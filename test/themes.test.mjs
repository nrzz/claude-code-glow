import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_GLOW } from "../src/defaults.mjs";
import { PALETTES, findPalette } from "../src/palettes.mjs";
import {
  COLOR_KEYS, VALID_BASES, contrast, darken, ensureContrast, generateTheme, hexToRgb, lighten, luminance, mix,
  normalizeHex, rgbToHex, serializeTheme,
} from "../src/theme-gen.mjs";
import { ROOT, readLf } from "./helpers.mjs";

// Claude Code's own color validator, copied from the spec so these tests do not trust our generator.
const ANSI_NAMES = new Set([
  "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "blackBright", "redBright", "greenBright", "yellowBright", "blueBright", "magentaBright", "cyanBright", "whiteBright",
]);
function isValidColor(r) {
  if (typeof r !== "string") return false;
  if (/^rgb\(\s?\d{1,3},\s?\d{1,3},\s?\d{1,3}\s?\)$/.test(r)) return true;
  if (/^#[0-9a-fA-F]{6}$/.test(r) || /^#[0-9a-fA-F]{3}$/.test(r)) return true;
  if (/^ansi256\(\d{1,3}\)$/.test(r)) return true;
  if (r.startsWith("ansi:")) return ANSI_NAMES.has(r.slice(5));
  return false;
}

// The complete list of color keys from the spec, written out independently.
const SPEC_KEYS = `autoAccept, skill, bashBorder, claude, claudeShimmer, claudeBlue_FOR_SYSTEM_SPINNER, claudeBlueShimmer_FOR_SYSTEM_SPINNER, permission, permissionShimmer, planMode, ide, promptBorder, promptBorderShimmer, text, inverseText, inactive, inactiveShimmer, subtle, suggestion, remember, background, success, error, warning, merged, warningShimmer, diffAdded, diffRemoved, diffAddedDimmed, diffRemovedDimmed, diffAddedWord, diffRemovedWord, red_FOR_SUBAGENTS_ONLY, blue_FOR_SUBAGENTS_ONLY, green_FOR_SUBAGENTS_ONLY, yellow_FOR_SUBAGENTS_ONLY, purple_FOR_SUBAGENTS_ONLY, orange_FOR_SUBAGENTS_ONLY, pink_FOR_SUBAGENTS_ONLY, cyan_FOR_SUBAGENTS_ONLY, professionalBlue, chromeYellow, clawd_body, clawd_background, userMessageBackground, userMessageBackgroundHover, composerSidebarBackground, selectionBg, bashMessageBackgroundColor, memoryBackgroundColor, rate_limit_fill, rate_limit_empty, fastMode, fastModeShimmer, effortUltra, briefLabelYou, briefLabelClaude, rainbow_red, rainbow_orange, rainbow_yellow, rainbow_green, rainbow_blue, rainbow_indigo, rainbow_violet, rainbow_red_shimmer, rainbow_orange_shimmer, rainbow_yellow_shimmer, rainbow_green_shimmer, rainbow_blue_shimmer, rainbow_indigo_shimmer, rainbow_violet_shimmer`
  .split(",").map((s) => s.trim());

const THEMES_DIR = path.join(ROOT, "themes");
const EXPECTED_SLUGS = [
  "synthwave-84", "dracula", "tokyo-night", "catppuccin-mocha", "catppuccin-latte", "nord", "gruvbox-dark",
  "solarized-dark", "rose-pine", "one-dark", "monokai", "matrix", "cyberpunk", "github-light", "classic",
];

test("the spec key list has 71 distinct keys and COLOR_KEYS is exactly that list", () => {
  assert.equal(SPEC_KEYS.length, 71);
  assert.equal(new Set(SPEC_KEYS).size, 71);
  assert.deepEqual([...COLOR_KEYS].sort(), [...SPEC_KEYS].sort());
});

test("every expected palette exists, with a unique slug and name", () => {
  assert.deepEqual(PALETTES.map((p) => p.slug), EXPECTED_SLUGS);
  assert.equal(new Set(PALETTES.map((p) => p.name)).size, PALETTES.length);
  for (const p of PALETTES) {
    for (const k of ["bg", "fg", "muted", "subtle", "border", "accent", "accent2", "blue", "green", "yellow", "red", "purple", "cyan", "orange", "pink"]) {
      assert.match(p[k], /^#[0-9a-f]{6}$/i, `${p.slug}.${k}`);
    }
    assert.ok(["dark", "light"].includes(p.base), `${p.slug} base`);
  }
  assert.equal(findPalette("catppuccin-latte").base, "light");
  assert.equal(findPalette("github-light").base, "light");
});

for (const palette of PALETTES) {
  const theme = generateTheme(palette);
  const statuslineOnly = !!palette.statuslineOnly;

  test(`${palette.slug}: structure, keys and colors`, () => {
    assert.equal(theme.name, `Glow · ${palette.name}`);
    assert.ok(VALID_BASES.includes(theme.base));
    assert.deepEqual(Object.keys(theme).sort(), ["base", "glow", "name", "overrides"]);
    if (statuslineOnly) {
      assert.deepEqual(theme.overrides, {});
      assert.equal(theme.base, "dark");
      return;
    }
    assert.equal(theme.base, palette.base);
    assert.deepEqual(Object.keys(theme.overrides).sort(), [...SPEC_KEYS].sort(), "all keys and nothing else");
    for (const [key, value] of Object.entries(theme.overrides)) {
      assert.ok(isValidColor(value), `${key}=${value} passes Claude Code's validator`);
      assert.match(value, /^#[0-9a-f]{6}$/, `${key}=${value} is lower-case #rrggbb`);
    }
  });

  if (!statuslineOnly) test(`${palette.slug}: text is readable on the background and on diff backgrounds`, () => {
    const o = theme.overrides;
    assert.ok(contrast(o.text, palette.bg) >= 4.5, `text on bg ${contrast(o.text, palette.bg).toFixed(2)}`);
    assert.ok(contrast(o.text, o.diffAdded) >= 4.5, `text on diffAdded ${contrast(o.text, o.diffAdded).toFixed(2)}`);
    assert.ok(contrast(o.text, o.diffRemoved) >= 4.5, `text on diffRemoved ${contrast(o.text, o.diffRemoved).toFixed(2)}`);
    assert.ok(contrast(o.text, o.diffAddedDimmed) >= 4.5);
    assert.ok(contrast(o.text, o.diffRemovedDimmed) >= 4.5);
    assert.ok(contrast(o.text, o.diffAddedWord) >= 3, "changed words stay legible");
    assert.ok(contrast(o.text, o.diffRemovedWord) >= 3);
    assert.ok(contrast(o.inactive, palette.bg) >= 3, "dim text stays visible");
    assert.ok(contrast(o.claude, palette.bg) >= 3, "the accent stays visible");
    assert.ok(contrast(o.promptBorder, palette.bg) >= 2.5, "the prompt border stays visible");
  });

  if (!statuslineOnly) test(`${palette.slug}: semantic mapping follows the spec`, () => {
    const o = theme.overrides;
    assert.equal(o.clawd_background, normalizeHex(palette.bg));
    assert.equal(o.inverseText, normalizeHex(palette.bg));
    assert.equal(o.claude, o.clawd_body);
    assert.equal(o.claude, o.briefLabelClaude);
    assert.equal(o.permission, o.suggestion);
    assert.equal(o.permission, o.rate_limit_fill);
    assert.equal(o.autoAccept, o.skill);
    assert.equal(o.autoAccept, o.merged);
    assert.equal(o.autoAccept, o.effortUltra);
    assert.equal(o.success, o.green_FOR_SUBAGENTS_ONLY);
    assert.equal(o.error, o.red_FOR_SUBAGENTS_ONLY);
    assert.equal(o.warning, o.yellow_FOR_SUBAGENTS_ONLY);
    assert.equal(o.warning, o.chromeYellow);
    assert.equal(o.fastMode, o.orange_FOR_SUBAGENTS_ONLY);
    assert.equal(o.bashBorder, o.pink_FOR_SUBAGENTS_ONLY);
    assert.equal(o.planMode, o.background);
    assert.equal(o.planMode, o.cyan_FOR_SUBAGENTS_ONLY);
    assert.equal(o.rainbow_indigo, o.purple_FOR_SUBAGENTS_ONLY);
    assert.equal(o.rainbow_violet, o.pink_FOR_SUBAGENTS_ONLY);
    // shimmers are lighter variants
    for (const [shimmer, base] of [["claudeShimmer", "claude"], ["permissionShimmer", "permission"], ["warningShimmer", "warning"], ["fastModeShimmer", "fastMode"], ["rainbow_red_shimmer", "rainbow_red"]]) {
      assert.ok(luminance(o[shimmer]) > luminance(o[base]), `${shimmer} lighter than ${base}`);
    }
    // panel backgrounds sit between the background and the text color
    const lo = Math.min(luminance(o.text), luminance(palette.bg));
    const hi = Math.max(luminance(o.text), luminance(palette.bg));
    for (const k of ["userMessageBackground", "userMessageBackgroundHover", "composerSidebarBackground"]) {
      assert.ok(luminance(o[k]) >= lo && luminance(o[k]) <= hi, k);
    }
    assert.ok(contrast(o.userMessageBackgroundHover, palette.bg) > contrast(o.userMessageBackground, palette.bg));
  });

  test(`${palette.slug}: the glow (status line) palette is complete and readable`, () => {
    const g = theme.glow;
    for (const k of ["bg", "fg", "dim", "accent", "accent2", "panelFg", "ok", "warn", "bad", "tip"]) assert.match(g[k], /^#[0-9a-f]{6}$/, k);
    assert.match(g.model.bg, /^#[0-9a-f]{6}$/);
    assert.match(g.model.fg, /^#[0-9a-f]{6}$/);
    assert.equal(g.model.bg, normalizeHex(palette.accent), "model chip uses the accent");
    assert.ok(contrast(g.model.fg, g.model.bg) >= 4.5, "model chip text is readable");
    assert.equal(g.panels.length, 7);
    for (let i = 1; i < g.panels.length; i++) {
      // each panel is a little further from the background than the one before
      assert.ok(contrast(g.panels[i], g.bg) > contrast(g.panels[i - 1], g.bg), `panel ${i} grades up`);
    }
    for (const panel of g.panels) {
      assert.ok(contrast(g.panelFg, panel) >= 4.5, `panel text on ${panel}`);
      for (const k of ["ok", "warn", "bad", "dim"]) assert.ok(contrast(g[k], panel) >= 2.9, `${k} on ${panel}`);
    }
    assert.ok(contrast(g.tip, g.bg) >= 4.5, "tip is readable on the background");
    assert.equal(g.gradient.length, 3);
    assert.equal(g.swatches.length, 5);
  });

  test(`${palette.slug}: the file on disk is up to date, valid JSON and small`, () => {
    const file = path.join(THEMES_DIR, `glow-${palette.slug}.json`);
    assert.ok(fs.existsSync(file), `${file} exists (run: npm run build:themes)`);
    const text = readLf(file);
    assert.ok(Buffer.byteLength(text) < 256 * 1024, "under Claude Code's 256KB limit");
    assert.equal(text, serializeTheme(theme), "build is up to date: run npm run build:themes");
    assert.ok(text.endsWith("}\n"), "pretty JSON with a trailing newline");
    assert.doesNotThrow(() => JSON.parse(text));
  });
}

test("themes/ holds exactly the generated glow-*.json files", () => {
  const onDisk = fs.readdirSync(THEMES_DIR).sort();
  assert.deepEqual(onDisk, EXPECTED_SLUGS.map((s) => `glow-${s}.json`).sort());
});

test("DEFAULT_GLOW is the classic palette (kept in sync by hand, enforced here)", () => {
  assert.deepEqual(DEFAULT_GLOW, generateTheme(findPalette("classic")).glow);
});

test("every theme's slug is the file name without the glow- prefix and .json", () => {
  for (const p of PALETTES) assert.ok(fs.existsSync(path.join(THEMES_DIR, `glow-${p.slug}.json`)));
});

// ---- color helpers

test("hex <-> rgb", () => {
  assert.deepEqual(hexToRgb("#ff7edb"), [255, 126, 219]);
  assert.deepEqual(hexToRgb("#fff"), [255, 255, 255]);
  assert.deepEqual(hexToRgb("0a0b0c"), [10, 11, 12]);
  assert.equal(rgbToHex([255, 126, 219]), "#ff7edb");
  assert.equal(rgbToHex([300, -5, 0.4]), "#ff0000");
  assert.equal(normalizeHex("#ABC"), "#aabbcc");
  assert.throws(() => hexToRgb("#12"), /hex/);
  assert.throws(() => hexToRgb("blue"), /hex/);
});

test("mix, lighten, darken", () => {
  assert.equal(mix("#000000", "#ffffff", 0), "#000000");
  assert.equal(mix("#000000", "#ffffff", 1), "#ffffff");
  assert.equal(mix("#000000", "#ffffff", 0.5), "#808080");
  assert.equal(mix("#ff0000", "#0000ff", 0.5), "#800080");
  assert.equal(lighten("#000000", 0.25), "#404040");
  assert.equal(darken("#ffffff", 0.25), "#bfbfbf");
});

test("luminance and contrast follow WCAG", () => {
  assert.equal(luminance("#000000"), 0);
  assert.equal(luminance("#ffffff"), 1);
  assert.ok(Math.abs(contrast("#000000", "#ffffff") - 21) < 1e-9);
  assert.ok(Math.abs(contrast("#ffffff", "#000000") - 21) < 1e-9, "symmetric");
  assert.equal(contrast("#777777", "#777777"), 1);
  assert.ok(Math.abs(contrast("#767676", "#ffffff") - 4.54) < 0.01, "the classic #767676-on-white 4.54");
});

test("ensureContrast leaves good colors alone and fixes weak ones", () => {
  assert.equal(ensureContrast("#ffffff", "#000000", 4.5), "#ffffff");
  const fixedOnDark = ensureContrast("#222222", "#000000", 4.5);
  assert.ok(contrast(fixedOnDark, "#000000") >= 4.5);
  assert.ok(luminance(fixedOnDark) > luminance("#222222"), "moves towards white on a dark background");
  const fixedOnLight = ensureContrast("#dddddd", "#ffffff", 4.5);
  assert.ok(contrast(fixedOnLight, "#ffffff") >= 4.5);
  assert.ok(luminance(fixedOnLight) < luminance("#dddddd"), "moves towards black on a light background");
});
