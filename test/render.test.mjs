import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeColors } from "../src/colors.mjs";
import { DROP_ORDER, render } from "../src/render.mjs";
import { sampleGit, sampleInput } from "../src/sample.mjs";
import { ROOT, cells } from "./helpers.mjs";

const NOW = Date.UTC(2026, 9, 3, 12, 0, 0);
const loadTheme = (slug) => JSON.parse(fs.readFileSync(path.join(ROOT, "themes", `glow-${slug}.json`), "utf8"));
const SYNTH = loadTheme("synthwave-84");
const ICON_MODES = ["nerd", "unicode", "ascii"];
const COLOR_MODES = ["truecolor", "256", "none"];
const ESC = "\x1b";

const full = () => sampleInput(NOW);
const config = (over = {}) => ({ theme: "synthwave-84", icons: "unicode", segments: ["model", "dir", "git", "context", "cost", "time", "limits", "cache"], tips: true, featureTips: true, ...over });
// plain unicode rendering of an input, with the sample git stub
const plain = (input, over = {}, opts = {}) => render(input, config(over), SYNTH, { colorMode: "none", now: NOW, git: sampleGit, ...opts });
const lines = (s) => s.split("\n");

// ---- the exact output, so format changes are deliberate

test("sample, unicode icons, no color: the exact two lines", () => {
  const [line1, line2, extra] = lines(plain(full()));
  assert.equal(line1, "◆ Sonnet 5.5 · high | ⌂ nrzz/claude-code-glow | ⎇ main* | ▰▰▰▱▱▱▱▱▱▱ 34% · 340K/1M | $1.84 | ◷ 42m | ◔ 5h 23% · 7d 41% | ↻ cache 91% · cold in 3m");
  assert.equal(line2, "💡 Prompt cache cools in 3m — reply soon or hand over; a cold restart re-writes all 340K tokens");
  assert.equal(extra, undefined, "two lines at most");
});

test("sample, ascii icons: only ASCII on line 1, `|` between segments, a tip: prefix", () => {
  const [line1, line2] = lines(plain(full(), { icons: "ascii" }));
  assert.equal(line1, "Sonnet 5.5 high | nrzz/claude-code-glow | main* | ctx [###-------] 34% 340K/1M | $1.84 | 42m | 5h 23% / 7d 41% | cache 91% cold in 3m");
  assert.match(line1, /^[\x20-\x7e]+$/);
  assert.equal(line2, "tip: Prompt cache cools in 3m - reply soon or hand over; a cold restart re-writes all 340K tokens");
  assert.match(line2, /^[\x20-\x7e]+$/, "the ascii tip has no unicode either");
});

test("sample, nerd icons", () => {
  const out = plain(full(), { icons: "nerd" });
  const [line1, line2] = lines(out);
  for (const glyph of ["\uf2db", "\uf07b", "\ue0a0", "\uf1c0", "\uf155", "\uf017", "\uf0e4", "\uf0e7"]) assert.ok(line1.includes(glyph), `glyph ${glyph.codePointAt(0).toString(16)}`);
  assert.ok(line1.includes("1.84") && !line1.includes("$1.84"), "the nerd icon is the dollar sign");
  assert.ok(line2.startsWith("💡 "));
});

// ---- layouts per color mode

test("colored unicode layout uses half-block chips; nerd uses powerline arrows; ascii uses neither", () => {
  const unicode = plain(full(), {}, { colorMode: "truecolor" });
  assert.ok(unicode.includes("▐") && unicode.includes("▌"));
  assert.ok(!unicode.includes("\ue0b0"));
  const nerd = plain(full(), { icons: "nerd" }, { colorMode: "truecolor" });
  assert.ok(nerd.includes("\ue0b0"));
  assert.ok(!nerd.includes("▐"));
  const ascii = plain(full(), { icons: "ascii" }, { colorMode: "truecolor" });
  assert.ok(!ascii.includes("▐") && !ascii.includes("\ue0b0"));
  assert.ok(ascii.includes(" | "));
});

test("chips: the model chip uses the accent, panels grade lighter", () => {
  const C = makeColors("truecolor");
  const [line1] = lines(plain(full(), {}, { colorMode: "truecolor" }));
  assert.ok(line1.startsWith(C.fg(SYNTH.glow.model.bg) + "▐" + C.bg(SYNTH.glow.model.bg) + C.fg(SYNTH.glow.model.fg)), "starts with the model chip");
  SYNTH.glow.panels.slice(0, 6).forEach((p) => assert.ok(line1.includes(C.bg(p)), `panel ${p}`));
  assert.ok(line1.endsWith(C.reset), "ends reset so nothing leaks");
});

