// Manager-blocked time slots (maintenance, private events, staff shortages).
// A blocked slot is hidden from the booking site and the partner feed, and the
// booking/request APIs refuse it — including staff walk-ins, so a slot taken
// out of service can't be filled by accident. Unblock to bring it back.
import { randomUUID } from "crypto";
import { startTimesFor, weekdayOf } from "./schedule";
import { addDaysISO } from "./format";
import type { Experience, LocationHours } from "./types";
import { rest, restError } from "./supabase";

export type SlotBlock = {
  id: string;
  roomId: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  reason: string;
  blockedBy: string; // who took it out of service; "" for the importer's own
  createdAt: string;
};

type Row = {
  id: string;
  room_id: string;
  date: string;
  time: string;
  reason: string | null;
  // Added later, so rows written before the column existed read as undefined.
  blocked_by?: string | null;
  created_at: string;
};

function toBlock(r: Row): SlotBlock {
  return {
    id: r.id,
    roomId: r.room_id,
    date: r.date,
    time: r.time,
    reason: r.reason ?? "",
    blockedBy: r.blocked_by ?? "",
    createdAt: r.created_at,
  };
}

// Blocks from `fromDate` onward (past blocks age out of the manager list).
export async function listBlocks(fromDate?: string): Promise<SlotBlock[]> {
  const filter = fromDate ? `&date=gte.${fromDate}` : "";
  const res = await rest(`slot_blocks?select=*${filter}&order=date.asc,time.asc`);
  if (res.status === 404) return []; // table not created yet
  if (!res.ok) throw await restError(res, "Loading blocked slots");
  return ((await res.json()) as Row[]).map(toBlock);
}

// "roomId|time" keys for one date — the shape availability filtering wants.
// One-off blocks and repeating ones together: everything that decides whether a
// session is on sale asks here, so a rule needs no other wiring.
// Never throws: a blocks-table problem must not take the booking site down.
export async function blockedKeysForDate(date: string): Promise<Set<string>> {
  const [oneOff, rules] = await Promise.all([
    (async () => {
      try {
        const res = await rest(`slot_blocks?select=room_id,time&date=eq.${encodeURIComponent(date)}`);
        if (!res.ok) return [];
        const rows = (await res.json()) as { room_id: string; time: string }[];
        return rows.map((r) => `${r.room_id}|${r.time}`);
      } catch {
        return [];
      }
    })(),
    listBlockRules().catch(() => [] as BlockRule[]),
  ]);
  return new Set([...oneOff, ...ruleKeysForDate(rules, date)]);
}

export async function isBlocked(roomId: string, date: string, time: string): Promise<boolean> {
  const keys = await blockedKeysForDate(date);
  return keys.has(`${roomId}|${time}`);
}

