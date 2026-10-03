// Glow HUD: a themed bar above the prompt and a theme picker pane, drawn with Claude Code's
// function hooks (early access, Claude Code 2.1.286 or newer). Nothing it shows is sent to the
// model, so the meter, the tips and the nudges cost zero tokens.
//
//   bar     context meter, plan limits, session cost, one tip, [Compact] [Theme] [x]
//   /glow   opens the theme picker; `/glow dracula` applies a theme; `/glow hud` hides or shows the bar
//   toasts  once when the context passes 50% and 80%, when a plan limit passes 80%, and when a
//           large file was read whole
//
// Colors on the bar are Claude Code theme keys (claude, success, warning, ...), so the bar follows
// whatever theme is active. Applying a Glow theme rewrites <config>/themes/glow.json, which Claude
// Code watches: with "Glow (live)" picked once in /theme, the whole interface recolors at once.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { HudTheme, HudUsage } from '../types'

const PANE = 'glow-themes'
const usage = atom({ plugin: 'glow-hud', key: 'usage' } as const, null)
const hidden = atom({ plugin: 'glow-hud', key: 'hidden' } as const, false)
const current = atom({ plugin: 'glow-hud', key: 'theme' } as const, '')
const HOTKEYS = '123456789abdefgijklmnopqrsuvwyz'.split('')

const FEATURE_TIPS = [
  'Esc Esc rewinds to an earlier message',
  'Shift+Tab cycles permission modes, plan mode included',
  '/context shows what fills your window',
  '/compact <focus> keeps only what you name',
  'One task per session keeps every message cheaper',
  '@path mentions one file instead of exploring the repo',
  'Subagents keep big outputs out of your main context',
  'Pick model and effort at session start: a switch re-caches everything',
  '/rename names this session so /resume finds it',
  '/usage shows plan limits and the cache hit ratio',
]

let themes: HudTheme[] | null = null
const readFiles = new Set<string>()
const said = { half: false, full: false, five: false, week: false }

async function loadThemes($: EngineInterface): Promise<HudTheme[]> {
  if (themes) return themes
  try {
    const parsed: unknown = JSON.parse(await $.fs.read(`${$.plugin.root}/data/themes.json`))
    themes = Array.isArray(parsed) ? (parsed as HudTheme[]) : []
  } catch {
    themes = []
  }
  return themes
}

async function configDir($: EngineInterface): Promise<string> {
  const custom = await $.env.get('CLAUDE_CONFIG_DIR')
  if (custom) return custom.replace(/[\\/]+$/, '')
  const home = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME')) || '.'
  return `${home.replace(/[\\/]+$/, '')}/.claude`
}

function findTheme(list: HudTheme[], query: string): HudTheme | undefined {
  const q = query.trim().toLowerCase().replace(/^glow[\s·-]*/, '').replace(/\s+/g, '-')
  if (!q) return undefined
  return list.find(t => t.slug === q) ?? list.find(t => t.slug.startsWith(q)) ?? list.find(t => t.name.toLowerCase().includes(q.replace(/-/g, ' ')))
}

async function applyTheme($: EngineInterface, query: string): Promise<HudTheme | undefined> {
  const theme = findTheme(await loadThemes($), query)
  if (!theme) return undefined
  const dir = await configDir($)
  // The Glow status line's settings, when it is installed: follow the theme, and honour
  // `claude-glow install --no-ui-theme`, which leaves Claude Code's own colors alone.
  const cfgFile = `${dir}/claude-code-glow/config.json`
  let cfg: Record<string, unknown> | null = null
  if (await $.fs.exists(cfgFile)) {
    try {
      cfg = JSON.parse(await $.fs.read(cfgFile)) as Record<string, unknown>
    } catch {
      cfg = {}
    }
    await $.fs.write(cfgFile, JSON.stringify({ ...cfg, theme: theme.slug }, null, 2) + '\n')
  }
  if (cfg?.uiTheme !== false) {
    // The same file `claude-glow theme set` writes: the whole theme, named "Glow (live)".
    const live = { name: 'Glow (live)', base: theme.base, overrides: theme.overrides, glow: theme.glow }
    await $.fs.write(`${dir}/themes/glow.json`, JSON.stringify(live, null, 2) + '\n')
  }
  await update($, current, () => theme.slug)
  await $.store.set('theme', theme.slug)
  const hinted = await $.store.get('liveHint')
  $.ui.toast(hinted ? `Glow theme: ${theme.name}` : `Glow theme: ${theme.name}. If the colors did not change, pick "Glow (live)" in /theme once.`, { timeoutMs: hinted ? 3000 : 9000 })
  if (!hinted) await $.store.set('liveHint', true)
  return theme
}

