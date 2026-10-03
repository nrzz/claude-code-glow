// Built-in defaults so the status line works with no config file and no theme file at all.

export const SEGMENT_IDS = ["model", "dir", "git", "context", "cost", "time", "limits", "cache"];
export const ICON_MODES = ["nerd", "unicode", "ascii"];

export const DEFAULT_CONFIG = {
  theme: "synthwave-84",
  icons: "unicode",
  segments: [...SEGMENT_IDS],
  tips: true,
  featureTips: true,
};

// The "classic" status-line palette, copied from themes/glow-classic.json. A test keeps it in sync
// with the generator. It fills in whatever a theme file leaves out, so rendering never fails on a
// half-edited theme.
export const DEFAULT_GLOW = {
  bg: "#1c1c1c",
  fg: "#e6e6e6",
  dim: "#999999",
  accent: "#d77757",
  accent2: "#b1b9f9",
  model: { bg: "#d77757", fg: "#1c1c1c" },
  panels: ["#303030", "#343434", "#383838", "#3c3c3c", "#404040", "#444444", "#484848"],
  panelFg: "#e6e6e6",
  ok: "#4eba65",
  warn: "#ffc107",
  bad: "#ff6b80",
  tip: "#b1b9f9",
  gradient: ["#d77757", "#af87ff", "#b1b9f9"],
  swatches: ["#d77757", "#b1b9f9", "#4eba65", "#ffc107", "#fd5db1"],
};

const HEX = /^#[0-9a-fA-F]{6}$/;
const hex = (v, fallback) => (typeof v === "string" && HEX.test(v) ? v : fallback);

/** A glow palette with every field present and valid; anything missing or malformed comes from DEFAULT_GLOW. */
export function normalizeGlow(g) {
  const src = g && typeof g === "object" ? g : {};
  const d = DEFAULT_GLOW;
  const list = (v, fallback, min) => {
    const ok = Array.isArray(v) ? v.filter((c) => typeof c === "string" && HEX.test(c)) : [];
    return ok.length >= min ? ok : fallback;
  };
  const model = src.model && typeof src.model === "object" ? src.model : {};
  return {
    bg: hex(src.bg, d.bg),
    fg: hex(src.fg, d.fg),
    dim: hex(src.dim, d.dim),
    accent: hex(src.accent, d.accent),
    accent2: hex(src.accent2, d.accent2),
    model: { bg: hex(model.bg, d.model.bg), fg: hex(model.fg, d.model.fg) },
    panels: list(src.panels, d.panels, 1),
    panelFg: hex(src.panelFg, d.panelFg),
    ok: hex(src.ok, d.ok),
    warn: hex(src.warn, d.warn),
    bad: hex(src.bad, d.bad),
    tip: hex(src.tip, d.tip),
    gradient: list(src.gradient, d.gradient, 2),
    swatches: list(src.swatches, d.swatches, 1),
  };
}

/** A config with every field present and valid; unknown or malformed fields are dropped, extras are kept. */
export function normalizeConfig(raw) {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const segments = Array.isArray(src.segments) ? src.segments.filter((s) => SEGMENT_IDS.includes(s)) : null;
  return {
    ...src,
    theme: typeof src.theme === "string" && src.theme.trim() ? src.theme.trim() : DEFAULT_CONFIG.theme,
    icons: ICON_MODES.includes(src.icons) ? src.icons : DEFAULT_CONFIG.icons,
    segments: segments && segments.length ? [...new Set(segments)] : [...DEFAULT_CONFIG.segments],
    tips: src.tips !== false,
    featureTips: src.featureTips !== false,
  };
}
