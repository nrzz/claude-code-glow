// The interactive theme picker (`claude-glow theme`): full screen, alternate screen buffer.
//   left   the theme list, five color swatches each
//   right  a live preview: the REAL status line (both lines) for sample data, then a mock of the
//          Claude Code UI drawn with the theme's own override colors
// buildFrame() is pure (state + size -> lines) so it can be tested and eyeballed; runPicker() is the
// thin TTY loop around it and restores the terminal on every way out.
import { makeColors, padEndVisible, truncate, visibleWidth } from "./colors.mjs";
import { ICON_MODES, normalizeGlow } from "./defaults.mjs";
import { findPalette } from "./palettes.mjs";
import { render } from "./render.mjs";
import { sampleGit, sampleInput } from "./sample.mjs";
import { generateOverrides } from "./theme-gen.mjs";
import { bannerLines, gradientText } from "./ui.mjs";

const ESC = "\x1b";
const LIST_WIDTH = 30;

/** Overrides to draw the mock with: the theme's own, or Claude's stock colors for status-line-only themes. */
function uiColors(theme) {
  if (theme && theme.overrides && Object.keys(theme.overrides).length) return theme.overrides;
  return generateOverrides(findPalette("classic"));
}

// Keep a line's panel background alive across the resets inside it, then pad it to the panel width.
function panelLine(content, width, g, C) {
  const style = C.bg(g.bg) + C.fg(g.fg);
  const clipped = truncate(content, width);
  const body = C.reset ? clipped.split(C.reset).join(C.reset + style) : clipped;
  return style + body + " ".repeat(Math.max(0, width - visibleWidth(clipped))) + C.reset;
}

/** The preview panel for one theme: status line, then a mock Claude Code UI. Returns padded lines. */
export function previewLines(theme, { width, height, icons, colorMode, now }) {
  const C = makeColors(colorMode);
  const g = normalizeGlow(theme && theme.glow);
  const o = uiColors(theme);
  const col = (text, key, bold) => C.paint(bold ? C.bold + text + C.boldOff : text, o[key] || g.fg);
  const inner = Math.max(10, width - 2);

  const status = render(sampleInput(now), { theme: "preview", icons, tips: true, featureTips: true, gitDirty: false }, theme, {
    columns: inner, colorMode, now, git: sampleGit,
  }).split("\n");

  const claudeBlock = [
    `${col("●", "claude")} ${col("Claude", "claude", true)}`,
    `  ${col("I'll tighten the retry loop and add a test.", "text")}`,
    `  ${col("Reading src/retry.ts ...", "inactive")}`,
  ];
  const mark = (text, key, hl) => {
    // a diff line: tinted background across the line, stronger background on the changed word
    const bg = o[key];
    const wordBg = o[hl];
    const open = C.bg(bg) + C.fg(o.text);
    const [before, word, after] = text;
    return open + before + C.bg(wordBg) + word + C.bg(bg) + after + C.reset;
  };
  const diffBlock = [
    mark([" 12  - const retries = ", "3", ";   "], "diffRemoved", "diffRemovedWord"),
    mark([" 12  + const retries = ", "5", ";   "], "diffAdded", "diffAddedWord"),
    ` 13    ${col("return run(retries);", "text")}`,
  ];
  const labelsBlock = [
    [col("✔ success", "success"), col("⚠ warning", "warning"), col("✖ error", "error"),
      col("◆ plan mode", "planMode"), col("▶▶ accept edits", "autoAccept"), col("! bash", "bashBorder")].join("  "),
  ];
  const boxW = Math.min(inner - 2, 46);
  const edge = (l, r) => col(l + "─".repeat(boxW - 2) + r, "promptBorder");
  const promptBlock = [
    edge("╭", "╮"),
    col("│", "promptBorder") + " " + col(">", "claude") + " " + padEndVisible(col("fix the failing retry test", "text"), boxW - 5) + col("│", "promptBorder"),
    edge("╰", "╯"),
    `  ${col("? for shortcuts", "subtle")}`,
  ];

  // Drop the least revealing blocks first when the panel is short.
  const optional = { claude: claudeBlock, labels: labelsBlock, diff: diffBlock };
  const keep = new Set(["claude", "labels", "diff"]);
  const assemble = (separators) => {
    const parts = [status];
    if (keep.has("claude")) parts.push(optional.claude);
    if (keep.has("diff")) parts.push(optional.diff);
    if (keep.has("labels")) parts.push(optional.labels);
    parts.push(promptBlock);
    const out = [];
    parts.forEach((p, i) => { if (i && separators) out.push(""); out.push(...p); });
    return out;
  };
  let lines = assemble(true);
  for (const drop of ["claude", "labels", "diff"]) {
    if (lines.length <= height) break;
    keep.delete(drop);
    lines = assemble(true);
  }
  if (lines.length > height) lines = assemble(false);
  if (lines.length > height) lines = lines.slice(0, Math.max(2, height));
  return lines.map((l) => panelLine(l, width, g, C));
}

