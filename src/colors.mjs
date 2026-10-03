// Terminal color helpers shared by the status line and the CLI: color-mode detection, 24-bit and
// nearest-xterm-256 output, and ANSI-aware width measuring and truncation. No dependencies.
import { hexToRgb } from "./color-math.mjs";

/**
 * "truecolor" (default), "256" or "none".
 *   none  when NO_COLOR is set (non-empty) or GLOW_COLOR=0
 *   256   when GLOW_COLOR=256 or TERM_PROGRAM=Apple_Terminal (it has no 24-bit color)
 *   GLOW_COLOR=truecolor forces 24-bit even on Apple Terminal.
 */
export function detectColorMode(env = process.env) {
  const glow = String(env.GLOW_COLOR ?? "").trim().toLowerCase();
  if ((env.NO_COLOR !== undefined && env.NO_COLOR !== "") || ["0", "off", "false", "none"].includes(glow)) return "none";
  if (glow === "256") return "256";
  if (["truecolor", "24bit", "16m"].includes(glow)) return "truecolor";
  if (env.TERM_PROGRAM === "Apple_Terminal") return "256";
  return "truecolor";
}

/**
 * Color mode for CLI commands that print for a person. The status line always colors (Claude Code
 * reads a pipe), but a command piped into a file should stay plain unless color is asked for.
 */
export function cliColorMode(stream = process.stdout, env = process.env) {
  const mode = detectColorMode(env);
  if (mode === "none") return mode;
  if (!stream.isTTY && !env.FORCE_COLOR && !env.GLOW_COLOR) return "none";
  return mode;
}

const CUBE = [0, 95, 135, 175, 215, 255];

/** Nearest xterm-256 index for an rgb triple (6x6x6 cube or the grey ramp, whichever is closer). */
export function to256([r, g, b]) {
  const level = (v) => (v < 48 ? 0 : v < 115 ? 1 : Math.min(5, Math.floor((v - 35) / 40)));
  const ri = level(r);
  const gi = level(g);
  const bi = level(b);
  const dist = (x, y, z) => (r - x) ** 2 + (g - y) ** 2 + (b - z) ** 2;
  const cube = dist(CUBE[ri], CUBE[gi], CUBE[bi]);
  const grey = Math.max(0, Math.min(23, Math.round(((r + g + b) / 3 - 8) / 10)));
  const gv = 8 + 10 * grey;
  if (dist(gv, gv, gv) < cube) return 232 + grey;
  return 16 + 36 * ri + 6 * gi + bi;
}