test("color modes: truecolor / 256 / none", () => {
  const t = plain(full(), {}, { colorMode: "truecolor" });
  assert.match(t, /\x1b\[38;2;\d+;\d+;\d+m/);
  assert.match(t, /\x1b\[48;2;\d+;\d+;\d+m/);
  const x = plain(full(), {}, { colorMode: "256" });
  assert.match(x, /\x1b\[38;5;\d+m/);
  assert.match(x, /\x1b\[48;5;\d+m/);
  assert.doesNotMatch(x, /;2;\d+;\d+;\d+m/, "no 24-bit sequences in 256 mode");
  for (const icons of ICON_MODES) assert.ok(!plain(full(), { icons }, { colorMode: "none" }).includes(ESC), `${icons}: no escape sequence at all with NO_COLOR`);
  for (const code of [...x.matchAll(/\x1b\[(?:38|48);5;(\d+)m/g)].map((m) => Number(m[1]))) assert.ok(code >= 16 && code <= 255);
});

test("an unknown colorMode falls back to detecting from the environment", () => {
  const out = render(full(), config(), SYNTH, { colorMode: "bogus", now: NOW, git: false });
  assert.equal(typeof out, "string");
});

// ---- never throws

const HOSTILE_INPUTS = [
  undefined, null, 0, 42, "a string", true, [], [1, 2, 3], {},
  { model: null, workspace: null, cwd: null, cost: null, context_window: null, prompt_cache: null, rate_limits: null, effort: null, thinking: null, vim: null, agent: null, pr: null, worktree: null, output_style: null, fast_mode: null, exceeds_200k_tokens: null, version: null, session_id: null },
  { model: { id: null, display_name: null }, workspace: { current_dir: null, project_dir: null, repo: null, added_dirs: null }, cost: { total_cost_usd: null, total_duration_ms: null }, context_window: { used_percentage: null, current_usage: null, context_window_size: null }, prompt_cache: { warm: null, hit_ratio: null, expires_at: null, requests: null }, rate_limits: { five_hour: null, seven_day: null, spend_limit: null } },
  { model: "claude-x", cost: "1", context_window: "x", workspace: "y", rate_limits: [], prompt_cache: 5, effort: "high", vim: "NORMAL" },
  { model: [], workspace: [], cost: [], context_window: [], prompt_cache: [], rate_limits: [[]], effort: [] },
  { context_window: { used_percentage: 1e308, context_window_size: 1e308, current_usage: { input_tokens: 1e308, cache_creation_input_tokens: 1e308, cache_read_input_tokens: 1e308 } }, cost: { total_cost_usd: 1e308, total_duration_ms: 1e308 }, prompt_cache: { warm: true, hit_ratio: 1e308, expires_at: 1e308, requests: 1e308 }, rate_limits: { five_hour: { used_percentage: 1e308, resets_at: 1e308 }, seven_day: { used_percentage: Number.MAX_SAFE_INTEGER, resets_at: -1e308 }, spend_limit: { used_percentage: 1e308 } }, exceeds_200k_tokens: true },
  { context_window: { used_percentage: -1e308, context_window_size: -5 }, cost: { total_cost_usd: -1, total_duration_ms: -1 }, prompt_cache: { hit_ratio: -3, expires_at: -1 } },
  { context_window: { used_percentage: NaN, context_window_size: Infinity, current_usage: { input_tokens: NaN, cache_read_input_tokens: Infinity } }, cost: { total_cost_usd: Infinity, total_duration_ms: NaN }, prompt_cache: { hit_ratio: NaN, expires_at: Infinity }, rate_limits: { five_hour: { used_percentage: Infinity, resets_at: NaN } } },
  { model: { display_name: "x".repeat(5000) }, workspace: { current_dir: "a/".repeat(2000) + "end", repo: { owner: "o".repeat(300), name: "n".repeat(300) } }, worktree: { branch: "b".repeat(1000) } },
  { model: { display_name: "日本語モデル" }, cwd: "/home/ユーザー/プロジェクト", worktree: { branch: "機能/ブランチ" } },
  { model: { display_name: "\x1b[31mred\x1b[0m\x07\x00" }, vim: { mode: "\x1b[2J" }, effort: { level: "\x1b[2J" }, workspace: { current_dir: "/x/\x1b]0;pwn\x07dir" } },
  { rate_limits: { five_hour: { used_percentage: 95, resets_at: "not a date" }, seven_day: { used_percentage: 75, resets_at: {} } }, prompt_cache: { expires_at: "also not a date", warm: "yes" } },
  JSON.parse('{"a":{"b":{"c":{"d":{"e":{"f":{"g":[]}}}}}}}'),
];
const HOSTILE_CONFIGS = [undefined, null, {}, [], "x", { icons: "weird", segments: "model", tips: "no", theme: 5 }, { segments: ["nope", 5, null] }, { segments: [] }, { icons: "nerd", segments: ["cache", "limits", "git", "dir", "model", "context", "time", "cost"] }];
const HOSTILE_THEMES = [undefined, null, {}, [], "x", { glow: null }, { glow: "x" }, { glow: { panels: "x", model: 5, bg: 12, gradient: [1], swatches: {} } }, { glow: { panels: [], model: { bg: "red" }, bad: "#12" } }, SYNTH.glow];

test("render never throws, whatever it is given (inputs x icon modes x color modes x widths)", () => {
  let count = 0;
  for (const input of HOSTILE_INPUTS) {
    for (const icons of ICON_MODES) {
      for (const colorMode of COLOR_MODES) {
        for (const columns of [undefined, 1, 2, 7, 12, 40, 80, 200]) {
          const out = render(input, config({ icons }), SYNTH, { colorMode, columns, now: NOW, git: false });
          count++;
          assert.equal(typeof out, "string");
          assert.ok(lines(out).length <= 2, `at most two lines, got ${lines(out).length}`);
          assert.ok(lines(out)[0].length > 0, "line 1 is never empty");
          if (columns) for (const l of lines(out)) assert.ok(cells(l) <= columns, `width ${cells(l)} > ${columns}: ${JSON.stringify(l)}`);
          if (colorMode === "none") assert.ok(!out.includes(ESC));
        }
      }
    }
  }
  assert.ok(count > 1000);
});

test("render never throws on hostile configs and themes either", () => {
  for (const cfg of HOSTILE_CONFIGS) for (const theme of HOSTILE_THEMES) {
    for (const colorMode of COLOR_MODES) {
      const out = render(full(), cfg, theme, { colorMode, now: NOW, git: sampleGit, columns: 100 });
      assert.equal(typeof out, "string");
      assert.ok(lines(out).length <= 2);
      for (const l of lines(out)) assert.ok(cells(l) <= 100);
    }
  }
  assert.doesNotThrow(() => render());
  assert.doesNotThrow(() => render({}));
  assert.doesNotThrow(() => render({}, {}, {}, null));
  assert.doesNotThrow(() => render({}, {}, {}, { now: "yesterday", columns: "wide", git: 5 }));
});

test("render({}) is a minimal but sensible line", () => {
  assert.equal(lines(plain({}))[0], "◆ Claude");
  assert.equal(lines(plain({}, { tips: false })).length, 1);
  assert.equal(plain(null, { tips: false }), "◆ Claude");
});

test("a git provider that throws does not take the status line down", () => {
  const out = render(full(), config({ tips: false }), SYNTH, { colorMode: "none", now: NOW, git: () => { throw new Error("boom"); } });
  assert.ok(out.includes("Sonnet 5.5"));
  assert.ok(!out.includes("main"));
});

// ---- width

test("visible width never exceeds the columns (emoji counted as two cells)", () => {
  const inputs = [full(), HOSTILE_INPUTS[HOSTILE_INPUTS.length - 5], { ...full(), model: { display_name: "Opus 4.8 with an unreasonably long display name for a model" } }];
  for (const input of inputs) for (const icons of ICON_MODES) for (const colorMode of COLOR_MODES) {
    for (let columns = 5; columns <= 260; columns += 7) {
      const out = render(input, config({ icons }), SYNTH, { colorMode, columns, now: NOW, git: sampleGit });
      for (const l of lines(out)) assert.ok(cells(l) <= columns, `${icons}/${colorMode}/${columns}: ${cells(l)} cells: ${JSON.stringify(l)}`);
    }
  }
});

test("without columns nothing is truncated", () => {
  const out = plain(full());
  assert.ok(!out.includes("…"));
  assert.ok(cells(lines(out)[0]) > 100);
});

test("segments drop in order: cache, limits, time, cost, git, and the rest stay", () => {
  assert.deepEqual(DROP_ORDER, ["cache", "limits", "time", "cost", "git"]);
  const marks = { cache: "cache 91%", limits: "5h 23%", time: "42m", cost: "$1.84", git: "main" };
  const keep = { model: "Sonnet 5.5", dir: "nrzz/claude-code-glow", context: "ctx [" };
  const fullLine = lines(plain(full(), { icons: "ascii", tips: false }))[0];
  for (let columns = cells(fullLine); columns >= 80; columns--) {
    const line = lines(plain(full(), { icons: "ascii", tips: false }, { columns }))[0];
    const present = DROP_ORDER.map((id) => line.includes(marks[id]));
    for (let i = 0; i < DROP_ORDER.length; i++) for (let j = i + 1; j < DROP_ORDER.length; j++) {
      // a segment that is dropped later (more important) can only be gone if every earlier one is gone too
      if (!present[j]) assert.ok(!present[i], `${DROP_ORDER[j]} dropped before ${DROP_ORDER[i]} at ${columns} columns`);
    }
    for (const text of Object.values(keep)) assert.ok(line.includes(text), `${text} kept at ${columns} columns`);
  }
  const at100 = lines(plain(full(), { icons: "ascii", tips: false }, { columns: 100 }))[0];
  assert.ok(!at100.includes(marks.cache) && !at100.includes(marks.limits), "cache and limits go first");
  assert.ok(at100.includes(marks.cost) || at100.includes(marks.time) || at100.includes(marks.git));
});

test("a long folder name is shortened with an ellipsis before the line is cut", () => {
  const input = { ...full(), workspace: { current_dir: "/x/" + "very-long-directory-name-".repeat(3), repo: null } };
  const line = lines(plain(input, { icons: "ascii", tips: false, segments: ["model", "dir", "context"] }, { columns: 70 }))[0];
  assert.ok(cells(line) <= 70);
  assert.ok(line.includes("…"));
  assert.ok(line.includes("ctx ["), "the context meter survives");
});

// ---- segments

test("segments without data are skipped", () => {
  const input = full();
  delete input.cost;
  delete input.prompt_cache;
  delete input.rate_limits;
  const line = lines(plain(input, { tips: false }))[0];
  assert.ok(!line.includes("$") && !line.includes("42m") && !line.includes("cache") && !line.includes("5h"));
  assert.ok(line.includes("Sonnet 5.5") && line.includes("34%"));
});

test("config.segments chooses and orders the segments", () => {
  const line = lines(plain(full(), { icons: "ascii", tips: false, segments: ["cost", "model"] }))[0];
  assert.equal(line, "$1.84 | Sonnet 5.5 high");
  assert.equal(lines(plain(full(), { icons: "ascii", tips: false, segments: ["dir"] }))[0], "nrzz/claude-code-glow");
});

test("model segment: effort, fast mode, vim mode, context-size suffix", () => {
  const line = (input, icons = "unicode") => lines(plain(input, { icons, tips: false, segments: ["model"] }))[0];
  assert.equal(line({ model: { display_name: "Opus 4.8" }, effort: { level: "xhigh" }, fast_mode: true, vim: { mode: "NORMAL" } }), "◆ Opus 4.8 · xhigh ⚡fast vim:N");
  assert.equal(line({ model: { display_name: "Opus 4.8" }, effort: { level: "xhigh" }, fast_mode: true, vim: { mode: "VISUAL LINE" } }, "ascii"), "Opus 4.8 xhigh fast vim:VL");
  assert.equal(line({ model: { display_name: "Opus 4.7 (1M context)" } }), "◆ Opus 4.7 1M");
  assert.equal(line({ model: { id: "claude-haiku-4-5" } }), "◆ claude-haiku-4-5");
  assert.equal(line({ model: "claude-sonnet" }), "◆ claude-sonnet");
  assert.equal(line({}), "◆ Claude");
  assert.equal(line({ fast_mode: false, model: { display_name: "X" } }), "◆ X");
});

test("dir segment: repo owner/name, subfolders, plain folder, windows paths", () => {
  const dir = (input) => lines(plain(input, { icons: "unicode", tips: false, segments: ["dir"] }))[0];
  assert.equal(dir({ workspace: { current_dir: "/work/claude-code-glow", repo: { owner: "nrzz", name: "claude-code-glow" } } }), "⌂ nrzz/claude-code-glow");
  assert.equal(dir({ workspace: { current_dir: "/work/claude-code-glow/src/deep", repo: { owner: "nrzz", name: "claude-code-glow" } } }), "⌂ nrzz/claude-code-glow › deep");
  assert.equal(lines(plain({ workspace: { current_dir: "/a/b", repo: { owner: "o", name: "n" } } }, { icons: "ascii", tips: false, segments: ["dir"] }))[0], "o/n > b");
  assert.equal(dir({ workspace: { current_dir: "/home/dev/proj" } }), "⌂ proj");
  assert.equal(dir({ cwd: "C:\\Users\\dev\\proj" }), "⌂ proj");
  assert.equal(dir({ workspace: { project_dir: "/p/only-project" } }), "⌂ only-project");
  assert.equal(dir({}), "Claude", "no folder at all: the bare fallback line");
});

test("git segment: branch, dirty marker, detached, worktree fallback, switched off", () => {
  const seen = [];
  const git = (info) => (dir) => { seen.push(dir); return info; };
  const line = (input, opts, over = {}) => lines(render(input, config({ tips: false, segments: ["git"], ...over }), SYNTH, { colorMode: "none", now: NOW, ...opts }))[0];
  const input = { cwd: "/repo/dir", workspace: { current_dir: "/repo/dir/sub" } };
  assert.equal(line(input, { git: git({ branch: "feature/x", dirty: false }) }), "⎇ feature/x");
  assert.deepEqual(seen, ["/repo/dir/sub"], "asked about the workspace folder");
  assert.equal(line(input, { git: git({ branch: "main", dirty: true }) }), "⎇ main*");
  assert.equal(line(input, { git: git({ branch: "main", dirty: null }) }), "⎇ main", "unknown dirtiness shows nothing");
  assert.equal(line(input, { git: git({ branch: "a1b2c3d", detached: true }) }), "⎇ a1b2c3d");
  assert.equal(line(input, { git: git(null) }), "Claude", "not a repository: no segment");
  assert.equal(line({ ...input, worktree: { name: "wt", branch: "wt-branch" } }, { git: git(null) }), "⎇ wt-branch", "falls back to the worktree branch");
  assert.equal(line(input, { git: false }), "Claude", "git: false switches the lookup off");
  assert.equal(lines(plain(input, { segments: ["git"], tips: false }, { git: git({ branch: "main", dirty: true }) }))[0], "⎇ main*");
});

test("context segment: bar, percentage, tokens; computed percentage; omitted without data", () => {
  const ctx = (input) => lines(plain(input, { tips: false, segments: ["context"] }))[0];
  assert.equal(ctx({ context_window: { used_percentage: 0, context_window_size: 1e6 } }), "▱▱▱▱▱▱▱▱▱▱ 0%");
  assert.equal(ctx({ context_window: { used_percentage: 3, context_window_size: 1e6 } }), "▰▱▱▱▱▱▱▱▱▱ 3% · 30K/1M", "any use shows at least one cell");
  assert.equal(ctx({ context_window: { used_percentage: 50, context_window_size: 200000 } }), "▰▰▰▰▰▱▱▱▱▱ 50% · 100K/200K");
  assert.equal(ctx({ context_window: { used_percentage: 100, context_window_size: 1e6 } }), "▰▰▰▰▰▰▰▰▰▰ 100% · 1M/1M");
  assert.equal(ctx({ context_window: { used_percentage: 340, context_window_size: 1e6 } }), "▰▰▰▰▰▰▰▰▰▰ 340% · 3.4M/1M", "the bar caps, the number is honest");
  assert.equal(ctx({ context_window: { context_window_size: 200000, current_usage: { input_tokens: 20000, cache_creation_input_tokens: 0, cache_read_input_tokens: 80000 } } }), "▰▰▰▰▰▱▱▱▱▱ 50% · 100K/200K", "computed from current_usage");
  assert.equal(ctx({ context_window: { used_percentage: 41 } }), "▰▰▰▰▱▱▱▱▱▱ 41%", "no window size: percentage only");
  assert.equal(ctx({ context_window: {} }), "Claude");
  assert.equal(ctx({}), "Claude");
});

test("context bar color turns ok -> warn -> bad at 50% and 75%", () => {
  const C = makeColors("truecolor");
  const bar = (pct) => render({ context_window: { used_percentage: pct, context_window_size: 1e6 } }, config({ tips: false, segments: ["context"] }), SYNTH, { colorMode: "truecolor", now: NOW, git: false });
  const state = (pct) => {
    const out = bar(pct);
    return ["ok", "warn", "bad"].filter((k) => out.includes(C.fg(SYNTH.glow[k]) + "▰"));
  };
  assert.deepEqual(state(10), ["ok"]);
  assert.deepEqual(state(49), ["ok"]);
  assert.deepEqual(state(50), ["warn"]);
  assert.deepEqual(state(74), ["warn"]);
  assert.deepEqual(state(75), ["bad"]);
  assert.deepEqual(state(99), ["bad"]);
  assert.ok(bar(60).includes(C.fg(SYNTH.glow.warn) + " 60%"), "the percentage takes the state color too");
});

test("cost and time segments", () => {
  const seg = (input, id) => lines(plain(input, { tips: false, segments: [id] }))[0];
  assert.equal(seg({ cost: { total_cost_usd: 12.3456 } }, "cost"), "$12.35");
  assert.equal(seg({ cost: { total_cost_usd: 0 } }, "cost"), "$0.00");
  assert.equal(seg({ cost: { total_duration_ms: 42 * 60000 } }, "time"), "◷ 42m");
  assert.equal(seg({ cost: { total_duration_ms: 90 * 60000 } }, "time"), "◷ 1h30m");
  assert.equal(seg({ cost: { total_duration_ms: 5000 } }, "time"), "◷ <1m");
  assert.equal(seg({ cost: {} }, "cost"), "Claude");
});

test("limits segment: shown only with rate_limits; warn from 70%, bad from 90%", () => {
  const C = makeColors("truecolor");
  const out = (five, seven) => render({ rate_limits: { five_hour: { used_percentage: five }, seven_day: { used_percentage: seven } } }, config({ tips: false, segments: ["limits"] }), SYNTH, { colorMode: "truecolor", now: NOW, git: false });
  assert.equal(lines(plain({ rate_limits: { five_hour: { used_percentage: 23 }, seven_day: { used_percentage: 41 } } }, { tips: false, segments: ["limits"] }))[0], "◔ 5h 23% · 7d 41%");
  assert.equal(lines(plain({ rate_limits: { five_hour: { used_percentage: 23.6 } } }, { tips: false, segments: ["limits"] }))[0], "◔ 5h 24%", "only the windows that exist");
  assert.equal(lines(plain({ rate_limits: { five_hour: { used_percentage: 23 }, seven_day: { used_percentage: 41 }, spend_limit: { used_percentage: 7 } } }, { tips: false, segments: ["limits"] }))[0], "◔ 5h 23% · 7d 41% · spend 7%");
  assert.equal(lines(plain({}, { tips: false, segments: ["limits"] }))[0], "Claude");
  const a = out(69, 70);
  assert.ok(!a.includes(C.fg(SYNTH.glow.warn) + "69%"), "69 is not warn");
  assert.ok(a.includes(C.fg(SYNTH.glow.warn) + "70%"), "70 is warn");
  const b = out(89, 90);
  assert.ok(b.includes(C.fg(SYNTH.glow.warn) + "89%"));
  assert.ok(b.includes(C.fg(SYNTH.glow.bad) + "90%"), "90 is bad");
  assert.ok(!out(10, 20).includes(C.fg(SYNTH.glow.warn) + "10%") && !out(10, 20).includes(C.fg(SYNTH.glow.bad) + "10%"));
});

test("cache segment: hit ratio, countdown inside five minutes, cold", () => {
  const seg = (pc, now = NOW) => lines(render({ prompt_cache: pc }, config({ tips: false, segments: ["cache"] }), SYNTH, { colorMode: "none", now, git: false }))[0];
  const sec = NOW / 1000;
  assert.equal(seg({ hit_ratio: 0.91 }), "↻ cache 91%");
  assert.equal(seg({ hit_ratio: 91 }), "↻ cache 91%", "a ratio already in percent");
  assert.equal(seg({ hit_ratio: 0.5, warm: true, expires_at: sec + 600 }), "↻ cache 50%", "more than five minutes left: no countdown");
  assert.equal(seg({ hit_ratio: 0.91, warm: true, expires_at: sec + 180 }), "↻ cache 91% · cold in 3m");
  assert.equal(seg({ hit_ratio: 0.91, warm: true, expires_at: sec + 300 }), "↻ cache 91% · cold in 5m");
  assert.equal(seg({ hit_ratio: 0.91, warm: true, expires_at: sec + 40 }), "↻ cache 91% · cold in 40s");
  assert.equal(seg({ hit_ratio: 0.4, warm: false, requests: 6 }), "↻ cache 40% · cold");
  assert.equal(seg({ hit_ratio: 0.4, warm: true, expires_at: sec - 10 }), "↻ cache 40% · cold", "expired");
  assert.equal(seg({ warm: false, requests: 0 }), "Claude", "nothing to say yet");
  assert.equal(seg({ expires_at: sec + 120, warm: true }), "↻ cache · cold in 2m");
  assert.equal(seg({}), "Claude");
});

test("control characters in data cannot inject escape sequences", () => {
  const input = { model: { display_name: "Op\x1b[31mus\x07" }, workspace: { current_dir: "/x/\x1b]0;pwn\x07dir" }, worktree: { branch: "br\x1b[2Jx" }, effort: { level: "hi\x1bgh" } };
  const out = render(input, config({ tips: false }), SYNTH, { colorMode: "none", now: NOW, git: false });
  assert.ok(!out.includes(ESC) && !out.includes("\x07"), JSON.stringify(out));
  assert.ok(out.includes("dir"));
});

// ---- tip line

test("the tip line: on by default, off with tips:false, feature tips switchable", () => {
  assert.equal(lines(plain(full())).length, 2);
  assert.equal(lines(plain(full(), { tips: false })).length, 1);
  const calm = { ...full(), prompt_cache: undefined };
  assert.equal(lines(plain(calm)).length, 2);
  assert.equal(lines(plain(calm, { featureTips: false })).length, 1, "nothing urgent and feature tips off: no line 2");
  const urgent = { ...calm, context_window: { used_percentage: 90, context_window_size: 1e6 } };
  assert.match(lines(plain(urgent, { featureTips: false }))[1], /Context 90% full/);
  assert.match(lines(plain(urgent, { featureTips: true }))[1], /Context 90% full/);
});

test("the tip is cut to the width and never wraps", () => {
  const out = plain(full(), {}, { columns: 40 });
  const l2 = lines(out)[1];
  assert.ok(cells(l2) <= 40);
  assert.ok(l2.endsWith("…"));
});

test("the same input gives the same output (no hidden clock)", () => {
  assert.equal(plain(full()), plain(full()));
  const later = render(full(), config(), SYNTH, { colorMode: "none", now: NOW + 120000, git: sampleGit });
  assert.ok(later.includes("cache 91% · cold in 1m"), "a later `now` moves the countdown");
  assert.ok(later.includes("cools in 1m"), "and the tip");
  const expired = render(full(), config(), SYNTH, { colorMode: "none", now: NOW + 240000, git: sampleGit });
  assert.ok(expired.includes("cache 91% · cold") && !expired.includes("cold in"), "expired: plain cold");
});

// ---- themes

test("every shipped theme renders in every mode within 100 columns", () => {
  for (const f of fs.readdirSync(path.join(ROOT, "themes"))) {
    const theme = JSON.parse(fs.readFileSync(path.join(ROOT, "themes", f), "utf8"));
    for (const icons of ICON_MODES) for (const colorMode of COLOR_MODES) {
      const out = render(full(), config({ icons }), theme, { colorMode, columns: 100, now: NOW, git: sampleGit });
      for (const l of lines(out)) assert.ok(cells(l) <= 100, `${f} ${icons} ${colorMode}`);
    }
  }
});

test("the theme's colors reach the output", () => {
  const dracula = loadTheme("dracula");
  const C = makeColors("truecolor");
  const out = render(full(), config(), dracula, { colorMode: "truecolor", now: NOW, git: sampleGit });
  assert.ok(out.includes(C.bg(dracula.glow.model.bg)), "model chip color");
  assert.ok(out.includes(C.fg(dracula.glow.tip)), "tip color");
  assert.ok(!out.includes(C.bg(SYNTH.glow.model.bg)), "and not another theme's");
  // the theme object may also be passed as the bare glow palette
  assert.ok(render(full(), config(), dracula.glow, { colorMode: "truecolor", now: NOW, git: sampleGit }).includes(C.bg(dracula.glow.model.bg)));
});
