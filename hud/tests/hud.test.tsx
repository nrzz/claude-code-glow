// Run with: claude plugin test hud
// The engine loads the plugin as a session would; the test's own hooks stand in for the file
// system, the store and the environment, so nothing on disk is touched.
import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const THEMES = [
  { slug: 'classic', name: 'Claude classic', base: 'dark', overrides: {}, glow: { accent: '#d77757' }, swatches: ['#d77757'] },
  { slug: 'dracula', name: 'Dracula', base: 'dark', overrides: { claude: '#bd93f9', text: '#f8f8f2' }, glow: { accent: '#bd93f9' }, swatches: ['#bd93f9', '#8be9fd'] },
  { slug: 'github-light', name: 'GitHub Light', base: 'light', overrides: { claude: '#0969da' }, glow: { accent: '#0969da' }, swatches: ['#0969da'] },
]
const HOME = 'C:/Users/test'
// How a person typing the command in a fullscreen terminal raises it.
const TYPED = { origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 120 } }

// A path as the test keys it. On macOS and Linux C:/Users/test is a relative path, which the engine
// places under the working directory, so cut what it put in front.
const norm = (p: string): string => {
  const slashed = p.replace(/\\/g, '/')
  const at = slashed.indexOf(`/${HOME}/`)
  return at >= 0 ? slashed.slice(at + 1) : slashed
}

// Stands in for the engine beneath the plugin: files in memory, the store, the environment, the
// usage measurements and the toasts.
function world(on: On, files: Record<string, string> = {}): { fs: Map<string, string>; toasts: string[] } {
  const fs = new Map(Object.entries(files))
  const toasts: string[] = []
  on('fs.read', (_$, e) => {
    if (/[\\/]data[\\/]themes\.json$/.test(e.path)) return { value: JSON.stringify(THEMES) }
    const text = fs.get(norm(e.path))
    if (text === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: text }
  })
  on('fs.write', (_$, e) => {
    fs.set(norm(e.path), e.text)
    return { value: undefined }
  })
  on('fs.exists', (_$, e) => ({ value: fs.has(norm(e.path)) }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  // What the engine draws in the band when no plugin does.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="engine-band" />
  })
  mock.store(on)
  mock.env(on, { USERPROFILE: HOME })
  return { fs, toasts }
}

const band = (bodyColumns: number, isWorking = false) =>
  ({
    plugin: 'glowbar',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking, maxRows: 4, bodyColumns, scroll: { offset: 0, bodyRows: 1 }, view: {} },
  }) as const

const measure = (percent: number, five = 20) => ({
  context: { tokens: percent * 10_000, window: 1_000_000, percent },
  rateLimits: [
    { kind: 'five_hour', percentUsed: five },
    { kind: 'seven_day', percentUsed: 41 },
  ],
  cost: { usd: 3.5 },
  changed: ['context', 'rateLimits', 'cost'] as ('context' | 'rateLimits' | 'cost')[],
})

test('the bar shows the meter, limits, cost and a tip, on the terminal and the desktop', async ($, on) => {
  world(on)
  await $.session.measure(measure(62, 84))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...band(140), surface })
    expect(await ui.find({ text: /▰{6}▱{4} 62%/ })).toBeDefined()
    expect(await ui.find({ text: '620K/1M' })).toBeDefined()
    expect(await ui.find({ text: '5h 84%' })).toBeDefined()
    expect(await ui.find({ text: '7d 41%' })).toBeDefined()
    expect(await ui.find({ text: '$3.50' })).toBeDefined()
    expect(await ui.find({ text: /Past half the context/ })).toBeDefined()
    expect(await ui.find({ key: 'compact' })).toBeDefined()
    expect(await ui.find({ key: 'themes' })).toBeDefined()
    await ui.unmount()
  }
})

test('a narrow bar drops the tip and the limits, and Compact waits while a turn runs', async ($, on) => {
  world(on)
  await $.session.measure(measure(55))
  const ui = await $.ui.mount({ ...band(64, true), surface: 'terminal' })
  expect(await ui.find({ text: /55%/ })).toBeDefined()
  expect(await ui.find({ text: /Past half/ })).toBeUndefined()
  expect(await ui.find({ text: /5h/ })).toBeUndefined()
  expect(await ui.find({ key: 'compact' })).toBeUndefined()
  await ui.unmount()
})

test('below half the context the tip is a feature tip and there is no Compact button', async ($, on) => {
  world(on)
  await $.session.measure(measure(12))
  const ui = await $.ui.mount({ ...band(160), surface: 'terminal' })
  expect(await ui.find({ key: 'compact' })).toBeUndefined()
  const tip = await ui.find({ text: /^💡 / })
  expect(tip).toBeDefined()
  // Not one of the warnings. (The feature tips rotate every two minutes, and one of them names plan
  // limits, so the check is for the warnings' own words.)
  expect(tip?.text).not.toMatch(/Context nearly full|Past half the context|5-hour limit|Weekly limit/)
  await ui.unmount()
})

