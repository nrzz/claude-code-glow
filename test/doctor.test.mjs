import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { BUDGET, audit, estimateTokens, findImports, parseFrontmatter } from "../src/doctor.mjs";
import { ROOT, ls, run, sandbox } from "./helpers.mjs";

const pad = (text, chars) => text + "x".repeat(chars - text.length);
const skill = (name, description) => `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\nbody that is never loaded up front\n`;

// A project and a config folder with known sizes, so every number in the report can be checked.
function fixture(box, { lean = false } = {}) {
  const proj = path.join(box.root, "proj");
  const w = (rel, content) => { const f = path.join(proj, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, typeof content === "string" ? content : JSON.stringify(content)); };
  if (lean) {
    w("CLAUDE.md", pad("# Lean\n", 400)); // 100 tokens
    box.write(".claude.json", { mcpServers: { only: { command: "x" } } });
    box.write("settings.json", { effortLevel: "high", env: { CLAUDE_CODE_SUBAGENT_MODEL: "sonnet" }, statusLine: { type: "command", command: "node \"/x/claude-code-glow/statusline.mjs\"" } });
    return proj;
  }
  // CLAUDE.md: exactly 4000 chars = 1000 tokens. It imports docs/guide.md, but not the @ignored.md in a code block, nor an e-mail.
  const claudeMd = pad("# Project\nSee @docs/guide.md for the guide.\nContact me@example.com about it.\n```\n@ignored.md\n```\nInline `@ignored.md` too.\n", 4000);
  w("CLAUDE.md", claudeMd);
  w("docs/guide.md", "g".repeat(2000)); // 500 tokens, imported
  w("ignored.md", "i".repeat(8000)); // would be 2000 tokens, must not be counted
  w("CLAUDE.local.md", "l".repeat(400)); // 100 tokens
  w(".claude/CLAUDE.md", "d".repeat(800)); // 200 tokens
  w(".claude/skills/alpha/SKILL.md", skill("alpha", "Does alpha things."));
  w(".claude/skills/beta/SKILL.md", `---\nname: beta\ndescription: >\n  A folded description\n  that spans two lines.\n---\nbody\n`);
  w(".mcp.json", { mcpServers: { filesystem: {}, github: {} } });
  w(".claude/settings.json", { effortLevel: "max" });
  box.write("CLAUDE.md", "u".repeat(1200)); // user level: 300 tokens
  box.write("skills/gamma/SKILL.md", skill("gamma", "G".repeat(5000))); // a long description
  box.write("settings.json", { model: "opus" }); // no statusLine
  box.write(".claude.json", {
    mcpServers: { sentry: {}, linear: {} },
    oauthAccount: { emailAddress: "secret@example.com" },
    projects: { [proj]: { mcpServers: { "local-only": {} }, history: ["a private prompt SECRETPROMPT"] } },
  });
  // A transcript folder that must never be read.
  box.write("projects/-proj/session.jsonl", JSON.stringify({ message: { content: "SENTINEL_TRANSCRIPT_TEXT" } }) + "\n");
  return proj;
}

test("estimateTokens is characters / 4, rounded up", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(estimateTokens("abcde"), 2);
  assert.equal(estimateTokens("x".repeat(4000)), 1000);
});

test("parseFrontmatter: plain, quoted, folded, literal, missing", () => {
  assert.deepEqual(parseFrontmatter("---\nname: a\ndescription: Plain text here\n---\nbody"), { name: "a", description: "Plain text here" });
  assert.equal(parseFrontmatter('---\ndescription: "Quoted: with colon"\n---\n').description, "Quoted: with colon");
  assert.equal(parseFrontmatter("---\ndescription: 'single'\n---\n").description, "single");
  assert.equal(parseFrontmatter("---\ndescription: >\n  folded line one\n  folded line two\nname: z\n---\n").description, "folded line one folded line two");
  assert.equal(parseFrontmatter("---\ndescription: |-\n  literal one\n  literal two\n---\n").description, "literal one literal two");
  assert.equal(parseFrontmatter("---\ndescription: starts here\n  and continues\n---\n").description, "starts here and continues");
  assert.deepEqual(parseFrontmatter("# no frontmatter"), {});
  assert.deepEqual(parseFrontmatter("﻿---\r\nname: crlf\r\n---\r\n"), { name: "crlf" });
  assert.deepEqual(parseFrontmatter(""), {});
});

test("findImports: relative and ~/ paths that exist; not code blocks, e-mails or missing files", () => {
  const box = sandbox();
  try {
    const dir = path.join(box.root, "docs");
    fs.mkdirSync(path.join(dir, "sub"), { recursive: true });
    fs.writeFileSync(path.join(dir, "a.md"), "a");
    fs.writeFileSync(path.join(dir, "sub", "b.md"), "b");
    fs.writeFileSync(path.join(box.home, "global.md"), "g");
    const text = [
      "Read @a.md and (@sub/b.md), also @~/global.md.",
      "Email me@example.com, handle @someone, missing @nope.md, folder @sub",
      "```", "@a.md in a fence", "```", "and `@sub/b.md` inline",
    ].join("\n");
    const found = findImports(text, dir, box.home).map((f) => f.ref);
    assert.deepEqual(found, ["a.md", "sub/b.md", "~/global.md"]);
    assert.deepEqual(findImports("no imports here", dir, box.home), []);
  } finally { box.cleanup(); }
});

