// Theme management for the CLI: list the shipped themes, resolve a typed name to a slug (with
// typo suggestions), and apply one (config.json + the live theme file Claude Code watches).
import path from "node:path";
import { PALETTES } from "./palettes.mjs";
import {
  ROOT, configDir, glowDir, liveThemePath, loadConfig, saveConfig, themeSlugsIn, toSlug,
} from "./config.mjs";
import { readJson, writeFileAtomic } from "./fsutil.mjs";
import { serializeTheme } from "./theme-gen.mjs";

/** The folder with the shipped theme files (the repo's, or the installed copy's). */
export const shippedThemesDir = () => path.join(ROOT, "themes");

/** Short display name: "Glow · Dracula" -> "Dracula". */
export const shortName = (theme) => String((theme && theme.name) || "").replace(/^Glow\s*·\s*/, "");

/** Every shipped theme as { slug, name, theme }, in the curated palette order. */
export function listThemes(dir = shippedThemesDir()) {
  const order = PALETTES.map((p) => p.slug);
  const rank = (s) => (order.includes(s) ? order.indexOf(s) : order.length);
  return themeSlugsIn(dir)
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((slug) => ({ slug, theme: readJson(path.join(dir, `glow-${slug}.json`)) }))
    .filter((t) => t.theme && typeof t.theme === "object")
    .map((t) => ({ ...t, name: shortName(t.theme) || t.slug }));
}

// "synthwave-84", "Synthwave 84", "synthwave84", "glow-synthwave-84" all compare equal when loosened.
const loose = (s) => toSlug(s).replace(/[^a-z0-9]/g, "");

function distance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length];
}

/**
 * Resolve what the user typed against the known slugs.
 * Returns { slug } on an exact, loose or unique-prefix match, else { suggestions: [slug, ...] }.
 */
export function resolveSlug(input, slugs) {
  const s = toSlug(input);
  if (slugs.includes(s)) return { slug: s };
  const l = loose(input);
  if (!l) return { suggestions: [] };
  const exact = slugs.filter((x) => loose(x) === l);
  if (exact.length === 1) return { slug: exact[0] };
  const prefix = slugs.filter((x) => loose(x).startsWith(l));
  if (prefix.length === 1) return { slug: prefix[0] };
  const limit = Math.max(2, Math.floor(l.length / 3));
  const scored = slugs
    .map((x) => {
      const lx = loose(x);
      const d = lx.includes(l) || l.includes(lx) ? 0 : distance(lx, l);
      return { x, d };
    })
    .filter((c) => c.d <= limit)
    .sort((a, b) => a.d - b.d);
  return { suggestions: scored.slice(0, 3).map((c) => c.x) };
}

/** The theme file as Claude Code should see the live theme: same colors, named "Glow (live)". */
export const liveTheme = (theme) => ({ ...theme, name: "Glow (live)" });

/** Rewrite <configDir>/themes/glow.json. Claude Code watches the folder and recolors a running session. */
export function writeLiveTheme(theme, cfg = configDir()) {
  const file = liveThemePath(cfg);
  writeFileAtomic(file, serializeTheme(liveTheme(theme)));
  return file;
}

/**
 * Make `slug` the active theme: config.json (status line) and, unless the install opted out of UI
 * themes, the live theme file (whole UI). Throws on an unknown slug.
 * @returns { config, live }  live is the path written, or null
 */
export function applyTheme(slug, { icons } = {}) {
  const found = listThemes().find((t) => t.slug === slug);
  if (!found) throw new Error(`unknown theme: ${slug}`);
  const dir = glowDir();
  const config = loadConfig(dir);
  config.theme = slug;
  if (icons) config.icons = icons;
  saveConfig(config, dir);
  const live = config.uiTheme === false ? null : writeLiveTheme(found.theme);
  return { config, live, name: found.name };
}
