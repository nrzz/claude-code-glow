import test from "node:test";
import assert from "node:assert/strict";
import {
  charWidth, cliColorMode, detectColorMode, makeColors, padEndVisible, stripAnsi, to256, truncate, visibleWidth, wrapText,
} from "../src/colors.mjs";
import { gradientColors, gradientText, BANNER_ROWS, bannerLines } from "../src/ui.mjs";
import {
  baseName, cacheInfo, clean, contextInfo, epochSeconds, formatClock, formatCountdown, formatDuration, formatMoney,
  formatTokens, limitsInfo,
} from "../src/metrics.mjs";

// ---- color mode

test("detectColorMode: truecolor by default", () => {
  assert.equal(detectColorMode({}), "truecolor");
  assert.equal(detectColorMode({ TERM_PROGRAM: "iTerm.app" }), "truecolor");
});

test("detectColorMode: 256 for Apple Terminal and GLOW_COLOR=256", () => {
  assert.equal(detectColorMode({ TERM_PROGRAM: "Apple_Terminal" }), "256");
  assert.equal(detectColorMode({ GLOW_COLOR: "256" }), "256");
  assert.equal(detectColorMode({ GLOW_COLOR: "truecolor", TERM_PROGRAM: "Apple_Terminal" }), "truecolor", "explicit override wins");
});

test("detectColorMode: none for NO_COLOR and GLOW_COLOR=0", () => {
  assert.equal(detectColorMode({ NO_COLOR: "1" }), "none");
  assert.equal(detectColorMode({ GLOW_COLOR: "0" }), "none");
  assert.equal(detectColorMode({ NO_COLOR: "1", GLOW_COLOR: "256" }), "none", "NO_COLOR always wins");
  assert.equal(detectColorMode({ NO_COLOR: "" }), "truecolor", "an empty NO_COLOR does not count (no-color.org)");
});

test("cliColorMode: plain when piped unless color is asked for", () => {
  assert.equal(cliColorMode({ isTTY: false }, {}), "none");
  assert.equal(cliColorMode({ isTTY: true }, {}), "truecolor");
  assert.equal(cliColorMode({ isTTY: false }, { FORCE_COLOR: "1" }), "truecolor");
  assert.equal(cliColorMode({ isTTY: false }, { GLOW_COLOR: "256" }), "256");
  assert.equal(cliColorMode({ isTTY: true }, { NO_COLOR: "1" }), "none");
});

// ---- escape sequences

test("makeColors: truecolor sequences", () => {
  const C = makeColors("truecolor");
  assert.equal(C.fg("#ff7edb"), "\x1b[38;2;255;126;219m");
  assert.equal(C.bg("#262335"), "\x1b[48;2;38;35;53m");
  assert.equal(C.reset, "\x1b[0m");
  assert.equal(C.paint("hi", "#ffffff"), "\x1b[38;2;255;255;255mhi\x1b[0m");
  assert.equal(C.fg("not a color"), "", "bad colors never produce garbage escapes");
});

test("makeColors: 256 sequences use the xterm palette", () => {
  const C = makeColors("256");
  assert.equal(C.fg("#ff0000"), "\x1b[38;5;196m");
  assert.equal(C.bg("#000000"), "\x1b[48;5;16m");
  assert.doesNotMatch(C.fg("#123456"), /;2;/);
});

test("makeColors: none emits nothing at all", () => {
  const C = makeColors("none");
  for (const s of [C.fg("#ff0000"), C.bg("#ff0000"), C.reset, C.bold, C.boldOff, C.fgDefault, C.bgDefault]) assert.equal(s, "");
  assert.equal(C.paint("plain", "#ff0000", "#00ff00"), "plain");
});

