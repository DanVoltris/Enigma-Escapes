// Comparing a name somebody typed against a name held in the database.
//
// Room names carry punctuation no keyboard offers: "ZZ TEST ROOM — do not book"
// uses an em dash, and a hyphen is what you get when you type it. Demanding the
// exact character turns a confirmation into a guessing game — the point of
// typing the name is to prove you mean this room, not to test your typography.
//
// So dashes, curly quotes and runs of whitespace are levelled on both sides
// before comparing. It still has to be the name; this only forgives what a
// keyboard can't produce.
const DASHES = /[‐-―−]/g; // ‐ ‑ ‒ – — ― and the minus sign
const SINGLE_QUOTES = /[‘’‛′]/g; // ' ' ‛ ′
const DOUBLE_QUOTES = /[“”‟″]/g; // " " ‟ ″

export function normalizeForMatch(value: string): string {
  return value
    .replace(DASHES, "-")
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function typedNameMatches(typed: string, actual: string): boolean {
  const wanted = normalizeForMatch(actual);
  return wanted !== "" && normalizeForMatch(typed) === wanted;
}
