import test from "node:test";
import assert from "node:assert/strict";
import { FEATURE_TIPS, featureTip, pickTip } from "../src/tips.mjs";

const NOW = Date.UTC(2026, 9, 3, 12, 0, 0);
const SEC = NOW / 1000;

const context = (pct, usedTokens = 0) => ({
  context_window: {
    used_percentage: pct,
    context_window_size: 1000000,
    current_usage: { input_tokens: usedTokens, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  },
});

test("context >= 80%: compact now", () => {
  const tip = pickTip(context(82, 820000), { now: NOW });
  assert.equal(tip.kind, "context-high");
  assert.equal(tip.text, "Context 82% full — /compact now, or hand over and start fresh");
  assert.equal(pickTip(context(80), { now: NOW }).kind, "context-high", "80 exactly");
  assert.equal(pickTip(context(100), { now: NOW }).kind, "context-high");
  assert.equal(pickTip(context(250), { now: NOW }).text, "Context 250% full — /compact now, or hand over and start fresh");
});

test("context >= 50%: finish this step", () => {
  const tip = pickTip(context(55), { now: NOW });
  assert.equal(tip.kind, "context-mid");
  assert.equal(tip.text, "Context 55% — finish this step, then /compact or start a new session");
  assert.equal(pickTip(context(50), { now: NOW }).kind, "context-mid", "50 exactly");
  assert.equal(pickTip(context(79), { now: NOW }).kind, "context-mid");
  assert.notEqual(pickTip(context(49), { now: NOW }).kind, "context-mid");
});

test("context percentage can be computed from current_usage", () => {
  const tip = pickTip({ context_window: { context_window_size: 200000, current_usage: { input_tokens: 5000, cache_creation_input_tokens: 5000, cache_read_input_tokens: 150000 } } }, { now: NOW });
  assert.equal(tip.kind, "context-high", "160K of 200K is 80%");
});

test("prompt cache cooling within 5 minutes, while warm", () => {
  const input = { ...context(34, 340000), prompt_cache: { warm: true, requests: 9, expires_at: SEC + 180 } };
  const tip = pickTip(input, { now: NOW });
  assert.equal(tip.kind, "cache-cooling");
  assert.equal(tip.text, "Prompt cache cools in 3m — reply soon or hand over; a cold restart re-writes all 340K tokens");
  assert.equal(pickTip({ prompt_cache: { warm: true, expires_at: SEC + 300 } }, { now: NOW }).kind, "cache-cooling", "5 minutes exactly");
  assert.equal(pickTip({ prompt_cache: { warm: true, expires_at: SEC + 45 } }, { now: NOW }).text.startsWith("Prompt cache cools in 45s"), true);
  assert.notEqual(pickTip({ prompt_cache: { warm: true, expires_at: SEC + 301 } }, { now: NOW }).kind, "cache-cooling", "more than 5 minutes left");
  assert.notEqual(pickTip({ prompt_cache: { warm: true, expires_at: SEC - 5 } }, { now: NOW }).kind, "cache-cooling", "already expired");
  assert.notEqual(pickTip({ prompt_cache: { warm: false, requests: 3, expires_at: SEC + 100 } }, { now: NOW }).kind, "cache-cooling", "not warm");
  assert.equal(pickTip({ prompt_cache: { expires_at: SEC + 100 } }, { now: NOW }).kind, "cache-cooling", "warm unknown counts as warm");
  assert.match(pickTip({ prompt_cache: { warm: true, expires_at: SEC + 100 } }, { now: NOW }).text, /re-writes the whole context$/, "no token count when the context size is unknown");
});

test("cold cache with requests behind it", () => {
  const input = { ...context(34, 340000), prompt_cache: { warm: false, requests: 4 } };
  const tip = pickTip(input, { now: NOW });
  assert.equal(tip.kind, "cache-cold");
  assert.equal(tip.text, "Cache is cold — this session's next message re-sends ~340K tokens at full price; a fresh session is cheaper");
  assert.notEqual(pickTip({ prompt_cache: { warm: false, requests: 0 } }, { now: NOW }).kind, "cache-cold", "brand new session");
  assert.notEqual(pickTip({ prompt_cache: { warm: false } }, { now: NOW }).kind, "cache-cold");
  assert.match(pickTip({ prompt_cache: { warm: false, requests: 1 } }, { now: NOW }).text, /re-sends the whole context at full price/);
});

test("rate limits >= 80%: 5h first, then 7d, with the reset time", () => {
  const five = pickTip({ rate_limits: { five_hour: { used_percentage: 84, resets_at: SEC + 3600 } } }, { now: NOW });
  assert.equal(five.kind, "limit-5h");
  assert.match(five.text, /^5h limit 84% \(resets (\w{3} )?\d{2}:\d{2}\) — move chores to Sonnet\/Haiku$/);
  const seven = pickTip({ rate_limits: { seven_day: { used_percentage: 91.4, resets_at: SEC + 86400 * 2 } } }, { now: NOW });
  assert.equal(seven.kind, "limit-7d");
  assert.match(seven.text, /^7d limit 91% \(resets \w{3} \d{2}:\d{2}\) — move chores to Sonnet\/Haiku$/);
  const both = pickTip({ rate_limits: { five_hour: { used_percentage: 81 }, seven_day: { used_percentage: 99 } } }, { now: NOW });
  assert.equal(both.kind, "limit-5h", "first match wins");
  assert.equal(both.text, "5h limit 81% — move chores to Sonnet/Haiku", "no reset time, no parentheses");
  assert.notEqual(pickTip({ rate_limits: { five_hour: { used_percentage: 79.4 } } }, { now: NOW }).kind, "limit-5h");
  assert.equal(pickTip({ rate_limits: { five_hour: { used_percentage: 80 } } }, { now: NOW }).kind, "limit-5h", "80 exactly");
  assert.equal(pickTip({ rate_limits: { spend_limit: { used_percentage: 90 } } }, { now: NOW }).kind, "limit-spend");
});

test("effort max overthinks", () => {
  const tip = pickTip({ effort: { level: "max" } }, { now: NOW });
  assert.equal(tip.kind, "effort-max");
  assert.equal(tip.text, "Effort max overthinks routine work — try high");
  assert.notEqual(pickTip({ effort: { level: "high" } }, { now: NOW }).kind, "effort-max");
});

test("over 200K tokens", () => {
  const tip = pickTip({ exceeds_200k_tokens: true }, { now: NOW });
  assert.equal(tip.kind, "over-200k");
  assert.equal(tip.text, "Over 200K tokens — long contexts cost more per message");
  assert.notEqual(pickTip({ exceeds_200k_tokens: false }, { now: NOW }).kind, "over-200k");
});

test("priority: context > cache cooling > limits > effort > 200K > feature tip", () => {
  const all = {
    ...context(85, 850000),
    prompt_cache: { warm: true, requests: 5, expires_at: SEC + 120 },
    rate_limits: { five_hour: { used_percentage: 90 } },
    effort: { level: "max" },
    exceeds_200k_tokens: true,
  };
  const order = [];
  const input = structuredClone(all);
  const step = (remove) => { remove(input); order.push(pickTip(input, { now: NOW }).kind); };
  order.push(pickTip(input, { now: NOW }).kind);
  step((i) => { delete i.context_window; });
  step((i) => { delete i.prompt_cache; });
  step((i) => { delete i.rate_limits; });
  step((i) => { delete i.effort; });
  step((i) => { delete i.exceeds_200k_tokens; });
  assert.deepEqual(order, ["context-high", "cache-cooling", "limit-5h", "effort-max", "over-200k", "feature"]);
  // cold cache outranks limits too
  assert.equal(pickTip({ prompt_cache: { warm: false, requests: 2 }, rate_limits: { five_hour: { used_percentage: 95 } } }, { now: NOW }).kind, "cache-cold");
});

test("feature tips: deterministic per 2-minute window, rotating, never empty", () => {
  const base = Math.floor(NOW / 120000) * 120000;
  const a = featureTip(base);
  assert.equal(featureTip(base + 119999), a, "same window, same tip");
  assert.equal(featureTip(base + 1), a);
  assert.notEqual(featureTip(base + 120000), a, "next window, next tip");
  assert.equal(pickTip({}, { now: base }).text, a);
  assert.equal(pickTip({}, { now: base }).kind, "feature");
  const seen = new Set();
  for (let i = 0; i < FEATURE_TIPS.length; i++) seen.add(featureTip(base + i * 120000));
  assert.equal(seen.size, FEATURE_TIPS.length, "a full cycle shows every tip exactly once");
  assert.equal(featureTip(NaN).length > 0, true);
});

test("featureTips:false silences the rotation but not the warnings", () => {
  assert.equal(pickTip({}, { now: NOW, featureTips: false }), null);
  assert.equal(pickTip(context(90), { now: NOW, featureTips: false }).kind, "context-high");
});

test("pickTip never throws on junk", () => {
  for (const junk of [null, undefined, 0, "x", [], {}, { context_window: "x" }, { prompt_cache: [] }, { rate_limits: 5 }, { effort: "max" }, { context_window: { used_percentage: NaN } }]) {
    assert.doesNotThrow(() => pickTip(junk, { now: NOW }));
    assert.doesNotThrow(() => pickTip(junk, {}));
  }
  assert.doesNotThrow(() => pickTip({}, { now: NaN }));
});

test("the curated feature tips are short, unique and include the essentials", () => {
  assert.ok(FEATURE_TIPS.length >= 20 && FEATURE_TIPS.length <= 30, `${FEATURE_TIPS.length} tips`);
  assert.equal(new Set(FEATURE_TIPS).size, FEATURE_TIPS.length);
  for (const t of FEATURE_TIPS) {
    assert.ok(t.length >= 15 && t.length <= 90, `"${t}" is ${t.length} chars`);
    assert.equal(t, t.trim());
    assert.doesNotMatch(t, /\n/);
  }
  for (const needle of ["Esc Esc", "Shift+Tab", "/context", "/compact", "/clear", "@path", "Subagents", "/rename", "claude --continue", "/usage", "! runs", "ctrl+r", "Glow themes"]) {
    assert.ok(FEATURE_TIPS.some((t) => t.includes(needle)), `a tip mentions ${needle}`);
  }
});
