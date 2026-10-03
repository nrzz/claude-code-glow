// The status line renderer. Pure: render(input, config, theme, opts) -> a string of one or two lines.
//   line 1  colored chips: model, folder, git branch, context meter, cost, session time, plan limits, cache
//   line 2  one tip (zero tokens, see src/tips.mjs)
// Every field of `input` may be missing or the wrong type; a segment with no data is skipped, and a
// segment that throws is skipped too, so this function does not throw.
import { detectColorMode, makeColors, truncate, visibleWidth } from "./colors.mjs";
import { normalizeConfig, normalizeGlow } from "./defaults.mjs";
import { gitInfo } from "./git.mjs";
import {
  baseName, cacheInfo, clean, contextInfo, formatCountdown, formatDuration, formatMoney,
  formatTokens, limitsInfo,
} from "./metrics.mjs";
import { pickTip } from "./tips.mjs";

// Nerd Font glyphs are Font Awesome codepoints (stable across Nerd Fonts v2 and v3) plus the
// Powerline branch. The unicode set sticks to Geometric Shapes and Block Elements.
const ICONS = {
  nerd: { model: "", dir: "", git: "", context: "", cost: "", time: "", limits: "", cache: "" },
  unicode: { model: "◆", dir: "⌂", git: "⎇", context: "", cost: "", time: "◷", limits: "◔", cache: "↻" },
  ascii: {},
};
const POWERLINE = "";

/** Segments dropped first when the line is too wide, in this order. */
export const DROP_ORDER = ["cache", "limits", "time", "cost", "git"];

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const obj = (v) => (isObject(v) ? v : {});
const pctOf = (n) => Math.min(999, Math.round(n));

// ---------------------------------------------------------------- segments
// A segment is { id, icon, parts }. A part is { t: text, c?: color, b?: bold, shrink?: may be shortened }.

function modelSegment({ input, mode }) {
  const m = input.model;
  let name = typeof m === "string" ? clean(m) : clean(obj(m).display_name) || clean(obj(m).id);
  name = (name || "Claude").replace(/\s*\((\d+(?:\.\d+)?[KM]) context\)/i, " $1"); // "Opus 4.7 (1M context)" -> "Opus 4.7 1M"
  const parts = [{ t: name, b: true }];
  const effort = clean(obj(input.effort).level);
  if (effort) parts.push({ t: mode === "ascii" ? ` ${effort}` : ` · ${effort}` });
  if (input.fast_mode === true) parts.push({ t: mode === "ascii" ? " fast" : " ⚡fast" });
  const vim = clean(obj(input.vim).mode);
  if (vim) parts.push({ t: ` vim:${vim.split(/\s+/).map((w) => w[0].toUpperCase()).join("")}` });
  return { parts };
}

function dirSegment({ input, mode }) {
  const ws = obj(input.workspace);
  const base = baseName(ws.current_dir ?? input.cwd ?? ws.project_dir);
  const repo = obj(ws.repo);
  const owner = clean(repo.owner);
  const name = clean(repo.name);
  if (owner && name) {
    const parts = [{ t: `${owner}/${name}`, shrink: true }];
    if (base && base !== name) parts.push({ t: mode === "ascii" ? ` > ${base}` : ` › ${base}` });
    return { parts };
  }
  return base ? { parts: [{ t: clean(base), shrink: true }] } : null;
}

function gitSegment({ input, glow, gitLookup }) {
  const ws = obj(input.workspace);
  const dir = ws.current_dir ?? input.cwd;
  let info = null;
  if (gitLookup && typeof dir === "string" && dir) info = gitLookup(dir);
  if (!info || !info.branch) {
    const b = clean(obj(input.worktree).branch);
    info = b ? { branch: b } : null; // fall back to what Claude Code reports for worktrees
  }
  if (!info) return null;
  const parts = [{ t: clean(info.branch), shrink: true }];
  if (info.dirty === true) parts.push({ t: "*", c: glow.warn });
  return { parts };
}

