import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { stripAnsi, visibleWidth } from "../src/colors.mjs";
import { ICON_MODES } from "../src/defaults.mjs";
import { buildFrame, previewLines, runPicker, tokenizeKeys } from "../src/picker.mjs";
import { listThemes } from "../src/themes.mjs";
import { cells } from "./helpers.mjs";

const NOW = Date.UTC(2026, 9, 3, 12, 0, 0);
const themes = listThemes();
const bySlug = (slug) => themes.findIndex((t) => t.slug === slug);
const state = (over = {}) => ({ themes, index: 0, icons: "unicode", applied: "synthwave-84", note: "enter writes glow.json and config.json", ...over });
const plain = (lines) => lines.map(stripAnsi);
const frame = (over, size) => buildFrame(state(over), { colorMode: "none", now: NOW, ...size });

// ---- keys

test("tokenizeKeys maps raw terminal input to key names", () => {
  assert.deepEqual(tokenizeKeys("\x1b[A"), ["up"]);
  assert.deepEqual(tokenizeKeys("\x1bOB"), ["down"]);
  assert.deepEqual(tokenizeKeys("jjk\r"), ["down", "down", "up", "enter"]);
  assert.deepEqual(tokenizeKeys("\n"), ["enter"]);
  assert.deepEqual(tokenizeKeys("\x1b[B\x1b[B\x1b[A"), ["down", "down", "up"]);
  assert.deepEqual(tokenizeKeys("q"), ["quit"]);
  assert.deepEqual(tokenizeKeys("Q"), ["quit"]);
  assert.deepEqual(tokenizeKeys("\x1b"), ["quit"], "a lone Esc quits");
  assert.deepEqual(tokenizeKeys("\x03"), ["quit"], "Ctrl+C");
  assert.deepEqual(tokenizeKeys("\x04"), ["quit"], "Ctrl+D");
  assert.deepEqual(tokenizeKeys("i"), ["icons"]);
  assert.deepEqual(tokenizeKeys("\x1b[5~\x1b[6~"), ["pageup", "pagedown"]);
  assert.deepEqual(tokenizeKeys("\x1b[H\x1b[F"), ["home", "end"]);
  assert.deepEqual(tokenizeKeys("gG"), ["home", "end"]);
  assert.deepEqual(tokenizeKeys("xyz 123"), [], "everything else is ignored");
  assert.deepEqual(tokenizeKeys(Buffer.from("j")), ["down"], "buffers work too");
  assert.deepEqual(tokenizeKeys(""), []);
  assert.deepEqual(tokenizeKeys("\x1b[1;5C"), [], "unknown sequences are swallowed whole, not misread as letters");
});

// ---- frames

const SIZES = [[240, 70], [200, 60], [160, 40], [120, 32], [120, 28], [120, 24], [100, 24], [96, 20], [95, 30], [80, 24], [70, 22], [60, 20], [50, 12], [44, 9], [43, 30], [30, 8], [20, 5], [10, 3], [44, 8], [3, 3]];

test("buildFrame fits every terminal size, color mode and selection", () => {
  for (const [cols, rows] of SIZES) for (const colorMode of ["truecolor", "256", "none"]) for (const index of [0, 1, 7, 13, 14]) for (const icons of ICON_MODES) {
    const lines = buildFrame(state({ index, icons }), { cols, rows, colorMode, now: NOW });
    assert.ok(Array.isArray(lines));
    assert.ok(lines.length <= Math.max(1, rows), `${cols}x${rows}: ${lines.length} lines`);
    for (const l of lines) {
      assert.equal(typeof l, "string");
      assert.ok(cells(l) <= Math.max(1, cols - 1), `${cols}x${rows} ${colorMode}: ${cells(l)} cells in ${JSON.stringify(stripAnsi(l))}`);
      assert.ok(!l.includes("\n") && !l.includes("\r"), "one terminal row per line");
    }
    if (colorMode === "none") assert.ok(!lines.join("").includes("\x1b"));
  }
});

test("buildFrame: the selected theme is always visible and marked", () => {
  for (const [cols, rows] of SIZES.filter(([c, r]) => c >= 44 && r >= 9)) for (let index = 0; index < themes.length; index++) {
    const lines = plain(buildFrame(state({ index }), { cols, rows, colorMode: "none", now: NOW }));
    assert.ok(lines.some((l) => l.includes(`▸ ${themes[index].name}`)), `${cols}x${rows}: "${themes[index].name}" selected and visible`);
  }
});

