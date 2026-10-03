// Shared terminal-drawing bits: gradients and the CLAUDE GLOW banner.
import { mix } from "./color-math.mjs";

/** `n` colors spread evenly across the gradient `stops` (hex strings). */
export function gradientColors(stops, n) {
  if (n <= 1) return [stops[0]];
  const segments = stops.length - 1;
  const out = [];
  for (let i = 0; i < n; i++) {
    const pos = (i / (n - 1)) * segments;
    const k = Math.min(segments - 1, Math.floor(pos));
    out.push(mix(stops[k], stops[k + 1], pos - k));
  }
  return out;
}

/** One line of text with a left-to-right gradient. */
export function gradientText(text, stops, C) {
  const chars = [...String(text)];
  const colors = gradientColors(stops, chars.length);
  return chars.map((ch, i) => (ch === " " ? ch : C.fg(colors[i]) + ch)).join("") + C.reset;
}

// "CLAUDE  GLOW" in a three-row box-drawing font; every row is 32 cells wide.
export const BANNER_ROWS = [
  "╔═╗╦  ╔═╗╦ ╦╔╦╗╔═╗  ╔═╗╦  ╔═╗╦ ╦",
  "║  ║  ╠═╣║ ║ ║║║╣   ║ ╦║  ║ ║║║║",
  "╚═╝╩═╝╩ ╩╚═╝═╩╝╚═╝  ╚═╝╩═╝╚═╝╚╩╝",
];

/** The banner as colored lines, the gradient running across all rows' columns. */
export function bannerLines(stops, C) {
  const colors = gradientColors(stops, BANNER_ROWS[0].length);
  return BANNER_ROWS.map((row) => [...row].map((ch, i) => (ch === " " ? ch : C.fg(colors[i]) + ch)).join("") + C.reset);
}
