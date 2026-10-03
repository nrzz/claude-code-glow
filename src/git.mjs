// Git info for the status line without shelling out on the hot path:
//   branch   read straight from .git/HEAD (walks up from the folder; follows worktree ".git" files)
//   dirty    optional `git status --porcelain` with a 300 ms timeout, cached for 5 s in a temp file
// Never throws; returns null / undefined parts when something is unavailable.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

/** Find the HEAD file of the repository containing `start`: { head, root } or null. */
export function findHead(start) {
  let dir = path.resolve(String(start || "."));
  for (let depth = 0; depth < 64; depth++) {
    const dot = path.join(dir, ".git");
    try {
      const st = fs.statSync(dot);
      if (st.isDirectory()) return { head: path.join(dot, "HEAD"), root: dir };
      if (st.isFile()) {
        // Worktrees and submodules: ".git" is a file reading "gitdir: <path>".
        const m = /^gitdir:\s*(.+)\s*$/m.exec(fs.readFileSync(dot, "utf8"));
        if (m) return { head: path.join(path.resolve(dir, m[1].trim()), "HEAD"), root: dir };
      }
    } catch { /* no .git here, keep walking up */ }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/** Parse a HEAD file: { branch } for a branch, { branch: "a1b2c3d", detached: true } for a bare commit. */
export function readHead(headFile) {
  try {
    const text = fs.readFileSync(headFile, "utf8").trim();
    const ref = /^ref:\s*(.+)$/.exec(text);
    if (ref) return { branch: ref[1].trim().replace(/^refs\/heads\//, "") };
    if (/^[0-9a-f]{7,64}$/i.test(text)) return { branch: text.slice(0, 7), detached: true };
  } catch { /* unreadable HEAD */ }
  return null;
}

// Tiny non-cryptographic hash to key the cache file by folder.
function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

/** `git status --porcelain`: true (changes), false (clean) or null (git missing, slow or failed). */
export function runStatus(dir, timeoutMs = 300) {
  try {
    const r = spawnSync("git", ["--no-optional-locks", "status", "--porcelain"], {
      cwd: dir, encoding: "utf8", timeout: timeoutMs, windowsHide: true, maxBuffer: 1 << 20,
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (r.error || r.status !== 0) return null;
    return r.stdout.length > 0;
  } catch {
    return null;
  }
}

/**
 * Dirty flag with a 5 second cache keyed by folder. Slow or failed runs are cached too (as null),
 * so a huge repo costs one 300 ms attempt per window, not one per refresh.
 */
export function isDirty(dir, { now = Date.now(), ttl = 5000, run = runStatus, tmp = os.tmpdir() } = {}) {
  const file = path.join(tmp, `claude-glow-git-${hash(path.resolve(dir))}.json`);
  try {
    const c = JSON.parse(fs.readFileSync(file, "utf8"));
    if (typeof c.t === "number" && now - c.t >= 0 && now - c.t < ttl) return typeof c.dirty === "boolean" ? c.dirty : null;
  } catch { /* no usable cache */ }
  const dirty = run(dir);
  try { fs.writeFileSync(file, JSON.stringify({ t: now, dirty })); } catch { /* cache is best effort */ }
  return dirty;
}

/** { branch, detached?, dirty } for the repository containing `dir`, or null outside a repository. */
export function gitInfo(dir, { dirty = true, ...rest } = {}) {
  try {
    const found = findHead(dir);
    if (!found) return null;
    const head = readHead(found.head);
    if (!head) return null;
    return { ...head, dirty: dirty ? isDirty(dir, rest) : null };
  } catch {
    return null;
  }
}
