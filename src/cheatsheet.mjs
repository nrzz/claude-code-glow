// `claude-glow cheatsheet`: one screen of Claude Code keys, commands, flags and token-saving habits.
// Only things that exist today; colors follow the active Glow theme.
import { makeColors, padEndVisible, truncate, visibleWidth, wrapText } from "./colors.mjs";
import { normalizeGlow } from "./defaults.mjs";
import { gradientText } from "./ui.mjs";

const KEYS = [
  ["Esc", "interrupt Claude"],
  ["Esc Esc", "rewind to an earlier message"],
  ["Shift+Tab", "cycle permission modes"],
  ["ctrl+r", "search your prompt history"],
  ["ctrl+o", "expand tool output"],
  ["! cmd", "run a shell command yourself"],
  ["@path", "mention a file or folder"],
];

const SLASH = [
  ["/context", "see what fills the window"],
  ["/compact [focus]", "summarize, say what to keep"],
  ["/clear", "start fresh; /resume returns"],
  ["/resume", "reopen an earlier session"],
  ["/rename", "name this session"],
  ["/model", "switch model"],
  ["/theme", "color themes (Glow lives here)"],
  ["/statusline", "set up a status line"],
  ["/usage", "plan limits and usage"],
  ["/hooks", "see configured hooks"],
  ["/agents", "manage subagents"],
  ["/plugin", "browse and install plugins"],
  ["/mcp", "manage MCP servers"],
  ["/memory", "edit CLAUDE.md memory files"],
  ["/export", "export the conversation"],
];

const CLI = [
  ["claude -c", "continue last session"],
  ["claude -r", "pick a session to resume"],
  ["claude -p \"...\"", "one-shot answer, no UI"],
  ["--fork-session", "fork when resuming"],
];

const SAVE = [
  "New task, new session: old context is re-sent with every message.",
  "/compact around 50% full, and name what to keep.",
  "Pick model and effort at session start; switching mid-session re-caches everything.",
  "@file beats \"go find the file\": one read instead of a search.",
  "Let subagents swallow big outputs (logs, test runs, searches).",
  "Keep CLAUDE.md short, it loads every session (claude-glow doctor).",
  "Reply while the prompt cache is warm: the status line counts down.",
];

// A rounded box with the title in the top border. rows: [key, text] pairs or plain strings.
function box(title, rows, width, glow, C) {
  const inner = width - 4;
  const keyW = Math.min(18, Math.max(0, ...rows.filter(Array.isArray).map(([k]) => visibleWidth(k))));
  const line = (content) => `${C.paint("│", glow.dim)} ${padEndVisible(content, inner)} ${C.paint("│", glow.dim)}`;
  const top = `${C.paint("╭─ ", glow.dim)}${C.paint(title, glow.accent)}${C.fg(glow.dim)} ${"─".repeat(Math.max(0, width - visibleWidth(title) - 5))}╮${C.reset}`;
  const out = [top];
  for (const row of rows) {
    if (Array.isArray(row)) {
      const [k, text] = row;
      out.push(line(C.paint(padEndVisible(k, keyW), glow.accent2) + "  " + truncate(text, inner - keyW - 2)));
    } else {
      wrapText(row, inner - 2).forEach((l, i) => out.push(line((i === 0 ? C.paint("• ", glow.accent) : "  ") + l)));
    }
  }
  out.push(`${C.fg(glow.dim)}╰${"─".repeat(width - 2)}╯${C.reset}`);
  return out;
}

// Put two boxes' lines side by side (the shorter one is padded with blanks).
function sideBySide(left, right, leftW, gap = 2) {
  const n = Math.max(left.length, right.length);
  const out = [];
  for (let i = 0; i < n; i++) out.push(padEndVisible(left[i] ?? "", leftW) + " ".repeat(gap) + (right[i] ?? ""));
  return out;
}

/** The cheat sheet as lines. opts: { glow, colorMode, columns } */
export function cheatsheetLines({ glow, colorMode, columns = 100 } = {}) {
  const g = normalizeGlow(glow);
  const C = makeColors(colorMode);
  const width = Math.max(60, Math.min(columns, 110));
  const out = [];
  out.push(gradientText("CLAUDE CODE  cheat sheet", g.gradient, C) + C.paint("   keys, commands, flags and token-saving habits", g.dim));
  out.push("");
  if (width >= 100) {
    const leftW = 46;
    const left = [...box("KEYS", KEYS, leftW, g, C), ...box("CLI", CLI, leftW, g, C)];
    const right = box("SLASH COMMANDS", SLASH, width - leftW - 2, g, C);
    out.push(...sideBySide(left, right, leftW));
  } else {
    out.push(...box("KEYS", KEYS, width, g, C), ...box("SLASH COMMANDS", SLASH, width, g, C), ...box("CLI", CLI, width, g, C));
  }
  out.push(...box("SAVE TOKENS (zero-cost habits)", SAVE, width, g, C));
  return out;
}