test("to256 picks the nearest cube color or grey", () => {
  assert.equal(to256([0, 0, 0]), 16);
  assert.equal(to256([255, 255, 255]), 231);
  assert.equal(to256([255, 0, 0]), 196);
  assert.equal(to256([0, 255, 0]), 46);
  assert.equal(to256([0, 0, 255]), 21);
  assert.equal(to256([128, 128, 128]), 244, "a mid grey lands on the grey ramp");
  assert.equal(to256([95, 135, 175]), 67, "an exact cube color maps exactly");
  for (let i = 0; i < 50; i++) {
    const n = to256([Math.random() * 255, Math.random() * 255, Math.random() * 255].map(Math.round));
    assert.ok(n >= 16 && n <= 255);
  }
});

// ---- width and truncation

test("charWidth and visibleWidth", () => {
  assert.equal(charWidth("a".codePointAt(0)), 1);
  assert.equal(charWidth("⚡".codePointAt(0)), 2);
  assert.equal(charWidth("💡".codePointAt(0)), 2);
  assert.equal(charWidth("日".codePointAt(0)), 2);
  assert.equal(charWidth(0x301), 0, "combining accent");
  assert.equal(charWidth(0x200d), 0, "zero width joiner");
  assert.equal(charWidth(0x1b), 0, "control");
  assert.equal(visibleWidth("abc"), 3);
  assert.equal(visibleWidth("💡 tip"), 6);
  assert.equal(visibleWidth("\x1b[38;2;255;0;0mred\x1b[0m"), 3);
  assert.equal(visibleWidth("\x1b]8;;https://example.com\x07link\x1b]8;;\x07"), 4, "OSC 8 hyperlinks are invisible");
  assert.equal(visibleWidth("▐ ◆ ▌"), 5, "box and geometric glyphs are single width");
  assert.equal(visibleWidth(""), 0);
});

test("stripAnsi removes CSI and OSC sequences", () => {
  assert.equal(stripAnsi("\x1b[1m\x1b[38;5;196mX\x1b[0m"), "X");
  assert.equal(stripAnsi("a\x1b[Kb"), "ab");
  assert.equal(stripAnsi("\x1b]0;title\x07text"), "text");
});

test("truncate: fits -> unchanged; else cut with an ellipsis within the width", () => {
  assert.equal(truncate("hello", 10), "hello");
  assert.equal(truncate("hello", 5), "hello");
  assert.equal(truncate("hello world", 8), "hello w…");
  assert.equal(visibleWidth(truncate("hello world", 8)), 8);
  assert.equal(truncate("anything", 0), "");
  assert.equal(truncate("日本語のテキスト", 7), "日本語…");
  const colored = "\x1b[31mred text that is long\x1b[0m";
  const cut = truncate(colored, 9);
  assert.equal(visibleWidth(cut), 9);
  assert.ok(cut.startsWith("\x1b[31m"), "keeps the opening escape");
  assert.ok(cut.includes("\x1b[0m"), "resets so color cannot leak");
  assert.ok(visibleWidth(truncate("💡💡💡💡💡", 5)) <= 5, "wide characters are never split over the limit");
});

test("padEndVisible and wrapText", () => {
  assert.equal(padEndVisible("ab", 5), "ab   ");
  assert.equal(visibleWidth(padEndVisible("\x1b[31mab\x1b[0m", 5)), 5);
  assert.equal(padEndVisible("abcdef", 3), "abcdef");
  assert.deepEqual(wrapText("the quick brown fox jumps", 10), ["the quick", "brown fox", "jumps"]);
  assert.deepEqual(wrapText("", 10), []);
  assert.deepEqual(wrapText("supercalifragilistic", 5), ["supercalifragilistic"], "a long word is not broken");
});

// ---- gradient and banner

test("gradientColors spreads evenly and hits the stops", () => {
  assert.deepEqual(gradientColors(["#000000", "#ffffff"], 3), ["#000000", "#808080", "#ffffff"]);
  assert.deepEqual(gradientColors(["#ff0000", "#00ff00", "#0000ff"], 5), ["#ff0000", "#808000", "#00ff00", "#008080", "#0000ff"]);
  assert.deepEqual(gradientColors(["#123456", "#abcdef"], 1), ["#123456"]);
  assert.equal(gradientColors(["#000000", "#ffffff"], 10).length, 10);
});

