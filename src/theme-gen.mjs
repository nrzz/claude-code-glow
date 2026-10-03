// Turns a palette (src/palettes.mjs) into a Claude Code theme file:
//   { name, base, overrides: { <every UI color key> }, glow: { <status-line palette> } }
// Claude Code reads name/base/overrides and ignores the extra "glow" object, so one file per theme
// is the single source of truth for both the UI colors and the status line.
//
// Guards keep every theme legible: text >= 4.5:1 on the background (also on diff backgrounds),
// accent hues >= 3:1, dim text >= 3:1. A color only moves when it fails, and only towards white
// or black, so the published palette survives wherever it already works.
import {
  contrast, ensureContrast, lighten, mix, normalizeHex, readableOn,
} from "./color-math.mjs";

export * from "./color-math.mjs";

/** Every color key Claude Code 2.1.28x accepts in `overrides`. */
export const COLOR_KEYS = [
  "autoAccept", "skill", "bashBorder", "claude", "claudeShimmer",
  "claudeBlue_FOR_SYSTEM_SPINNER", "claudeBlueShimmer_FOR_SYSTEM_SPINNER",
  "permission", "permissionShimmer", "planMode", "ide", "promptBorder", "promptBorderShimmer",
  "text", "inverseText", "inactive", "inactiveShimmer", "subtle", "suggestion", "remember",
  "background", "success", "error", "warning", "merged", "warningShimmer",
  "diffAdded", "diffRemoved", "diffAddedDimmed", "diffRemovedDimmed", "diffAddedWord", "diffRemovedWord",
  "red_FOR_SUBAGENTS_ONLY", "blue_FOR_SUBAGENTS_ONLY", "green_FOR_SUBAGENTS_ONLY",
  "yellow_FOR_SUBAGENTS_ONLY", "purple_FOR_SUBAGENTS_ONLY", "orange_FOR_SUBAGENTS_ONLY",
  "pink_FOR_SUBAGENTS_ONLY", "cyan_FOR_SUBAGENTS_ONLY",
  "professionalBlue", "chromeYellow", "clawd_body", "clawd_background",
  "userMessageBackground", "userMessageBackgroundHover", "composerSidebarBackground",
  "selectionBg", "bashMessageBackgroundColor", "memoryBackgroundColor",
  "rate_limit_fill", "rate_limit_empty", "fastMode", "fastModeShimmer", "effortUltra",
  "briefLabelYou", "briefLabelClaude",
  "rainbow_red", "rainbow_orange", "rainbow_yellow", "rainbow_green", "rainbow_blue",
  "rainbow_indigo", "rainbow_violet",
  "rainbow_red_shimmer", "rainbow_orange_shimmer", "rainbow_yellow_shimmer", "rainbow_green_shimmer",
  "rainbow_blue_shimmer", "rainbow_indigo_shimmer", "rainbow_violet_shimmer",
];

/** Bases Claude Code understands; anything else silently falls back to dark. */
export const VALID_BASES = ["dark", "light", "dark-daltonized", "light-daltonized", "dark-ansi", "light-ansi"];

const TEXT_MIN = 4.5; // main text on the background and on diff backgrounds
const HUE_MIN = 3; // accent hues used as text
const WORD_MIN = 3; // text on the stronger "changed word" diff background

/** A background tinted towards `hue`, weakened until `text` stays readable on it. */
function tint(bg, hue, text, strength, minContrast) {
  let t = strength;
  let color = mix(bg, hue, t);
  while (contrast(text, color) < minContrast && t > 0.04) {
    t = Math.max(0.04, t - 0.02);
    color = mix(bg, hue, t);
  }
  return { color, t };
}

