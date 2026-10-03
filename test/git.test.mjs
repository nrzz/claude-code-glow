import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findHead, gitInfo, isDirty, readHead, runStatus } from "../src/git.mjs";

// Repositories are faked with plain files: no `git init`, no git binary needed.
function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "glow-git-"));
  return { dir, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
function fakeRepo(root, head) {
  fs.mkdirSync(path.join(root, ".git"), { recursive: true });
  fs.writeFileSync(path.join(root, ".git", "HEAD"), head);
}
const SHA = "0123456789abcdef0123456789abcdef01234567";

test("readHead: branch, branch with slashes, detached, CRLF, garbage", () => {
  const t = tmp();
  try {
    const head = path.join(t.dir, "HEAD");
    const read = (text) => { fs.writeFileSync(head, text); return readHead(head); };
    assert.deepEqual(read("ref: refs/heads/main\n"), { branch: "main" });
    assert.deepEqual(read("ref: refs/heads/main\r\n"), { branch: "main" });
    assert.deepEqual(read("ref: refs/heads/feature/glow-themes\n"), { branch: "feature/glow-themes" });
    assert.deepEqual(read(`${SHA}\n`), { branch: "0123456", detached: true });
    assert.deepEqual(read("ref: refs/remotes/origin/x"), { branch: "refs/remotes/origin/x" });
    assert.equal(read(""), null);
    assert.equal(read("garbage"), null);
    assert.equal(readHead(path.join(t.dir, "missing")), null);
  } finally { t.done(); }
});

test("findHead walks up from a subfolder", () => {
  const t = tmp();
  try {
    fakeRepo(t.dir, "ref: refs/heads/main\n");
    const deep = path.join(t.dir, "a", "b", "c");
    fs.mkdirSync(deep, { recursive: true });
    const found = findHead(deep);
    assert.equal(found.head, path.join(t.dir, ".git", "HEAD"));
    assert.equal(found.root, t.dir);
    assert.deepEqual(gitInfo(deep, { dirty: false }), { branch: "main", dirty: null });
  } finally { t.done(); }
});

test("worktrees and submodules: a .git file pointing at the real git dir (absolute and relative)", () => {
  const t = tmp();
  try {
    const main = path.join(t.dir, "main");
    fakeRepo(main, "ref: refs/heads/main\n");
    const wtGit = path.join(main, ".git", "worktrees", "wt");
    fs.mkdirSync(wtGit, { recursive: true });
    fs.writeFileSync(path.join(wtGit, "HEAD"), "ref: refs/heads/wt-branch\n");

    const abs = path.join(t.dir, "wt-abs");
    fs.mkdirSync(abs);
    fs.writeFileSync(path.join(abs, ".git"), `gitdir: ${wtGit}\n`);
    assert.equal(gitInfo(abs, { dirty: false }).branch, "wt-branch");

    const rel = path.join(t.dir, "wt-rel", "src");
    fs.mkdirSync(rel, { recursive: true });
    fs.writeFileSync(path.join(t.dir, "wt-rel", ".git"), "gitdir: ../main/.git/worktrees/wt\n");
    assert.equal(gitInfo(rel, { dirty: false }).branch, "wt-branch", "relative gitdir, queried from a subfolder");
    assert.equal(gitInfo(main, { dirty: false }).branch, "main", "the main checkout is unaffected");
  } finally { t.done(); }
});

test("a broken .git file is skipped and the search continues upward", () => {
  const t = tmp();
  try {
    fakeRepo(t.dir, "ref: refs/heads/outer\n");
    const sub = path.join(t.dir, "sub");
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(sub, ".git"), "this is not a gitdir line\n");
    assert.equal(gitInfo(sub, { dirty: false }).branch, "outer");
  } finally { t.done(); }
});

test("no usable HEAD -> null; nonexistent folders never throw", () => {
  const t = tmp();
  try {
    fs.mkdirSync(path.join(t.dir, ".git")); // a .git folder with no HEAD inside
    assert.equal(gitInfo(t.dir, { dirty: false }), null);
    assert.doesNotThrow(() => gitInfo(path.join(t.dir, "nope", "nope"), { dirty: false }));
    assert.doesNotThrow(() => gitInfo(undefined, { dirty: false }));
    assert.doesNotThrow(() => gitInfo(null));
    assert.doesNotThrow(() => findHead(""));
    assert.equal(findHead(path.parse(os.tmpdir()).root), null, "the drive root is not inside a repository");
  } finally { t.done(); }
});

test("isDirty: runs once, caches for 5 seconds, then asks again", () => {
  const t = tmp();
  try {
    let calls = 0;
    let answer = true;
    const run = () => { calls++; return answer; };
    const opts = (now) => ({ now, run, tmp: t.dir });
    const dir = path.join(t.dir, "repo");
    assert.equal(isDirty(dir, opts(1_000_000)), true);
    assert.equal(calls, 1);
    answer = false;
    assert.equal(isDirty(dir, opts(1_000_000 + 4999)), true, "still inside the 5 s window: cached answer");
    assert.equal(calls, 1);
    assert.equal(isDirty(dir, opts(1_000_000 + 5000)), false, "window over: asked again");
    assert.equal(calls, 2);
    assert.equal(isDirty(path.join(t.dir, "other"), opts(1_000_000 + 5001)), false, "the cache is keyed by folder");
    assert.equal(calls, 3);
  } finally { t.done(); }
});

test("isDirty: a slow or failed git (null) is cached too, and a damaged cache is ignored", () => {
  const t = tmp();
  try {
    let calls = 0;
    const run = () => { calls++; return null; };
    assert.equal(isDirty("/x", { now: 5000, run, tmp: t.dir }), null);
    assert.equal(isDirty("/x", { now: 6000, run, tmp: t.dir }), null);
    assert.equal(calls, 1, "a timeout costs one attempt per window, not one per refresh");
    for (const f of fs.readdirSync(t.dir)) fs.writeFileSync(path.join(t.dir, f), "{ not json");
    assert.equal(isDirty("/x", { now: 6500, run: () => false, tmp: t.dir }), false, "damaged cache: run again");
    // a cache entry from the future (clock skew) is not trusted either
    for (const f of fs.readdirSync(t.dir)) fs.writeFileSync(path.join(t.dir, f), JSON.stringify({ t: 9_000_000, dirty: true }));
    assert.equal(isDirty("/x", { now: 7000, run: () => false, tmp: t.dir }), false);
  } finally { t.done(); }
});

test("gitInfo: dirty flag follows the option", () => {
  const t = tmp();
  try {
    fakeRepo(t.dir, "ref: refs/heads/main\n");
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), "glow-cache-"));
    assert.deepEqual(gitInfo(t.dir, { dirty: true, run: () => true, tmp: cache }), { branch: "main", dirty: true });
    assert.deepEqual(gitInfo(t.dir, { dirty: false, run: () => { throw new Error("must not run"); }, tmp: cache }), { branch: "main", dirty: null });
    fs.rmSync(cache, { recursive: true, force: true });
  } finally { t.done(); }
});

test("runStatus gives null (not an exception) when git cannot run", () => {
  assert.equal(runStatus(path.join(os.tmpdir(), "glow-definitely-missing-folder")), null);
});
