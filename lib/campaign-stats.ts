// The area codes in the customer list, with how many people each covers, so the
// composer can offer them as filters instead of asking the manager to guess.
import { rest } from "./supabase";

// Counted in the database (migrations/0010). Reading every number back to group
// them here took eleven seconds on a list of twenty thousand, which is what the
// Marketing page waited for before it would open.
export async function areaCodeCounts(): Promise<{ code: string; people: number }[]> {
  const res = await rest("rpc/campaign_area_codes", { method: "POST", body: "{}" });
  if (!res.ok) return [];
  const rows = (await res.json()) as { code: string; people: number }[];
  return rows.filter((r) => r.code?.length === 3).slice(0, 12);
}
