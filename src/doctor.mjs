// claude-glow doctor: a STATIC token audit. It reads config files only (CLAUDE.md files, skills,
// .mcp.json, settings.json, and the mcpServers key of .claude.json). It never reads session
// transcripts and never prints anything from .claude.json except server names.
// Token counts are estimates: characters / 4.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cliColorMode, makeColors, padEndVisible, truncate, wrapText } from "./colors.mjs";
import { configDir, loadConfig, loadTheme } from "./config.mjs";
import { normalizeGlow } from "./defaults.mjs";
import { readJson, readText } from "./fsutil.mjs";
import { isOurStatusLine } from "./install.mjs";

// Budgets behind the ✔ / ⚠ verdicts.
export const BUDGET = {
  memoryOk: 2000, // CLAUDE.md tokens before it is worth trimming
  memoryTarget: 1500, // what trimming should aim for
  skillsOk: 1000, // tokens of skill names + descriptions
  mcpOk: 3, // servers before it is worth pruning
  mcpTokens: 2000, // rough cost of one server's tool definitions when they load eagerly
};

export const estimateTokens = (text) => Math.ceil(String(text).length / 4);
const fmt = (n) => Math.round(n).toLocaleString("en-US");

/** Minimal YAML frontmatter reader: handles plain, quoted, folded (>) and literal (|) scalars. */
export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text).replace(/^﻿/, ""));
  if (!m) return {};
  const lines = m[1].split(/\r?\n/);
  const out = {};
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    const [, key] = kv;
    let val = kv[2].trim();
    const block = /^[>|][+-]?$/.test(val);
    if (block) val = "";
    while (i + 1 < lines.length && (/^[ \t]+\S/.test(lines[i + 1]) || (block && lines[i + 1].trim() === ""))) {
      val += (val ? " " : "") + lines[++i].trim();
    }
    out[key] = val.trim().replace(/^(["'])([\s\S]*)\1$/, "$2");
  }
  return out;
}

/** Files that CLAUDE.md-style text pulls in with @path (relative, ~/ or absolute), skipping code blocks. */
export function findImports(text, baseDir, home = os.homedir()) {
  const plain = String(text).replace(/```[\s\S]*?```/g, " ").replace(/~~~[\s\S]*?~~~/g, " ").replace(/`[^`\n]*`/g, " ");
  const found = [];
  const re = /(^|[\s(\[])@([^\s)\]>"'`,;]+)/g;
  let m;
  while ((m = re.exec(plain))) {
    const ref = m[2].replace(/[.,:;!?]+$/, "");
    if (!ref || ref.length > 260) continue;
    const file = ref.startsWith("~/") ? path.join(home, ref.slice(2)) : path.resolve(baseDir, ref);
    try {
      const st = fs.statSync(file);
      if (st.isFile() && st.size <= 1024 * 1024) found.push({ ref, file: path.resolve(file) });
    } catch { /* not a file: probably an @mention, not an import */ }
  }
  return found;
}

function memoryFiles(cfgDir, project, home) {
  const defs = [
    ["user CLAUDE.md", path.join(cfgDir, "CLAUDE.md")],
    ["CLAUDE.md", path.join(project, "CLAUDE.md")],
    ["CLAUDE.local.md", path.join(project, "CLAUDE.local.md")],
    [".claude/CLAUDE.md", path.join(project, ".claude", "CLAUDE.md")],
  ];
  const files = [];
  const seen = new Set();
  for (const [label, file] of defs) {
    const text = readText(file);
    if (text == null) continue;
    seen.add(path.resolve(file));
    files.push({ label, file, tokens: estimateTokens(text), imported: false });
    for (const imp of findImports(text, path.dirname(file), home)) { // one level only
      if (seen.has(imp.file)) continue;
      seen.add(imp.file);
      const body = readText(imp.file);
      if (body != null) files.push({ label: `@${imp.ref}`, file: imp.file, tokens: estimateTokens(body), imported: true, from: label });
    }
  }
  return files;
}

function skillsIn(dir) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory() && !e.isSymbolicLink()) continue;
    const text = readText(path.join(dir, e.name, "SKILL.md"));
    if (text == null) continue;
    const fm = parseFrontmatter(text);
    const name = fm.name || e.name;
    const description = fm.description || "";
    out.push({ name, descChars: description.length, tokens: Math.ceil((name.length + description.length + 12) / 4) });
  }
  return out;
}

