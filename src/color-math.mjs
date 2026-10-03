// Pure color math: hex <-> rgb, mixing, WCAG luminance and contrast. No dependencies, no I/O.
// Everything outside this file talks in "#rrggbb" strings; helpers always return lower-case 6-digit hex.

/** "#abc" or "#aabbcc" -> [r, g, b]. Throws on anything else so palette typos fail loudly. */
export function hexToRgb(hex) {
  let h = String(hex).trim().replace(/^#/, "");
  if (h.length === 3) h = h.replace(/./g, "$&$&");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`not a hex color: ${JSON.stringify(hex)}`);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const byte = (v) => Math.max(0, Math.min(255, Math.round(v)));

/** [r, g, b] -> "#rrggbb" (values are rounded and clamped). */
export function rgbToHex([r, g, b]) {
  return "#" + [r, g, b].map((v) => byte(v).toString(16).padStart(2, "0")).join("");
}

/** Normalize any accepted hex spelling to "#rrggbb". */
export const normalizeHex = (hex) => rgbToHex(hexToRgb(hex));

/** Linear blend: t=0 gives a, t=1 gives b. */
export function mix(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex(A.map((v, i) => v + (B[i] - v) * t));
}

export const lighten = (hex, amount) => mix(hex, "#ffffff", amount);
export const darken = (hex, amount) => mix(hex, "#000000", amount);

/** WCAG 2.x relative luminance, 0 (black) .. 1 (white). */
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colors, 1 (identical) .. 21 (black on white). */
export function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Nudge `color` towards white or black (whichever gives the better contrast on `bg`)
 * until it reaches `min` contrast. Returns the color unchanged when it already passes.
 */
export function ensureContrast(color, bg, min) {
  const c = normalizeHex(color);
  if (contrast(c, bg) >= min) return c;
  const target = contrast("#ffffff", bg) >= contrast("#000000", bg) ? "#ffffff" : "#000000";
  if (contrast(target, bg) < min) return target; // unreachable demand: best effort
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (contrast(mix(c, target, mid), bg) >= min) hi = mid; else lo = mid;
  }
  return mix(c, target, hi);
}

/** The first candidate that reaches `min` contrast on `bg`, else the best of black/white. */
export function readableOn(bg, candidates, min = 4.5) {
  for (const c of candidates) if (contrast(c, bg) >= min) return normalizeHex(c);
  return contrast("#ffffff", bg) >= contrast("#000000", bg) ? "#ffffff" : "#000000";
}
