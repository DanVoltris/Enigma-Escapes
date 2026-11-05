import { pinnedTenantId } from "./supabase";

// How long a venue's icon or manifest may be reused. These were drawn afresh
// on every request — thousands a day for a picture that changes when the
// owner uploads a new logo, which phones only pick up on reinstall anyway.
//
// The browser may keep it for `seconds`. Vercel's edge may too, and serve it
// without running anything, but only on a deployment pinned to one business:
// the platform deployment answers for many businesses at different addresses
// from the same code, and the edge must not be what decides whose icon a
// phone gets.
export function venueAssetCache(seconds: number, browserSeconds = seconds): string {
  const edge = pinnedTenantId() ? `, s-maxage=${seconds}, stale-while-revalidate=${seconds * 7}` : "";
  return `public, max-age=${browserSeconds}${edge}`;
}