// Bulk block. Existing blocks for the same slot are left as they are (the
// unique index makes re-blocking a no-op rather than an error).
export async function createBlocks(
  entries: { roomId: string; date: string; time: string }[],
  reason: string,
  blockedBy: string
): Promise<number> {
  if (entries.length === 0) return 0;
  const rows = entries.map((e) => ({
    id: randomUUID(),
    room_id: e.roomId,
    date: e.date,
    time: e.time,
    reason: reason || null,
    blocked_by: blockedBy || null,
    created_at: new Date().toISOString(),
  }));
  // A slot is a business's own room, date and time (migrations/0003).
  const res = await rest("slot_blocks?on_conflict=tenant_id,room_id,date,time", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw await restError(res, "Blocking the slots");
  return rows.length;
}

// Returns the row that was removed, so the caller can say what went back on
// sale rather than logging a bare id nobody can look up.
export async function deleteBlock(id: string): Promise<SlotBlock | undefined> {
  const res = await rest(`slot_blocks?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Prefer: "return=representation" },
  });
  if (!res.ok) throw await restError(res, "Unblocking the slot");
  const rows = (await res.json()) as Row[];
  return rows[0] ? toBlock(rows[0]) : undefined;
}

// One block, so a caller can check whose room it is before removing it.
export async function getBlock(id: string): Promise<SlotBlock | undefined> {
  const res = await rest(`slot_blocks?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
  if (res.status === 404) return undefined; // table not created yet
  if (!res.ok) throw await restError(res, "Loading the blocked slot");
  const rows = (await res.json()) as Row[];
  return rows[0] ? toBlock(rows[0]) : undefined;
}

// Clears every block on one date (optionally just for some rooms).
export async function deleteBlocksForDate(date: string, roomIds?: string[]): Promise<void> {
  if (roomIds && roomIds.length === 0) return;
  const list = roomIds?.map((r) => `"${r.replace(/"/g, '\\"')}"`).join(",");
  const roomFilter = list ? `&room_id=in.(${encodeURIComponent(list)})` : "";
  const res = await rest(`slot_blocks?date=eq.${encodeURIComponent(date)}${roomFilter}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
  if (!res.ok) throw await restError(res, "Unblocking the day");
}

// ---------- repeating blocks (slot_block_rules, migrations/0016) ----------
// The same sessions out of service week after week — "no Monday mornings until
// we've hired". A rule is never expanded into slot_blocks: it is read alongside
// them, so removing it puts every session back at once and an open-ended one
// never runs out.

export type BlockRule = {
  id: string;
  roomId: string;
  weekdays: number[]; // 0 = Sunday … 6 = Saturday
  times: string[]; // HH:MM
  from: string; // YYYY-MM-DD
  until: string | null; // null = until removed
  reason: string;
  blockedBy: string;
  createdAt: string;
};

type RuleRow = {
  id: string;
  room_id: string;
  weekdays: number[];
  times: string[];
  date_from: string;
  date_to: string | null;
  reason: string;
  blocked_by: string | null;
  created_at: string;
};

function toRule(r: RuleRow): BlockRule {
  return {
    id: r.id,
    roomId: r.room_id,
    weekdays: r.weekdays ?? [],
    times: r.times ?? [],
    from: r.date_from,
    until: r.date_to ?? null,
    reason: r.reason ?? "",
    blockedBy: r.blocked_by ?? "",
    createdAt: r.created_at,
  };
}

// Every rule, including ones that have ended — there are a handful per venue,
// and filtering by date here is simpler than in a PostgREST query string.
export async function listBlockRules(): Promise<BlockRule[]> {
  const res = await rest("slot_block_rules?select=*&order=created_at.asc");
  if (res.status === 404) return []; // migration 0016 not applied yet
  if (!res.ok) throw await restError(res, "Loading repeating blocks");
  return ((await res.json()) as RuleRow[]).map(toRule);
}

export function ruleCovers(rule: BlockRule, date: string): boolean {
  return (
    date >= rule.from && (rule.until === null || date <= rule.until) && rule.weekdays.includes(weekdayOf(date))
  );
}

// "roomId|time" keys the rules take out of service on one date.
export function ruleKeysForDate(rules: BlockRule[], date: string): string[] {
  return rules.filter((r) => ruleCovers(r, date)).flatMap((r) => r.times.map((t) => `${r.roomId}|${t}`));
}

// "roomId|date|time" keys over a stretch of days — the reports' shape.
export function ruleKeysForDays(rules: BlockRule[], days: string[]): string[] {
  return days.flatMap((d) => ruleKeysForDate(rules, d).map((k) => {
    const [roomId, time] = k.split("|");
    return `${roomId}|${d}|${time}`;
  }));
}

// The start times a room runs on each weekday — what a rule can pick from. Its
// usual times, plus whatever the next two weeks actually run (a stretch of
// different times in force now is worth blocking too).
export function weeklyStartTimes(exp: Experience, hours: LocationHours | null, from: string): Record<number, string[]> {
  const usual = { ...exp, dateTimes: {}, timePeriods: [] };
  const week: Record<number, Set<string>> = {};
  for (let i = 0; i < 14; i++) {
    const date = addDaysISO(from, i);
    const dow = weekdayOf(date);
    for (const t of [...startTimesFor(usual, date, hours), ...startTimesFor(exp, date, hours)]) {
      (week[dow] ??= new Set()).add(t);
    }
  }
  return Object.fromEntries(Object.entries(week).map(([d, set]) => [Number(d), [...set].sort()]));
}

export async function createBlockRule(rule: Omit<BlockRule, "id" | "createdAt">): Promise<void> {
  const res = await rest("slot_block_rules", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      id: randomUUID(),
      room_id: rule.roomId,
      weekdays: rule.weekdays,
      times: rule.times,
      date_from: rule.from,
      date_to: rule.until,
      reason: rule.reason,
      blocked_by: rule.blockedBy || null,
      created_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) throw await restError(res, "Saving the repeating block");
}

export async function getBlockRule(id: string): Promise<BlockRule | undefined> {
  const res = await rest(`slot_block_rules?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
  if (res.status === 404) return undefined;
  if (!res.ok) throw await restError(res, "Loading the repeating block");
  const rows = (await res.json()) as RuleRow[];
  return rows[0] ? toRule(rows[0]) : undefined;
}

export async function deleteBlockRule(id: string): Promise<BlockRule | undefined> {
  const res = await rest(`slot_block_rules?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Prefer: "return=representation" },
  });
  if (!res.ok) throw await restError(res, "Removing the repeating block");
  const rows = (await res.json()) as RuleRow[];
  return rows[0] ? toRule(rows[0]) : undefined;
}
