import { NextRequest, NextResponse } from "next/server";
import { apiGuard, canSeeLocation } from "@/lib/auth";
import { createBlockRule, weeklyStartTimes } from "@/lib/blocks";
import { logActivity } from "@/lib/db";
import { getExperience } from "@/lib/experiences";
import { formatDateLong, formatTime, isValidISODate, todayISO } from "@/lib/format";
import { getLocationHours } from "@/lib/hours";
import { WEEKDAY_NAMES } from "@/lib/schedule";

export const dynamic = "force-dynamic";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// A repeating block: the same sessions out of service on chosen weekdays, from
// a date until a date or until removed. One rule per room, and each keeps only
// the times that room actually runs on those weekdays, so a stale page can't
// save a rule for sessions that don't exist.
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

  const roomIds = Array.isArray(o.roomIds) ? o.roomIds.filter((r): r is string => typeof r === "string") : [];
  if (roomIds.length === 0) return NextResponse.json({ error: "Pick at least one experience." }, { status: 400 });
  const weekdays = Array.isArray(o.weekdays)
    ? [...new Set(o.weekdays.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
    : [];
  if (weekdays.length === 0) return NextResponse.json({ error: "Pick at least one day of the week." }, { status: 400 });
  const times = Array.isArray(o.times) ? o.times.filter((t): t is string => typeof t === "string" && TIME_RE.test(t)) : [];
  if (times.length === 0) return NextResponse.json({ error: "Pick at least one time." }, { status: 400 });

  const today = todayISO();
  const from = typeof o.from === "string" ? o.from : "";
  if (!isValidISODate(from)) return NextResponse.json({ error: "Pick a start date." }, { status: 400 });
  if (from < today) return NextResponse.json({ error: "The start date can't be in the past." }, { status: 400 });
  const until = typeof o.until === "string" && o.until ? o.until : null;
  if (until !== null && (!isValidISODate(until) || until < from)) {
    return NextResponse.json({ error: "The end date must be on or after the start date." }, { status: 400 });
  }
  const reason = typeof o.reason === "string" ? o.reason.trim().slice(0, 200) : "";
  if (reason.length < 3) {
    return NextResponse.json(
      { error: "Say why it's blocked — short-staffed, renovation. Whoever finds it later needs to know." },
      { status: 400 }
    );
  }

  const who = guard.staff.name || guard.staff.email;
  const saved: string[] = [];
  try {
    for (const roomId of roomIds) {
      const exp = await getExperience(roomId);
      if (!exp || !canSeeLocation(guard.staff, exp.location)) continue;
      const hours = exp.scheduleMode === "store" ? await getLocationHours(exp.location) : null;
      const week = weeklyStartTimes(exp, hours, today);
      const runs = new Set(weekdays.flatMap((d) => week[d] ?? []));
      const mine = times.filter((t) => runs.has(t)).sort();
      if (mine.length === 0) continue;
      await createBlockRule({ roomId, weekdays, times: mine, from, until, reason, blockedBy: who });
      saved.push(`${exp.name} ${mine.map(formatTime).join(", ")}`);
    }
  } catch (err) {
    console.error("saving repeating block failed:", err);
    return NextResponse.json({ error: "Could not save that repeating block right now. Please try again." }, { status: 500 });
  }
  if (saved.length === 0) {
    return NextResponse.json({ error: "Those rooms don't run those times on those days." }, { status: 400 });
  }
  const days = weekdays.map((d) => WEEKDAY_NAMES[d].slice(0, 3)).join(", ");
  await logActivity(
    "Repeating block added",
    `${saved.join("; ")} — every ${days} from ${formatDateLong(from)} ${until ? `to ${formatDateLong(until)}` : "until further notice"} — ${who}: ${reason}`
  );
  return NextResponse.json({ ok: true, rules: saved.length }, { status: 201 });
}
