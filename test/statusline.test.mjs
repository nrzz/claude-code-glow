import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { stripAnsi } from "../src/colors.mjs";
import { sampleInput } from "../src/sample.mjs";
import { STATUSLINE, SAMPLE_JSON, cells, readJson, runStatusline, sandbox } from "./helpers.mjs";

const SAMPLE = readJson(SAMPLE_JSON);
const ESC = "\x1b";

test("statusline.mjs: sample on stdin -> two lines, exit 0, nothing on stderr", () => {
  const box = sandbox();
  try {
    const r = runStatusline(box, STATUSLINE, SAMPLE);
    assert.equal(r.status, 0);
    assert.equal(r.stderr, "");
    assert.ok(r.stdout.endsWith("\n"));
    const lines = r.stdout.trimEnd().split("\n");
    assert.equal(lines.length, 2);
    assert.match(lines[0], /^◆ Sonnet 5\.5 · high \| ⌂ nrzz\/claude-code-glow \|/);
    assert.match(lines[0], /34% · 340K\/1M \| \$1\.84 \| ◷ 42m \| ◔ 5h 23% · 7d 41% \| ↻ cache 91%/);
    assert.ok(lines[1].startsWith("💡 "));
  } finally { box.cleanup(); }
});

test("statusline.mjs: colors by default, and the env switches work", () => {
  const box = sandbox();
  try {
    const out = (env) => runStatusline(box, STATUSLINE, SAMPLE, { env }).stdout;
    const truecolor = out({ NO_COLOR: undefined });
    assert.match(truecolor, /\x1b\[38;2;\d+;\d+;\d+m/, "24-bit by default");
    assert.ok(!stripAnsi(truecolor).includes(ESC));

    assert.ok(!out({}).includes(ESC), "NO_COLOR=1 (sandbox default) -> no escapes at all");
    assert.ok(!out({ NO_COLOR: undefined, GLOW_COLOR: "0" }).includes(ESC), "GLOW_COLOR=0");

    for (const env of [{ NO_COLOR: undefined, GLOW_COLOR: "256" }, { NO_COLOR: undefined, TERM_PROGRAM: "Apple_Terminal" }]) {
      const o = out(env);
      assert.match(o, /\x1b\[38;5;\d+m/, JSON.stringify(env));
      assert.doesNotMatch(o, /\x1b\[(38|48);2;/, `no 24-bit colors: ${JSON.stringify(env)}`);
    }
  } finally { box.cleanup(); }
});

test("statusline.mjs: garbage, empty, huge and closed stdin never fail", () => {
  const box = sandbox();
  try {
    for (const stdin of ["", "   \n", "not json", "{", "null", "42", "[]", "\"x\"", "{\"model\":", "﻿{\"model\":{\"display_name\":\"BOM\"}}"]) {
      const r = runStatusline(box, STATUSLINE, stdin);
      assert.equal(r.status, 0, JSON.stringify(stdin));
      assert.equal(r.stderr, "", JSON.stringify(stdin));
      assert.ok(r.stdout.trim().length > 0, `prints something for ${JSON.stringify(stdin)}`);
      assert.ok(r.stdout.trimEnd().split("\n").length <= 2);
    }
    assert.match(runStatusline(box, STATUSLINE, "﻿{\"model\":{\"display_name\":\"BOM\"}}").stdout, /BOM/, "a UTF-8 BOM is tolerated");
    const big = runStatusline(box, STATUSLINE, JSON.stringify({ ...SAMPLE, junk: "x".repeat(3_000_000) }));
    assert.equal(big.status, 0);
    assert.match(big.stdout, /Sonnet 5\.5/, "input bigger than a pipe buffer is read completely");
    const closed = spawnSync(process.execPath, [STATUSLINE], { env: box.env, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: 20000 });
    assert.equal(closed.status, 0);
    assert.ok(closed.stdout.trim().length > 0);
  } finally { box.cleanup(); }
});

test("statusline.mjs: COLUMNS shortens the output", () => {
  const box = sandbox();
  try {
    for (const columns of [30, 60, 90]) {
      const r = runStatusline(box, STATUSLINE, SAMPLE, { env: { COLUMNS: String(columns) } });
      for (const line of r.stdout.trimEnd().split("\n")) assert.ok(cells(line) <= columns, `${columns}: ${cells(line)}`);
    }
    const wide = runStatusline(box, STATUSLINE, SAMPLE, { env: { COLUMNS: "400" } }).stdout;
    assert.match(wide, /cache 91%/, "a wide terminal keeps every segment");
    const bogus = runStatusline(box, STATUSLINE, SAMPLE, { env: { COLUMNS: "abc" } });
    assert.equal(bogus.status, 0);
  } finally { box.cleanup(); }
});

test("statusline.mjs: reads <configDir>/claude-code-glow/config.json (icons, tips, segments, theme)", () => {
  const box = sandbox();
  try {
    box.write("claude-code-glow/config.json", { theme: "dracula", icons: "ascii", tips: false, segments: ["model", "cost"] });
    const r = runStatusline(box, STATUSLINE, SAMPLE, { env: { NO_COLOR: undefined } });
    assert.equal(r.stdout.trimEnd().split("\n").length, 1, "tips: false -> one line");
    assert.equal(stripAnsi(r.stdout).trim(), "Sonnet 5.5 high | $1.84");
    const dracula = readJson(path.join(path.dirname(STATUSLINE), "themes", "glow-dracula.json"));
    const [rr, gg, bb] = [1, 3, 5].map((i) => parseInt(dracula.glow.accent.slice(i, i + 2), 16));
    assert.ok(r.stdout.includes(`${ESC}[38;2;${rr};${gg};${bb}m`), "the model name uses dracula's accent");
  } finally { box.cleanup(); }
});

test("statusline.mjs: an installed theme folder wins over the repo's; a missing or broken theme falls back", () => {
  const box = sandbox();
  try {
    const dracula = readJson(path.join(path.dirname(STATUSLINE), "themes", "glow-dracula.json"));
    const custom = { ...dracula, glow: { ...dracula.glow, accent: "#123456", model: { bg: "#123456", fg: "#fedcba" } } };
    box.write("claude-code-glow/config.json", { theme: "dracula", icons: "unicode", tips: false });
    box.write("claude-code-glow/themes/glow-dracula.json", custom);
    const env = { NO_COLOR: undefined };
    let out = runStatusline(box, STATUSLINE, SAMPLE, { env }).stdout;
    assert.ok(out.includes(`${ESC}[48;2;18;52;86m`), "uses the installed copy (#123456)");

    box.write("claude-code-glow/config.json", { theme: "no-such-theme", icons: "unicode", tips: false });
    let r = runStatusline(box, STATUSLINE, SAMPLE, { env });
    assert.equal(r.status, 0);
    assert.ok(r.stdout.includes(`${ESC}[48;2;215;119;87m`), "unknown theme: the built-in classic accent #d77757");

    box.write("claude-code-glow/config.json", { theme: "dracula", icons: "unicode", tips: false });
    box.write("claude-code-glow/themes/glow-dracula.json", "{ this is not json");
    r = runStatusline(box, STATUSLINE, SAMPLE, { env });
    assert.equal(r.status, 0);
    assert.ok(r.stdout.includes(`${ESC}[48;2;189;147;249m`), "a broken installed theme falls through to the repo's copy (#bd93f9)");

    box.write("claude-code-glow/config.json", { theme: "../../etc/passwd", icons: 7, segments: "model", tips: "no" });
    r = runStatusline(box, STATUSLINE, SAMPLE, { env });
    assert.equal(r.status, 0);
    assert.equal(r.stderr, "");
    box.write("claude-code-glow/config.json", "{ broken");
    assert.equal(runStatusline(box, STATUSLINE, SAMPLE, { env }).status, 0, "a broken config.json means defaults");
  } finally { box.cleanup(); }
});

test("statusline.mjs: shows the git branch from .git/HEAD in the reported folder", () => {
  const box = sandbox();
  try {
    const repo = path.join(box.root, "repo");
    fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".git", "HEAD"), "ref: refs/heads/glow-branch\n");
    fs.mkdirSync(path.join(repo, "pkg"));
    const input = { ...SAMPLE, cwd: path.join(repo, "pkg"), workspace: { current_dir: path.join(repo, "pkg"), repo: null } };
    const r = runStatusline(box, STATUSLINE, input);
    assert.match(r.stdout, /⎇ glow-branch/);
    assert.match(r.stdout, /⌂ pkg/);
  } finally { box.cleanup(); }
});

test("statusline.mjs starts and renders quickly", () => {
  const box = sandbox();
  try {
    runStatusline(box, STATUSLINE, SAMPLE); // warm the disk cache
    const runs = 5;
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < runs; i++) runStatusline(box, STATUSLINE, SAMPLE);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6 / runs;
    assert.ok(ms < 1500, `${ms.toFixed(0)} ms per run (mostly node start-up)`);
  } finally { box.cleanup(); }
});

test("the sample input module and the static fixture agree on the shape", () => {
  const live = sampleInput(0);
  assert.deepEqual(Object.keys(SAMPLE).sort(), Object.keys(live).sort());
});
