import { NextRequest, NextResponse } from "next/server";
import { apiGuard, canSeeLocation } from "@/lib/auth";
import { deleteExperience, experienceUsage, getExperience, updateExperience } from "@/lib/experiences";
import { parseExperienceInput } from "@/lib/experience-validation";
import { typedNameMatches } from "@/lib/text-match";
import { logActivity } from "@/lib/db";

export const dynamic = "force-dynamic";

// What deleting this room would cost, for the panel that asks about it.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await apiGuard("experiences");
  if (guard.response) return guard.response;
  const { id } = await ctx.params;

  const experience = await getExperience(id);
  if (!experience) return NextResponse.json({ error: "That experience no longer exists." }, { status: 404 });
  if (!canSeeLocation(guard.staff, experience.location)) {
    return NextResponse.json({ error: "That room is at a location your account doesn't cover." }, { status: 403 });
  }
  try {
    return NextResponse.json({ name: experience.name, ...(await experienceUsage(id)) });
  } catch (err) {
    console.error("counting a room's bookings failed:", err);
    return NextResponse.json({ error: "Could not check this room's bookings. Try again shortly." }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await apiGuard("experiences");
  if (guard.response) return guard.response;
  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = parseExperienceInput(body);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const existing = await getExperience(id);
    if (!existing) return NextResponse.json({ error: "That experience no longer exists." }, { status: 404 });
    await updateExperience(id, parsed);
    await logActivity("Edited experience", `${parsed.name}${parsed.active ? "" : " (hidden)"}`);
    return NextResponse.json({ id });
  } catch (err) {
    console.error("updating experience failed:", err);
    return NextResponse.json(
      { error: "Could not save your changes right now. Please try again shortly." },
      { status: 500 }
    );
  }
}

// Deleting a room is not undoable and takes its past sessions off the calendar
// with it, so the same guards the panel shows are enforced here — the panel is
// what a staff member sees, this is what actually decides.
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await apiGuard("experiences");
  if (guard.response) return guard.response;
  const { id } = await ctx.params;

  const experience = await getExperience(id);
  if (!experience) return NextResponse.json({ error: "That experience no longer exists." }, { status: 404 });
  if (!canSeeLocation(guard.staff, experience.location)) {
    return NextResponse.json({ error: "That room is at a location your account doesn't cover." }, { status: 403 });
  }

  let usage: Awaited<ReturnType<typeof experienceUsage>>;
  try {
    usage = await experienceUsage(id);
  } catch (err) {
    // Never delete on a failed check: not knowing what's booked is exactly when
    // to stop.
    console.error("counting a room's bookings before deleting failed:", err);
    return NextResponse.json(
      { error: "Could not check what's booked in this room, so nothing was deleted. Try again shortly." },
      { status: 500 }
    );
  }

  if (usage.upcoming > 0) {
    return NextResponse.json(
      {
        error:
          `${usage.upcoming} session${usage.upcoming === 1 ? " is" : "s are"} still booked in this room, ` +
          `so deleting it would leave ${usage.upcoming === 1 ? "that customer" : "those customers"} ` +
          `booked into a room that no longer exists. Move or cancel ` +
          `${usage.upcoming === 1 ? "it" : "them"} first, or untick “Visible and bookable” to take the ` +
          `room off sale without losing anything.`,
      },
      { status: 409 }
    );
  }

  // Past history is the owner's call, but they have to name the room to make it
  // — a typo-proof confirmation for something that can't be undone. Matched
  // loosely on punctuation: several room names carry an em dash, which is not
  // on anyone's keyboard.
  if (usage.total > 0) {
    const typed = new URL(req.url).searchParams.get("confirm") ?? "";
    if (!typedNameMatches(typed, experience.name)) {
      return NextResponse.json(
        { error: `Type the room's name — “${experience.name}” — to confirm.` },
        { status: 400 }
      );
    }
  }

  try {
    await deleteExperience(id);
    await logActivity(
      "Deleted experience",
      `${experience.name} (${experience.location})` +
        (usage.total > 0 ? ` — ${usage.total.toLocaleString()} past bookings kept their details` : "")
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("deleting experience failed:", err);
    return NextResponse.json({ error: "Could not delete the room right now. Try again shortly." }, { status: 500 });
  }
}
