// Draws the real status line of every theme into docs/themes.svg for the README.
// The lines come from render() itself; this file only turns its ANSI colors into SVG.
// Run: node scripts/preview-svg.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// --- ANSI to styled runs -------------------------------------------------------------------

const BASIC = ["#000000", "#cd3131", "#0dbc79", "#e5e510", "#2472c8", "#bc3fbc", "#11a8cd", "#e5e5e5",
  "#666666", "#f14c4c", "#23d18b", "#f5f543", "#3b8eea", "#d670d6", "#29b8db", "#ffffff"];
function xterm256(n) {
  if (n < 16) return BASIC[n];
  if (n >= 232) { const v = 8 + (n - 232) * 10; return rgbHex(v, v, v); }
  const i = n - 16, steps = [0, 95, 135, 175, 215, 255];
  return rgbHex(steps[Math.floor(i / 36)], steps[Math.floor(i / 6) % 6], steps[i % 6]);
}
const rgbHex = (r, g, b) => "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("");

// East Asian wide characters and most emoji take two cells in a terminal.
export function cellWidth(ch) {
  const cp = ch.codePointAt(0);
  if (cp === 0xfe0f || cp === 0x200d) return 0;
  if ((cp >= 0x1f300 && cp <= 0x1faff) || (cp >= 0x2600 && cp <= 0x27bf && cp !== 0x2714) || (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xff00 && cp <= 0xff60)) return 2;
  return 1;
}

export function ansiRuns(line, defaults) {
  const runs = [];
  let style = { fg: defaults.fg, bg: null, bold: false, dim: false };
  const text = line.replace(/\x1b\]8;[^\x07\x1b]*(?:\x07|\x1b\\)/g, ""); // OSC 8 links
  const re = /\x1b\[([0-9;]*)m/g;
  let last = 0, m;
  const push = (s) => {
    if (!s) return;
    const prev = runs[runs.length - 1];
    if (prev && prev.fg === style.fg && prev.bg === style.bg && prev.bold === style.bold && prev.dim === style.dim) prev.text += s;
    else runs.push({ ...style, text: s });
  };
  while ((m = re.exec(text))) {
    push(text.slice(last, m.index));
    last = re.lastIndex;
    const codes = (m[1] || "0").split(";").map(Number);
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      if (c === 0) style = { fg: defaults.fg, bg: null, bold: false, dim: false };
      else if (c === 1) style = { ...style, bold: true };
      else if (c === 2) style = { ...style, dim: true };
      else if (c === 22) style = { ...style, bold: false, dim: false };
      else if (c === 39) style = { ...style, fg: defaults.fg };
      else if (c === 49) style = { ...style, bg: null };
      else if ((c === 38 || c === 48) && codes[i + 1] === 2) { style = { ...style, [c === 38 ? "fg" : "bg"]: rgbHex(codes[i + 2], codes[i + 3], codes[i + 4]) }; i += 4; }
      else if ((c === 38 || c === 48) && codes[i + 1] === 5) { style = { ...style, [c === 38 ? "fg" : "bg"]: xterm256(codes[i + 2]) }; i += 2; }
      else if (c >= 30 && c <= 37) style = { ...style, fg: BASIC[c - 30] };
      else if (c >= 90 && c <= 97) style = { ...style, fg: BASIC[c - 82] };
      else if (c >= 40 && c <= 47) style = { ...style, bg: BASIC[c - 40] };
      else if (c >= 100 && c <= 107) style = { ...style, bg: BASIC[c - 92] };
    }
  }
  push(text.slice(last));
  return runs;
}

// --- SVG ----------------------------------------------------------------------------------

const xml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const CW = 8.6, LH = 22, FONT = 14;

