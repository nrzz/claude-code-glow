import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PALETTES } from "../src/palettes.mjs";
import { ROOT, SAMPLE_JSON, ls, readJson, run, runScript, runStatusline, sandbox } from "./helpers.mjs";

const UI_SLUGS = PALETTES.map((p) => p.slug).filter((s) => s !== "classic");
const OLD_STATUSLINE = { type: "command", command: "echo old-status", padding: 2 };
const ORIGINAL = {
  model: "opus",
  statusLine: OLD_STATUSLINE,
  permissions: { allow: ["Bash(npm test)", "Read(~/notes/**)"], deny: ["Bash(rm -rf *)"], defaultMode: "acceptEdits" },
  env: { FOO: "bar", UNICODE: "café ☕ 日本語" },
  hooks: { PostToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "echo done" }] }] },
  enabledPlugins: { "a@b": true },
  cleanupPeriodDays: 30,
};
const backups = (box) => ls(box.cfg).filter((f) => /^settings\.json\.bak-glow-\d{8}-\d{6}(-\d+)?$/.test(f));
const slFor = (box) => `node "${path.join(box.cfg, "claude-code-glow", "statusline.mjs").replace(/\\/g, "/")}"`;

test("install into an empty config folder", () => {
  const box = sandbox();
  try {
    const r = run(box, ["install"]);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /In Claude Code run \/theme and pick 'Glow \(live\)' once — after that `claude-glow theme` switches the whole UI instantly\./);
    assert.match(r.out, /copied statusline\.mjs, bin\/, src\/ and themes\/ into /, "the summary names bin/ too");
    assert.ok(r.out.includes(`Without npm, from any folder: node "${box.path("claude-code-glow", "bin", "claude-glow.mjs").replace(/\\/g, "/")}" theme`), "and the stable command");

    // settings.json: only the statusLine key; no backup because there was nothing to back up
    const settings = readJson(box.path("settings.json"));
    assert.deepEqual(settings, { statusLine: { type: "command", command: slFor(box), padding: 0 } });
    assert.match(settings.statusLine.command, /^node "[^"\\]+\/claude-code-glow\/statusline\.mjs"$/, "forward slashes, quoted path");
    assert.ok(fs.existsSync(settings.statusLine.command.slice(6, -1)), "the command points at a real file");
    assert.deepEqual(backups(box), []);

    // our copy
    for (const f of ["statusline.mjs", "config.json", "package.json", "bin/claude-glow.mjs", "src/cli.mjs", "src/render.mjs", "src/colors.mjs", "src/config.mjs", "src/tips.mjs", "src/git.mjs", "src/metrics.mjs", "src/defaults.mjs", "src/color-math.mjs", "src/fsutil.mjs", "src/theme-gen.mjs", "src/palettes.mjs", "themes/glow-dracula.json", "themes/glow-classic.json"]) {
      assert.ok(fs.existsSync(box.path("claude-code-glow", f)), f);
    }
    assert.deepEqual(readJson(box.path("claude-code-glow", "config.json")), {
      theme: "synthwave-84", icons: "unicode", segments: ["model", "dir", "git", "context", "cost", "time", "limits", "cache"], tips: true, featureTips: true,
    });

    // UI themes: all but classic, plus the live file
    assert.deepEqual(ls(box.path("themes")), ["glow.json", ...UI_SLUGS.map((s) => `glow-${s}.json`)].sort());
    for (const s of UI_SLUGS) assert.equal(fs.readFileSync(box.path("themes", `glow-${s}.json`), "utf8"), fs.readFileSync(path.join(ROOT, "themes", `glow-${s}.json`), "utf8"));
    const live = readJson(box.path("themes", "glow.json"));
    const synth = readJson(path.join(ROOT, "themes", "glow-synthwave-84.json"));
    assert.equal(live.name, "Glow (live)");
    assert.deepEqual({ ...live, name: synth.name }, synth, "the live theme is the chosen theme under another name");

    // nothing escaped the config folder
    assert.deepEqual(ls(box.root), ["cfg", "home"]);
    assert.deepEqual(ls(box.home), [], "HOME is untouched");
  } finally { box.cleanup(); }
});

