// Manager-blocked time slots (maintenance, private events, staff shortages).
// A blocked slot is hidden from the booking site and the partner feed, and the
// booking/request APIs refuse it — including staff walk-ins, so a slot taken
// out of service can't be filled by accident. Unblock to bring it back.
import { randomUUID } from "crypto";
import { rest, restError } from "./supabase";

export type SlotBlock = {
  id: string;
  roomId: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  reason: string;
  createdAt: string;
};

type Row = { id: string; room_id: string; date: string; time: string; reason: string | null; created_at: string };

function toBlock(r: Row): SlotBlock {
  return {
    id: r.id,
    roomId: r.room_id,
    date: r.date,
    time: r.time,
    reason: r.reason ?? "",
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
// Never throws: a blocks-table problem must not take the booking site down.
export async function blockedKeysForDate(date: string): Promise<Set<string>> {
  try {
    const res = await rest(`slot_blocks?select=room_id,time&date=eq.${encodeURIComponent(date)}`);
    if (!res.ok) return new Set();
    const rows = (await res.json()) as { room_id: string; time: string }[];
    return new Set(rows.map((r) => `${r.room_id}|${r.time}`));
  } catch {
    return new Set();
  }
}

export async function isBlocked(roomId: string, date: string, time: string): Promise<boolean> {
  const keys = await blockedKeysForDate(date);
  return keys.has(`${roomId}|${time}`);
}

// Bulk block. Existing blocks for the same slot are left as they are (the
// unique index makes re-blocking a no-op rather than an error).
export async function createBlocks(
  entries: { roomId: string; date: string; time: string }[],
  reason: string
): Promise<number> {
  if (entries.length === 0) return 0;
  const rows = entries.map((e) => ({
    id: randomUUID(),
    room_id: e.roomId,
    date: e.date,
    time: e.time,
    reason: reason || null,
    created_at: new Date().toISOString(),
  }));
  const res = await rest("slot_blocks?on_conflict=room_id,date,time", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw await restError(res, "Blocking the slots");
  return rows.length;
}

export async function deleteBlock(id: string): Promise<boolean> {
  const res = await rest(`slot_blocks?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
  if (!res.ok) throw await restError(res, "Unblocking the slot");
  return true;
}

// Clears every block on one date (optionally just for one room).
export async function deleteBlocksForDate(date: string, roomId?: string): Promise<void> {
  const roomFilter = roomId ? `&room_id=eq.${encodeURIComponent(roomId)}` : "";
  const res = await rest(`slot_blocks?date=eq.${encodeURIComponent(date)}${roomFilter}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
  if (!res.ok) throw await restError(res, "Unblocking the day");
}