test("buildFrame: a big terminal shows the banner, the whole list, the live status line and the mock UI", () => {
  const lines = plain(frame({ index: bySlug("dracula") }, { cols: 120, rows: 32 }));
  const text = lines.join("\n");
  assert.ok(lines[0].includes("╔═╗╦  ╔═╗╦ ╦╔╦╗╔═╗  ╔═╗╦  ╔═╗╦ ╦"), "the CLAUDE GLOW banner");
  assert.match(text, /THEMES 2\/15/);
  for (const t of themes) assert.ok(text.includes(t.name), `${t.name} listed`);
  assert.equal((text.match(/■■■■■/g) || []).length, 15, "five swatches per theme");
  assert.match(text, /▸ Dracula/);
  assert.match(text, /Synthwave '84 +■■■■■ ✔/, "the applied theme carries a check");
  // the real status line, both lines
  assert.match(text, /◆ Sonnet 5\.5 · high/);
  assert.match(text, /nrzz\/claude-code-glow/);
  assert.match(text, /💡 Prompt cache cools in 3m/);
  // the mock Claude Code UI
  for (const needle of ["● Claude", "I'll tighten the retry loop", "Reading src/retry.ts", "const retries = 3;", "const retries = 5;", "return run(retries);", "✔ success", "⚠ warning", "✖ error", "plan mode", "accept edits", "! bash", "╭", "╰", "> fix the failing retry test", "? for shortcuts"]) {
    assert.ok(text.includes(needle), `mock UI shows ${needle}`);
  }
  // footer
  assert.match(lines.at(-2), /↑↓\/jk move {2}· {2}enter apply {2}· {2}i icons: unicode {2}· {2}q quit/);
  assert.match(lines.at(-1), /enter writes glow\.json and config\.json/);
  assert.equal(lines.length, 32, "uses the whole screen height");
});

test("buildFrame: shorter and narrower terminals degrade gracefully", () => {
  const small = plain(frame({}, { cols: 100, rows: 24 })).join("\n");
  assert.match(small, /CLAUDE GLOW/);
  assert.match(small, /╭/, "the prompt box survives");
  assert.match(small, /Sonnet 5\.5/);

  const stacked = plain(frame({ index: 9 }, { cols: 80, rows: 24 })).join("\n");
  assert.match(stacked, /THEMES 10\/15/);
  assert.match(stacked, /▸ One Dark/);
  assert.match(stacked, /Sonnet 5\.5/, "the status line preview is still there");

  const tiny = plain(frame({}, { cols: 44, rows: 9 }));
  assert.ok(tiny.length <= 9);
  assert.match(tiny.join("\n"), /▸ Synthwave '84/);

  const tooSmall = plain(frame({}, { cols: 30, rows: 8 }));
  assert.match(tooSmall.join("\n"), /Terminal too small/);
  assert.match(tooSmall.join("\n"), /claude-glow theme list/);
});

test("buildFrame: each theme is drawn in its own colors", () => {
  const dracula = themes[bySlug("dracula")].theme;
  const light = themes[bySlug("github-light")].theme;
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(";");
  const a = buildFrame(state({ index: bySlug("dracula") }), { cols: 120, rows: 32, colorMode: "truecolor", now: NOW }).join("\n");
  assert.ok(a.includes(`\x1b[48;2;${rgb(dracula.overrides.diffAdded)}m`), "diffAdded background");
  assert.ok(a.includes(`\x1b[48;2;${rgb(dracula.overrides.diffRemoved)}m`), "diffRemoved background");
  assert.ok(a.includes(`\x1b[48;2;${rgb(dracula.overrides.diffAddedWord)}m`), "changed-word highlight");
  assert.ok(a.includes(`\x1b[38;2;${rgb(dracula.overrides.promptBorder)}m`), "prompt border");
  assert.ok(a.includes(`\x1b[38;2;${rgb(dracula.overrides.claude)}m`), "Claude's color");
  for (const key of ["success", "warning", "error", "planMode", "autoAccept", "bashBorder"]) assert.ok(a.includes(`\x1b[38;2;${rgb(dracula.overrides[key])}m`), key);
  assert.ok(a.includes(`\x1b[48;2;${rgb(dracula.glow.bg)}m`), "the preview panel is painted in the theme's background");
  const b = buildFrame(state({ index: bySlug("github-light") }), { cols: 120, rows: 32, colorMode: "truecolor", now: NOW }).join("\n");
  assert.ok(b.includes(`\x1b[48;2;255;255;255m`), "a light theme paints a light panel");
  assert.ok(b.includes(`\x1b[48;2;${rgb(light.overrides.diffAdded)}m`));
});

test("buildFrame: the status-line-only theme draws the mock with Claude's stock colors", () => {
  const classic = plain(frame({ index: bySlug("classic") }, { cols: 120, rows: 32 })).join("\n");
  assert.match(classic, /▸ Classic/);
  assert.match(classic, /const retries = 5;/);
  const colored = buildFrame(state({ index: bySlug("classic") }), { cols: 120, rows: 32, colorMode: "truecolor", now: NOW }).join("\n");
  assert.ok(colored.includes("\x1b[38;2;215;119;87m"), "Claude orange #d77757");
});

test("buildFrame: the icons mode shows in the footer and changes the preview", () => {
  const ascii = plain(frame({ icons: "ascii" }, { cols: 120, rows: 32 })).join("\n");
  assert.match(ascii, /i icons: ascii/);
  assert.match(ascii, /Sonnet 5\.5 high \|/);
  assert.match(ascii, /tip: Prompt cache/);
  const nerd = plain(frame({ icons: "nerd" }, { cols: 120, rows: 32 })).join("\n");
  assert.match(nerd, /i icons: nerd/);
  assert.ok(nerd.includes(""));
});

test("buildFrame copes with odd state: no themes, a theme without colors, an out-of-range index", () => {
  for (const odd of [
    state({ themes: [], index: 0 }),
    state({ themes: [{ slug: "x", name: "X", theme: null }], index: 0 }),
    state({ themes: [{ slug: "x", name: "X", theme: {} }, { slug: "y", name: "Y", theme: { overrides: "no", glow: 5 } }], index: 1 }),
    state({ index: 99 }),
    state({ index: -3 }),
    state({ note: undefined }),
    state({ note: "n".repeat(500) }),
  ]) {
    for (const [cols, rows] of [[120, 32], [80, 24], [44, 9]]) {
      assert.doesNotThrow(() => buildFrame(odd, { cols, rows, colorMode: "truecolor", now: NOW }));
    }
  }
});

test("previewLines: exactly as wide as asked, never taller than asked", () => {
  const theme = themes[0].theme;
  for (const width of [30, 45, 60, 100, 200]) for (const height of [2, 4, 6, 8, 10, 14, 17, 30]) {
    const lines = previewLines(theme, { width, height, icons: "unicode", colorMode: "truecolor", now: NOW });
    assert.ok(lines.length <= height, `${width}x${height}: ${lines.length} lines`);
    assert.ok(lines.length >= 2 || height < 2);
    for (const l of lines) assert.equal(visibleWidth(l), width, `${width}x${height}`);
  }
  // when it is short, the least revealing blocks go first and the prompt box stays
  const short = plain(previewLines(theme, { width: 60, height: 9, icons: "unicode", colorMode: "none", now: NOW })).join("\n");
  assert.match(short, /╭/);
  assert.match(short, /Sonnet 5\.5/);
  assert.doesNotMatch(short, /● Claude/);
});

// ---- the interactive loop, on fake terminals

function fakeTerminal({ columns = 120, rows = 32 } = {}) {
  const input = new EventEmitter();
  Object.assign(input, { isTTY: true, rawMode: undefined, rawHistory: [], paused: true });
  input.setRawMode = (v) => { input.rawMode = v; input.rawHistory.push(v); };
  input.resume = () => { input.paused = false; };
  input.pause = () => { input.paused = true; };
  const output = new EventEmitter();
  Object.assign(output, { isTTY: true, columns, rows, writes: [] });
  output.write = (s) => { output.writes.push(String(s)); return true; };
  return { input, output, text: () => output.writes.join(""), press: (...keys) => keys.forEach((k) => input.emit("data", Buffer.from(k))) };
}
const PROCESS_EVENTS = ["exit", "SIGINT", "SIGTERM", "SIGHUP", "uncaughtException"];
const processListeners = () => PROCESS_EVENTS.map((e) => process.listenerCount(e));

// Everything the picker switched on must be off again, however it ended.
function assertRestored(term, baseline) {
  const text = term.text();
  assert.ok(text.includes("\x1b[?1049h"), "entered the alternate screen");
  assert.ok(text.indexOf("\x1b[?25h") > text.indexOf("\x1b[?25l"), "cursor hidden, then shown again");
  assert.ok(text.endsWith("\x1b[0m\x1b[?25h\x1b[?1049l"), "the last write leaves the alternate screen and shows the cursor");
  assert.deepEqual(term.input.rawHistory, [true, false], "raw mode on, then off");
  assert.equal(term.input.paused, true);
  for (const e of ["data", "end", "close"]) assert.equal(term.input.listenerCount(e), 0, `input ${e} listeners`);
  assert.equal(term.output.listenerCount("resize"), 0);
  assert.deepEqual(processListeners(), baseline, "process listeners are removed");
}

test("runPicker: down, down, enter applies the third theme and restores the terminal", async () => {
  const baseline = processListeners();
  const term = fakeTerminal();
  const applied = [];
  const done = runPicker({ themes, current: themes[0].slug, icons: "unicode", colorMode: "truecolor", input: term.input, output: term.output, onApply: (...a) => applied.push(a) });
  assert.equal(term.input.rawMode, true);
  assert.ok(term.text().startsWith("\x1b[?1049h\x1b[?25l"), "alternate screen on, cursor hidden, before anything is drawn");
  assert.ok(term.output.writes.length >= 2, "first frame drawn");
  assert.notDeepEqual(processListeners(), baseline, "exit/signal handlers installed while running");
  term.press("\x1b[B", "\x1b[B");
  assert.ok(stripAnsi(term.output.writes.at(-1)).includes(`▸ ${themes[2].name}`), "the frame follows the cursor");
  term.press("\r");
  const result = await done;
  assert.deepEqual(result, { applied: themes[2].slug, icons: "unicode" });
  assert.deepEqual(applied, [[themes[2].slug, "unicode"]]);
  assertRestored(term, baseline);
});

test("runPicker: several keys in one chunk, vim keys, clamping at both ends", async () => {
  const baseline = processListeners();
  let term = fakeTerminal();
  let done = runPicker({ themes, current: themes[0].slug, icons: "unicode", input: term.input, output: term.output });
  term.press("kkk", "jjj\r");
  assert.equal((await done).applied, themes[3].slug, "k at the top stays at the top, then three down");
  assertRestored(term, baseline);

  term = fakeTerminal();
  done = runPicker({ themes, current: themes[0].slug, icons: "unicode", input: term.input, output: term.output });
  term.press("j".repeat(40), "\r");
  assert.equal((await done).applied, themes.at(-1).slug, "clamped at the last theme");

  term = fakeTerminal();
  done = runPicker({ themes, current: themes[5].slug, icons: "unicode", input: term.input, output: term.output });
  term.press("\x1b[F", "\r");
  assert.equal((await done).applied, themes.at(-1).slug, "End");

  term = fakeTerminal();
  done = runPicker({ themes, current: themes[5].slug, icons: "unicode", input: term.input, output: term.output });
  term.press("\x1b[H", "\r");
  assert.equal((await done).applied, themes[0].slug, "Home");

  term = fakeTerminal();
  done = runPicker({ themes, current: themes[0].slug, icons: "unicode", input: term.input, output: term.output });
  term.press("\x1b[6~", "\r");
  assert.equal((await done).applied, themes[5].slug, "Page Down moves five");
});

test("runPicker starts on the current theme", async () => {
  const term = fakeTerminal();
  const done = runPicker({ themes, current: "nord", icons: "unicode", input: term.input, output: term.output });
  assert.ok(stripAnsi(term.output.writes.at(-1)).includes("▸ Nord"));
  term.press("\r");
  assert.equal((await done).applied, "nord");
  const unknown = fakeTerminal();
  const d2 = runPicker({ themes, current: "does-not-exist", icons: "unicode", input: unknown.input, output: unknown.output });
  unknown.press("\r");
  assert.equal((await d2).applied, themes[0].slug, "unknown current theme: start at the top");
});

test("runPicker: q, Q, Esc, Ctrl+C and Ctrl+D quit without applying", async () => {
  for (const key of ["q", "Q", "\x1b", "\x03", "\x04"]) {
    const baseline = processListeners();
    const term = fakeTerminal();
    let called = false;
    const done = runPicker({ themes, current: themes[0].slug, icons: "unicode", input: term.input, output: term.output, onApply: () => { called = true; } });
    term.press("j", key);
    const result = await done;
    assert.equal(result.applied, null, JSON.stringify(key));
    assert.equal(called, false);
    assertRestored(term, baseline);
  }
});

test("runPicker: i cycles the icon mode and Enter reports it", async () => {
  const term = fakeTerminal();
  const applied = [];
  const done = runPicker({ themes, current: themes[0].slug, icons: "unicode", input: term.input, output: term.output, onApply: (...a) => applied.push(a) });
  assert.ok(stripAnsi(term.output.writes.at(-1)).includes("icons: unicode"));
  term.press("i");
  assert.ok(stripAnsi(term.output.writes.at(-1)).includes("icons: ascii"));
  term.press("i");
  assert.ok(stripAnsi(term.output.writes.at(-1)).includes("icons: nerd"));
  term.press("i");
  assert.ok(stripAnsi(term.output.writes.at(-1)).includes("icons: unicode"), "wraps around");
  term.press("i", "\r");
  assert.deepEqual(await done, { applied: themes[0].slug, icons: "ascii" });
  assert.deepEqual(applied, [[themes[0].slug, "ascii"]]);
});

test("runPicker: quitting after changing icons reports the original icons (no change)", async () => {
  const term = fakeTerminal();
  const done = runPicker({ themes, current: themes[0].slug, icons: "nerd", input: term.input, output: term.output });
  term.press("i", "q");
  assert.deepEqual(await done, { applied: null, icons: "nerd" });
});

test("runPicker redraws on resize", async () => {
  const term = fakeTerminal({ columns: 120, rows: 32 });
  const done = runPicker({ themes, current: themes[0].slug, icons: "unicode", colorMode: "truecolor", input: term.input, output: term.output });
  const before = term.output.writes.length;
  term.output.columns = 80;
  term.output.rows = 24;
  term.output.emit("resize");
  assert.equal(term.output.writes.length, before + 1, "one redraw");
  const lines = term.output.writes.at(-1).split("\r\n");
  assert.ok(lines.length <= 24);
  for (const l of lines) assert.ok(cells(l) <= 79 + 4, "fits the new size (plus the erase codes)");
  term.output.columns = 50;
  term.output.rows = 12;
  term.output.emit("resize");
  assert.equal(term.output.writes.length, before + 2);
  term.press("q");
  await done;
  const afterQuit = term.output.writes.length;
  term.output.emit("resize");
  assert.equal(term.output.writes.length, afterQuit, "no drawing after the picker has ended");
});

test("runPicker: the frame is positioned at home and each line erases its tail", async () => {
  const term = fakeTerminal({ columns: 100, rows: 24 });
  const done = runPicker({ themes, current: themes[0].slug, icons: "unicode", colorMode: "truecolor", input: term.input, output: term.output });
  const frameWrite = term.output.writes.at(-1);
  assert.ok(frameWrite.startsWith("\x1b[H"));
  assert.ok(frameWrite.endsWith("\x1b[J"));
  const rows = frameWrite.slice(3, -3).split("\r\n");
  assert.equal(rows.length, 24);
  for (const r of rows) assert.ok(r.endsWith("\x1b[0m\x1b[K"), "reset and erase to end of line");
  term.press("q");
  await done;
});

test("runPicker: an onApply that throws still restores the terminal and reports the error", async () => {
  const baseline = processListeners();
  const term = fakeTerminal();
  const done = runPicker({ themes, current: themes[0].slug, icons: "unicode", input: term.input, output: term.output, onApply: () => { throw new Error("disk full"); } });
  term.press("\r");
  const result = await done;
  assert.equal(result.applied, null);
  assert.equal(result.error.message, "disk full");
  assertRestored(term, baseline);
});

test("runPicker: input that ends (terminal closed) quits cleanly", async () => {
  const baseline = processListeners();
  for (const event of ["end", "close"]) {
    const term = fakeTerminal();
    const done = runPicker({ themes, current: themes[0].slug, icons: "unicode", input: term.input, output: term.output });
    term.input.emit(event);
    assert.equal((await done).applied, null);
    assertRestored(term, baseline);
  }
});

test("runPicker: when raw mode is unavailable it fails without leaving the screen switched", async () => {
  const baseline = processListeners();
  const term = fakeTerminal();
  term.input.setRawMode = () => { throw new Error("not a tty"); };
  const result = await runPicker({ themes, current: themes[0].slug, icons: "unicode", input: term.input, output: term.output });
  assert.equal(result.applied, null);
  assert.equal(result.error.message, "not a tty");
  assert.equal(term.text(), "", "nothing was written to the terminal");
  assert.deepEqual(processListeners(), baseline);
});

test("runPicker survives frames that cannot be drawn", async () => {
  const term = fakeTerminal();
  term.output.write = function write(s) { this.writes.push(String(s)); if (this.writes.length === 2) throw new Error("EPIPE"); return true; };
  const done = runPicker({ themes, current: themes[0].slug, icons: "unicode", input: term.input, output: term.output });
  term.press("j", "\r");
  assert.equal((await done).applied, themes[1].slug);
});
