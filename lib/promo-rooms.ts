// Which rooms a promo code is limited to, as staff set it on Promo codes.
// Shared by the create and edit routes.
import { listExperiences } from "./experiences";

export const PROMO_ROOMS_MIGRATION =
  "Limiting a code to some rooms needs migration 0019 (promo rooms) on this venue's database first.";

// The rooms a code is limited to, checked against the venue's real rooms.
// Returns the cleaned list (empty = every room) or an error to show.
export async function parsePromoRooms(raw: unknown): Promise<{ ids: string[]; names: string[] } | { error: string }> {
  if (raw === undefined || raw === null) return { ids: [], names: [] };
  if (!Array.isArray(raw) || raw.some((r) => typeof r !== "string") || raw.length > 50) {
    return { error: "Choose the rooms from the list." };
  }
  const rooms = await listExperiences();
  const ids = [...new Set(raw as string[])];
  const unknown = ids.filter((id) => !rooms.some((r) => r.id === id));
  if (unknown.length > 0) return { error: "One of those rooms no longer exists. Reload the page." };
  return { ids, names: ids.map((id) => rooms.find((r) => r.id === id)!.name) };
}