test("the banner rows are equally wide and gradientText keeps the text", () => {
  const widths = new Set(BANNER_ROWS.map((r) => [...r].length));
  assert.equal(widths.size, 1);
  assert.equal([...widths][0], 32);
  const C = makeColors("truecolor");
  assert.equal(stripAnsi(gradientText("CLAUDE GLOW", ["#ff0000", "#0000ff"], C)), "CLAUDE GLOW");
  const lines = bannerLines(["#ff0000", "#0000ff"], C);
  assert.equal(lines.length, 3);
  lines.forEach((l, i) => assert.equal(stripAnsi(l), BANNER_ROWS[i]));
  assert.equal(gradientText("abc", ["#ff0000", "#0000ff"], makeColors("none")), "abc");
});

// ---- metrics

test("formatTokens", () => {
  const cases = [[0, "0"], [-5, "0"], [NaN, "0"], [7, "7"], [999, "999"], [1000, "1K"], [1500, "1.5K"], [9960, "10K"], [12345, "12K"],
    [340000, "340K"], [999499, "999K"], [999999, "1M"], [1e6, "1M"], [1.2e6, "1.2M"], [12.6e6, "13M"], [1e9, "1B"], [1e12, "999B+"], [Infinity, "0"]];
  for (const [n, want] of cases) assert.equal(formatTokens(n), want, String(n));
  assert.equal(formatTokens("340000"), "340K", "numeric strings are accepted");
});

test("formatDuration", () => {
  assert.equal(formatDuration(0), "<1m");
  assert.equal(formatDuration(59999), "<1m");
  assert.equal(formatDuration(60000), "1m");
  assert.equal(formatDuration(42 * 60000), "42m");
  assert.equal(formatDuration(125 * 60000), "2h05m");
  assert.equal(formatDuration(27 * 3600000), "1d3h");
  assert.equal(formatDuration(-1), "");
  assert.equal(formatDuration(null), "");
  assert.equal(formatDuration("x"), "");
  assert.equal(formatDuration(Number.MAX_SAFE_INTEGER).endsWith("h"), true);
});

test("formatMoney", () => {
  assert.equal(formatMoney(1.234), "$1.23");
  assert.equal(formatMoney(0), "$0.00");
  assert.equal(formatMoney(0.005), "$0.01");
  assert.equal(formatMoney(12345), "$12K");
  assert.equal(formatMoney(null), "");
  assert.equal(formatMoney(-1), "");
  assert.equal(formatMoney("3"), "");
});

test("formatCountdown", () => {
  assert.equal(formatCountdown(180), "3m");
  assert.equal(formatCountdown(125), "3m");
  assert.equal(formatCountdown(60), "1m");
  assert.equal(formatCountdown(59), "59s");
  assert.equal(formatCountdown(-5), "0s");
});

test("epochSeconds accepts seconds, milliseconds and ISO strings", () => {
  assert.equal(epochSeconds(1700000000), 1700000000);
  assert.equal(epochSeconds(1700000000000), 1700000000);
  assert.equal(epochSeconds("2026-10-03T12:00:00Z"), Date.UTC(2026, 9, 3, 12) / 1000);
  assert.equal(epochSeconds("nope"), null);
  assert.equal(epochSeconds(null), null);
  assert.equal(epochSeconds({}), null);
});

test("formatClock: same day -> HH:MM, another day -> weekday + HH:MM (local time)", () => {
  const now = new Date(2026, 9, 3, 10, 0, 0).getTime();
  const sameDay = new Date(2026, 9, 3, 14, 30, 0).getTime() / 1000;
  const nextDay = new Date(2026, 9, 5, 9, 5, 0).getTime() / 1000;
  assert.equal(formatClock(sameDay, now), "14:30");
  assert.match(formatClock(nextDay, now), /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) 09:05$/);
  assert.equal(formatClock(undefined, now), "");
});