export function linesToSvg(rows, { title = "Claude Code Glow", background = "#0d1117", fg = "#c9d1d9", width } = {}) {
  const padX = 18, top = 46;
  for (const row of rows) row.runs ||= ansiRuns(row.text, { fg });
  // As wide as the longest line, unless a width is given.
  width ||= Math.max(40, ...rows.map((row) => row.runs.reduce((n, run) => n + [...run.text].reduce((m, ch) => m + cellWidth(ch), 0), 0))) + 1;
  const height = top + rows.length * LH + 18;
  const w = Math.round(padX * 2 + width * CW);
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${height}" viewBox="0 0 ${w} ${height}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace" font-size="${FONT}">`,
    `<rect width="${w}" height="${height}" rx="10" fill="${background}"/>`,
    `<circle cx="20" cy="18" r="6" fill="#ff5f57"/><circle cx="40" cy="18" r="6" fill="#febc2e"/><circle cx="60" cy="18" r="6" fill="#28c840"/>`,
    `<text x="${w / 2}" y="22" fill="#8b949e" text-anchor="middle">${xml(title)}</text>`,
  ];
  rows.forEach((row, i) => {
    const y = top + i * LH;
    // A row may carry its own terminal background (a theme shown on the background it is made for).
    if (row.background) out.push(`<rect x="8" y="${y - 2}" width="${w - 16}" height="${LH}" fill="${row.background}"/>`);
    let col = 0;
    for (const run of row.runs || ansiRuns(row.text, { fg })) {
      const cells = [...run.text].reduce((n, ch) => n + cellWidth(ch), 0);
      const x = padX + col * CW;
      if (run.bg) out.push(`<rect x="${x.toFixed(1)}" y="${y}" width="${(cells * CW + 0.6).toFixed(1)}" height="${LH - 2}" fill="${run.bg}"/>`);
      if (run.text.trim()) {
        const attrs = [`x="${x.toFixed(1)}"`, `y="${y + 15}"`, `fill="${run.fg || fg}"`, run.bold ? `font-weight="bold"` : "", run.dim ? `opacity="0.65"` : "", `xml:space="preserve"`].filter(Boolean).join(" ");
        out.push(`<text ${attrs}>${xml(run.text)}</text>`);
      }
      col += cells;
    }
  });
  out.push("</svg>");
  return out.join("\n") + "\n";
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { render } = await import(new URL("../src/render.mjs", import.meta.url));
  const { sampleInput } = await import(new URL("../src/sample.mjs", import.meta.url));
  const now = Date.parse("2026-10-03T12:00:00Z");
  const sec = Math.floor(now / 1000);
  // A different moment of a session for each theme, so the gallery shows the tips at work.
  const moments = [
    (s) => s, // the prompt cache is about to go cold
    (s) => { s.context_window.used_percentage = 62; s.context_window.current_usage.cache_read_input_tokens = 610000; s.prompt_cache.expires_at = sec + 3000; return s; },
    (s) => { s.rate_limits.five_hour.used_percentage = 84; s.prompt_cache.expires_at = sec + 3000; return s; },
    (s) => { s.context_window.used_percentage = 86; s.context_window.current_usage.cache_read_input_tokens = 850000; s.prompt_cache.expires_at = sec + 3000; return s; },
    (s) => { s.prompt_cache.expires_at = sec + 3000; return s; }, // a quiet moment: a feature tip
  ];
  const files = fs.readdirSync(path.join(root, "themes")).filter((f) => /^glow-.+\.json$/.test(f)).sort();
  const rows = [];
  files.forEach((f, i) => {
    const theme = JSON.parse(fs.readFileSync(path.join(root, "themes", f), "utf8"));
    const label = theme.name.replace(/^Glow\s*·\s*/, "");
    const background = theme.glow?.bg || null;
    const dim = theme.glow?.dim || "#8b949e";
    rows.push({ background, runs: [{ fg: dim, bg: null, bold: true, dim: false, text: ` ${label}  ${theme.base.startsWith("light") ? "(light)" : ""}` }] });
    const input = moments[i % moments.length](sampleInput(now));
    const out = render(input, { theme: f.replace(/^glow-|\.json$/g, ""), icons: "unicode", tips: true, featureTips: true }, theme,
      { columns: 150, colorMode: "truecolor", now: now + i * 120000, git: () => ({ branch: "main", dirty: true }) });
    for (const line of String(out).split("\n")) rows.push({ background, text: ` ${line}` });
  });
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs", "themes.svg"), linesToSvg(rows, { title: "claude-glow theme list" }));
  console.log(`wrote docs/themes.svg (${files.length} themes)`);
}
