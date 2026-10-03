import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PALETTES } from "../src/palettes.mjs";
import { ROOT, SAMPLE_JSON, ls, readJson, run, sandbox } from "./helpers.mjs";

const SLUGS = PALETTES.map((p) => p.slug);
const theme = (slug) => readJson(path.join(ROOT, "themes", `glow-${slug}.json`));
const live = (box) => readJson(box.path("themes", "glow.json"));
const config = (box) => readJson(box.path("claude-code-glow", "config.json"));

// Claude Code's color validator (hex branch is all the generated files use), for the live theme file.
const validColor = (v) => typeof v === "string" && (/^#[0-9a-fA-F]{6}$/.test(v) || /^#[0-9a-fA-F]{3}$/.test(v));

test("help: --help, -h, help and no arguments print usage and exit 0", () => {
  const box = sandbox();
  try {
    for (const args of [["--help"], ["-h"], ["help"], []]) {
      const r = run(box, args);
      assert.equal(r.status, 0, JSON.stringify(args));
      assert.match(r.stdout, /Usage: claude-glow <command>/);
      for (const cmd of ["install", "uninstall", "theme set", "theme list", "preview", "icons", "tips", "cheatsheet", "doctor"]) assert.ok(r.stdout.includes(cmd), `${cmd} documented`);
    }
    assert.equal(run(box, ["install", "--help"]).status, 0);
    assert.deepEqual(ls(box.cfg), [], "asking for help writes nothing");
  } finally { box.cleanup(); }
});

test("unknown command: help on stdout, a message on stderr, exit 1", () => {
  const box = sandbox();
  try {
    const r = run(box, ["frobnicate"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /unknown command "frobnicate"/);
    assert.match(r.stdout, /Usage: claude-glow/);
    assert.equal(run(box, ["theme", "frobnicate"]).status, 1);
    assert.equal(run(box, ["theme", "set"]).status, 1);
    assert.equal(run(box, ["preview", "--wat"]).status, 1);
    assert.equal(run(box, ["icons"]).status, 1);
    assert.equal(run(box, ["tips", "maybe"]).status, 1);
    assert.deepEqual(ls(box.cfg), [], "failed commands write nothing");
  } finally { box.cleanup(); }
});

test("--version prints the package version", () => {
  const box = sandbox();
  try {
    const pkg = readJson(path.join(ROOT, "package.json"));
    for (const flag of ["--version", "-v"]) {
      const r = run(box, [flag]);
      assert.equal(r.status, 0);
      assert.equal(r.stdout.trim(), pkg.version);
    }
    assert.equal(pkg.version, "1.0.0");
  } finally { box.cleanup(); }
});

test("theme set rewrites glow.json (the live theme) and config.json", () => {
  const box = sandbox();
  try {
    assert.equal(run(box, ["install"]).status, 0);
    for (const slug of ["dracula", "tokyo-night", "github-light", "matrix", "classic"]) {
      const r = run(box, ["theme", "set", slug]);
      assert.equal(r.status, 0, r.out);
      assert.equal(config(box).theme, slug);
      const l = live(box);
      const t = theme(slug);
      assert.equal(l.name, "Glow (live)");
      assert.equal(l.base, t.base);
      assert.deepEqual(l.overrides, t.overrides, `${slug}: the live theme carries the theme's colors`);
      assert.deepEqual(l.glow, t.glow);
      for (const v of Object.values(l.overrides)) assert.ok(validColor(v));
      assert.match(r.out, /Claude Code recolors instantly/);
    }
    assert.deepEqual(live(box).overrides, {}, "classic: stock UI colors");
  } finally { box.cleanup(); }
});

test("theme set accepts the glow- prefix, any case, spaces and a unique prefix", () => {
  const box = sandbox();
  try {
    for (const [typed, want] of [["glow-nord", "nord"], ["NORD", "nord"], ["Tokyo Night", "tokyo-night"], ["tokyo_night", "tokyo-night"], ["synthwave84", "synthwave-84"], ["Synthwave '84", "synthwave-84"], ["glow-Catppuccin-Latte", "catppuccin-latte"], ["solar", "solarized-dark"], ["rose", "rose-pine"]]) {
      const r = run(box, ["theme", "set", typed]);
      assert.equal(r.status, 0, `${typed}: ${r.out}`);
      assert.equal(config(box).theme, want, typed);
      assert.equal(live(box).overrides.claude, theme(want).overrides.claude || live(box).overrides.claude);
    }
  } finally { box.cleanup(); }
});

test("theme set: typos get a suggestion and change nothing; ambiguous names list the candidates", () => {
  const box = sandbox();
  try {
    assert.equal(run(box, ["theme", "set", "dracula"]).status, 0);
    const before = fs.readFileSync(box.path("themes", "glow.json"), "utf8");
    const configBefore = fs.readFileSync(box.path("claude-code-glow", "config.json"), "utf8");
    for (const [typed, suggestion] of [["draclua", "dracula"], ["nrod", "nord"], ["tokio-night", "tokyo-night"], ["gruvbox", null], ["monokay", "monokai"], ["matrx", "matrix"], ["cyberpunc", "cyberpunk"]]) {
      const r = run(box, ["theme", "set", typed]);
      if (suggestion === null) { assert.equal(r.status, 0, "unique prefix resolves"); assert.equal(config(box).theme, "gruvbox-dark"); run(box, ["theme", "set", "dracula"]); continue; }
      assert.equal(r.status, 1, typed);
      assert.match(r.stderr, new RegExp(`Did you mean: .*${suggestion}`), typed);
    }
    const cat = run(box, ["theme", "set", "cat"]);
    assert.equal(cat.status, 1);
    assert.match(cat.stderr, /catppuccin-mocha, catppuccin-latte/);
    const nope = run(box, ["theme", "set", "qqqqqqqq"]);
    assert.equal(nope.status, 1);
    assert.doesNotMatch(nope.stderr, /Did you mean/);
    assert.equal(fs.readFileSync(box.path("themes", "glow.json"), "utf8"), before, "live theme untouched by failures");
    assert.equal(fs.readFileSync(box.path("claude-code-glow", "config.json"), "utf8"), configBefore);
  } finally { box.cleanup(); }
});

test("theme set without a usable name: the problem on stderr, the theme names on stdout (the /glow:theme skill shows stdout)", () => {
  const box = sandbox();
  try {
    const names = `Themes: ${SLUGS.join(", ")}`;
    for (const [args, problem] of [
      [["theme", "set"], /needs a theme name/],
      [["theme", "set", ""], /needs a theme name/],
      [["theme", "set", "   "], /needs a theme name/],
      [["theme", "set", "qqqqqqqq"], /Unknown theme "qqqqqqqq"/],
      [["theme", "set", "draclua"], /Did you mean: dracula/],
    ]) {
      const r = run(box, args);
      assert.equal(r.status, 1, JSON.stringify(args));
      assert.equal(r.stdout.trim(), names, `stdout lists every theme for ${JSON.stringify(args)}`);
      assert.match(r.stderr, problem);
    }
    assert.deepEqual(ls(box.cfg), [], "nothing was written");
  } finally { box.cleanup(); }
});

test("`theme <slug>` is a shortcut for `theme set <slug>`", () => {
  const box = sandbox();
  try {
    const r = run(box, ["theme", "monokai"]);
    assert.equal(r.status, 0, r.out);
    assert.equal(config(box).theme, "monokai");
  } finally { box.cleanup(); }
});

test("theme set works before install, and says so", () => {
  const box = sandbox();
  try {
    const r = run(box, ["theme", "set", "nord"]);
    assert.equal(r.status, 0, r.out);
    assert.equal(config(box).theme, "nord");
    assert.ok(fs.existsSync(box.path("themes", "glow.json")));
    assert.match(r.out, /not installed yet: run `claude-glow install`/);
    assert.ok(!fs.existsSync(box.path("settings.json")), "theme set never touches settings.json");
  } finally { box.cleanup(); }
});

test("the live theme file is replaced atomically: always parseable, no stray temp files", () => {
  const box = sandbox();
  try {
    for (let i = 0; i < 8; i++) {
      assert.equal(run(box, ["theme", "set", SLUGS[i]]).status, 0);
      assert.doesNotThrow(() => live(box));
    }
    assert.deepEqual(ls(box.path("themes")), ["glow.json"], "no leftover .tmp files next to it");
  } finally { box.cleanup(); }
});

test("theme list: every theme, the current one marked, one line each, plain when piped", () => {
  const box = sandbox();
  try {
    assert.equal(run(box, ["theme", "set", "gruvbox-dark"]).status, 0);
    const r = run(box, ["theme", "list"]);
    assert.equal(r.status, 0, r.out);
    assert.ok(!r.stdout.includes("\x1b"), "no escape codes when piped");
    const rows = r.stdout.split("\n").filter((l) => /■■■■■/.test(l));
    assert.equal(rows.length, PALETTES.length);
    for (const slug of SLUGS) assert.ok(rows.some((l) => l.includes(` ${slug} `)), slug);
    const marked = rows.filter((l) => l.startsWith("●"));
    assert.equal(marked.length, 1);
    assert.ok(marked[0].includes("gruvbox-dark"));
    for (const row of rows) assert.match(row, /◆ Sonnet 5\.5/, "each row previews the status line");
    assert.match(r.stdout, /15 themes\. Switch with: claude-glow theme set <slug>/);
    // colors on request
    const colored = run(box, ["theme", "list"], { env: { NO_COLOR: undefined, FORCE_COLOR: "1" } });
    assert.match(colored.stdout, /\x1b\[38;2;/);
    assert.match(colored.stdout, /\x1b\[48;2;/, "the previews are drawn in each theme's colors");
  } finally { box.cleanup(); }
});

test("theme with no arguments and no terminal behaves like theme list", () => {
  const box = sandbox();
  try {
    const bare = run(box, ["theme"]);
    const list = run(box, ["theme", "list"]);
    assert.equal(bare.status, 0, bare.out);
    assert.equal(bare.stdout, list.stdout);
    assert.deepEqual(ls(box.cfg), [], "listing writes nothing");
  } finally { box.cleanup(); }
});

test("preview: two lines of sample data, honoring the config", () => {
  const box = sandbox();
  try {
    let r = run(box, ["preview"]);
    assert.equal(r.status, 0, r.out);
    let lines = r.stdout.trimEnd().split("\n");
    assert.equal(lines.length, 2);
    assert.match(lines[0], /^◆ Sonnet 5\.5 · high \| ⌂ nrzz\/claude-code-glow \| ⎇ main\* \|/);
    assert.match(lines[1], /^💡 /);
    assert.equal(run(box, ["icons", "ascii"]).status, 0);
    assert.equal(run(box, ["tips", "off"]).status, 0);
    r = run(box, ["preview"]);
    lines = r.stdout.trimEnd().split("\n");
    assert.equal(lines.length, 1, "tips off: one line");
    assert.match(lines[0], /^Sonnet 5\.5 high \| nrzz\/claude-code-glow \| main\* \| ctx \[###/);
    assert.equal(run(box, ["tips", "on"]).status, 0);
    assert.equal(run(box, ["preview"]).stdout.trimEnd().split("\n").length, 2);
  } finally { box.cleanup(); }
});

test("preview --theme, --json <file> and --json -", () => {
  const box = sandbox();
  try {
    const colored = { NO_COLOR: undefined, FORCE_COLOR: "1" };
    const dracula = run(box, ["preview", "--theme", "dracula"], { env: colored });
    assert.equal(dracula.status, 0, dracula.out);
    assert.ok(dracula.stdout.includes("\x1b[48;2;189;147;249m"), "dracula's accent");
    const tokyo = run(box, ["preview", "--theme=tokyo"], { env: colored });
    assert.ok(tokyo.stdout.includes("\x1b[48;2;187;154;247m"), "tokyo night's accent #bb9af7");
    assert.equal(run(box, ["preview", "--theme", "draclua"]).status, 1);

    const fromFile = run(box, ["preview", "--json", SAMPLE_JSON]);
    assert.equal(fromFile.status, 0, fromFile.out);
    assert.match(fromFile.stdout, /Sonnet 5\.5/);
    assert.match(fromFile.stdout, /cache 91%/);
    assert.doesNotMatch(fromFile.stdout, /cold in/, "the fixture's cache expires in 2100");

    const custom = { model: { display_name: "Haiku 4.5" }, effort: { level: "max" }, cost: { total_cost_usd: 12.5 } };
    const fromStdin = run(box, ["preview", "--json", "-"], { input: JSON.stringify(custom) });
    assert.equal(fromStdin.status, 0, fromStdin.out);
    const lines = fromStdin.stdout.trimEnd().split("\n");
    assert.match(lines[0], /Haiku 4\.5 · max/);
    assert.match(lines[0], /\$12\.50/);
    assert.equal(lines[1], "💡 Effort max overthinks routine work — try high");

    assert.equal(run(box, ["preview", "--json", path.join(box.root, "missing.json")]).status, 1);
    const badFile = path.join(box.root, "bad.json");
    fs.writeFileSync(badFile, "{ nope");
    const bad = run(box, ["preview", "--json", badFile]);
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /Cannot read JSON/);
    assert.equal(run(box, ["preview", "--json"]).status, 1);
  } finally { box.cleanup(); }
});

test("icons and tips persist to config.json and validate", () => {
  const box = sandbox();
  try {
    for (const mode of ["nerd", "ascii", "unicode"]) {
      const r = run(box, ["icons", mode]);
      assert.equal(r.status, 0, r.out);
      assert.equal(config(box).icons, mode);
    }
    assert.match(run(box, ["icons", "nerd"]).out, /Nerd Font/);
    const bad = run(box, ["icons", "emoji"]);
    assert.equal(bad.status, 1);
    assert.equal(config(box).icons, "nerd");
    assert.equal(run(box, ["tips", "off"]).status, 0);
    assert.equal(config(box).tips, false);
    assert.equal(run(box, ["tips", "on"]).status, 0);
    assert.equal(config(box).tips, true);
    assert.equal(run(box, ["tips", "yes"]).status, 1);
    // other config keys survive
    run(box, ["theme", "set", "nord"]);
    run(box, ["icons", "ascii"]);
    assert.equal(config(box).theme, "nord");
  } finally { box.cleanup(); }
});

test("cheatsheet prints the keys, commands, flags and habits", () => {
  const box = sandbox();
  try {
    const r = run(box, ["cheatsheet"]);
    assert.equal(r.status, 0, r.out);
    for (const needle of ["Esc Esc", "Shift+Tab", "ctrl+r", "ctrl+o", "! cmd", "@path", "/context", "/compact", "/clear", "/resume", "/rename", "/model", "/theme", "/statusline", "/usage", "/hooks", "/agents", "/plugin", "/mcp", "/memory", "/export", "claude -c", "claude -r", "claude -p", "--fork-session", "SAVE TOKENS"]) {
      assert.ok(r.stdout.includes(needle), needle);
    }
    assert.ok(r.stdout.split("\n").length <= 34, "fits one screen");
    assert.ok(!r.stdout.includes("\x1b"));
    const colored = run(box, ["cheatsheet"], { env: { NO_COLOR: undefined, FORCE_COLOR: "1" } });
    assert.match(colored.stdout, /\x1b\[38;2;/);
  } finally { box.cleanup(); }
});

test("CLAUDE_CONFIG_DIR: relative paths resolve from the working directory; default is ~/.claude", () => {
  const box = sandbox();
  try {
    const rel = run(box, ["icons", "ascii"], { env: { CLAUDE_CONFIG_DIR: "relative-cfg" }, cwd: box.root });
    assert.equal(rel.status, 0, rel.out);
    assert.ok(fs.existsSync(path.join(box.root, "relative-cfg", "claude-code-glow", "config.json")));

    const dflt = run(box, ["icons", "nerd"], { env: { CLAUDE_CONFIG_DIR: undefined } });
    assert.equal(dflt.status, 0, dflt.out);
    assert.ok(fs.existsSync(path.join(box.home, ".claude", "claude-code-glow", "config.json")), "falls back to <HOME>/.claude (here a temp HOME)");
    assert.deepEqual(ls(box.cfg), [], "and does not touch the CLAUDE_CONFIG_DIR sandbox of other runs");
  } finally { box.cleanup(); }
});

test("a corrupt config.json is treated as defaults and repaired by the next write", () => {
  const box = sandbox();
  try {
    box.write("claude-code-glow/config.json", "{ nope");
    const r = run(box, ["icons", "ascii"]);
    assert.equal(r.status, 0, r.out);
    assert.equal(config(box).icons, "ascii");
    assert.equal(config(box).theme, "synthwave-84");
  } finally { box.cleanup(); }
});
