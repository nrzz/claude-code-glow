// Packs the generated themes into hud/data/themes.json for the glowbar plugin's picker (the HUD).
// The HUD is its own plugin, installed on its own, so it carries its own copy of the data.
// Run after build-themes: node scripts/build-hud-data.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const themesDir = path.join(root, "themes");
const out = path.join(root, "hud", "data", "themes.json");

export function hudThemes() {
  return fs.readdirSync(themesDir)
    .filter((f) => /^glow-.+\.json$/.test(f))
    .map((f) => {
      const t = JSON.parse(fs.readFileSync(path.join(themesDir, f), "utf8"));
      return {
        slug: f.replace(/^glow-|\.json$/g, ""),
        name: String(t.name || f).replace(/^Glow\s*·\s*/, ""),
        base: t.base,
        overrides: t.overrides || {},
        glow: t.glow || {}, // written back into glow.json, so uninstall knows the file is Glow's
        swatches: (t.glow && t.glow.swatches) || [],
      };
    })
    // Stock Claude colors first, then dark themes, then light ones, each by name.
    .sort((a, b) => (a.slug === "classic" ? -1 : b.slug === "classic" ? 1 : 0)
      || (a.base.startsWith("light") - b.base.startsWith("light"))
      || a.name.localeCompare(b.name));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const list = hudThemes();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(list, null, 1) + "\n");
  console.log(`wrote ${path.relative(root, out)}: ${list.length} themes`);
}
