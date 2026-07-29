// Shared owner notes about site edits (the manager Notes tab): a small board
// the partners use to leave each other change requests and mark them done.
// Stored in the settings table under "edit_notes" — no schema changes needed
// on Supabase or local mode.
import { randomUUID } from "crypto";
import { getSetting, saveSetting } from "./settings";

export type EditNote = {
  id: string;
  author: string;
  text: string;
  done: boolean;
  createdAt: string;
};

const KEY = "edit_notes";

export async function listEditNotes(): Promise<EditNote[]> {
  try {
    const { value } = await getSetting<EditNote[]>(KEY);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export async function addEditNote(author: string, text: string): Promise<EditNote> {
  const notes = await listEditNotes();
  const note: EditNote = { id: randomUUID(), author, text, done: false, createdAt: new Date().toISOString() };
  await saveSetting(KEY, [note, ...notes].slice(0, 500)); // newest first, sane cap
  return note;
}

export async function setEditNoteDone(id: string, done: boolean): Promise<boolean> {
  const notes = await listEditNotes();
  const idx = notes.findIndex((n) => n.id === id);
  if (idx < 0) return false;
  notes[idx] = { ...notes[idx], done };
  await saveSetting(KEY, notes);
  return true;
}

export async function deleteEditNote(id: string): Promise<boolean> {
  const notes = await listEditNotes();
  const remaining = notes.filter((n) => n.id !== id);
  if (remaining.length === notes.length) return false;
  await saveSetting(KEY, remaining);
  return true;
}
