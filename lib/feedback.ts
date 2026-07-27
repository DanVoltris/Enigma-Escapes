// Post-game survey responses, keyed by booking reference (one per booking —
// resubmitting overwrites, which also caps abuse from the public form).
// Supabase table (see CLAUDE.md): feedback(reference text primary key,
// rating int, comment text, name text, created_at timestamptz).
import { rest, restError } from "./supabase";

export type Feedback = {
  reference: string;
  rating: number; // 1-5
  comment: string;
  name: string;
  createdAt: string;
};

type Row = { reference: string; rating: number; comment: string; name: string; created_at: string };

export async function saveFeedback(fb: Feedback): Promise<void> {
  const res = await rest("feedback?on_conflict=reference", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([
      { reference: fb.reference, rating: fb.rating, comment: fb.comment, name: fb.name, created_at: fb.createdAt },
    ]),
  });
  if (res.status === 404) throw new Error("The feedback table doesn't exist yet — see CLAUDE.md for the SQL.");
  if (!res.ok) throw await restError(res, "Saving the feedback");
}

export async function listFeedback(): Promise<Feedback[]> {
  const res = await rest("feedback?select=*&order=created_at.desc");
  if (res.status === 404) return []; // table not created yet — report nothing
  if (!res.ok) throw await restError(res, "Loading feedback");
  return ((await res.json()) as Row[]).map((r) => ({
    reference: r.reference,
    rating: r.rating,
    comment: r.comment ?? "",
    name: r.name ?? "",
    createdAt: r.created_at,
  }));
}
