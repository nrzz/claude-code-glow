// Generates themes/glow-<slug>.json for every palette in src/palettes.mjs.
//   node scripts/build-themes.mjs          write the files (and remove glow-*.json of palettes that are gone)
//   node scripts/build-themes.mjs --check  write nothing; exit 1 if the files on disk are out of date
// The generated files ship with the repo, so run this after editing a palette or src/theme-gen.mjs.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PALETTES } from "../src/palettes.mjs";
import { generateTheme, serializeTheme } from "../src/theme-gen.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "themes");
const check = process.argv.includes("--check");

const wanted = new Map(PALETTES.map((p) => [`glow-${p.slug}.json`, serializeTheme(generateTheme(p))]));
let stale = 0;
let written = 0;

if (!check) fs.mkdirSync(dir, { recursive: true });
for (const [file, content] of wanted) {
  const target = path.join(dir, file);
  let current = null;
  try { current = fs.readFileSync(target, "utf8"); } catch { /* not written yet */ }
  if (current !== null && current.replace(/\r\n/g, "\n") === content) continue; // a CRLF checkout of the same content is current
  stale++;
  if (!check) { fs.writeFileSync(target, content); written++; }
}

// Files for palettes that no longer exist (renamed or dropped) should not ship.
let existing = [];
try { existing = fs.readdirSync(dir); } catch { /* no themes folder yet */ }
for (const file of existing) {
  if (!/^glow-.*\.json$/.test(file) || wanted.has(file)) continue;
  stale++;
  if (!check) { fs.rmSync(path.join(dir, file)); written++; }
}

if (check) {
  console.log(stale ? `${stale} theme file(s) out of date. Run: npm run build:themes` : `All ${wanted.size} theme files are up to date.`);
  process.exit(stale ? 1 : 0);
}
console.log(`${wanted.size} themes in ${path.relative(process.cwd(), dir) || "."}: ${written} written, ${wanted.size - written} unchanged.`);