// Server NAMES only. For .claude.json this reads the mcpServers key and nothing else.
function mcpNames(project, cfgDir, home, env) {
  const names = new Set();
  const add = (servers) => {
    if (servers && typeof servers === "object" && !Array.isArray(servers)) for (const k of Object.keys(servers)) names.add(k);
  };
  const projectFile = readJson(path.join(project, ".mcp.json"));
  if (projectFile && typeof projectFile === "object") add(projectFile.mcpServers);
  const globals = [path.join(cfgDir, ".claude.json")];
  if (!env.CLAUDE_CONFIG_DIR) globals.push(path.join(home, ".claude.json"));
  for (const file of globals) {
    const g = readJson(file);
    if (g && typeof g === "object") add(g.mcpServers);
  }
  return [...names];
}

function settingsFacts(cfgDir, project, env) {
  const files = [path.join(cfgDir, "settings.json"), path.join(project, ".claude", "settings.json"), path.join(project, ".claude", "settings.local.json")];
  const facts = { effort: null, subagentModel: env.CLAUDE_CODE_SUBAGENT_MODEL || null, statusLine: null };
  for (const f of files) { // later files (project, local) override earlier ones
    const s = readJson(f);
    if (!s || typeof s !== "object" || Array.isArray(s)) continue;
    if (typeof s.effortLevel === "string") facts.effort = s.effortLevel;
    if (s.env && typeof s.env === "object" && s.env.CLAUDE_CODE_SUBAGENT_MODEL) facts.subagentModel = String(s.env.CLAUDE_CODE_SUBAGENT_MODEL);
    if (s.statusLine) facts.statusLine = s.statusLine;
  }
  return facts;
}

/**
 * Gather the facts and turn them into checks. Pure data in, pure data out; printing is separate.
 * Each check: { level: "ok"|"warn", title, summary, details[], fix?, saves (tokens or null), note? }
 */
export function audit({ project, cfg = configDir(), home = os.homedir(), env = process.env } = {}) {
  const proj = path.resolve(project || process.cwd());
  const memory = memoryFiles(cfg, proj, home);
  const skills = [...skillsIn(path.join(cfg, "skills")), ...skillsIn(path.join(proj, ".claude", "skills"))];
  const servers = mcpNames(proj, cfg, home, env);
  const facts = settingsFacts(cfg, proj, env);
  const checks = [];

  // CLAUDE.md memory
  const memTokens = memory.reduce((n, f) => n + f.tokens, 0);
  const memDetails = [...memory].sort((a, b) => b.tokens - a.tokens)
    .map((f) => `${fmt(f.tokens).padStart(7)}  ${f.label}${f.imported ? `  (imported by ${f.from})` : ""}`);
  if (!memory.length) {
    checks.push({ level: "ok", title: "CLAUDE.md memory", summary: "none found: nothing loaded from memory files", details: [], saves: 0 });
  } else if (memTokens <= BUDGET.memoryOk) {
    checks.push({ level: "ok", title: "CLAUDE.md memory", summary: `${fmt(memTokens)} tokens loaded every session (${memory.length} file${memory.length === 1 ? "" : "s"})`, details: memDetails, saves: 0 });
  } else {
    checks.push({
      level: "warn", title: "CLAUDE.md memory", summary: `${fmt(memTokens)} tokens loaded every session (${memory.length} file${memory.length === 1 ? "" : "s"})`, details: memDetails,
      fix: `Keep only what Claude cannot work out from the code. Move task-specific notes into skills or docs that are read on demand. Aim for under ${fmt(BUDGET.memoryTarget)}.`,
      saves: memTokens - BUDGET.memoryTarget,
    });
  }

  // Skills
  const skillTokens = skills.reduce((n, s) => n + s.tokens, 0);
  const descChars = skills.reduce((n, s) => n + s.descChars, 0);
  const skillSummary = `${skills.length} skill${skills.length === 1 ? "" : "s"}, descriptions ${fmt(descChars)} chars, about ${fmt(skillTokens)} tokens loaded every session`;
  if (!skills.length) {
    checks.push({ level: "ok", title: "Skills", summary: "none found", details: [], saves: 0 });
  } else if (skillTokens <= BUDGET.skillsOk) {
    checks.push({ level: "ok", title: "Skills", summary: skillSummary, details: [], saves: 0 });
  } else {
    checks.push({
      level: "warn", title: "Skills", summary: skillSummary, details: [],
      fix: "Every skill's name and description is sent each session. Delete or disable the ones you do not use, and cut descriptions to one sentence.",
      saves: skillTokens - BUDGET.skillsOk,
    });
  }

  // MCP servers
  const shown = servers.slice(0, 8).join(", ") + (servers.length > 8 ? ", ..." : "");
  if (!servers.length) {
    checks.push({ level: "ok", title: "MCP servers", summary: "none configured", details: [], saves: 0 });
  } else if (servers.length <= BUDGET.mcpOk) {
    checks.push({ level: "ok", title: "MCP servers", summary: `${servers.length} configured (${shown})`, details: [], saves: 0 });
  } else {
    checks.push({
      level: "warn", title: "MCP servers", summary: `${servers.length} configured (${shown})`, details: [],
      fix: `Each server's tool definitions can add about ${fmt(BUDGET.mcpTokens)} tokens when they load eagerly. Remove the ones you rarely use (claude mcp remove <name>), or keep them in project .mcp.json only where needed. Keep about ${BUDGET.mcpOk}.`,
      saves: (servers.length - BUDGET.mcpOk) * BUDGET.mcpTokens,
      note: "estimate: depends on the servers' tool counts",
    });
  }

  // Effort level
  if (facts.effort === "max") {
    checks.push({
      level: "warn", title: "Effort level", summary: 'effortLevel is "max"', details: [],
      fix: 'Set "effortLevel": "high" in settings.json (or pick it with /model). Max overthinks routine work and spends thinking tokens on every turn.',
      saves: null, savesNote: "thinking tokens on every turn, not counted in the total",
    });
  } else {
    checks.push({ level: "ok", title: "Effort level", summary: facts.effort ? `effortLevel is "${facts.effort}"` : "not forced to max", details: [], saves: 0 });
  }

  // Subagent model
  if (!facts.subagentModel) {
    checks.push({
      level: "warn", title: "Subagent model", summary: "CLAUDE_CODE_SUBAGENT_MODEL is not set", details: [],
      fix: 'Run subagents on a cheaper model: add "env": {"CLAUDE_CODE_SUBAGENT_MODEL":"sonnet"} to settings.json (or "haiku").',
      saves: null, savesNote: "cost per subagent token, not counted in the total",
    });
  } else {
    checks.push({ level: "ok", title: "Subagent model", summary: `CLAUDE_CODE_SUBAGENT_MODEL=${facts.subagentModel}`, details: [], saves: 0 });
  }

  // Status line
  if (!facts.statusLine) {
    checks.push({
      level: "warn", title: "Status line", summary: "none configured", details: [],
      fix: "Run `claude-glow install` for a status line with a context meter, cache countdown and plan limits, so you can act before it costs you.",
      saves: null, savesNote: "nothing by itself: it shows what costs tokens while you can still act",
    });
  } else {
    checks.push({ level: "ok", title: "Status line", summary: isOurStatusLine(facts.statusLine) ? "claude-glow status line active" : "custom status line configured", details: [], saves: 0 });
  }

  const total = checks.reduce((n, c) => n + (typeof c.saves === "number" && c.saves > 0 ? c.saves : 0), 0);
  return { project: proj, cfg, checks, total, memTokens, skillTokens, serverCount: servers.length };
}