function contextSegment({ input, glow, mode }) {
  const c = contextInfo(input);
  if (!c) return null;
  const state = c.pct >= 75 ? glow.bad : c.pct >= 50 ? glow.warn : glow.ok;
  const cells = 10;
  const filled = Math.min(cells, Math.max(c.pct > 0 ? 1 : 0, Math.round(c.pct / 10)));
  const ascii = mode === "ascii";
  const on = ascii ? "#" : "▰";
  const off = ascii ? "-" : "▱";
  const parts = [];
  if (ascii) parts.push({ t: "ctx [" });
  parts.push({ t: on.repeat(filled), c: state }, { t: off.repeat(cells - filled), c: glow.dim });
  if (ascii) parts.push({ t: "]" });
  parts.push({ t: ` ${pctOf(c.pct)}%`, c: state });
  const amount = c.used != null && c.size ? `${formatTokens(c.used)}/${formatTokens(c.size)}` : c.used ? formatTokens(c.used) : "";
  if (amount) parts.push({ t: ascii ? " " : " · ", c: glow.dim }, { t: amount });
  return { parts };
}

function costSegment({ input, mode }) {
  const text = formatMoney(obj(input.cost).total_cost_usd);
  if (!text) return null;
  return { parts: [{ t: mode === "nerd" ? text.slice(1) : text }] }; // the nerd icon is already a dollar sign
}

function timeSegment({ input }) {
  const text = formatDuration(obj(input.cost).total_duration_ms);
  return text ? { parts: [{ t: text }] } : null;
}

function limitsSegment({ input, glow, mode }) {
  const l = limitsInfo(input);
  if (!l) return null;
  const level = (pct) => (pct >= 90 ? glow.bad : pct >= 70 ? glow.warn : undefined);
  const sep = { t: mode === "ascii" ? " / " : " · ", c: glow.dim };
  const parts = [];
  for (const [label, w] of [["5h", l.five], ["7d", l.seven], ["spend", l.spend]]) {
    if (!w) continue;
    if (parts.length) parts.push(sep);
    parts.push({ t: `${label} ` }, { t: `${pctOf(w.pct)}%`, c: level(w.pct) });
  }
  return { parts };
}

function cacheSegment({ input, glow, mode, now }) {
  const c = cacheInfo(input, now);
  if (!c) return null;
  const sep = { t: mode === "ascii" ? " " : " · ", c: glow.dim };
  const parts = [{ t: c.hit != null ? `cache ${Math.round(c.hit)}%` : "cache" }];
  const cold = (c.warm === false && (c.requests ?? 0) > 0) || (c.left != null && c.left <= 0);
  if (cold) parts.push(sep, { t: "cold", c: glow.bad });
  else if (c.warm !== false && c.left != null && c.left <= 300) parts.push(sep, { t: `cold in ${formatCountdown(c.left)}`, c: glow.warn });
  return parts.length > 1 || c.hit != null ? { parts } : null; // a bare "cache" says nothing
}

const BUILDERS = {
  model: modelSegment, dir: dirSegment, git: gitSegment, context: contextSegment,
  cost: costSegment, time: timeSegment, limits: limitsSegment, cache: cacheSegment,
};

function buildSegments(ctx) {
  const out = [];
  for (const id of ctx.config.segments) {
    try {
      const seg = BUILDERS[id] && BUILDERS[id](ctx);
      if (seg && seg.parts.length) out.push({ id, icon: ICONS[ctx.mode][id] || "", ...seg });
    } catch { /* a broken segment is skipped, never fatal */ }
  }
  return out;
}

// ---------------------------------------------------------------- layout

// Text pieces to escape sequences. A colored part switches the foreground and then restores the
// segment's own, so the segment background survives.
function paintParts(parts, baseFg, C) {
  let out = "";
  for (const p of parts) {
    if (!p.t) continue;
    const open = p.b ? C.bold : "";
    const close = p.b ? C.boldOff : "";
    out += p.c ? C.fg(p.c) + open + p.t + close + C.fg(baseFg) : open + p.t + close;
  }
  return out;
}

const body = (seg, baseFg, C) => (seg.icon ? `${seg.icon} ` : "") + paintParts(seg.parts, baseFg, C);

// Model chip in the accent; every other chip a graded panel, each a little lighter than the last.
function styles(segs, g) {
  let k = 0;
  return segs.map((s) => (s.id === "model" ? g.model : { bg: g.panels[Math.min(k++, g.panels.length - 1)], fg: g.panelFg }));
}

// unicode: chips with half-block ends (render in any font), one space apart
function chipLine(segs, g, C) {
  const st = styles(segs, g);
  return segs.map((s, i) =>
    C.fg(st[i].bg) + "▐" + C.bg(st[i].bg) + C.fg(st[i].fg) + " " + body(s, st[i].fg, C) + " " + C.reset + C.fg(st[i].bg) + "▌" + C.reset,
  ).join(" ");
}