/** All UI color overrides for a palette (every key in COLOR_KEYS). */
export function generateOverrides(p) {
  const isLight = p.base === "light";
  const bg = normalizeHex(p.bg);
  const text = ensureContrast(p.fg, bg, TEXT_MIN);
  const tone = (c) => ensureContrast(c, bg, HUE_MIN);
  const shimmer = (c) => lighten(c, 0.25);

  const accent = tone(p.accent);
  const accent2 = tone(p.accent2);
  const blue = tone(p.blue);
  const green = tone(p.green);
  const yellow = tone(p.yellow);
  const red = tone(p.red);
  const purple = tone(p.purple);
  const cyan = tone(p.cyan);
  const orange = tone(p.orange);
  const pink = tone(p.pink);
  const muted = ensureContrast(p.muted, bg, HUE_MIN);
  const subtle = ensureContrast(p.subtle, bg, 2);
  const border = ensureContrast(p.border, bg, 2.5);

  // Diff backgrounds: a tint of green / red over the background, weakened where the text would suffer.
  const line = isLight ? 0.22 : 0.3;
  const added = tint(bg, p.green, text, line, TEXT_MIN);
  const removed = tint(bg, p.red, text, line, TEXT_MIN);
  const dimmed = (t) => Math.min(0.15, t * 0.55);
  const word = isLight ? 0.45 : 0.55;
  const addedWord = tint(bg, p.green, text, word, WORD_MIN);
  const removedWord = tint(bg, p.red, text, word, WORD_MIN);
  // The changed-word highlight must read stronger than its line, even when contrast pulled it back.
  const stronger = (hue, w, lineT) => (w.t > lineT ? w.color : mix(bg, hue, Math.min(0.9, lineT + 0.08)));

  const o = {
    autoAccept: purple,
    skill: purple,
    bashBorder: pink,
    claude: accent,
    claudeShimmer: shimmer(accent),
    claudeBlue_FOR_SYSTEM_SPINNER: blue,
    claudeBlueShimmer_FOR_SYSTEM_SPINNER: shimmer(blue),
    permission: accent2,
    permissionShimmer: shimmer(accent2),
    planMode: cyan,
    ide: blue,
    promptBorder: border,
    promptBorderShimmer: shimmer(border),
    text,
    inverseText: bg,
    inactive: muted,
    inactiveShimmer: shimmer(muted),
    subtle,
    suggestion: accent2,
    remember: blue,
    background: cyan,
    success: green,
    error: red,
    warning: yellow,
    merged: purple,
    warningShimmer: shimmer(yellow),
    diffAdded: added.color,
    diffRemoved: removed.color,
    diffAddedDimmed: tint(bg, p.green, text, dimmed(added.t), TEXT_MIN).color,
    diffRemovedDimmed: tint(bg, p.red, text, dimmed(removed.t), TEXT_MIN).color,
    diffAddedWord: stronger(p.green, addedWord, added.t),
    diffRemovedWord: stronger(p.red, removedWord, removed.t),
    red_FOR_SUBAGENTS_ONLY: red,
    blue_FOR_SUBAGENTS_ONLY: blue,
    green_FOR_SUBAGENTS_ONLY: green,
    yellow_FOR_SUBAGENTS_ONLY: yellow,
    purple_FOR_SUBAGENTS_ONLY: purple,
    orange_FOR_SUBAGENTS_ONLY: orange,
    pink_FOR_SUBAGENTS_ONLY: pink,
    cyan_FOR_SUBAGENTS_ONLY: cyan,
    professionalBlue: blue,
    chromeYellow: yellow,
    clawd_body: accent,
    clawd_background: bg,
    userMessageBackground: mix(bg, p.fg, 0.07),
    userMessageBackgroundHover: mix(bg, p.fg, 0.11),
    composerSidebarBackground: mix(bg, p.fg, 0.05),
    selectionBg: mix(bg, p.accent2, 0.35),
    bashMessageBackgroundColor: mix(bg, p.pink, 0.1),
    memoryBackgroundColor: mix(bg, p.cyan, 0.1),
    rate_limit_fill: accent2,
    rate_limit_empty: mix(bg, p.accent2, 0.25),
    fastMode: orange,
    fastModeShimmer: shimmer(orange),
    effortUltra: purple,
    briefLabelYou: blue,
    briefLabelClaude: accent,
    rainbow_red: red,
    rainbow_orange: orange,
    rainbow_yellow: yellow,
    rainbow_green: green,
    rainbow_blue: blue,
    rainbow_indigo: purple,
    rainbow_violet: pink,
    rainbow_red_shimmer: shimmer(red),
    rainbow_orange_shimmer: shimmer(orange),
    rainbow_yellow_shimmer: shimmer(yellow),
    rainbow_green_shimmer: shimmer(green),
    rainbow_blue_shimmer: shimmer(blue),
    rainbow_indigo_shimmer: shimmer(purple),
    rainbow_violet_shimmer: shimmer(pink),
  };

  // Emit in the canonical key order so generated files diff cleanly.
  const ordered = {};
  for (const k of COLOR_KEYS) ordered[k] = o[k];
  return ordered;
}

/** The status-line palette: chips, graded panels, meter colors, tip color. */
export function generateGlow(p) {
  const bg = normalizeHex(p.bg);
  const fg = ensureContrast(p.fg, bg, TEXT_MIN);
  const tone = (c) => ensureContrast(c, bg, HUE_MIN);

  // Seven panels from barely-off-background to clearly-lighter (darker on light themes).
  const panels = [0.1, 0.12, 0.14, 0.16, 0.18, 0.2, 0.22].map((t) => mix(bg, p.fg, t));
  const lastPanel = panels[panels.length - 1]; // the worst case for anything drawn on a panel
  const onPanel = (c, min) => ensureContrast(c, lastPanel, min);
  const accentBg = normalizeHex(p.accent);

  return {
    bg,
    fg,
    dim: onPanel(p.muted, HUE_MIN),
    accent: tone(p.accent),
    accent2: tone(p.accent2),
    model: { bg: accentBg, fg: readableOn(accentBg, [bg, fg, "#000000", "#ffffff"], TEXT_MIN) },
    panels,
    panelFg: onPanel(fg, TEXT_MIN),
    ok: onPanel(p.green, HUE_MIN),
    warn: onPanel(p.yellow, HUE_MIN),
    bad: onPanel(p.red, HUE_MIN),
    tip: ensureContrast(p.accent2, bg, TEXT_MIN),
    gradient: [tone(p.accent), tone(p.purple), tone(p.accent2)],
    swatches: [p.accent, p.accent2, p.green, p.yellow, p.pink].map(normalizeHex),
  };
}

/** The complete theme file content for a palette. Status-line-only palettes ship no UI overrides. */
export function generateTheme(p) {
  return {
    name: `Glow · ${p.name}`,
    base: p.statuslineOnly ? "dark" : p.base,
    overrides: p.statuslineOnly ? {} : generateOverrides(p),
    glow: generateGlow(p),
  };
}

/** Pretty JSON with a trailing newline, exactly as written to themes/*.json. */
export const serializeTheme = (theme) => JSON.stringify(theme, null, 2) + "\n";