test("audit: counts CLAUDE.md files and their imports, skills, MCP servers and settings", () => {
  const box = sandbox();
  try {
    const proj = fixture(box);
    const r = audit({ project: proj, cfg: box.cfg, home: box.home, env: { CLAUDE_CONFIG_DIR: box.cfg } });
    const byTitle = Object.fromEntries(r.checks.map((c) => [c.title, c]));

    // memory: 300 (user) + 1000 (CLAUDE.md) + 500 (imported guide) + 100 (local) + 200 (.claude/CLAUDE.md)
    assert.equal(r.memTokens, 2100);
    assert.equal(byTitle["CLAUDE.md memory"].level, "warn");
    assert.equal(byTitle["CLAUDE.md memory"].saves, 2100 - BUDGET.memoryTarget);
    assert.match(byTitle["CLAUDE.md memory"].summary, /2,100 tokens loaded every session \(5 files\)/);
    const detail = byTitle["CLAUDE.md memory"].details.join("\n");
    assert.match(detail, /1,000  CLAUDE\.md/);
    assert.match(detail, /500  @docs\/guide\.md  \(imported by CLAUDE\.md\)/);
    assert.match(detail, /300  user CLAUDE\.md/);
    assert.match(detail, /100  CLAUDE\.local\.md/);
    assert.match(detail, /200  \.claude\/CLAUDE\.md/);
    assert.ok(!detail.includes("ignored.md"), "imports inside code are not counted");

    // skills: 3 (alpha, beta, gamma with a 3000 char description)
    assert.match(byTitle.Skills.summary, /^3 skills, descriptions \d[\d,]* chars/);
    assert.equal(byTitle.Skills.level, "warn");
    assert.ok(r.skillTokens > BUDGET.skillsOk);
    assert.equal(byTitle.Skills.saves, r.skillTokens - BUDGET.skillsOk);

    // MCP: .mcp.json (2) + top-level mcpServers of .claude.json (2); per-project local servers are not read
    assert.equal(r.serverCount, 4);
    assert.match(byTitle["MCP servers"].summary, /4 configured \(filesystem, github, sentry, linear\)/);
    assert.equal(byTitle["MCP servers"].saves, (4 - BUDGET.mcpOk) * BUDGET.mcpTokens);
    assert.ok(!byTitle["MCP servers"].summary.includes("local-only"));

    // settings
    assert.equal(byTitle["Effort level"].level, "warn");
    assert.equal(byTitle["Subagent model"].level, "warn");
    assert.equal(byTitle["Status line"].level, "warn");
    assert.equal(byTitle["Effort level"].saves, null, "not measurable statically, so not counted");

    assert.equal(r.total, byTitle["CLAUDE.md memory"].saves + byTitle.Skills.saves + byTitle["MCP servers"].saves);
  } finally { box.cleanup(); }
});

test("doctor: the report, end to end", () => {
  const box = sandbox();
  try {
    const proj = fixture(box);
    const r = run(box, ["doctor", "--project", proj]);
    assert.equal(r.status, 0, r.out);
    const out = r.stdout;
    assert.match(out, /claude-glow doctor/);
    assert.ok(out.includes(proj), "names the project");
    assert.ok(out.includes(box.cfg), "names the config folder");
    assert.match(out, /⚠ CLAUDE\.md memory\s+2,100 tokens loaded every session \(5 files\)/);
    assert.match(out, /1,000 {2}CLAUDE\.md/, "the CLAUDE.md token estimate is reported");
    assert.match(out, /saves about 600 tokens per session/);
    assert.match(out, /⚠ Skills\s+3 skills/);
    assert.match(out, /⚠ MCP servers\s+4 configured/);
    assert.match(out, /saves about 2,000 tokens per session/);
    assert.match(out, /⚠ Effort level\s+effortLevel is "max"/);
    assert.match(out, /"effortLevel": "high"/, "a concrete fix");
    assert.match(out, /⚠ Subagent model\s+CLAUDE_CODE_SUBAGENT_MODEL is not set/);
    assert.match(out, /"CLAUDE_CODE_SUBAGENT_MODEL":"sonnet"/);
    assert.match(out, /saves cost per subagent token, not counted in the total/);
    assert.match(out, /saves thinking tokens on every turn, not counted in the total/);
    assert.match(out, /⚠ Status line\s+none configured/);
    assert.match(out, /claude-glow install/);
    assert.match(out, /Total about [\d,]+ tokens per session/);
    // privacy: only server names come out of .claude.json; transcripts are never read
    for (const secret of ["secret@example.com", "SECRETPROMPT", "SENTINEL_TRANSCRIPT_TEXT", "oauthAccount", "local-only"]) assert.ok(!out.includes(secret), `${secret} must not appear`);
    assert.ok(!out.includes("\x1b"), "plain when piped");
  } finally { box.cleanup(); }
});

