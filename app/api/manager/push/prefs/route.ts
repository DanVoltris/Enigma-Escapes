import { NextRequest, NextResponse } from "next/server";
import { apiGuard } from "@/lib/auth";
import { getPrefs, savePrefs } from "@/lib/push";
import { eventsFor, PUSH_EVENTS, type PushEvent } from "@/lib/push-events";

export const dynamic = "force-dynamic";

// Which alerts this person wants on their phones. Their own choices only —
// nobody sets another person's.
export async function PUT(req: NextRequest) {
  const guard = await apiGuard();
  if (guard.response) return guard.response;
  const o = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const event = o.event as PushEvent;
  if (!PUSH_EVENTS.includes(event) || typeof o.on !== "boolean") {
    return NextResponse.json({ error: "Say which alert and whether it's on." }, { status: 400 });
  }
  if (!eventsFor(guard.staff).includes(event)) {
    return NextResponse.json({ error: "Your account doesn't have access to that alert." }, { status: 403 });
  }
  try {
    const prefs = await getPrefs(guard.staff.id);
    await savePrefs(guard.staff.id, { ...prefs, [event]: o.on });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("saving notification choices failed:", err);
    return NextResponse.json({ error: "Could not save that. Please try again." }, { status: 500 });
  }
}