async function openPicker($: EngineInterface): Promise<void> {
  await $.ui.open({ id: PANE, title: 'Glow themes', focus: true, closeOnEscape: true })
}

function toHud(context: { tokens?: number; window: number; percent?: number }, limits: { kind: string; percentUsed: number; resetsAt?: string }[], cost?: { usd: number }): HudUsage {
  return {
    pct: typeof context.percent === 'number' ? Math.round(context.percent) : null,
    tokens: typeof context.tokens === 'number' ? context.tokens : null,
    window: context.window,
    limits: limits.map(l => ({ kind: l.kind, pct: l.percentUsed, ...(l.resetsAt ? { resetsAt: l.resetsAt } : {}) })),
    usd: cost ? cost.usd : null,
  }
}

const compactNumber = (n: number | null): string => {
  if (n === null) return '?'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}K`
  return String(n)
}
const meter = (pct: number, cells: number): string => {
  const full = Math.min(cells, Math.max(0, Math.round((pct / 100) * cells)))
  return '▰'.repeat(full) + '▱'.repeat(cells - full)
}
const limitName = (kind: string): string => (kind === 'five_hour' ? '5h' : kind === 'seven_day' ? '7d' : kind === 'spend_limit' ? 'spend' : kind)
const tone = (pct: number, warn: number, bad: number): string => (pct >= bad ? 'error' : pct >= warn ? 'warning' : 'success')

export function tipFor(u: HudUsage, now: number): string {
  const five = u.limits.find(l => l.kind === 'five_hour')
  const week = u.limits.find(l => l.kind === 'seven_day')
  if (u.pct !== null && u.pct >= 80) return 'Context nearly full: compact now, or hand over and start fresh'
  if (u.pct !== null && u.pct >= 50) return 'Past half the context: finish this step, then compact or start a new session'
  if (five && five.pct >= 80) return `5-hour limit at ${Math.round(five.pct)}%: move chores to Sonnet or Haiku`
  if (week && week.pct >= 80) return `Weekly limit at ${Math.round(week.pct)}%: keep the big model for hard problems`
  return FEATURE_TIPS[Math.floor(now / 120000) % FEATURE_TIPS.length] ?? ''
}

function nudge($: EngineInterface, u: HudUsage): void {
  if (u.pct !== null) {
    if (u.pct < 45) {
      said.half = false
      said.full = false
    }
    if (u.pct >= 80 && !said.full) {
      said.full = true
      said.half = true
      $.ui.toast(`Context ${u.pct}% full: compact now (c on the Glow bar), or hand over and start a fresh session.`, { timeoutMs: 9000 })
    } else if (u.pct >= 50 && !said.half) {
      said.half = true
      $.ui.toast(`Context ${u.pct}%: every message now re-sends ${compactNumber(u.tokens)} tokens. A good moment to compact or hand over.`, { timeoutMs: 8000 })
    }
  }
  for (const l of u.limits) {
    const key = l.kind === 'five_hour' ? 'five' : l.kind === 'seven_day' ? 'week' : null
    if (!key) continue
    if (l.pct < 70) said[key] = false
    if (l.pct >= 80 && !said[key]) {
      said[key] = true
      $.ui.toast(`${limitName(l.kind)} plan limit at ${Math.round(l.pct)}%: lighter models for chores stretch what is left.`, { timeoutMs: 8000 })
    }
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'glow', description: 'Glow: pick a theme (/glow), apply one (/glow dracula), or hide/show the bar (/glow hud)', argumentHint: '[theme | hud]' })
    const saved = await $.store.get('theme')
    if (typeof saved === 'string' && saved) await update($, current, () => saved)
    if ((await $.store.get('hidden')) === true) await update($, hidden, () => true)
    void loadThemes($)
    try {
      const u = await $.session.usage()
      await update($, usage, () => toHud(u.context, u.rateLimits, u.cost))
    } catch {
      // no figures yet: the bar waits for the first measurement
    }
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const u = toHud(e.context, e.rateLimits, e.cost)
    await update($, usage, () => u)
    nudge($, u)
    return next(e)
  })

  // /glow answers with toasts and the picker, never with a transcript line: a line would be
  // recorded in the conversation and read by the model, and this command must cost no tokens.
  on('command.run', { command: 'glow' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'hud') {
      const hide = !(await read($, hidden))
      await update($, hidden, () => hide)
      await $.store.set('hidden', hide)
      $.ui.toast(hide ? 'Glow bar hidden; /glow hud shows it again.' : 'Glow bar shown.')
      return {}
    }
    if (arg) {
      const theme = await applyTheme($, arg)
      if (!theme) $.ui.toast(`No Glow theme matches "${arg}"; /glow opens the picker.`)
      return {}
    }
    await openPicker($)
    return {}
  })

  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    const result = await next(e)
    if (e.offset === undefined && e.limit === undefined && !readFiles.has(e.file_path) && result.isError !== true) {
      readFiles.add(e.file_path)
      try {
        const stat = await $.fs.stat(e.file_path)
        if (stat.size > 60_000) {
          const name = e.file_path.split(/[\\/]/).pop() ?? e.file_path
          $.ui.toast(`${name} was read whole: about ${Math.round(stat.size / 4000)}K tokens, re-sent with every later message. Asking for a line range is cheaper.`, { timeoutMs: 9000 })
        }
      } catch {
        // the file moved or cannot be read: nothing to say
      }
    }
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, hidden))) return next(e)
    const u = await read($, usage)
    if (!u || u.pct === null) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const cols = e.props.bodyColumns
    const tip = cols >= 100 ? tipFor(u, Date.now()) : ''
    const limits = cols >= 72 ? u.limits.filter(l => l.kind === 'five_hour' || l.kind === 'seven_day') : []

    return (
      <Box flexDirection="row" columnGap={1}>
        <Text color="claude" bold>
          ◆ glow
        </Text>
        <Text color={tone(u.pct, 50, 75)}>
          {meter(u.pct, cols >= 72 ? 10 : 5)} {u.pct}%
        </Text>
        <Text dimColor>
          {compactNumber(u.tokens)}/{compactNumber(u.window)}
        </Text>
        {limits.map(l => (
          <Text color={tone(l.pct, 70, 90)}>
            {limitName(l.kind)} {Math.round(l.pct)}%
          </Text>
        ))}
        {u.usd !== null && cols >= 60 && <Text dimColor>${u.usd.toFixed(2)}</Text>}
        {tip !== '' && (
          <Text color="suggestion" wrap="truncate-end">
            💡 {tip}
          </Text>
        )}
        {u.pct >= 50 && !e.props.isWorking && (
          <Button key="compact" label="Compact" hotkey="c" variant="primary" onPress={() => void $.session.compact()} />
        )}
        <Button key="themes" label="Theme" hotkey="t" onPress={() => void openPicker($)} />
        <Button
          key="hide"
          label="×"
          hotkey="h"
          plain
          dimColor
          role="dismiss"
          onPress={() => {
            void update($, hidden, () => true)
            void $.store.set('hidden', true)
          }}
        />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await loadThemes($)
    const active = await read($, current)

    return (
      <Box flexDirection="column">
        <Text color="claude" bold>
          Glow themes
        </Text>
        <Text dimColor>Press a key to recolor Claude Code and the Glow status line. Esc closes.</Text>
        {list.length === 0 && <Text color="warning">No theme data found in this plugin's data/themes.json.</Text>}
        {list.map((t, i) => (
          <Box key={`row-${t.slug}`} flexDirection="row" columnGap={1}>
            <Button
              key={`theme-${t.slug}`}
              label={t.slug === active ? `● ${t.name}` : t.name}
              {...(HOTKEYS[i] ? { hotkey: HOTKEYS[i] } : {})}
              {...(t.slug === active ? { variant: 'primary' as const } : {})}
              onPress={() => void applyTheme($, t.slug)}
            />
            {t.swatches.map(color => (
              <Text color={color}>██</Text>
            ))}
            <Text dimColor>{t.base}</Text>
          </Box>
        ))}
      </Box>
    )
  })
}
