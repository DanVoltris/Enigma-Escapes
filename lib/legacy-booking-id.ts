import { createHash } from "crypto";

// A booking's UUID is the only secret on its public pages — /booking/<id>,
// /confirmation/<id>, /receipt/<id> — and the key to cancelling or moving it.
// Bookings made here get a random one. Bookings imported from the old system
// used not to: the importer derived each id from the old transaction number so
// a re-import would update rather than duplicate. The formula is in a public
// repository and transaction numbers are small and sequential, so every such
// id can be rebuilt from its reference (VB-L<transaction>).
//
// migrations/0002 re-issues those ids at random and the importer no longer
// derives them. Any derivable id that remains — a venue the migration hasn't
// reached, or an import run from an old checkout — gets its public pages
// treated as unknown. Staff are unaffected: the portal never goes through
// these pages.
//
// This matches only an id that really is the derived one. Once an imported
// booking has been re-issued a random id it no longer matches and its links
// work again, so the check retires itself — nothing to remember to remove.

// The formula the importer used for booking ids (legacyId() in
// scripts/import-bookings.mjs, which still uses it for notes and blocked slots).
function derivedId(transactionId: string): string {
  const h = createHash("sha1").update(`voltris-legacy-booking:${transactionId}`).digest("hex");
  const variant = ((Number.parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function hasGuessableId(booking: { id: string; reference: string }): boolean {
  if (!booking.reference.startsWith("VB-L")) return false;
  return derivedId(booking.reference.slice("VB-L".length)) === booking.id;
}
