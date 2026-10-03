// Pulls numbers out of the status-line JSON and formats them. Every field Claude Code sends may be
// missing, null or the wrong type, so everything here returns null instead of throwing.

/** A finite number or null. */
export const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

const isObject = (v) => v !== null && typeof v === "object";

/** Strip control characters so a hostile branch or folder name cannot inject escape sequences. */
export const clean = (v) => String(v ?? "").replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").trim();

/** Last path segment of a unix or windows path ("" for empty input). */
export function baseName(p) {
  const parts = String(p ?? "").split(/[\\/]+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

const unit = (v) => (v < 10 ? String(Math.round(v * 10) / 10) : String(Math.round(v)));

/** 340000 -> "340K", 1200000 -> "1.2M", 999999 -> "1M". */
export function formatTokens(n) {
  n = Number(n);
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 999.5) return String(Math.round(n));
  if (n < 999500) return unit(n / 1e3) + "K";
  if (n < 999500000) return unit(n / 1e6) + "M";
  if (n < 1e12) return unit(n / 1e9) + "B";
  return "999B+";
}

/** Milliseconds -> "<1m", "42m", "2h05m", "3d4h". */
export function formatDuration(ms) {
  ms = num(ms);
  if (ms == null || ms < 0) return "";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h${String(minutes % 60).padStart(2, "0")}m`;
  return `${Math.floor(hours / 24)}d${hours % 24}h`;
}

/** 1.234 -> "$1.23"; large amounts shorten to "$12K". */
export function formatMoney(usd) {
  usd = num(usd);
  if (usd == null || usd < 0) return "";
  if (usd >= 10000) return "$" + formatTokens(usd);
  return "$" + usd.toFixed(2);
}

/** Seconds since the epoch from a number (seconds or milliseconds) or an ISO string; else null. */
export function epochSeconds(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v > 1e12 ? v / 1000 : v;
  if (typeof v === "string" && v.trim()) {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t / 1000;
  }
  return null;
}

/** "14:30" for a time today, "Mon 14:30" for another day, in the machine's local time zone. */
export function formatClock(epoch, nowMs = Date.now()) {
  const sec = epochSeconds(epoch);
  if (sec == null) return "";
  const d = new Date(sec * 1000);
  if (Number.isNaN(d.getTime())) return "";
  const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const today = new Date(nowMs);
  const sameDay = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  return sameDay ? hhmm : `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()]} ${hhmm}`;
}

/** "3m" for 180 seconds, "45s" under a minute. */
export function formatCountdown(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return s >= 60 ? `${Math.ceil(s / 60)}m` : `${s}s`;
}

/**
 * Context window fill: { pct, used, size } or null when nothing usable was sent.
 * pct comes from context_window.used_percentage, else (input + cache_creation + cache_read) / size.
 */
export function contextInfo(input) {
  const cw = isObject(input) ? input.context_window : null;
  if (!isObject(cw)) return null;
  const size = num(cw.context_window_size) > 0 ? num(cw.context_window_size) : null;
  const u = isObject(cw.current_usage) ? cw.current_usage : null;
  let used = null;
  if (u) used = (num(u.input_tokens) || 0) + (num(u.cache_creation_input_tokens) || 0) + (num(u.cache_read_input_tokens) || 0);
  let pct = num(cw.used_percentage);
  if (pct == null && used != null && size) pct = (used / size) * 100;
  if (pct == null) return null;
  pct = Math.max(0, pct);
  if ((used == null || used === 0) && size && pct > 0) used = (pct / 100) * size;
  return { pct, used, size };
}

/** Prompt-cache state: { warm, requests, hit (0-100 or null), left (seconds until expiry or null) } or null. */
export function cacheInfo(input, nowMs = Date.now()) {
  const pc = isObject(input) ? input.prompt_cache : null;
  if (!isObject(pc)) return null;
  let hit = num(pc.hit_ratio);
  if (hit != null) hit = Math.max(0, Math.min(100, hit <= 1 ? hit * 100 : hit)); // a fraction, or already a percentage
  const expires = epochSeconds(pc.expires_at);
  return {
    warm: typeof pc.warm === "boolean" ? pc.warm : null,
    requests: num(pc.requests),
    hit,
    left: expires == null ? null : expires - nowMs / 1000,
  };
}

/** Plan limits: { five, seven, spend } where each is { pct, resetsAt, ... } or null. */
export function limitsInfo(input) {
  const rl = isObject(input) ? input.rate_limits : null;
  if (!isObject(rl)) return null;
  const one = (w) => (isObject(w) && num(w.used_percentage) != null
    ? { pct: Math.max(0, num(w.used_percentage)), resetsAt: w.resets_at, usedUsd: num(w.used_usd), limitUsd: num(w.limit_usd) }
    : null);
  const out = { five: one(rl.five_hour), seven: one(rl.seven_day), spend: one(rl.spend_limit) };
  return out.five || out.seven || out.spend ? out : null;
}