test("doctor: a lean setup gets all check marks and nothing to trim", () => {
  const box = sandbox();
  try {
    const proj = fixture(box, { lean: true });
    const r = run(box, ["doctor", "--project", proj]);
    assert.equal(r.status, 0, r.out);
    assert.doesNotMatch(r.stdout, /⚠/);
    assert.equal((r.stdout.match(/✔/g) || []).length, 6);
    assert.match(r.stdout, /✔ CLAUDE\.md memory\s+100 tokens loaded every session \(1 file\)/);
    assert.match(r.stdout, /✔ Status line\s+claude-glow status line active/);
    assert.match(r.stdout, /Nothing measurable to trim/);
  } finally { box.cleanup(); }
});

test("doctor: CLAUDE_CODE_SUBAGENT_MODEL from the environment counts; a custom status line is fine", () => {
  const box = sandbox();
  try {
    const proj = fixture(box, { lean: true });
    box.write("settings.json", { statusLine: { type: "command", command: "echo custom" } });
    const r = run(box, ["doctor", "--project", proj], { env: { CLAUDE_CODE_SUBAGENT_MODEL: "haiku" } });
    assert.match(r.stdout, /✔ Subagent model\s+CLAUDE_CODE_SUBAGENT_MODEL=haiku/);
    assert.match(r.stdout, /✔ Status line\s+custom status line configured/);
    assert.match(r.stdout, /✔ Effort level\s+not forced to max/);
  } finally { box.cleanup(); }
});

test("doctor: settings precedence (project overrides user) and the .claude.json location", () => {
  const box = sandbox();
  try {
    const proj = path.join(box.root, "p2");
    fs.mkdirSync(path.join(proj, ".claude"), { recursive: true });
    box.write("settings.json", { effortLevel: "max" });
    fs.writeFileSync(path.join(proj, ".claude", "settings.local.json"), JSON.stringify({ effortLevel: "high" }));
    assert.match(run(box, ["doctor", "--project", proj]).stdout, /✔ Effort level\s+effortLevel is "high"/, "local settings win");

    // with CLAUDE_CONFIG_DIR set, ~/.claude.json is not Claude Code's file and is ignored
    fs.writeFileSync(path.join(box.home, ".claude.json"), JSON.stringify({ mcpServers: { a: {}, b: {}, c: {}, d: {}, e: {} } }));
    assert.match(run(box, ["doctor", "--project", proj]).stdout, /✔ MCP servers\s+none configured/);
    // without it, ~/.claude.json is the global config
    const home = run(box, ["doctor", "--project", proj], { env: { CLAUDE_CONFIG_DIR: undefined } });
    assert.match(home.stdout, /⚠ MCP servers\s+5 configured \(a, b, c, d, e\)/);
  } finally { box.cleanup(); }
});

test("doctor: defaults to the working directory; missing project is an error; never writes", () => {
  const box = sandbox();
  try {
    const proj = fixture(box);
    const before = JSON.stringify([ls(box.cfg), ls(proj), ls(box.home)]);
    const r = run(box, ["doctor"], { cwd: proj });
    assert.equal(r.status, 0, r.out);
    assert.match(r.stdout, /CLAUDE\.md memory\s+2,100 tokens/);
    const missing = run(box, ["doctor", "--project", path.join(box.root, "nope")]);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /Project folder not found/);
    assert.equal(JSON.stringify([ls(box.cfg), ls(proj), ls(box.home)]), before, "read-only");
  } finally { box.cleanup(); }
});

test("doctor never opens anything under projects/ (session transcripts)", () => {
  const files = [];
  const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith(".mjs")) files.push(p); } };
  walk(path.join(ROOT, "src"));
  walk(path.join(ROOT, "bin"));
  files.push(path.join(ROOT, "statusline.mjs"));
  for (const f of files) {
    const code = fs.readFileSync(f, "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l)).join("\n");
    assert.doesNotMatch(code, /["'`]projects["'`]/, `${path.relative(ROOT, f)} must not reference the transcripts folder`);
  }
});

test("a missing or empty setup is not an error", () => {
  const box = sandbox();
  try {
    const proj = path.join(box.root, "empty");
    fs.mkdirSync(proj);
    const r = run(box, ["doctor", "--project", proj]);
    assert.equal(r.status, 0, r.out);
    assert.match(r.stdout, /✔ CLAUDE\.md memory\s+none found/);
    assert.match(r.stdout, /✔ Skills\s+none found/);
    assert.match(r.stdout, /✔ MCP servers\s+none configured/);
  } finally { box.cleanup(); }
});
