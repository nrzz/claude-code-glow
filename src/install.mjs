// install / uninstall. Everything lives under Claude Code's config folder ($CLAUDE_CONFIG_DIR or ~/.claude):
//   <configDir>/claude-code-glow/   our copy of statusline.mjs, bin/, src/, themes/ and package.json, plus config.json
//                                   (bin/claude-glow.mjs there is a stable command: node <that path> theme)
//   <configDir>/themes/glow-*.json  the UI themes Claude Code lists in /theme (+ glow.json, the live one)
//   <configDir>/settings.json       only the "statusLine" key is touched, after a timestamped backup
// Nothing outside those paths is ever written or deleted.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { cliColorMode } from "./colors.mjs";
import {
  ROOT, configDir, glowDir, loadConfig, saveConfig, uiThemesDir,
} from "./config.mjs";
import { DEFAULT_CONFIG, ICON_MODES } from "./defaults.mjs";
import { readJson, syncDir, timestamp, uniquePath, writeFileAtomic } from "./fsutil.mjs";
import { sampleInput } from "./sample.mjs";
import { listThemes, resolveSlug, writeLiveTheme } from "./themes.mjs";

const consoleIO = { log: (s = "") => console.log(s), error: (s = "") => console.error(s) };
const forwardSlashes = (p) => p.replace(/\\/g, "/");

// Two spellings of one folder, symbolic links resolved: on macOS /var is a link to /private/var,
// and Node gives a module's own path with links resolved.
function samePath(a, b) {
  try {
    return fs.realpathSync(a) === fs.realpathSync(b);
  } catch {
    return path.resolve(a) === path.resolve(b);
  }
}

/** The settings.json "statusLine" value that runs our installed copy. */
export function statusLineFor(gdir) {
  return { type: "command", command: `node "${forwardSlashes(path.join(gdir, "statusline.mjs"))}"`, padding: 0 };
}

/** True when a statusLine setting runs a claude-code-glow status line. */
export function isOurStatusLine(sl) {
  return !!sl && typeof sl === "object" && typeof sl.command === "string"
    && /claude-code-glow[\\/]statusline\.mjs/.test(sl.command);
}

/**
 * Read settings.json without ever modifying it.
 * status: "missing" | "ok" (data is a plain object; empty file counts as {}) | "invalid"
 */
export function readSettings(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (e) {
    return e && e.code === "ENOENT" ? { status: "missing", data: {}, raw: null } : { status: "invalid", data: null, raw: null };
  }
  const text = raw.replace(/^﻿/, "");
  if (!text.trim()) return { status: "ok", data: {}, raw };
  try {
    const data = JSON.parse(text);
    if (data && typeof data === "object" && !Array.isArray(data)) return { status: "ok", data, raw };
  } catch { /* falls through to invalid */ }
  return { status: "invalid", data: null, raw };
}

const writeSettings = (file, data) => writeFileAtomic(file, JSON.stringify(data, null, 2) + "\n");

// Copy settings.json aside before changing it. Returns the backup path.
function backupSettings(file) {
  const backup = uniquePath(`${file}.bak-glow-${timestamp()}`);
  fs.copyFileSync(file, backup);
  return backup;
}

// Run the installed copy once with sample input, the way Claude Code will, to prove it works.
function verifyInstalled(gdir) {
  const env = { ...process.env };
  if (cliColorMode() === "none") env.GLOW_COLOR = "0";
  const r = spawnSync(process.execPath, [path.join(gdir, "statusline.mjs")], {
    input: JSON.stringify(sampleInput()), encoding: "utf8", timeout: 8000, windowsHide: true, env,
  });
  const out = (r.stdout || "").replace(/\s+$/, "");
  return r.status === 0 && out ? { ok: true, out } : { ok: false, out: r.error ? r.error.message : (r.stderr || "").trim() };
}

/**
 * claude-glow install
 * @param opts { theme?, icons?, uiTheme = true, dryRun = false }
 * @returns exit code: 0 done, 1 failed or settings.json could not be updated
 */
