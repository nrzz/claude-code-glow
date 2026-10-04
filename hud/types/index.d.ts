export type HudLimit = { kind: string; pct: number; resetsAt?: string }

export type HudUsage = {
  pct: number | null
  tokens: number | null
  window: number
  limits: HudLimit[]
  usd: number | null
}

export type HudTheme = {
  slug: string
  name: string
  base: string
  overrides: Record<string, string>
  glow: Record<string, unknown>
  swatches: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'glowbar': { usage: HudUsage | null; hidden: boolean; theme: string }
  }
}
