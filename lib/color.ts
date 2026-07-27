// Pure colour helpers for deriving readable theme tokens from a brand colour.
// Used by the site and manager layouts; keep this module dependency-free.
// Inputs are validated #rrggbb strings (see normalizeSiteSettings).

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
}

// Darken by multiplying channels (factor < 1) — hover states.
export function shade(hex: string, factor: number): string {
  const [r, g, b] = hexToRgb(hex);
  return toHex(r * factor, g * factor, b * factor);
}

// Mix towards white (weight 0..1 = how much white) — tinted backgrounds.
export function tint(hex: string, weight: number): string {
  const [r, g, b] = hexToRgb(hex);
  return toHex(r + (255 - r) * weight, g + (255 - g) * weight, b + (255 - b) * weight);
}

// Dark ink or white, whichever reads better on the given colour
// (WCAG-style relative luminance).
export function readableOn(hex: string): string {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.4 ? "#16212b" : "#ffffff";
}
