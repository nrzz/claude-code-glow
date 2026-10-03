// Where things live, and reading / writing config.json. Honors CLAUDE_CONFIG_DIR everywhere,
// the same way Claude Code does (default: ~/.claude).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeConfig } from "./defaults.mjs";
import { readJson, writeFileAtomic } from "./fsutil.mjs";

/** The folder this package runs from: the repo, or the installed copy under <configDir>/claude-code-glow. */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Claude Code's config folder: $CLAUDE_CONFIG_DIR, else ~/.claude. */
export function configDir(env = process.env) {
  const custom = env.CLAUDE_CONFIG_DIR && env.CLAUDE_CONFIG_DIR.trim();
  return path.resolve(custom || path.join(os.homedir(), ".claude"));
}

/** Our own folder inside it: statusline copy, config.json, theme copies. */
export const glowDir = (cfg = configDir()) => path.join(cfg, "claude-code-glow");

/** Where Claude Code looks for custom UI themes. */
export const uiThemesDir = (cfg = configDir()) => path.join(cfg, "themes");

/** The live theme file: the one theme the user picks once in /theme, rewritten on every switch. */
export const liveThemePath = (cfg = configDir()) => path.join(uiThemesDir(cfg), "glow.json");

/** config.json merged over the defaults (missing or broken file -> defaults). */
export function loadConfig(dir = glowDir()) {
  return normalizeConfig(readJson(path.join(dir, "config.json")));
}

export function saveConfig(config, dir = glowDir()) {
  writeFileAtomic(path.join(dir, "config.json"), JSON.stringify(config, null, 2) + "\n");
}

/** "glow-dracula", "Dracula", "dracula" -> "dracula" (display-ish input normalized to a slug). */
export const toSlug = (s) => String(s ?? "").trim().toLowerCase().replace(/^glow-/, "").replace(/[\s_]+/g, "-");

/**
 * The theme file for a slug, looked up in the installed copy first, then next to this script.
 * Returns the parsed theme ({ name, base, overrides, glow }) or null.
 */
export function loadTheme(slug, dirs = [path.join(glowDir(), "themes"), path.join(ROOT, "themes")]) {
  const s = toSlug(slug);
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(s) || s.includes("..")) return null;
  for (const dir of dirs) {
    const theme = readJson(path.join(dir, `glow-${s}.json`));
    if (theme && typeof theme === "object" && !Array.isArray(theme)) return theme;
  }
  return null;
}

/** Slugs of every glow theme file in a folder (without ordering). */
export function themeSlugsIn(dir) {
  try {
    return fs.readdirSync(dir)
      .map((f) => /^glow-(.+)\.json$/.exec(f))
      .filter(Boolean)
      .map((m) => m[1]);
  } catch {
    return [];
  }
}
