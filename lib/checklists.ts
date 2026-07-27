// Staff checklists (room resets, opening/closing): definitions plus a per-day
// tick state, both in the settings table. State stores only today — when the
// date rolls over, every list starts unchecked again.
import { randomUUID } from "crypto";
import { todayISO } from "./format";
import { getSetting, saveSetting } from "./settings";

export type ChecklistItem = { id: string; text: string };
export type Checklist = { id: string; name: string; items: ChecklistItem[] };
export type ChecklistState = { date: string; checked: Record<string, boolean> };

const DEFS_KEY = "checklists";
const STATE_KEY = "checklist_state";

export async function getChecklists(): Promise<Checklist[]> {
  try {
    const { value } = await getSetting<Checklist[]>(DEFS_KEY);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

// Full-replace save with validation; caller sends the whole set (small data).
export function normalizeChecklists(input: unknown): Checklist[] | null {
  if (!Array.isArray(input) || input.length > 30) return null;
  const out: Checklist[] = [];
  for (const raw of input) {
    const o = (raw ?? {}) as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim().slice(0, 80) : "";
    if (!name || !Array.isArray(o.items) || o.items.length > 50) return null;
    const items: ChecklistItem[] = [];
    for (const ri of o.items) {
      const io = (ri ?? {}) as Record<string, unknown>;
      const text = typeof io.text === "string" ? io.text.trim().slice(0, 200) : "";
      if (!text) return null;
      items.push({ id: typeof io.id === "string" && io.id ? io.id : randomUUID(), text });
    }
    out.push({ id: typeof o.id === "string" && o.id ? o.id : randomUUID(), name, items });
  }
  return out;
}

export async function saveChecklists(lists: Checklist[]): Promise<void> {
  await saveSetting(DEFS_KEY, lists);
}

// Today's ticks; yesterday's state is discarded on first read of a new day.
export async function getTodayState(): Promise<ChecklistState> {
  const today = todayISO();
  try {
    const { value } = await getSetting<ChecklistState>(STATE_KEY);
    if (value && value.date === today && value.checked && typeof value.checked === "object") return value;
  } catch {
    // fall through to fresh state
  }
  return { date: today, checked: {} };
}

export async function setItemChecked(itemId: string, checked: boolean): Promise<ChecklistState> {
  const state = await getTodayState();
  const next: ChecklistState = { date: state.date, checked: { ...state.checked, [itemId]: checked } };
  if (!checked) delete next.checked[itemId];
  await saveSetting(STATE_KEY, next);
  return next;
}