// One theme row: marker, name, five swatches, and a check on the theme that is currently applied.
function themeRow(t, selected, applied, C, width) {
  const g = normalizeGlow(t.theme && t.theme.glow);
  const swatches = g.swatches.slice(0, 5).map((c) => C.fg(c) + "■").join("") + C.reset;
  const name = selected ? C.fg(g.accent) + C.bold + t.name + C.boldOff + C.reset : t.name;
  const mark = selected ? C.paint("▸", g.accent) : " ";
  const tick = applied ? " " + C.paint("✔", g.ok) : "";
  return truncate(`${mark} ${padEndVisible(name, 18)} ${swatches}${tick}`, width);
}

// A window of the list that keeps the selection in view.
function listWindow(count, index, height) {
  const h = Math.max(0, Math.min(height, count));
  const top = Math.max(0, Math.min(index - Math.floor(h / 2), count - h));
  return { top, h };
}

/**
 * The whole screen as an array of lines (each at most cols-1 wide, at most `rows` lines).
 * state: { themes: [{ slug, name, theme }], index, icons, applied (slug or null), note }
 * size:  { cols, rows, colorMode, now }
 */
export function buildFrame(state, { cols, rows, colorMode = "truecolor", now = Date.now() }) {
  const C = makeColors(colorMode);
  const maxW = Math.max(1, cols - 1); // never touch the last column: avoids auto-wrap surprises
  const index = state.themes.length ? Math.max(0, Math.min(state.themes.length - 1, Math.trunc(state.index) || 0)) : 0;
  const sel = state.themes[index];
  const g = normalizeGlow(sel && sel.theme && sel.theme.glow);

  if (cols < 44 || rows < 9) {
    return [
      truncate("Terminal too small.", maxW),
      truncate("Use: claude-glow theme list", maxW),
      truncate("(q quits)", maxW),
    ].slice(0, Math.max(1, rows));
  }

  // header
  const header = [];
  if (rows >= 28 && cols >= 40) {
    header.push(...bannerLines(g.gradient, C).map((l) => " " + l));
    header.push(" " + C.paint(`themes for Claude Code · ${state.themes.length} to pick from`, g.dim));
    header.push("");
  } else {
    header.push(" " + gradientText("CLAUDE GLOW", g.gradient, C) + C.paint(`  themes for Claude Code`, g.dim));
  }
  const key = (k) => C.paint(k, g.accent2);
  const footer = [
    " " + [`${key("↑↓")}/${key("jk")} move`, `${key("enter")} apply`, `${key("i")} icons: ${C.paint(state.icons, g.accent)}`, `${key("q")} quit`].join(C.paint("  ·  ", g.dim)),
    " " + C.paint(truncate(state.note || "", maxW - 2), g.dim),
  ];
  const bodyH = Math.max(3, rows - header.length - footer.length);

  const rowsOut = [];
  const wide = cols >= 96;
  if (wide) {
    const { top, h } = listWindow(state.themes.length, index, bodyH - 1);
    const left = [" " + C.paint(`THEMES ${index + 1}/${state.themes.length}`, g.dim)];
    for (let i = top; i < top + h; i++) left.push(" " + themeRow(state.themes[i], i === index, state.themes[i].slug === state.applied, C, LIST_WIDTH - 2));
    const pw = Math.max(30, maxW - LIST_WIDTH - 2);
    const right = sel ? previewLines(sel.theme, { width: pw, height: bodyH, icons: state.icons, colorMode, now }) : [];
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      rowsOut.push(padEndVisible(left[i] || "", LIST_WIDTH) + "  " + (right[i] || ""));
    }
  } else {
    const listH = Math.min(state.themes.length, Math.max(3, Math.floor((bodyH - 1) * 0.45)));
    const { top, h } = listWindow(state.themes.length, index, listH);
    rowsOut.push(" " + C.paint(`THEMES ${index + 1}/${state.themes.length}`, g.dim));
    for (let i = top; i < top + h; i++) rowsOut.push(" " + themeRow(state.themes[i], i === index, state.themes[i].slug === state.applied, C, maxW - 2));
    const left = bodyH - rowsOut.length;
    if (sel && left >= 3) rowsOut.push(...previewLines(sel.theme, { width: maxW - 2, height: left, icons: state.icons, colorMode, now }).map((l) => " " + l));
  }

  const lines = [...header, ...rowsOut.slice(0, bodyH)];
  while (lines.length < header.length + bodyH) lines.push("");
  lines.push(...footer);
  return lines.slice(0, rows).map((l) => truncate(l, maxW));
}