export function install(opts = {}, io = consoleIO) {
  const { dryRun = false, uiTheme = true } = opts;
  const cfgDir = configDir();
  const gdir = glowDir(cfgDir);
  const themes = listThemes();
  if (!themes.length) {
    io.error(`No theme files found in ${path.join(ROOT, "themes")}. Run: npm run build:themes`);
    return 1;
  }
  const slugs = themes.map((t) => t.slug);

  if (opts.icons && !ICON_MODES.includes(opts.icons)) {
    io.error(`Unknown icon mode "${opts.icons}". Use one of: ${ICON_MODES.join(", ")}`);
    return 1;
  }
  const config = loadConfig(gdir);
  let slug = slugs.includes(config.theme) ? config.theme : (slugs.includes(DEFAULT_CONFIG.theme) ? DEFAULT_CONFIG.theme : slugs[0]);
  if (opts.theme) {
    const r = resolveSlug(opts.theme, slugs);
    if (!r.slug) {
      io.error(`Unknown theme "${opts.theme}".${r.suggestions.length ? ` Did you mean: ${r.suggestions.join(", ")}?` : ""}`);
      io.error(`Available: ${slugs.join(", ")}`);
      return 1;
    }
    slug = r.slug;
  }
  const chosen = themes.find((t) => t.slug === slug);

  const settingsFile = path.join(cfgDir, "settings.json");
  const settings = readSettings(settingsFile);
  const wanted = statusLineFor(gdir);
  const current = settings.status === "ok" ? settings.data.statusLine : undefined;

  io.log(dryRun ? `claude-code-glow install (dry run, nothing will be written)` : `claude-code-glow install`);
  io.log(`  config folder  ${cfgDir}`);
  const step = (would, did, fn) => {
    if (dryRun) { io.log(`  would ${would}`); return; }
    fn();
    io.log(`  ✔ ${did}`);
  };

  // 1. our own copy: statusline.mjs, src/, themes/
  if (samePath(ROOT, gdir)) {
    io.log("  - running from the installed copy; not copying files onto themselves");
  } else {
    step(`copy statusline.mjs, bin/, src/ and themes/ into ${gdir}`, `copied statusline.mjs, bin/, src/ and themes/ into ${gdir}`, () => {
      fs.mkdirSync(gdir, { recursive: true });
      fs.copyFileSync(path.join(ROOT, "statusline.mjs"), path.join(gdir, "statusline.mjs"));
      if (fs.existsSync(path.join(ROOT, "package.json"))) fs.copyFileSync(path.join(ROOT, "package.json"), path.join(gdir, "package.json")); // for --version
      syncDir(path.join(ROOT, "bin"), path.join(gdir, "bin"));
      syncDir(path.join(ROOT, "src"), path.join(gdir, "src"));
      syncDir(path.join(ROOT, "themes"), path.join(gdir, "themes"));
    });
  }

  // 2. config.json: keep what is there, apply the flags, remember a status line we are replacing
  const hadForeign = current != null && typeof current === "object" && !isOurStatusLine(current);
  config.theme = slug;
  if (opts.icons) config.icons = opts.icons;
  if (uiTheme) delete config.uiTheme; else config.uiTheme = false;
  if (hadForeign) config.previousStatusLine = current;
  step(`write ${path.join(gdir, "config.json")} (theme ${slug}, icons ${config.icons})`,
    `config.json: theme ${chosen.name}, icons ${config.icons}`, () => saveConfig(config, gdir));

  // 3. UI themes for /theme, and the live one
  if (uiTheme) {
    const dest = uiThemesDir(cfgDir);
    const shipped = themes.filter((t) => t.slug !== "classic"); // classic is status-line only
    step(`copy ${shipped.length} themes into ${dest} and write glow.json (live: ${chosen.name})`,
      `${shipped.length} UI themes in ${dest}; live theme glow.json = ${chosen.name}`, () => {
        fs.mkdirSync(dest, { recursive: true });
        for (const t of shipped) fs.copyFileSync(path.join(ROOT, "themes", `glow-${t.slug}.json`), path.join(dest, `glow-${t.slug}.json`));
        writeLiveTheme(chosen.theme, cfgDir);
      });
  } else {
    io.log("  - --no-ui-theme: Claude Code's own colors are left alone");
  }

  // 4. settings.json: only the statusLine key
  let code = 0;
  if (settings.status === "invalid") {
    io.error("");
    io.error(`  ✖ ${settingsFile} is not valid JSON, so I left it untouched.`);
    io.error("    Fix the file (or add this inside the top-level object by hand), then run install again:");
    io.error("");
    io.error(JSON.stringify({ statusLine: wanted }, null, 2).split("\n").map((l) => `      ${l}`).join("\n"));
    code = 1;
  } else if (current && JSON.stringify(current) === JSON.stringify(wanted)) {
    io.log("  ✔ settings.json already uses the glow status line");
  } else {
    let backup = null;
    step(`back up settings.json, then set its "statusLine" to ${wanted.command}`,
      `settings.json: "statusLine" set${settings.status === "ok" ? " (other keys untouched)" : " (new file)"}`, () => {
        fs.mkdirSync(cfgDir, { recursive: true });
        if (settings.status === "ok" && settings.raw !== null) backup = backupSettings(settingsFile);
        writeSettings(settingsFile, { ...settings.data, statusLine: wanted });
      });
    if (backup) io.log(`    backup: ${backup}`);
    if (hadForeign) io.log(`    your previous status line ${dryRun ? "would be saved" : "is saved"} in config.json; \`claude-glow uninstall\` restores it`);
  }

  if (!dryRun) {
    const check = verifyInstalled(gdir);
    if (check.ok) {
      io.log("");
      io.log("  What Claude Code will show (sample data):");
      for (const line of check.out.split("\n")) io.log(`    ${line}`);
    } else {
      io.log(`  ! the installed status line did not run cleanly${check.out ? `: ${check.out}` : ""}`);
    }
  }

  io.log("");
  if (uiTheme) io.log("In Claude Code run /theme and pick 'Glow (live)' once — after that `claude-glow theme` switches the whole UI instantly.");
  io.log("Restart Claude Code (or send a message) to see the status line. Change themes any time: `claude-glow theme`.");
  io.log(`Without npm, from any folder: node "${forwardSlashes(path.join(gdir, "bin", "claude-glow.mjs"))}" theme`);
  return code;
}