test("install preserves every other settings key, backs up, formats with 2 spaces", () => {
  const box = sandbox();
  try {
    const original = JSON.stringify(ORIGINAL, null, 4) + "\n";
    box.write("settings.json", original);
    const r = run(box, ["install", "--theme", "dracula"]);
    assert.equal(r.status, 0, r.out);

    const text = fs.readFileSync(box.path("settings.json"), "utf8");
    const settings = JSON.parse(text);
    assert.deepEqual(settings, { ...ORIGINAL, statusLine: { type: "command", command: slFor(box), padding: 0 } });
    assert.deepEqual(Object.keys(settings), Object.keys(ORIGINAL), "key order kept, statusLine stays where it was");
    assert.equal(text, JSON.stringify(settings, null, 2) + "\n", "2-space indent, trailing newline");

    const [backup, ...rest] = backups(box);
    assert.equal(rest.length, 0, "exactly one backup");
    assert.equal(fs.readFileSync(box.path(backup), "utf8"), original, "the backup is the original, byte for byte");

    // the status line we replaced is remembered for uninstall
    assert.deepEqual(readJson(box.path("claude-code-glow", "config.json")).previousStatusLine, OLD_STATUSLINE);
    assert.match(r.out, /previous status line/);
    assert.ok(r.out.includes(backup), "the output names the backup");
  } finally { box.cleanup(); }
});

test("install appends statusLine at the end when settings had none", () => {
  const box = sandbox();
  try {
    const { statusLine, ...without } = ORIGINAL;
    box.write("settings.json", without);
    assert.equal(run(box, ["install"]).status, 0);
    const settings = readJson(box.path("settings.json"));
    assert.deepEqual(Object.keys(settings), [...Object.keys(without), "statusLine"]);
    assert.equal(readJson(box.path("claude-code-glow", "config.json")).previousStatusLine, undefined);
    assert.equal(backups(box).length, 1);
  } finally { box.cleanup(); }
});

test("install is idempotent: same settings bytes, one backup, previous status line kept", () => {
  const box = sandbox();
  try {
    box.write("settings.json", ORIGINAL);
    assert.equal(run(box, ["install", "--theme", "nord"]).status, 0);
    const settingsAfterFirst = fs.readFileSync(box.path("settings.json"), "utf8");
    const configAfterFirst = fs.readFileSync(box.path("claude-code-glow", "config.json"), "utf8");
    const themesAfterFirst = ls(box.path("themes"));
    const second = run(box, ["install"]);
    assert.equal(second.status, 0, second.out);
    assert.equal(fs.readFileSync(box.path("settings.json"), "utf8"), settingsAfterFirst, "settings.json byte-identical");
    assert.equal(fs.readFileSync(box.path("claude-code-glow", "config.json"), "utf8"), configAfterFirst, "config.json (theme nord, previousStatusLine) unchanged");
    assert.deepEqual(ls(box.path("themes")), themesAfterFirst);
    assert.equal(backups(box).length, 1, "no second backup when nothing changed");
    assert.equal(readJson(box.path("claude-code-glow", "config.json")).previousStatusLine.command, "echo old-status", "our own status line never replaces the saved one");
    assert.match(second.out, /already uses the glow status line/);
    assert.equal(run(box, ["install"]).status, 0, "and a third time");
    assert.equal(fs.readFileSync(box.path("settings.json"), "utf8"), settingsAfterFirst);
  } finally { box.cleanup(); }
});

