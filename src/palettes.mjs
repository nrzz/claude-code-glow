// The color schemes behind the Glow themes. One compact palette per scheme; src/theme-gen.mjs turns
// each into a Claude Code theme file (all UI color keys) plus the status-line palette.
//
//   bg      terminal background          fg      main text
//   muted   dim but readable text        subtle  very dim text and separators
//   border  the prompt box border (kept neutral: bash / plan / accept-edits modes recolor it)
//   accent  the brand accent: Claude's name, spinner, logo, status-line model chip
//   accent2 blue-ish UI accent: permission prompts, suggestions, selection
//   blue green yellow red purple cyan orange pink   the scheme's hues
//
// Colors come from each scheme's published palette. Where a scheme has no such hue (Dracula and
// Nord have no real blue or pink, Rose Pine no green or orange, Monokai no separate pink ...)
// the value is mixed from its two nearest neighbours and marked "derived".

const dark = (slug, name, c) => ({ slug, name, base: "dark", ...c });
const light = (slug, name, c) => ({ slug, name, base: "light", ...c });

export const PALETTES = [
  // Robb Owen's Synthwave '84: neon pink and cyan on deep purple.
  dark("synthwave-84", "Synthwave '84", {
    bg: "#262335", fg: "#ffffff", muted: "#848bbd", subtle: "#614d85", border: "#495495",
    accent: "#ff7edb", accent2: "#36f9f6",
    blue: "#03edf9", green: "#72f1b8", yellow: "#fede5d", red: "#fe4450",
    purple: "#b893ce", cyan: "#36f9f6", orange: "#ff8b39", pink: "#f92aad",
  }),

  // Dracula (draculatheme.com).
  dark("dracula", "Dracula", {
    bg: "#282a36", fg: "#f8f8f2", muted: "#6272a4", subtle: "#44475a", border: "#6272a4",
    accent: "#bd93f9", accent2: "#8be9fd",
    blue: "#a2c2fb" /* derived: cyan + purple */, green: "#50fa7b", yellow: "#f1fa8c", red: "#ff5555",
    purple: "#bd93f9", cyan: "#8be9fd", orange: "#ffb86c", pink: "#ff79c6",
  }),

  // Tokyo Night (enkia), the "night" variant.
  dark("tokyo-night", "Tokyo Night", {
    bg: "#1a1b26", fg: "#c0caf5", muted: "#737aa2", subtle: "#414868", border: "#565f89",
    accent: "#bb9af7", accent2: "#7aa2f7",
    blue: "#7aa2f7", green: "#9ece6a", yellow: "#e0af68", red: "#f7768e",
    purple: "#9d7cd8", cyan: "#7dcfff", orange: "#ff9e64", pink: "#ff007c",
  }),

  // Catppuccin Mocha and Latte (catppuccin.com).
  dark("catppuccin-mocha", "Catppuccin Mocha", {
    bg: "#1e1e2e", fg: "#cdd6f4", muted: "#9399b2", subtle: "#585b70", border: "#6c7086",
    accent: "#cba6f7", accent2: "#74c7ec",
    blue: "#89b4fa", green: "#a6e3a1", yellow: "#f9e2af", red: "#f38ba8",
    purple: "#b4befe", cyan: "#89dceb", orange: "#fab387", pink: "#f5c2e7",
  }),
  light("catppuccin-latte", "Catppuccin Latte", {
    bg: "#eff1f5", fg: "#4c4f69", muted: "#6c6f85", subtle: "#9ca0b0", border: "#8c8fa1",
    accent: "#8839ef", accent2: "#209fb5",
    blue: "#1e66f5", green: "#40a02b", yellow: "#df8e1d", red: "#d20f39",
    purple: "#7287fd", cyan: "#179299", orange: "#fe640b", pink: "#ea76cb",
  }),

  // Nord (nordtheme.com): polar night, frost and aurora.
  dark("nord", "Nord", {
    bg: "#2e3440", fg: "#d8dee9", muted: "#7b88a1", subtle: "#4c566a", border: "#616e88",
    accent: "#88c0d0", accent2: "#81a1c1",
    blue: "#5e81ac", green: "#a3be8c", yellow: "#ebcb8b", red: "#bf616a",
    purple: "#b48ead", cyan: "#8fbcbb", orange: "#d08770", pink: "#c58fb0" /* derived: purple + red */,
  }),

  // Gruvbox dark (morhetz), bright variants.
  dark("gruvbox-dark", "Gruvbox Dark", {
    bg: "#282828", fg: "#ebdbb2", muted: "#a89984", subtle: "#665c54", border: "#7c6f64",
    accent: "#fe8019", accent2: "#83a598",
    blue: "#83a598", green: "#b8bb26", yellow: "#fabd2f", red: "#fb4934",
    purple: "#d3869b", cyan: "#8ec07c" /* gruvbox aqua */, orange: "#fe8019", pink: "#e78fb3" /* derived */,
  }),

  // Solarized dark (Ethan Schoonover). Text is base1, the "emphasized content" tone, for readability.
  dark("solarized-dark", "Solarized Dark", {
    bg: "#002b36", fg: "#93a1a1", muted: "#657b83", subtle: "#586e75", border: "#586e75",
    accent: "#cb4b16", accent2: "#268bd2",
    blue: "#268bd2", green: "#859900", yellow: "#b58900", red: "#dc322f",
    purple: "#6c71c4", cyan: "#2aa198", orange: "#cb4b16", pink: "#d33682",
  }),

  // Rose Pine (rosepinetheme.com), main variant.
  dark("rose-pine", "Rosé Pine", {
    bg: "#191724", fg: "#e0def4", muted: "#908caa", subtle: "#524f67", border: "#6e6a86",
    accent: "#ebbcba", accent2: "#9ccfd8",
    blue: "#66a1b3" /* derived: pine + foam */, green: "#5fb3a1" /* derived: pine, lifted */, yellow: "#f6c177", red: "#eb6f92",
    purple: "#c4a7e7", cyan: "#9ccfd8", orange: "#f2a480" /* derived: gold + love */, pink: "#e17da7" /* derived: love + iris */,
  }),

  // Atom One Dark.
  dark("one-dark", "One Dark", {
    bg: "#282c34", fg: "#abb2bf", muted: "#828997", subtle: "#4b5263", border: "#5c6370",
    accent: "#c678dd", accent2: "#61afef",
    blue: "#528bff", green: "#98c379", yellow: "#e5c07b", red: "#e06c75",
    purple: "#c678dd", cyan: "#56b6c2", orange: "#d19a66", pink: "#d372a9" /* derived: purple + red */,
  }),

  // Monokai.
  dark("monokai", "Monokai", {
    bg: "#272822", fg: "#f8f8f2", muted: "#90908a", subtle: "#75715e", border: "#75715e",
    accent: "#fd971f", accent2: "#66d9ef",
    blue: "#7fbaf5" /* derived: cyan + purple */, green: "#a6e22e", yellow: "#e6db74", red: "#f92672",
    purple: "#ae81ff", cyan: "#66d9ef", orange: "#fd971f", pink: "#ff5fa2" /* derived */,
  }),

  // Hacker green on black, in the greens of the Matrix digital rain.
  dark("matrix", "Matrix", {
    bg: "#0d0208", fg: "#00e03c", muted: "#00a82b", subtle: "#006b1c", border: "#008f11",
    accent: "#00ff41", accent2: "#00ffa3",
    blue: "#19c9ff", green: "#39ff14", yellow: "#e6ff3a", red: "#ff3355",
    purple: "#b26bff", cyan: "#00fff0", orange: "#ffa21f", pink: "#ff4fb0",
  }),

  // Neon yellow, cyan and magenta on near-black navy.
  dark("cyberpunk", "Cyberpunk", {
    bg: "#0b0b1a", fg: "#e6ecff", muted: "#8b90b8", subtle: "#4a4e7a", border: "#5a5f9e",
    accent: "#fcee0a", accent2: "#00f0ff",
    blue: "#4d7cff", green: "#05ffa1", yellow: "#fcee0a", red: "#ff003c",
    purple: "#b967ff", cyan: "#00f0ff", orange: "#ff8f1f", pink: "#ff2a6d",
  }),

  // GitHub light (Primer).
  light("github-light", "GitHub Light", {
    bg: "#ffffff", fg: "#1f2328", muted: "#59636e", subtle: "#afb8c1", border: "#8c959f",
    accent: "#0969da", accent2: "#8250df",
    blue: "#0550ae", green: "#1a7f37", yellow: "#9a6700", red: "#cf222e",
    purple: "#8250df", cyan: "#1b7c83", orange: "#bc4c00", pink: "#bf3989",
  }),

  // Claude's own default colors on neutral greys. Status line only: no UI overrides are written,
  // so Claude Code keeps its stock theme but you still get the glow bar.
  {
    slug: "classic", name: "Classic", base: "dark", statuslineOnly: true,
    bg: "#1c1c1c", fg: "#e6e6e6", muted: "#999999", subtle: "#505050", border: "#888888",
    accent: "#d77757", accent2: "#b1b9f9",
    blue: "#93a5ff", green: "#4eba65", yellow: "#ffc107", red: "#ff6b80",
    purple: "#af87ff", cyan: "#48968c", orange: "#ff9933", pink: "#fd5db1",
  },
];

export const findPalette = (slug) => PALETTES.find((p) => p.slug === slug) || null;