/** Print the audit as a short colored report. Returns the audit data. */
export function runDoctor(opts = {}, out = (s = "") => console.log(s)) {
  const result = audit(opts);
  const C = makeColors(cliColorMode());
  let glow;
  try { glow = normalizeGlow((loadTheme(loadConfig().theme) || {}).glow); } catch { glow = normalizeGlow(null); }
  const ok = (s) => C.paint(s, glow.ok);
  const warn = (s) => C.paint(s, glow.warn);
  const dim = (s) => C.paint(s, glow.dim);
  const head = (s) => C.paint(s, glow.accent) ;
  const cols = Math.max(60, Math.min(process.stdout.columns || 100, 110));

  out(head("claude-glow doctor") + dim("  static token audit: reads config files only, never your transcripts"));
  out(dim(`project  ${result.project}`));
  out(dim(`config   ${result.cfg}`));
  out("");
  for (const c of result.checks) {
    const mark = c.level === "ok" ? ok("✔") : warn("⚠");
    out(` ${mark} ${padEndVisible(c.title, 18)} ${truncate(c.summary, cols - 24)}`);
    if (c.level === "warn" || c.details.length) for (const d of c.details) out(dim(`      ${d}`));
    if (c.level === "warn") {
      wrapText(c.fix, cols - 14).forEach((line, i) => out(`      ${dim(i === 0 ? "fix  " : "     ")} ${line}`));
      out(`      ${dim("saves")} ${typeof c.saves === "number" ? warn(`about ${fmt(c.saves)} tokens per session`) + (c.note ? dim(` (${c.note})`) : "") : dim(c.savesNote || "not counted in the total")}`);
    }
  }
  out("");
  if (result.total > 0) out(` ${warn("Total")} about ${warn(fmt(result.total))} tokens per session if you apply the fixes above ${dim("(characters / 4)")}`);
  else out(` ${ok("Nothing measurable to trim.")} ${dim("Always-loaded context looks lean (characters / 4).")}`);
  return result;
}