// nerd: classic powerline arrows between touching segments
function powerlineLine(segs, g, C) {
  const st = styles(segs, g);
  let out = "";
  segs.forEach((s, i) => {
    out += C.bg(st[i].bg) + C.fg(st[i].fg) + " " + body(s, st[i].fg, C) + " ";
    out += st[i + 1]
      ? C.fg(st[i].bg) + C.bg(st[i + 1].bg) + POWERLINE
      : C.reset + C.fg(st[i].bg) + POWERLINE + C.reset;
  });
  return out;
}

// ascii, and any mode without color: no backgrounds, segments split by " | "
function plainLine(segs, g, C) {
  return segs.map((s) => {
    const base = s.id === "model" ? g.accent : g.fg;
    return C.fg(base) + body(s, base, C) + C.reset;
  }).join(C.fg(g.dim) + " | " + C.reset);
}

function layout(segs, ctx) {
  if (!segs.length) return "";
  if (ctx.mode === "ascii" || !ctx.C.on) return plainLine(segs, ctx.glow, ctx.C);
  return ctx.mode === "nerd" ? powerlineLine(segs, ctx.glow, ctx.C) : chipLine(segs, ctx.glow, ctx.C);
}

// Make line 1 fit: drop the least important segments, then shorten folder / branch names, then cut.
function fit(segs, ctx, columns) {
  const cur = segs.slice();
  let line = layout(cur, ctx);
  if (!columns) return line;
  for (const id of DROP_ORDER) {
    if (visibleWidth(line) <= columns) return line;
    const i = cur.findIndex((s) => s.id === id);
    if (i === -1) continue;
    cur.splice(i, 1);
    line = layout(cur, ctx);
  }
  for (let round = 0; round < 8 && visibleWidth(line) > columns; round++) {
    const over = visibleWidth(line) - columns;
    const widest = cur.flatMap((s) => s.parts.filter((p) => p.shrink)).sort((a, b) => visibleWidth(b.t) - visibleWidth(a.t))[0];
    if (!widest || visibleWidth(widest.t) <= 4) break;
    widest.t = truncate(widest.t, Math.max(4, visibleWidth(widest.t) - over));
    line = layout(cur, ctx);
  }
  return visibleWidth(line) > columns ? truncate(line, columns) : line;
}

function tipLine(input, ctx, columns) {
  if (ctx.config.tips === false) return "";
  const tip = pickTip(input, { now: ctx.now, featureTips: ctx.config.featureTips !== false });
  if (!tip) return "";
  const ascii = ctx.mode === "ascii";
  const text = ascii ? tip.text.replace(/—/g, "-").replace(/→/g, "->") : tip.text; // ascii mode stays pure ASCII
  const line = ctx.C.fg(ctx.glow.tip) + (ascii ? "tip: " : "💡 ") + text + ctx.C.reset;
  return columns ? truncate(line, columns) : line;
}

/**
 * Render the status line.
 * @param input   the JSON Claude Code sends on stdin (anything; missing fields are fine)
 * @param config  { theme, icons, segments, tips, featureTips, gitDirty } (missing fields default)
 * @param theme   a theme file's parsed JSON ({ glow: {...} }), or null for the built-in palette
 * @param opts    { columns, colorMode: "truecolor"|"256"|"none", now (ms), git: false | (dir) => info }
 * @returns       one or two lines joined by "\n", no trailing newline
 */
export function render(input, config, theme, opts = {}) {
  const o = obj(opts);
  const cfg = normalizeConfig(config);
  const ctx = {
    input: obj(input),
    config: cfg,
    glow: normalizeGlow(isObject(theme) && isObject(theme.glow) ? theme.glow : theme),
    mode: cfg.icons,
    C: makeColors(["truecolor", "256", "none"].includes(o.colorMode) ? o.colorMode : detectColorMode()),
    now: Number.isFinite(o.now) ? o.now : Date.now(),
    gitLookup: o.git === false ? null : typeof o.git === "function" ? o.git : (dir) => gitInfo(dir, { dirty: cfg.gitDirty !== false }),
  };
  const columns = Number.isFinite(o.columns) && o.columns > 0 ? Math.floor(o.columns) : null;

  let first = "";
  try { first = fit(buildSegments(ctx), ctx, columns); } catch { /* fall through to the minimal line */ }
  if (!first) first = ctx.C.fg(ctx.glow.accent) + "Claude" + ctx.C.reset;
  let second = "";
  try { second = tipLine(ctx.input, ctx, columns); } catch { /* the tip is optional */ }
  return second ? `${first}\n${second}` : first;
}

export { ICONS };
