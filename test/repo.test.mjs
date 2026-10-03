import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, readJson } from "./helpers.mjs";

const pkg = readJson(path.join(ROOT, "package.json"));

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".git") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
// Only the files this package's core owns. The plugin manifest, skills, HUD and docs live elsewhere
// in the repo and answer to their own tests.
const sources = [
  path.join(ROOT, "statusline.mjs"),
  path.join(ROOT, "scripts", "build-themes.mjs"),
  ...["bin", "src", "test"].flatMap((d) => walk(path.join(ROOT, d))).filter((f) => /\.m?js$/.test(f)),
];
const rel = (f) => path.relative(ROOT, f).replace(/\\/g, "/");
const lines = (text) => text.split(/\r?\n/); // tolerate a CRLF checkout

// Specifiers of static imports, re-exports and dynamic imports with a string literal.
function specifiers(code) {
  const out = [];
  for (const m of code.matchAll(/(?:^|[\s;])(?:import|export)\s+(?:[^"'`;]*?\sfrom\s*)?["']([^"']+)["']/gm)) out.push(m[1]);
  for (const m of code.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) out.push(m[1]);
  return out;
}

test("package.json: name, version, module type, bin, engines, license, repository, scripts", () => {
  assert.equal(pkg.name, "claude-code-glow");
  assert.equal(pkg.version, "1.0.0");
  assert.equal(pkg.type, "module");
  assert.deepEqual(pkg.bin, { "claude-glow": "bin/claude-glow.mjs" });
  assert.equal(pkg.engines.node, ">=18");
  assert.equal(pkg.license, "MIT");
  assert.equal(pkg.repository, "github:nrzz/claude-code-glow");
  assert.equal(pkg.scripts.test, "node --test test/");
  assert.equal(pkg.scripts["build:themes"], "node scripts/build-themes.mjs");
  for (const f of ["bin", "src", "themes", "statusline.mjs"]) assert.ok(pkg.files.includes(f), `files lists ${f}`);
  for (const f of pkg.files) assert.ok(!f.startsWith("/") && !f.includes(".."));
  assert.ok(fs.existsSync(path.join(ROOT, pkg.bin["claude-glow"])));
});

test("zero dependencies: no dependency fields, no lockfile, no node_modules, only node: and relative imports", () => {
  for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies", "bundledDependencies"]) assert.equal(pkg[field], undefined, field);
  for (const f of ["package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "node_modules"]) assert.ok(!fs.existsSync(path.join(ROOT, f)), `${f} must not exist`);
  assert.ok(sources.length > 20);
  for (const file of sources) {
    const code = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(code, /\brequire\(/, `${rel(file)} is ESM`);
    for (const spec of specifiers(code)) {
      if (spec.startsWith("node:")) continue;
      assert.ok(spec.startsWith("."), `${rel(file)} imports "${spec}": only node: built-ins and relative files are allowed`);
      assert.ok(fs.existsSync(path.resolve(path.dirname(file), spec)), `${rel(file)} -> ${spec} exists`);
    }
  }
});

test("the status line imports only what it needs and does no network I/O", () => {
  const seen = new Set();
  const queue = [path.join(ROOT, "statusline.mjs")];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const code = fs.readFileSync(file, "utf8");
    for (const spec of specifiers(code)) {
      if (spec.startsWith(".")) queue.push(path.resolve(path.dirname(file), spec));
      else assert.ok(!/^node:(https?|http2|net|tls|dns|dgram|worker_threads|cluster|inspector|repl|vm)$/.test(spec), `${rel(file)} must not import ${spec}`);
    }
    assert.doesNotMatch(code, /\bfetch\s*\(|XMLHttpRequest|WebSocket|\.connect\(/, `${rel(file)}: no network calls`);
  }
  const reachable = [...seen].map(rel).sort();
  assert.deepEqual(reachable, [
    "src/color-math.mjs", "src/colors.mjs", "src/config.mjs", "src/defaults.mjs", "src/fsutil.mjs", "src/git.mjs",
    "src/metrics.mjs", "src/render.mjs", "src/tips.mjs", "statusline.mjs",
  ], "the status line stays small and fast: no picker, installer, doctor, palettes or generator");
});

test("code stays Node 18 compatible (no newer built-ins)", () => {
  const newer = [
    [/import\.meta\.(dirname|filename)/, "import.meta.dirname/filename (Node 20.11+)"],
    [/\.(toSorted|toReversed|toSpliced)\(/, "array copy methods (Node 20+)"],
    [/Object\.groupBy|Map\.groupBy/, "groupBy (Node 21+)"],
    [/Promise\.withResolvers/, "Promise.withResolvers (Node 22+)"],
    [/Array\.fromAsync/, "Array.fromAsync (Node 22+)"],
    [/\bfs\.(cpSync|cp|globSync|glob)\(/, "fs.cp / glob (experimental or Node 22+)"],
    [/\.(isWellFormed|toWellFormed)\(/, "well-formed strings (Node 20+)"],
    [/\.(union|intersection|difference|symmetricDifference|isSubsetOf|isSupersetOf)\(/, "Set methods (Node 22+)"],
    [/process\.getBuiltinModule/, "process.getBuiltinModule (Node 22+)"],
    [/recursive:\s*true[^)]*\}\)\s*\.(?:filter|map)/, "readdir recursive option results"],
    [/import\s+[^;]+\bwith\s*\{/, "import attributes (Node 18.20+/20.10+)"],
  ];
  for (const file of sources.filter((f) => !f.endsWith("repo.test.mjs"))) {
    const code = fs.readFileSync(file, "utf8");
    for (const [re, what] of newer) assert.doesNotMatch(code, re, `${rel(file)} uses ${what}`);
  }
});

test("entry points have a node shebang; LICENSE, .gitignore, .gitattributes are in place", () => {
  for (const f of ["bin/claude-glow.mjs", "statusline.mjs"]) {
    assert.equal(lines(fs.readFileSync(path.join(ROOT, f), "utf8"))[0], "#!/usr/bin/env node", f);
  }
  const license = lines(fs.readFileSync(path.join(ROOT, "LICENSE"), "utf8"));
  assert.deepEqual(license.slice(0, 3), ["MIT License", "", "Copyright (c) 2026 Naresh Prabu"]);
  const ignore = lines(fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8"));
  for (const line of ["node_modules/", "*.log", ".DS_Store"]) assert.ok(ignore.includes(line), line);
  const attributes = lines(fs.readFileSync(path.join(ROOT, ".gitattributes"), "utf8"));
  assert.ok(attributes.includes("* text=auto eol=lf"), "LF everywhere, so generated files compare byte for byte on Windows too");
});

test("every source file starts with a comment that says what it is", () => {
  for (const file of sources.filter((f) => /[\\/](src|bin|scripts)[\\/]|statusline\.mjs$/.test(f))) {
    const head = lines(fs.readFileSync(file, "utf8"));
    const first = head[0].startsWith("#!") ? head[1] : head[0];
    assert.match(first, /^\/\/ \S/, `${rel(file)} should open with a // comment`);
  }
});

test("the test entry point lets `node --test test/` find every test file on any Node version", () => {
  const index = fs.readFileSync(path.join(ROOT, "test", "index.js"), "utf8");
  assert.match(index, /process\.versions\.node/);
  assert.match(index, /\.test\.mjs/);
  assert.equal(pkg.scripts.test, "node --test test/");
});

test("scripts/build-themes.mjs --check agrees the themes are current", async () => {
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "build-themes.mjs"), "--check"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /All 15 theme files are up to date/);
});
