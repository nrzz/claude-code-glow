// Command handlers for `claude-glow`. bin/claude-glow.mjs is a thin wrapper around main().
import fs from "node:fs";
import path from "node:path";
import { cheatsheetLines } from "./cheatsheet.mjs";
import { cliColorMode, makeColors, padEndVisible, visibleWidth } from "./colors.mjs";
import {
  ROOT, glowDir, loadConfig, loadTheme, saveConfig, uiThemesDir,
} from "./config.mjs";
import { ICON_MODES, normalizeGlow } from "./defaults.mjs";
import { runDoctor } from "./doctor.mjs";
import { install, uninstall } from "./install.mjs";
import { runPicker } from "./picker.mjs";
import { render } from "./render.mjs";
import { sampleGit, sampleInput } from "./sample.mjs";
import { applyTheme, listThemes, resolveSlug } from "./themes.mjs";
import { readJson } from "./fsutil.mjs";

const HELP = `claude-glow: color themes, a glow status line and zero-token tips for Claude Code

Usage: claude-glow <command> [options]

Commands
  install [--theme <slug>] [--icons nerd|unicode|ascii] [--no-ui-theme] [--dry-run]
                              set up the status line and the UI themes (backs up settings.json first)
  uninstall [--dry-run]       remove what install added; restores your previous status line
  theme                       pick a theme interactively, with a live preview
  theme set <slug>            switch the status line and the whole UI to a theme now
  theme list                  every theme with a one-line status-line preview
  preview [--theme <slug>] [--json <file>]
                              print the status line for sample data (or for your own JSON; "-" = stdin)
  icons <nerd|unicode|ascii>  icon style (nerd needs a Nerd Font)
  tips <on|off>               the tip line under the status line
  cheatsheet                  Claude Code keys, commands, flags and token-saving habits
  doctor [--project <dir>]    static token audit: CLAUDE.md, skills, MCP servers, settings

Options
  -h, --help                  this help
  -v, --version               print the version

The config folder is $CLAUDE_CONFIG_DIR, or ~/.claude when that is not set.
`;

class UsageError extends Error {}

// Tiny argument parser: boolean flags, --name value / --name=value options, positionals.
function parseArgs(args, { flags = [], options = [] } = {}) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") { out._.push(...args.slice(i + 1)); break; }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const name = eq === -1 ? a.slice(2) : a.slice(2, eq);
      if (flags.includes(name)) out[name] = true;
      else if (options.includes(name)) {
        const value = eq === -1 ? args[++i] : a.slice(eq + 1);
        if (value === undefined) throw new UsageError(`--${name} needs a value`);
        out[name] = value;
      } else throw new UsageError(`unknown option --${name}`);
    } else if (a.startsWith("-") && a.length > 1) {
      throw new UsageError(`unknown option ${a}`);
    } else out._.push(a);
  }
  return out;
}

const say = (s = "") => console.log(s);
const fail = (s) => { console.error(s); return 1; };

// A reminder when the status line has not been installed (themes and tips still work without it).
function installHint() {
  if (!fs.existsSync(path.join(glowDir(), "statusline.mjs"))) say("(the status line is not installed yet: run `claude-glow install`)");
}

function swatchRow(glow, C) {
  return normalizeGlow(glow).swatches.slice(0, 5).map((c) => C.fg(c) + "■").join("") + C.reset;
}

// ---------------------------------------------------------------- commands

function themeList() {
  const themes = listThemes();
  if (!themes.length) return fail(`No theme files in ${path.join(ROOT, "themes")}. Run: npm run build:themes`);
  const config = loadConfig();
  const colorMode = cliColorMode();
  const C = makeColors(colorMode);
  const width = process.stdout.columns || 120;
  const nameW = Math.max(...themes.map((t) => visibleWidth(t.name)));
  const slugW = Math.max(...themes.map((t) => t.slug.length));
  const now = Date.now();
  for (const t of themes) {
    const g = normalizeGlow(t.theme.glow);
    const prefix = `${t.slug === config.theme ? C.paint("●", g.ok) : " "} ${padEndVisible(C.paint(t.name, g.accent), nameW)}  ${padEndVisible(C.paint(t.slug, g.dim), slugW)}  ${swatchRow(t.theme.glow, C)}  `;
    const line = render(sampleInput(now), { ...config, tips: false }, t.theme, {
      columns: Math.max(20, width - visibleWidth(prefix) - 1), colorMode, now, git: sampleGit,
    });
    say(prefix + line);
  }
  say("");
  say(`${themes.length} themes. Switch with: claude-glow theme set <slug>   (● = current)`);
  return 0;
}

function reportApplied(result, slug) {
  const config = result.config;
  say(`✔ Theme: ${result.name} (${slug}), icons: ${config.icons}`);
  say("  status line  config.json updated");
  if (result.live) say(`  whole UI     ${result.live} rewritten: Claude Code recolors instantly if 'Glow (live)' is your /theme`);
  else say("  whole UI     untouched (installed with --no-ui-theme)");
  installHint();
}

function themeSet(arg) {
  const themes = listThemes();
  const slugs = themes.map((t) => t.slug);
  // The problem goes to stderr; the names go to stdout, so a caller that only shows stdout
  // (the /glowline:theme skill) can still offer the choices.
  const refuse = (problem) => {
    console.error(problem);
    say(`Themes: ${slugs.join(", ")}`);
    return 1;
  };
  if (!arg || !arg.trim()) return refuse("theme set needs a theme name.");
  const r = resolveSlug(arg, slugs);
  if (!r.slug) return refuse(`Unknown theme "${arg}".${r.suggestions.length ? ` Did you mean: ${r.suggestions.join(", ")}?` : ""}`);
  reportApplied(applyTheme(r.slug), r.slug);
  return 0;
}

