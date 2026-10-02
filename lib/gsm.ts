// Characters that read the same in a text but cost three times as much, and
// what a text costs to send.
//
// Kept apart from lib/sms.ts, which is server-only: the campaign composer runs
// in the browser and needs the same arithmetic to show what a message will cost
// before it goes to thousands of people.
// A text is 160 characters per segment only while every character is in the
// GSM-7 alphabet. One that isn't — an em dash, a curly apostrophe, an ellipsis —
// silently re-encodes the WHOLE message as UCS-2 at 70 characters a segment,
// and Twilio bills per segment. Our copy is written in prose style, so a single
// "—" was turning a two-segment confirmation into a five-segment one.
//
// Swapped here rather than policed in the templates: this way the copy can go on
// being written naturally and can never quietly get expensive again.
const GSM_SAFE: [RegExp, string][] = [
  [/[\u2010-\u2015\u2212]/g, "-"], // ‐ ‑ ‒ – — ― and the minus sign
  [/[\u2018\u2019\u201B\u2032]/g, "'"],
  [/[\u201C\u201D\u201F\u2033]/g, '"'],
  [/\u2026/g, "..."],
  [/\u2192/g, "->"],
  [/\u00A0/g, " "], // non-breaking space
  [/[\u2022\u00B7]/g, "*"],
];

export function toGsmSafe(body: string): string {
  return GSM_SAFE.reduce((text, [re, to]) => text.replace(re, to), body);
}