// Theme files we wrote carry the extra top-level "glow" object; a user's own glow-*.json does not.
function isOurThemeFile(file) {
  const t = readJson(file);
  return !!t && typeof t === "object" && !!t.glow && typeof t.glow === "object";
}

/**
 * claude-glow uninstall: restore (or remove) the statusLine, delete the theme files we created and our folder.
 * @param opts { dryRun = false }
 * @returns exit code: 0 done, 1 settings.json could not be parsed (nothing was changed)
 */
export function uninstall(opts = {}, io = consoleIO) {
  const { dryRun = false } = opts;
  const cfgDir = configDir();
  const gdir = glowDir(cfgDir);
  const settingsFile = path.join(cfgDir, "settings.json");
  const settings = readSettings(settingsFile);
  if (settings.status === "invalid") {
    io.error(`${settingsFile} is not valid JSON, so nothing was changed.`);
    io.error('Remove the "statusLine" entry that points at claude-code-glow by hand, then run uninstall again.');
    return 1;
  }

  io.log(dryRun ? "claude-code-glow uninstall (dry run, nothing will be changed)" : "claude-code-glow uninstall");
  io.log(`  config folder  ${cfgDir}`);
  let did = 0;
  const step = (would, done, fn) => {
    did++;
    if (dryRun) { io.log(`  would ${would}`); return; }
    fn();
    io.log(`  ✔ ${done}`);
  };

  // 1. settings.json
  const ours = settings.status === "ok" && isOurStatusLine(settings.data.statusLine);
  if (ours) {
    const config = readJson(path.join(gdir, "config.json")) || {};
    const prev = config.previousStatusLine && typeof config.previousStatusLine === "object" ? config.previousStatusLine : null;
    let backup = null;
    step(prev ? "back up settings.json and restore your previous status line" : "back up settings.json and remove the glow status line",
      prev ? "settings.json: previous status line restored" : "settings.json: glow status line removed", () => {
        backup = backupSettings(settingsFile);
        const next = { ...settings.data };
        if (prev) next.statusLine = prev; else delete next.statusLine;
        writeSettings(settingsFile, next);
      });
    if (backup) io.log(`    backup: ${backup}`);
  } else if (settings.status === "ok" && settings.data.statusLine) {
    io.log("  - settings.json has a different status line; left as it is");
  }

  // 2. UI themes we created: glow.json and glow-*.json that carry our "glow" marker
  const themesDir = uiThemesDir(cfgDir);
  let themeFiles = [];
  try { themeFiles = fs.readdirSync(themesDir).filter((f) => /^glow(-.+)?\.json$/.test(f)); } catch { /* no themes folder */ }
  const mine = themeFiles.filter((f) => isOurThemeFile(path.join(themesDir, f)));
  if (mine.length) {
    step(`delete ${mine.length} Glow theme file(s) from ${themesDir}`, `removed ${mine.length} Glow theme file(s) from ${themesDir}`, () => {
      for (const f of mine) fs.rmSync(path.join(themesDir, f), { force: true });
    });
  }
  const skipped = themeFiles.length - mine.length;
  if (skipped) io.log(`  - kept ${skipped} file(s) named glow*.json that are not Glow themes`);

  // 3. our folder
  if (fs.existsSync(gdir)) {
    step(`delete ${gdir}`, `removed ${gdir}`, () => fs.rmSync(gdir, { recursive: true, force: true }));
  }

  if (!did) io.log("  nothing to remove: claude-code-glow is not installed here.");
  else if (!dryRun) {
    io.log("");
    io.log("If you had a Glow theme selected, run /theme in Claude Code and pick another.");
  }
  return 0;
}
