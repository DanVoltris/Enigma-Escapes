import { NextRequest, NextResponse } from "next/server";
import { apiGuard, canSeeLocation } from "@/lib/auth";
import { createBlocks, deleteBlocksForDate } from "@/lib/blocks";
import { logActivity } from "@/lib/db";
import { getExperience } from "@/lib/experiences";
import { formatDateLong, isValidISODate } from "@/lib/format";
import { getLocationHours } from "@/lib/hours";
import { startTimesFor } from "@/lib/schedule";

export const dynamic = "force-dynamic";

// Block slots: one or more rooms on a date, either specific times or the whole
// day (times omitted). Times are validated against each room's real schedule,
// so a stale page can't create blocks for sessions that don't exist.
export async function POST(req: NextRequest) {
  const guard = await apiGuard("blocks");
  if (guard.response) return guard.response;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const o = (body ?? {}) as Record<string, unknown>;

  const date = typeof o.date === "string" ? o.date : "";
  if (!isValidISODate(date)) return NextResponse.json({ error: "Pick a valid date." }, { status: 400 });
  const roomIds = Array.isArray(o.roomIds) ? o.roomIds.filter((r): r is string => typeof r === "string") : [];
  if (roomIds.length === 0) return NextResponse.json({ error: "Pick at least one experience." }, { status: 400 });
  const wholeDay = !Array.isArray(o.times);
  const wantedTimes = Array.isArray(o.times) ? o.times.filter((t): t is string => typeof t === "string") : [];
  if (!wholeDay && wantedTimes.length === 0) {
    return NextResponse.json({ error: "Pick at least one time, or block the whole day." }, { status: 400 });
  }
  const reason = typeof o.reason === "string" ? o.reason.trim().slice(0, 200) : "";

  const entries: { roomId: string; date: string; time: string }[] = [];
  const roomNames: string[] = [];
  for (const roomId of roomIds) {
    const exp = await getExperience(roomId);
    if (!exp) continue;
    if (!canSeeLocation(guard.staff, exp.location)) continue; // not their store
    const hours = exp.scheduleMode === "store" ? await getLocationHours(exp.location) : null;
    const dayTimes = startTimesFor(exp, date, hours);
    const times = wholeDay ? dayTimes : dayTimes.filter((t) => wantedTimes.includes(t));
    for (const time of times) entries.push({ roomId, date, time });
    if (times.length > 0) roomNames.push(exp.name);
  }
  if (entries.length === 0) {
    return NextResponse.json({ error: "Those rooms have no sessions at those times on that date." }, { status: 400 });
  }

  try {
    const count = await createBlocks(entries, reason);
    await logActivity(
      "Slots blocked off",
      `${count} slot(s) on ${formatDateLong(date)} — ${roomNames.join(", ")}${reason ? ` (${reason})` : ""}`
    );
    return NextResponse.json({ ok: true, blocked: count }, { status: 201 });
  } catch (err) {
    console.error("blocking slots failed:", err);
    return NextResponse.json({ error: "Could not block those slots right now. Please try again." }, { status: 500 });
  }
}

// Unblock an entire date (optionally one room on it).
export async function DELETE(req: NextRequest) {
  const guard = await apiGuard("blocks");
  if (guard.response) return guard.response;
  const o = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const date = typeof o.date === "string" ? o.date : "";
  if (!isValidISODate(date)) return NextResponse.json({ error: "Pick a valid date." }, { status: 400 });
  const roomId = typeof o.roomId === "string" && o.roomId ? o.roomId : undefined;
  try {
    await deleteBlocksForDate(date, roomId);
    await logActivity("Slots unblocked", `All blocks cleared on ${formatDateLong(date)}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("unblocking day failed:", err);
    return NextResponse.json({ error: "Could not unblock those slots right now. Please try again." }, { status: 500 });
  }
}