/** Split raw terminal input into key names. Exported for tests. */
export function tokenizeKeys(data) {
  const out = [];
  for (const tok of String(data).match(/\x1b\[[0-9;]*[A-Za-z~]|\x1bO[A-Za-z]|\x1b|[\s\S]/g) || []) {
    if (tok === "\x03" || tok === "\x04") out.push("quit");
    else if (tok === ESC) out.push("quit");
    else if (tok === `${ESC}[A` || tok === `${ESC}OA` || tok === "k") out.push("up");
    else if (tok === `${ESC}[B` || tok === `${ESC}OB` || tok === "j") out.push("down");
    else if (tok === `${ESC}[5~`) out.push("pageup");
    else if (tok === `${ESC}[6~`) out.push("pagedown");
    else if (tok === `${ESC}[H` || tok === `${ESC}[1~` || tok === `${ESC}OH` || tok === "g") out.push("home");
    else if (tok === `${ESC}[F` || tok === `${ESC}[4~` || tok === `${ESC}OF` || tok === "G") out.push("end");
    else if (tok === "\r" || tok === "\n") out.push("enter");
    else if (tok === "i") out.push("icons");
    else if (tok === "q" || tok === "Q") out.push("quit");
  }
  return out;
}

/**
 * Run the picker until the user applies a theme or quits.
 * @param opts { themes, current (slug), icons, onApply(slug, icons), input, output, colorMode, note }
 * @returns Promise<{ applied: string|null, icons: string, error?: Error }>
 */
export function runPicker(opts) {
  const input = opts.input || process.stdin;
  const output = opts.output || process.stdout;
  const colorMode = opts.colorMode || "truecolor";
  const state = {
    themes: opts.themes,
    index: Math.max(0, opts.themes.findIndex((t) => t.slug === opts.current)),
    icons: ICON_MODES.includes(opts.icons) ? opts.icons : "unicode",
    applied: opts.current || null,
    note: opts.note || "",
  };

  return new Promise((resolve) => {
    let finished = false;
    let entered = false; // the alternate screen is on, so it must be switched off again
    const size = () => ({ cols: output.columns || 80, rows: output.rows || 24, colorMode, now: Date.now() });
    const draw = () => {
      try {
        const lines = buildFrame(state, size());
        output.write(`${ESC}[H` + lines.map((l) => `${l}${ESC}[0m${ESC}[K`).join("\r\n") + `${ESC}[J`);
      } catch { /* a bad frame must not kill the terminal state: keep going */ }
    };

    // Everything that was switched on is switched off here, once, whatever the exit path.
    const restore = () => {
      if (finished) return;
      finished = true;
      if (entered) { try { output.write(`${ESC}[0m${ESC}[?25h${ESC}[?1049l`); } catch { /* terminal gone */ } }
      try { input.setRawMode(false); } catch { /* not a tty any more */ }
      try { input.pause(); } catch { /* ignore */ }
      input.removeListener("data", onData);
      input.removeListener("end", onEnd);
      input.removeListener("close", onEnd);
      output.removeListener("resize", draw);
      process.removeListener("exit", restore);
      process.removeListener("SIGINT", onSignal);
      process.removeListener("SIGTERM", onSignal);
      process.removeListener("SIGHUP", onSignal);
      process.removeListener("uncaughtException", onCrash);
    };
    const done = (result) => { restore(); resolve(result); };
    const onEnd = () => done({ applied: null, icons: opts.icons }); // the terminal went away
    const onSignal = () => { restore(); process.exit(130); };
    const onCrash = (err) => { restore(); console.error(err); process.exit(1); };

    const move = (to) => { state.index = Math.max(0, Math.min(state.themes.length - 1, to)); };
    const onData = (chunk) => {
      for (const key of tokenizeKeys(chunk)) {
        if (finished) return;
        if (key === "quit") return done({ applied: null, icons: opts.icons });
        if (key === "up") move(state.index - 1);
        else if (key === "down") move(state.index + 1);
        else if (key === "pageup") move(state.index - 5);
        else if (key === "pagedown") move(state.index + 5);
        else if (key === "home") move(0);
        else if (key === "end") move(state.themes.length - 1);
        else if (key === "icons") state.icons = ICON_MODES[(ICON_MODES.indexOf(state.icons) + 1) % ICON_MODES.length];
        else if (key === "enter") {
          if (!state.themes[state.index]) return done({ applied: null, icons: opts.icons });
          const slug = state.themes[state.index].slug;
          try {
            if (opts.onApply) opts.onApply(slug, state.icons);
            return done({ applied: slug, icons: state.icons });
          } catch (error) {
            return done({ applied: null, icons: opts.icons, error });
          }
        }
      }
      draw();
    };

    try {
      input.setRawMode(true);
      input.resume();
      output.write(`${ESC}[?1049h${ESC}[?25l`);
      entered = true;
    } catch (error) {
      restore();
      return resolve({ applied: null, icons: opts.icons, error });
    }
    input.on("data", onData);
    input.on("end", onEnd);
    input.on("close", onEnd);
    output.on("resize", draw);
    process.on("exit", restore);
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
    process.on("SIGHUP", onSignal);
    process.on("uncaughtException", onCrash);
    draw();
  });
}
