// The one tip on the status line's second line. Zero tokens: the status line is never sent to the model.
// Rules run top to bottom and the first match wins; with nothing urgent, a rotating feature tip
// is shown (same tip for a whole 2-minute window, so it does not flicker on every refresh).
import { cacheInfo, contextInfo, formatClock, formatCountdown, formatTokens, limitsInfo } from "./metrics.mjs";

/** Things worth knowing about Claude Code. Short, and true of current versions. */
export const FEATURE_TIPS = [
  "Esc Esc rewinds to an earlier message",
  "Shift+Tab cycles permission modes (plan mode included)",
  "/context shows what fills your window",
  "/compact <focus> steers what the summary keeps",
  "/clear starts fresh without losing the old session (/resume)",
  "@path mentions one file instead of exploring",
  "Subagents keep big outputs out of your main context",
  "Pick model and effort at session start; switching mid-session re-caches everything",
  "/rename names this session so /resume finds it",
  "claude --continue picks up your last session here",
  "/usage shows your plan limits and how much you have used",
  "! runs a shell command without spending a turn",
  "ctrl+r searches your prompt history",
  "/theme → Glow themes recolor the whole UI",
  "ctrl+o expands collapsed tool output",
  "/memory opens your CLAUDE.md files for editing",
  "claude -p \"prompt\" answers once and exits: handy in scripts",
  "/export saves this conversation to a file",
  "claude --resume lets you pick an earlier session",
  "/agents creates and manages subagents",
  "/hooks shows the hooks Claude Code will run",
  "Keep CLAUDE.md short: it is loaded at the start of every session",
  "--fork-session branches a resumed session instead of continuing it",
  "/statusline writes a status line from a plain-English description",
  "/plugin browses and installs plugins",
  "/model switches models: save the biggest one for the hardest work",
];

const WINDOW_MS = 120000;

/** The feature tip for the 2-minute window containing `now`. */
export function featureTip(now = Date.now()) {
  const t = Number.isFinite(now) ? now : Date.now();
  return FEATURE_TIPS[Math.floor(t / WINDOW_MS) % FEATURE_TIPS.length];
}

const pctText = (n) => Math.min(999, Math.round(n));

/**
 * The tip for this moment: { kind, text } or null. `kind` names the rule that fired:
 * context-high, context-mid, cache-cooling, cache-cold, limit-5h, limit-7d, limit-spend,
 * effort-max, over-200k, feature.
 */
export function pickTip(input, { now = Date.now(), featureTips = true } = {}) {
  const inp = input && typeof input === "object" ? input : {};
  const ctx = contextInfo(inp);
  const tokens = ctx && ctx.used > 0 ? formatTokens(ctx.used) : null;

  if (ctx) {
    const pct = pctText(ctx.pct);
    if (pct >= 80) return { kind: "context-high", text: `Context ${pct}% full — /compact now, or hand over and start fresh` };
    if (pct >= 50) return { kind: "context-mid", text: `Context ${pct}% — finish this step, then /compact or start a new session` };
  }

  const cache = cacheInfo(inp, now);
  if (cache) {
    if (cache.warm !== false && cache.left != null && cache.left > 0 && cache.left <= 300) {
      return {
        kind: "cache-cooling",
        text: `Prompt cache cools in ${formatCountdown(cache.left)} — reply soon or hand over; a cold restart re-writes ${tokens ? `all ${tokens} tokens` : "the whole context"}`,
      };
    }
    if (cache.warm === false && (cache.requests ?? 0) > 0) {
      return {
        kind: "cache-cold",
        text: `Cache is cold — this session's next message re-sends ${tokens ? `~${tokens} tokens` : "the whole context"} at full price; a fresh session is cheaper`,
      };
    }
  }

  const limits = limitsInfo(inp);
  if (limits) {
    const reset = (w) => { const c = formatClock(w.resetsAt, now); return c ? ` (resets ${c})` : ""; };
    if (limits.five && limits.five.pct >= 80) {
      return { kind: "limit-5h", text: `5h limit ${pctText(limits.five.pct)}%${reset(limits.five)} — move chores to Sonnet/Haiku` };
    }
    if (limits.seven && limits.seven.pct >= 80) {
      return { kind: "limit-7d", text: `7d limit ${pctText(limits.seven.pct)}%${reset(limits.seven)} — move chores to Sonnet/Haiku` };
    }
    if (limits.spend && limits.spend.pct >= 80) {
      return { kind: "limit-spend", text: `Spend limit ${pctText(limits.spend.pct)}%${reset(limits.spend)} — move chores to Sonnet/Haiku` };
    }
  }

  const effort = inp.effort && typeof inp.effort === "object" ? inp.effort.level : null;
  if (effort === "max") return { kind: "effort-max", text: "Effort max overthinks routine work — try high" };
  if (inp.exceeds_200k_tokens === true) return { kind: "over-200k", text: "Over 200K tokens — long contexts cost more per message" };

  if (featureTips) return { kind: "feature", text: featureTip(now) };
  return null;
}