test("re-install applies new flags, keeps config edits, and removes files left by an older version", () => {
  const box = sandbox();
  try {
    assert.equal(run(box, ["install", "--theme", "dracula", "--icons", "nerd"]).status, 0);
    const configFile = box.path("claude-code-glow", "config.json");
    const config = readJson(configFile);
    config.segments = ["model", "cost"];
    config.tips = false;
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
    fs.writeFileSync(box.path("claude-code-glow", "src", "old-module.mjs"), "// from an older version\n");
    fs.writeFileSync(box.path("claude-code-glow", "bin", "old-cli.mjs"), "// from an older version\n");
    fs.writeFileSync(box.path("claude-code-glow", "themes", "glow-retired.json"), "{}");
    fs.mkdirSync(box.path("claude-code-glow", "src", "old-dir"));

    assert.equal(run(box, ["install"]).status, 0, "no flags: keep theme and icons");
    let after = readJson(configFile);
    assert.equal(after.theme, "dracula");
    assert.equal(after.icons, "nerd");
    assert.deepEqual(after.segments, ["model", "cost"]);
    assert.equal(after.tips, false);
    assert.ok(!fs.existsSync(box.path("claude-code-glow", "src", "old-module.mjs")));
    assert.ok(!fs.existsSync(box.path("claude-code-glow", "bin", "old-cli.mjs")));
    assert.ok(fs.existsSync(box.path("claude-code-glow", "bin", "claude-glow.mjs")));
    assert.ok(!fs.existsSync(box.path("claude-code-glow", "src", "old-dir")));
    assert.ok(!fs.existsSync(box.path("claude-code-glow", "themes", "glow-retired.json")));
    assert.ok(fs.existsSync(box.path("claude-code-glow", "src", "render.mjs")));

    assert.equal(run(box, ["install", "--theme", "tokyo-night", "--icons", "ascii"]).status, 0);
    after = readJson(configFile);
    assert.equal(after.theme, "tokyo-night");
    assert.equal(after.icons, "ascii");
    assert.equal(readJson(box.path("themes", "glow.json")).overrides.claude, readJson(path.join(ROOT, "themes", "glow-tokyo-night.json")).overrides.claude, "the live theme follows");
  } finally { box.cleanup(); }
});

test("install: invalid settings.json is never touched; exit 1 with the snippet to add by hand", () => {
  const box = sandbox();
  try {
    for (const bad of ['{ "model": "opus", }', "not json at all", "[]", '"a string"', '{ "a": 1 } trailing', "{ // comment\n}"]) {
      const file = box.write("settings.json", bad);
      const r = run(box, ["install"]);
      assert.equal(r.status, 1, `exit code for ${JSON.stringify(bad)}`);
      assert.equal(fs.readFileSync(file, "utf8"), bad, "bytes untouched");
      assert.deepEqual(backups(box), [], "no backup of a file we did not change");
      assert.match(r.out, /not valid JSON/);
      assert.match(r.stderr, /"statusLine": \{/);
      assert.match(r.stderr, /"type": "command"/);
      assert.match(r.stderr, /claude-code-glow\/statusline\.mjs/);
    }
    assert.ok(fs.existsSync(box.path("claude-code-glow", "statusline.mjs")), "the files were still copied, so the manual snippet works");
  } finally { box.cleanup(); }
});

test("install: an empty settings.json counts as {}, and a BOM is tolerated and dropped", () => {
  const box = sandbox();
  try {
    box.write("settings.json", "");
    assert.equal(run(box, ["install"]).status, 0);
    assert.deepEqual(Object.keys(readJson(box.path("settings.json"))), ["statusLine"]);

    const box2 = sandbox();
    try {
      const withBom = "\uFEFF" + JSON.stringify({ model: "sonnet" });
      box2.write("settings.json", withBom);
      assert.equal(run(box2, ["install"]).status, 0);
      const text = fs.readFileSync(box2.path("settings.json"), "utf8");
      assert.ok(!text.startsWith("\uFEFF"));
      assert.equal(JSON.parse(text).model, "sonnet");
      assert.equal(fs.readFileSync(box2.path(backups(box2)[0]), "utf8"), withBom, "the backup keeps the original bytes");
    } finally { box2.cleanup(); }
  } finally { box.cleanup(); }
});

test("install --dry-run writes nothing", () => {
  const box = sandbox();
  try {
    box.write("settings.json", ORIGINAL);
    const before = fs.readFileSync(box.path("settings.json"), "utf8");
    const r = run(box, ["install", "--dry-run", "--theme", "gruvbox"]);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /dry run/);
    assert.match(r.out, /would copy/);
    assert.deepEqual(ls(box.cfg), ["settings.json"]);
    assert.equal(fs.readFileSync(box.path("settings.json"), "utf8"), before);
    assert.ok(!r.out.includes("What Claude Code will show"), "no verification run in a dry run");
  } finally { box.cleanup(); }
});