async function themePick() {
  const themes = listThemes();
  if (!themes.length) return fail(`No theme files in ${path.join(ROOT, "themes")}. Run: npm run build:themes`);
  const colorMode = cliColorMode();
  if (!process.stdout.isTTY || !process.stdin.isTTY || colorMode === "none") return themeList();
  const config = loadConfig();
  const result = await runPicker({
    themes, current: config.theme, icons: config.icons, colorMode,
    note: `enter writes ${path.join(uiThemesDir(), "glow.json")} and config.json`,
  });
  if (result.error) return fail(`claude-glow: ${result.error.message}`);
  if (!result.applied) { say("No change."); return 0; }
  reportApplied(applyTheme(result.applied, { icons: result.icons }), result.applied);
  return 0;
}

function preview(args) {
  const o = parseArgs(args, { options: ["theme", "json"] });
  const config = loadConfig();
  let slug = config.theme;
  if (o.theme) {
    const r = resolveSlug(o.theme, listThemes().map((t) => t.slug));
    if (!r.slug) return fail(`Unknown theme "${o.theme}".${r.suggestions.length ? ` Did you mean: ${r.suggestions.join(", ")}?` : ""}`);
    slug = r.slug;
  }
  let input = null;
  if (o.json) {
    try { input = JSON.parse(fs.readFileSync(o.json === "-" ? 0 : o.json, "utf8")); } catch (e) { return fail(`Cannot read JSON from ${o.json}: ${e.message}`); }
  }
  const now = Date.now();
  say(render(input || sampleInput(now), config, loadTheme(slug, [path.join(ROOT, "themes")]) || loadTheme(slug), {
    columns: process.stdout.columns, colorMode: cliColorMode(), now, git: input ? undefined : sampleGit,
  }));
  return 0;
}

function setIcons(mode) {
  if (!ICON_MODES.includes(mode)) return fail(`icons needs one of: ${ICON_MODES.join(", ")}`);
  const config = loadConfig();
  config.icons = mode;
  saveConfig(config);
  say(`✔ icons: ${mode}${mode === "nerd" ? " (needs a Nerd Font in your terminal)" : ""}`);
  installHint();
  return 0;
}

function setTips(value) {
  if (!["on", "off"].includes(value)) return fail("tips needs on or off");
  const config = loadConfig();
  config.tips = value === "on";
  saveConfig(config);
  say(`✔ tips: ${value}`);
  installHint();
  return 0;
}

function cheatsheet() {
  const config = loadConfig();
  const theme = loadTheme(config.theme, [path.join(ROOT, "themes")]) || loadTheme(config.theme);
  const lines = cheatsheetLines({ glow: theme && theme.glow, colorMode: cliColorMode(), columns: process.stdout.columns || 100 });
  for (const l of lines) say(l);
  return 0;
}

function doctor(args) {
  const o = parseArgs(args, { options: ["project"] });
  if (o.project && !fs.existsSync(o.project)) return fail(`Project folder not found: ${o.project}`);
  runDoctor({ project: o.project }, say);
  return 0;
}

// ---------------------------------------------------------------- entry

/** Run the CLI. Returns the exit code (0 ok, 1 error). */
export async function main(argv) {
  const [cmd, ...rest] = argv;
  try {
    switch (cmd) {
      case undefined:
      case "help":
      case "-h":
      case "--help":
        say(HELP);
        return 0;
      case "-v":
      case "--version":
        say((readJson(path.join(ROOT, "package.json")) || {}).version || "unknown");
        return 0;
      case "install": {
        const o = parseArgs(rest, { flags: ["dry-run", "no-ui-theme", "help"], options: ["theme", "icons"] });
        if (o.help) { say(HELP); return 0; }
        return install({ theme: o.theme, icons: o.icons, uiTheme: !o["no-ui-theme"], dryRun: !!o["dry-run"] });
      }
      case "uninstall": {
        const o = parseArgs(rest, { flags: ["dry-run", "help"] });
        if (o.help) { say(HELP); return 0; }
        return uninstall({ dryRun: !!o["dry-run"] });
      }
      case "theme": {
        const [sub, ...more] = rest;
        if (sub === undefined) return await themePick();
        if (sub === "list") return themeList();
        if (sub === "set") return themeSet(more[0]);
        // `claude-glow theme dracula` is a shortcut for `theme set dracula`
        if (listThemes().length && resolveSlug(sub, listThemes().map((t) => t.slug)).slug) return themeSet(sub);
        return fail(`Unknown theme command or theme "${sub}". Try: claude-glow theme list`);
      }
      case "preview": return preview(rest);
      case "icons": return setIcons(rest[0]);
      case "tips": return setTips(rest[0]);
      case "cheatsheet": return cheatsheet();
      case "doctor": return doctor(rest);
      default:
        console.error(`claude-glow: unknown command "${cmd}"\n`);
        say(HELP);
        return 1;
    }
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(`claude-glow: ${e.message}. Try: claude-glow --help`);
      return 1;
    }
    console.error(`claude-glow: ${e && e.message ? e.message : e}`);
    return 1;
  }
}