/** Escape-sequence factory for a color mode. In "none" mode every sequence is the empty string. */
export function makeColors(mode = detectColorMode()) {
  const on = mode !== "none";
  const seq = (code) => (on ? `\x1b[${code}m` : "");
  const rgbOf = (hex) => { try { return hexToRgb(hex); } catch { return null; } };
  const color = (kind, hex) => {
    const rgb = on ? rgbOf(hex) : null;
    if (!rgb) return "";
    return mode === "256" ? `\x1b[${kind};5;${to256(rgb)}m` : `\x1b[${kind};2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
  };
  return {
    mode,
    on,
    fg: (hex) => color(38, hex),
    bg: (hex) => color(48, hex),
    fgDefault: seq(39),
    bgDefault: seq(49),
    bold: seq(1),
    boldOff: seq(22),
    reset: seq(0),
    /** text wrapped in a foreground color (and optional background), reset afterwards */
    paint(text, fg, bg) {
      const open = (fg ? color(38, fg) : "") + (bg ? color(48, bg) : "");
      return open ? open + text + seq(0) : text;
    },
  };
}

// CSI sequences (colors, cursor), OSC sequences (hyperlinks, titles), and lone two-byte escapes.
const ANSI_SOURCE = "\\x1b\\[[0-9;:?]*[ -/]*[@-~]|\\x1b\\][^\\x07\\x1b]*(?:\\x07|\\x1b\\\\)|\\x1b[@-Z\\\\-_]";
const ANSI_GLOBAL = new RegExp(ANSI_SOURCE, "g");
const ANSI_STICKY = new RegExp(ANSI_SOURCE, "y");

export const stripAnsi = (s) => String(s).replace(ANSI_GLOBAL, "");

// Code points drawn two cells wide: CJK, Hangul, fullwidth forms, emoji (including the BMP
// emoji-presentation ones such as the lightning bolt and check mark).
const WIDE_RANGES = [
  [0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff],
  [0xa000, 0xa4cf], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe30, 0xfe6f], [0xff00, 0xff60],
  [0xffe0, 0xffe6], [0x1f300, 0x1f64f], [0x1f680, 0x1f6ff], [0x1f900, 0x1f9ff], [0x1fa70, 0x1faff],
  [0x20000, 0x3fffd],
  [0x231a, 0x231b], [0x23e9, 0x23ec], [0x23f0, 0x23f0], [0x23f3, 0x23f3], [0x25fd, 0x25fe],
  [0x2614, 0x2615], [0x2648, 0x2653], [0x267f, 0x267f], [0x2693, 0x2693], [0x26a1, 0x26a1],
  [0x26aa, 0x26ab], [0x26bd, 0x26be], [0x26c4, 0x26c5], [0x26ce, 0x26ce], [0x26d4, 0x26d4],
  [0x26ea, 0x26ea], [0x26f2, 0x26f3], [0x26f5, 0x26f5], [0x26fa, 0x26fa], [0x26fd, 0x26fd],
  [0x2705, 0x2705], [0x270a, 0x270b], [0x2728, 0x2728], [0x274c, 0x274c], [0x274e, 0x274e],
  [0x2753, 0x2755], [0x2757, 0x2757], [0x2795, 0x2797], [0x27b0, 0x27b0], [0x27bf, 0x27bf],
  [0x2b1b, 0x2b1c], [0x2b50, 0x2b50], [0x2b55, 0x2b55],
];

/** Terminal cell width of one code point: 0 (controls, combining, joiners), 1 or 2. */
export function charWidth(cp) {
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if (cp < 0x300) return 1;
  if ((cp >= 0x300 && cp <= 0x36f) || (cp >= 0x200b && cp <= 0x200f) || (cp >= 0x2060 && cp <= 0x2064)
    || (cp >= 0xfe00 && cp <= 0xfe0f) || cp === 0xfeff || (cp >= 0xe0100 && cp <= 0xe01ef)) return 0;
  for (const [lo, hi] of WIDE_RANGES) if (cp >= lo && cp <= hi) return 2;
  return 1;
}

/** Visible width of a string in terminal cells, ignoring ANSI escapes. */
export function visibleWidth(str) {
  let w = 0;
  for (const ch of stripAnsi(str)) w += charWidth(ch.codePointAt(0));
  return w;
}

/**
 * Cut `str` to at most `max` cells, keeping its ANSI escapes intact, and end with `ellipsis`
 * when something was cut. Resets styling after a cut so colors never leak into the next line.
 */
export function truncate(str, max, ellipsis = "…") {
  str = String(str);
  if (max <= 0) return "";
  if (visibleWidth(str) <= max) return str;
  const budget = Math.max(0, max - visibleWidth(ellipsis));
  let out = "";
  let used = 0;
  let i = 0;
  let styled = false;
  while (i < str.length) {
    ANSI_STICKY.lastIndex = i;
    const m = ANSI_STICKY.exec(str);
    if (m) { out += m[0]; styled = true; i += m[0].length; continue; }
    const cp = str.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    const w = charWidth(cp);
    if (used + w > budget) break;
    out += ch;
    used += w;
    i += ch.length;
  }
  return out + (styled ? "\x1b[0m" : "") + ellipsis;
}

/** Pad with spaces on the right to `width` visible cells. */
export const padEndVisible = (s, width) => s + " ".repeat(Math.max(0, width - visibleWidth(s)));

/** Word-wrap plain text to `width` cells; returns the lines. */
export function wrapText(text, width) {
  const lines = [];
  let cur = "";
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    if (!cur) cur = word;
    else if (visibleWidth(cur) + 1 + visibleWidth(word) <= width) cur += " " + word;
    else { lines.push(cur); cur = word; }
  }
  if (cur) lines.push(cur);
  return lines;
}
