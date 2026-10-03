// Shared test helpers. Every test that touches install / settings / config runs against a throwaway
// folder passed through CLAUDE_CONFIG_DIR (and a throwaway HOME), never the real ~/.claude.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CLI = path.join(ROOT, "bin", "claude-glow.mjs");
export const STATUSLINE = path.join(ROOT, "statusline.mjs");
export const SAMPLE_JSON = path.join(ROOT, "test", "fixtures", "sample.json");

/** A throwaway world: a config folder, a home folder, and an env that points at them. */
export function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "glow-test-"));
  const cfg = path.join(root, "cfg");
  const home = path.join(root, "home");
  fs.mkdirSync(cfg);
  fs.mkdirSync(home);
  const env = { ...process.env, CLAUDE_CONFIG_DIR: cfg, HOME: home, USERPROFILE: home, NO_COLOR: "1" };
  for (const k of ["GLOW_COLOR", "FORCE_COLOR", "COLUMNS", "TERM_PROGRAM", "CLAUDE_CODE_SUBAGENT_MODEL"]) delete env[k];
  return {
    root, cfg, home, env,
    path: (...p) => path.join(cfg, ...p),
    write(rel, content) {
      const file = path.join(cfg, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content, null, 2) + "\n");
      return file;
    },
    cleanup() { fs.rmSync(root, { recursive: true, force: true }); },
  };
}

// Overrides with value `undefined` remove the variable from the child's environment.
function childEnv(box, extra = {}) {
  const env = { ...box.env, ...extra };
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  return env;
}

/** Run a claude-glow entry point (the repo's bin, or an installed copy's) as a child process in the sandbox. */
export function runScript(box, script, args, { input, env, cwd } = {}) {
  const r = spawnSync(process.execPath, [script, ...args], {
    env: childEnv(box, env), input, cwd, encoding: "utf8", timeout: 60000, windowsHide: true,
  });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "", out: (r.stdout || "") + (r.stderr || "") };
}

/** Run `claude-glow <args>` from the repo as a child process inside the sandbox. */
export const run = (box, args, opts) => runScript(box, CLI, args, opts);

/** Run a status-line script (the repo's or an installed copy) with JSON on stdin. */
export function runStatusline(box, script, json, { env } = {}) {
  const r = spawnSync(process.execPath, [script], {
    env: childEnv(box, env), input: typeof json === "string" ? json : JSON.stringify(json), encoding: "utf8", timeout: 30000, windowsHide: true,
  });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

export const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

/** File text with Windows line endings folded to LF, so exact comparisons survive a CRLF checkout. */
export const readLf = (file) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");

/** Names of the entries in a folder, or [] when it does not exist. */
export function ls(dir) {
  try { return fs.readdirSync(dir).sort(); } catch { return []; }
}

/** Independent display-width measure for assertions: strips ANSI, counts emoji as two cells. */
export function cells(s) {
  const plain = String(s).replace(/\x1b\[[0-9;:?]*[ -/]*[@-~]/g, "").replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "");
  let n = 0;
  for (const ch of plain) n += /[\u{1F300}-\u{1FAFF}⚡]/u.test(ch) ? 2 : 1;
  return n;
}