test('the × button hides the bar', async ($, on) => {
  world(on)
  await $.session.measure(measure(30))
  const ui = await $.ui.mount({ ...band(120), surface: 'terminal' })
  expect(await ui.find({ key: 'hide' })).toBeDefined()
  await ui.press({ key: 'hide' })
  expect(await ui.find({ key: 'themes' })).toBeUndefined()
  await ui.unmount()
})

test('/glow dracula writes the live theme and moves the status line with it, at no token cost', async ($, on) => {
  const { fs, toasts } = world(on, { [`${HOME}/.claude/claude-code-glow/config.json`]: JSON.stringify({ theme: 'classic', icons: 'nerd' }) })
  const ran = await $.command.run({ command: 'glow', args: 'dracula', ...TYPED })
  expect(ran.text).toBeUndefined() // no transcript line: nothing reaches the model
  expect(ran.context).toBeUndefined()
  const live = JSON.parse(fs.get(`${HOME}/.claude/themes/glow.json`) ?? '{}')
  expect(live).toEqual({ name: 'Glow (live)', base: 'dark', overrides: { claude: '#bd93f9', text: '#f8f8f2' }, glow: { accent: '#bd93f9' } })
  expect(JSON.parse(fs.get(`${HOME}/.claude/claude-code-glow/config.json`) ?? '{}')).toEqual({ theme: 'dracula', icons: 'nerd' })
  expect(toasts[0]).toMatch(/^Glow theme: Dracula\. .*Glow \(live\)/)
  const missing = await $.command.run({ command: 'glow', args: 'no-such-theme', ...TYPED })
  expect(missing.text).toBeUndefined()
  expect(toasts[toasts.length - 1]).toMatch(/No Glow theme matches "no-such-theme"/)
})

test('the picker lists every theme and a press applies it', async ($, on) => {
  const { fs } = world(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'glowbar',
      surface,
      component: 'Pane',
      requestId: 'glow-themes',
      props: { title: 'Glow themes', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
    })
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(3)
    await ui.press({ key: 'theme-github-light' })
    expect(JSON.parse(fs.get(`${HOME}/.claude/themes/glow.json`) ?? '{}').base).toBe('light')
    expect((await ui.find({ key: 'theme-github-light' }))?.text).toMatch(/^● /)
    await ui.unmount()
  }
})

test('crossing half and most of the context each raises one toast', async ($, on) => {
  const { toasts } = world(on)
  await $.session.measure(measure(30))
  await $.session.measure(measure(52))
  await $.session.measure(measure(58))
  await $.session.measure(measure(83))
  await $.session.measure(measure(85))
  expect(toasts.filter(t => /^Context 52%/.test(t))).toHaveLength(1)
  expect(toasts.filter(t => /^Context 83% full/.test(t))).toHaveLength(1)
  expect(toasts).toHaveLength(2)
})

test('reading a large file whole raises one toast with what it costs', async ($, on) => {
  const { toasts } = world(on)
  on('fs.stat', (_$, e) => ({ value: { kind: 'file' as const, size: e.path.endsWith('big.json') ? 200_000 : 2_000, mtimeMs: 0, isLink: false } }))
  // Stands in for the Read tool itself.
  on('tool.call', { tool: 'Read' }, (_$, e) => ({ result: { type: 'text', file: { filePath: e.file_path, content: '{}', numLines: 1, startLine: 1, totalLines: 1 } } }) as never)
  await $.tool.call({ tool: 'Read', file_path: 'C:/repo/big.json' })
  await $.tool.call({ tool: 'Read', file_path: 'C:/repo/big.json' })
  await $.tool.call({ tool: 'Read', file_path: 'C:/repo/small.ts' })
  await $.tool.call({ tool: 'Read', file_path: 'C:/repo/other-big.json', offset: 1, limit: 50 })
  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toMatch(/^big\.json was read whole: about 50K tokens/)
})

test('with --no-ui-theme installed, a switch moves only the status line', async ($, on) => {
  const { fs, toasts } = world(on, { [`${HOME}/.claude/claude-code-glow/config.json`]: JSON.stringify({ theme: 'classic', uiTheme: false }) })
  await $.command.run({ command: 'glow', args: 'nord-is-missing', ...TYPED })
  await $.command.run({ command: 'glow', args: 'drac', ...TYPED })
  expect(toasts[toasts.length - 1]).toMatch(/^Glow theme: Dracula/)
  expect(fs.has(`${HOME}/.claude/themes/glow.json`)).toBe(false)
  expect(JSON.parse(fs.get(`${HOME}/.claude/claude-code-glow/config.json`) ?? '{}')).toEqual({ theme: 'dracula', uiTheme: false })
})