test("baseName handles unix, windows and trailing separators", () => {
  assert.equal(baseName("/home/dev/proj"), "proj");
  assert.equal(baseName("C:\\Users\\dev\\proj\\"), "proj");
  assert.equal(baseName("C:/Users/dev/proj/"), "proj");
  assert.equal(baseName("/"), "");
  assert.equal(baseName(null), "");
  assert.equal(baseName(42), "42");
});

test("clean strips control characters", () => {
  assert.equal(clean("a\x1b[31mb\x07c"), "a [31mb c");
  assert.equal(clean(null), "");
  assert.equal(clean("  x  "), "x");
});

test("contextInfo: given percentage, computed percentage, nothing", () => {
  assert.deepEqual(contextInfo({ context_window: { used_percentage: 34, context_window_size: 1e6, current_usage: { input_tokens: 4200, cache_creation_input_tokens: 5800, cache_read_input_tokens: 330000 } } }), { pct: 34, used: 340000, size: 1e6 });
  const computed = contextInfo({ context_window: { context_window_size: 200000, current_usage: { input_tokens: 10000, cache_creation_input_tokens: 20000, cache_read_input_tokens: 70000 } } });
  assert.equal(computed.pct, 50);
  assert.equal(computed.used, 100000);
  const pctOnly = contextInfo({ context_window: { used_percentage: 25, context_window_size: 400000 } });
  assert.equal(pctOnly.used, 100000, "tokens are derived from the percentage when usage is missing");
  assert.equal(contextInfo({ context_window: {} }), null);
  assert.equal(contextInfo({ context_window: { used_percentage: null, current_usage: null } }), null);
  assert.equal(contextInfo({ context_window: { current_usage: { input_tokens: 5 } } }), null, "no size, no percentage: omit");
  assert.equal(contextInfo(null), null);
  assert.equal(contextInfo({}), null);
  assert.equal(contextInfo({ context_window: { used_percentage: -4, context_window_size: 1000 } }).pct, 0);
  assert.equal(contextInfo({ context_window: { used_percentage: "50" } }), null, "strings are not numbers");
});

test("cacheInfo normalizes the hit ratio and the countdown", () => {
  const now = 1_000_000_000_000;
  assert.equal(cacheInfo({ prompt_cache: { hit_ratio: 0.91 } }, now).hit, 91);
  assert.equal(cacheInfo({ prompt_cache: { hit_ratio: 91 } }, now).hit, 91);
  assert.equal(cacheInfo({ prompt_cache: { hit_ratio: 140 } }, now).hit, 100);
  assert.equal(cacheInfo({ prompt_cache: { expires_at: now / 1000 + 180 } }, now).left, 180);
  assert.equal(cacheInfo({ prompt_cache: { warm: false, requests: 3 } }, now).warm, false);
  assert.equal(cacheInfo({ prompt_cache: { warm: "yes" } }, now).warm, null);
  assert.equal(cacheInfo({}, now), null);
  assert.equal(cacheInfo({ prompt_cache: null }, now), null);
  assert.equal(cacheInfo({ prompt_cache: "x" }, now), null);
});

test("limitsInfo reads the three windows", () => {
  const l = limitsInfo({ rate_limits: { five_hour: { used_percentage: 23, resets_at: 5 }, seven_day: { used_percentage: 41 }, spend_limit: { used_percentage: 3, used_usd: 1.5, limit_usd: 50 } } });
  assert.equal(l.five.pct, 23);
  assert.equal(l.seven.pct, 41);
  assert.equal(l.spend.limitUsd, 50);
  assert.equal(limitsInfo({ rate_limits: {} }), null);
  assert.equal(limitsInfo({ rate_limits: { five_hour: { used_percentage: null } } }), null);
  assert.equal(limitsInfo({ rate_limits: null }), null);
  assert.equal(limitsInfo(null), null);
});