test("install --theme / --icons validation", () => {
  const box = sandbox();
  try {
    let r = run(box, ["install", "--theme", "draclua"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Did you mean: dracula/);
    r = run(box, ["install", "--theme", "zzzzzz"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Available: .*dracula/);
    r = run(box, ["install", "--icons", "emoji"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /nerd, unicode, ascii/);
    r = run(box, ["install", "--bogus"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /unknown option --bogus/);
    r = run(box, ["install", "--theme"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /--theme needs a value/);
    assert.deepEqual(ls(box.cfg), [], "nothing written for rejected installs");

    r = run(box, ["install", "--theme=glow-Cyberpunk", "--icons=ascii"]);
    assert.equal(r.status, 0, r.out);
    const config = readJson(box.path("claude-code-glow", "config.json"));
    assert.equal(config.theme, "cyberpunk");
    assert.equal(config.icons, "ascii");
  } finally { box.cleanup(); }
});

test("install --theme classic: status line only, the live theme carries no overrides", () => {
  const box = sandbox();
  try {
    assert.equal(run(box, ["install", "--theme", "classic"]).status, 0);
    assert.ok(!fs.existsSync(box.path("themes", "glow-classic.json")), "classic is never listed in /theme");
    const live = readJson(box.path("themes", "glow.json"));
    assert.deepEqual(live.overrides, {});
    assert.equal(live.base, "dark");
    assert.equal(live.name, "Glow (live)");
    assert.equal(readJson(box.path("claude-code-glow", "config.json")).theme, "classic");
  } finally { box.cleanup(); }
});

test("install --no-ui-theme leaves Claude Code's UI colors alone, and theme set respects it", () => {
  const box = sandbox();
  try {
    const r = run(box, ["install", "--no-ui-theme"]);
    assert.equal(r.status, 0, r.out);
    assert.ok(!fs.existsSync(box.path("themes")), "no themes folder created");
    assert.equal(readJson(box.path("claude-code-glow", "config.json")).uiTheme, false);
    assert.ok(!r.out.includes("pick 'Glow (live)'"), "no /theme instruction when there is no UI theme");
    const set = run(box, ["theme", "set", "dracula"]);
    assert.equal(set.status, 0, set.out);
    assert.ok(!fs.existsSync(box.path("themes")), "theme set does not write UI themes either");
    assert.equal(readJson(box.path("claude-code-glow", "config.json")).theme, "dracula", "but the status line follows");
    assert.match(set.out, /untouched/);
    // installing again without the flag brings the UI themes
    assert.equal(run(box, ["install"]).status, 0);
    assert.ok(fs.existsSync(box.path("themes", "glow.json")));
    assert.equal(readJson(box.path("claude-code-glow", "config.json")).uiTheme, undefined);
    assert.equal(readJson(box.path("themes", "glow.json")).overrides.claude, readJson(path.join(ROOT, "themes", "glow-dracula.json")).overrides.claude);
  } finally { box.cleanup(); }
});

test("the installed copy runs on its own with the installed theme and icons", () => {
  const box = sandbox();
  try {
    assert.equal(run(box, ["install", "--theme", "dracula", "--icons", "ascii"]).status, 0);
    const installed = box.path("claude-code-glow", "statusline.mjs");
    const r = runStatusline(box, installed, readJson(SAMPLE_JSON));
    assert.equal(r.status, 0);
    assert.equal(r.stderr, "");
    assert.match(r.stdout, /Sonnet 5\.5 high \| nrzz\/claude-code-glow/);
    const colored = runStatusline(box, installed, readJson(SAMPLE_JSON), { env: { NO_COLOR: undefined } });
    assert.ok(colored.stdout.includes("\x1b[38;2;189;147;249m"), "dracula's #bd93f9");
    // and it works even when the repo is not around: it only imports files inside its own folder
    const folder = (d) => fs.readdirSync(box.path("claude-code-glow", d)).map((f) => fs.readFileSync(box.path("claude-code-glow", d, f), "utf8"));
    const sources = [...folder("src"), ...folder("bin"), fs.readFileSync(installed, "utf8")];
    for (const src of sources) for (const m of src.matchAll(/(?:from|import\()\s*["'](\.[^"']+)["']/g)) assert.doesNotMatch(m[1], /^\.\.\/\.\.|^\.\.\/(?!src)/, `${m[1]} stays inside the installed folder`);
  } finally { box.cleanup(); }
});

test("the installed bin/claude-glow.mjs is a stable command: every subcommand works from it", () => {
  const box = sandbox();
  try {
    box.write("settings.json", ORIGINAL);
    assert.equal(run(box, ["install", "--theme", "dracula"]).status, 0);
    const cli = box.path("claude-code-glow", "bin", "claude-glow.mjs");
    const glow = (...args) => runScript(box, cli, args);

    const version = glow("--version");
    assert.equal(version.status, 0, version.out);
    assert.equal(version.stdout.trim(), "1.0.0", "package.json is copied too, so --version works");
    assert.match(glow("--help").stdout, /Usage: claude-glow <command>/);

    const list = glow("theme", "list");
    assert.equal(list.status, 0, list.out);
    assert.equal(list.stdout.split("\n").filter((l) => /■■■■■/.test(l)).length, 15, "the installed themes/ folder has them all, classic included");
    assert.ok(list.stdout.split("\n").find((l) => l.startsWith("●")).includes("dracula"), "the current theme is marked");

    const set = glow("theme", "set", "tokyo-night");
    assert.equal(set.status, 0, set.out);
    assert.equal(readJson(box.path("claude-code-glow", "config.json")).theme, "tokyo-night");
    assert.equal(readJson(box.path("themes", "glow.json")).overrides.claude, readJson(path.join(ROOT, "themes", "glow-tokyo-night.json")).overrides.claude);
    assert.equal(glow("theme", "set", "tokio-night").status, 1);
    assert.equal(glow("theme").status, 0, "theme without a terminal lists");

    const preview = glow("preview");
    assert.equal(preview.status, 0, preview.out);
    assert.equal(preview.stdout.trimEnd().split("\n").length, 2);
    assert.equal(glow("icons", "ascii").status, 0);
    assert.equal(glow("tips", "off").status, 0);
    assert.equal(glow("preview").stdout.trimEnd().split("\n").length, 1);
    assert.match(glow("cheatsheet").stdout, /SAVE TOKENS/);
    const doctor = glow("doctor", "--project", box.root);
    assert.equal(doctor.status, 0, doctor.out);
    assert.match(doctor.stdout, /claude-glow doctor/);

    // `install` from the installed copy: nothing to copy onto itself, the rest still works
    const settingsBefore = fs.readFileSync(box.path("settings.json"), "utf8");
    const again = glow("install");
    assert.equal(again.status, 0, again.out);
    assert.match(again.out, /running from the installed copy; not copying files onto themselves/);
    assert.equal(fs.readFileSync(box.path("settings.json"), "utf8"), settingsBefore);
    assert.ok(fs.existsSync(cli), "the copy is still there");
    assert.equal(readJson(box.path("claude-code-glow", "config.json")).previousStatusLine.command, "echo old-status");

    // and `uninstall` from it removes the folder it is running from, then restores the old status line
    const gone = glow("uninstall");
    assert.equal(gone.status, 0, gone.out);
    assert.ok(!fs.existsSync(box.path("claude-code-glow")), "the whole folder, bin/ included");
    assert.deepEqual(readJson(box.path("settings.json")), ORIGINAL);
  } finally { box.cleanup(); }
});

// ---- uninstall

function installed(box, extra = {}) {
  box.write("settings.json", { ...ORIGINAL, ...extra });
  const r = run(box, ["install", "--theme", "dracula"]);
  assert.equal(r.status, 0, r.out);
}

test("uninstall restores the previous status line and removes only what we added", () => {
  const box = sandbox();
  try {
    installed(box);
    // things that must survive: the user's own files, in and around our folders
    box.write("themes/my-own-theme.json", { name: "Mine", base: "dark", overrides: {} });
    box.write("themes/glow-handmade.json", { name: "Glow Handmade", base: "dark", overrides: { claude: "#ff0000" } });
    box.write("themes/glow-notjson.json", "{ nope");
    box.write("CLAUDE.md", "# my memory\n");
    box.write("skills/s/SKILL.md", "---\nname: s\ndescription: x\n---\n");
    box.write("projects/p/session.jsonl", "{}\n");
    box.write("claude-code-glow/themes/extra.json", "{}");
    const bak1 = backups(box).length;

    const r = run(box, ["uninstall"]);
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(readJson(box.path("settings.json")), ORIGINAL, "settings are exactly as before install");
    assert.equal(backups(box).length, bak1 + 1, "uninstall backs up first");
    assert.ok(!fs.existsSync(box.path("claude-code-glow")), "our folder is gone");
    assert.deepEqual(ls(box.path("themes")), ["glow-handmade.json", "glow-notjson.json", "my-own-theme.json"], "only Glow's own theme files are removed");
    assert.ok(fs.existsSync(box.path("CLAUDE.md")) && fs.existsSync(box.path("skills", "s", "SKILL.md")) && fs.existsSync(box.path("projects", "p", "session.jsonl")));
    assert.match(r.out, /kept 2 file\(s\) named glow\*\.json that are not Glow themes/);
    assert.match(r.out, /previous status line restored/);
    assert.deepEqual(ls(box.home), [], "HOME untouched");
  } finally { box.cleanup(); }
});

test("uninstall without a previous status line removes the statusLine key", () => {
  const box = sandbox();
  try {
    const { statusLine, ...without } = ORIGINAL;
    installed(box, {});
    box.write("settings.json", { ...without, statusLine: { type: "command", command: slFor(box), padding: 0 } });
    const cfgFile = box.path("claude-code-glow", "config.json");
    const config = readJson(cfgFile);
    delete config.previousStatusLine;
    fs.writeFileSync(cfgFile, JSON.stringify(config));
    const r = run(box, ["uninstall"]);
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(readJson(box.path("settings.json")), without);
    assert.match(r.out, /glow status line removed/);
  } finally { box.cleanup(); }
});

test("uninstall leaves a status line that is not ours alone", () => {
  const box = sandbox();
  try {
    installed(box);
    const mine = { ...ORIGINAL, statusLine: { type: "command", command: "node /somewhere/else.js", padding: 0 } };
    box.write("settings.json", mine);
    const before = fs.readFileSync(box.path("settings.json"), "utf8");
    const bak = backups(box).length;
    const r = run(box, ["uninstall"]);
    assert.equal(r.status, 0, r.out);
    assert.equal(fs.readFileSync(box.path("settings.json"), "utf8"), before, "bytes untouched");
    assert.equal(backups(box).length, bak, "no backup, since nothing in settings.json changed");
    assert.match(r.out, /different status line; left as it is/);
    assert.ok(!fs.existsSync(box.path("claude-code-glow")), "our files are still removed");
  } finally { box.cleanup(); }
});

test("uninstall refuses to act when settings.json is not valid JSON", () => {
  const box = sandbox();
  try {
    installed(box);
    box.write("settings.json", "{ broken");
    const r = run(box, ["uninstall"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not valid JSON/);
    assert.equal(fs.readFileSync(box.path("settings.json"), "utf8"), "{ broken");
    assert.ok(fs.existsSync(box.path("claude-code-glow", "statusline.mjs")), "nothing was deleted, so the old status line still works");
    assert.ok(fs.existsSync(box.path("themes", "glow.json")));
  } finally { box.cleanup(); }
});

test("uninstall twice, on nothing, and --dry-run", () => {
  const box = sandbox();
  try {
    const empty = run(box, ["uninstall"]);
    assert.equal(empty.status, 0);
    assert.match(empty.out, /not installed here/);
    assert.deepEqual(ls(box.cfg), []);

    installed(box);
    const snapshot = ls(box.cfg).join(",") + ls(box.path("themes")).join(",");
    const dry = run(box, ["uninstall", "--dry-run"]);
    assert.equal(dry.status, 0, dry.out);
    assert.match(dry.out, /dry run/);
    assert.equal(ls(box.cfg).join(",") + ls(box.path("themes")).join(","), snapshot, "dry run changes nothing");
    assert.ok(fs.existsSync(box.path("claude-code-glow")));

    assert.equal(run(box, ["uninstall"]).status, 0);
    const again = run(box, ["uninstall"]);
    assert.equal(again.status, 0);
    assert.match(again.out, /not installed here/);
    assert.deepEqual(readJson(box.path("settings.json")), ORIGINAL);
  } finally { box.cleanup(); }
});

test("install -> uninstall -> install round trip", () => {
  const box = sandbox();
  try {
    installed(box);
    assert.equal(run(box, ["uninstall"]).status, 0);
    assert.equal(run(box, ["install"]).status, 0);
    const settings = readJson(box.path("settings.json"));
    assert.equal(settings.statusLine.command, slFor(box));
    assert.deepEqual(readJson(box.path("claude-code-glow", "config.json")).previousStatusLine, OLD_STATUSLINE, "the restored status line is remembered again");
    assert.equal(run(box, ["uninstall"]).status, 0);
    assert.deepEqual(readJson(box.path("settings.json")), ORIGINAL);
  } finally { box.cleanup(); }
});
