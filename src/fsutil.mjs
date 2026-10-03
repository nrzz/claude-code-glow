// Small file helpers: tolerant reads, atomic writes, recursive copy, backup timestamps.
import fs from "node:fs";
import path from "node:path";

/** File contents as text (BOM stripped), or null when it cannot be read. */
export function readText(file) {
  try { return fs.readFileSync(file, "utf8").replace(/^﻿/, ""); } catch { return null; }
}

/** Parsed JSON, or null when the file is missing or not valid JSON. */
export function readJson(file) {
  const text = readText(file);
  if (text == null) return null;
  try { return JSON.parse(text); } catch { return null; }
}

/**
 * Write via a temp file and rename so a watcher (Claude Code watches its themes folder) never sees a
 * half-written file. The temp name does not end in .json, so it is ignored. Falls back to a direct
 * write where rename-over-existing is refused (Windows, file held open by another process).
 */
export function writeFileAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
  } catch {
    try { fs.rmSync(tmp, { force: true }); } catch { /* nothing to clean */ }
    fs.writeFileSync(file, data);
  }
}

/** Copy a folder recursively, overwriting files. Symlinks are skipped. */
export function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else if (entry.isFile()) fs.copyFileSync(src, dst);
  }
}

// Remove whatever is in `to` but no longer in `from`.
function prune(from, to) {
  for (const entry of fs.readdirSync(to, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (!fs.existsSync(src)) fs.rmSync(dst, { recursive: true, force: true });
    else if (entry.isDirectory()) prune(src, dst);
  }
}

/** Make `to` mirror `from`: copy everything over, then drop files left behind by an older version. */
export function syncDir(from, to) {
  copyDir(from, to);
  prune(from, to);
}

const two = (n) => String(n).padStart(2, "0");

/** 20261003-201530 (local time), used in backup file names. */
export function timestamp(d = new Date()) {
  return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
}

/** A path that does not exist yet: `base`, else `base-1`, `base-2` ... */
export function uniquePath(base) {
  if (!fs.existsSync(base)) return base;
  for (let i = 1; i < 1000; i++) if (!fs.existsSync(`${base}-${i}`)) return `${base}-${i}`;
  return `${base}-${Date.now()}`;
}
