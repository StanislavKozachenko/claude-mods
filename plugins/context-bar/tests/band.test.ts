import type { CommandRunInput, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const CATEGORIES = [
  { name: 'System prompt', tokens: 3_000, color: 'promptBorder', isDeferred: false, kind: 'used' },
  { name: 'Messages', tokens: 117_000, color: 'claude', isDeferred: false, kind: 'used' },
  { name: 'Free space', tokens: 47_000, color: 'promptBorder', isDeferred: false, kind: 'free' },
  { name: 'Autocompact buffer', tokens: 33_000, color: 'inactive', isDeferred: false, kind: 'buffer' },
]

// The engine beneath the mod: a clock, a store, and a usage whose breakdown
// the test sets.
const engine = (on: On, percent = 60, stored: Record<string, unknown> = {}) => {
  const calls = { usage: 0 }
  const store = new Map(Object.entries(stored))
  const clock = mock.clock(on, { now: 1_000_000 })
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('session.start', (_$, e) => e as never)
  on('command.register', () => ({ value: undefined }) as never)
  // What the engine draws when the mod passes: nothing of its own here
  on('ui.render', ($, e) => h($.ui.resolve(e).Box, { key: 'engine' }) as never)
  on('session.usage', () => {
    calls.usage += 1
    return { value: {
      startedAt: 0,
      rateLimits: [],
      context: {
        window: 200_000,
        breakdown: { categories: CATEGORIES, totalTokens: 120_000, maxTokens: 200_000, rawMaxTokens: 200_000, percentage: percent },
      },
    } } as never
  })
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false } }) as never)

  return { calls, store, clock }
}

const command = (args: string): CommandRunInput => ({
  command: 'context-bar',
  args,
  origin: { kind: 'composer' } as CommandRunInput['origin'],
  presentation: { isFullscreen: false, columns: 100 },
})

const BAND = {
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

test('draws the bar and the legend on every surface that has the band', async ($, on) => {
  engine(on)
  await $.command.run(command('on'))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'context-bar', surface, ...BAND, props: BAND.props as never })
    expect(await ui.find({ type: 'Text', text: /60% · 120k \/ 200k/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /█+/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Messages 117k' })).toBeDefined()
    await ui.unmount()
  }
})

test('/context-bar hides and shows it, and remembers the choice', async ($, on) => {
  const { store } = engine(on)
  await $.command.run(command('on'))

  expect((await $.command.run(command(''))).text).toContain('Hidden')
  expect(store.get('isHidden')).toBe(true)
  const hidden = await $.ui.mount({ plugin: 'context-bar', surface: 'terminal', ...BAND, props: BAND.props as never })
  expect(await hidden.find({ type: 'Text', text: /120k/ })).toBeUndefined()
  await hidden.unmount()

  expect((await $.command.run(command('on'))).text).toBe('Shown.')
  expect(store.get('isHidden')).toBe(false)
  expect((await $.command.run(command('sideways'))).text).toContain('Usage')
})

test('a narrow band shows the summary alone', async ($, on) => {
  engine(on, 91)
  await $.command.run(command('on'))

  const props = { ...BAND.props, bodyColumns: 24 }
  const ui = await $.ui.mount({ plugin: 'context-bar', surface: 'terminal', ...BAND, props: props as never })
  const found = await ui.find({ type: 'Text', text: /context 91%/ })
  expect(found?.props.bold).toBe(true)
  expect(await ui.find({ type: 'Text', text: /█/ })).toBeUndefined()
})

test('yields to a survey and to a subagent transcript', async ($, on) => {
  engine(on)
  await $.command.run(command('on'))

  for (const props of [{ ...BAND.props, hasSurvey: true }, { ...BAND.props, view: { agentId: 'a1' } }]) {
    const ui = await $.ui.mount({ plugin: 'context-bar', surface: 'terminal', ...BAND, props: props as never })
    expect(await ui.find({ type: 'Text', text: /120k/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('re-measures after tool calls at most once per refreshSeconds', { options: { refreshSeconds: 5 } }, async ($, on) => {
  const { calls, clock } = engine(on)
  await $.command.run(command('on'))
  const before = calls.usage

  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(calls.usage).toBe(before)

  await clock.advance(5_000)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  expect(calls.usage).toBe(before + 1)
})

test('a new session starts hidden when the person hid it before', async ($, on) => {
  engine(on, 60, { isHidden: true })
  await $.session.start({ cwd: '/repo', surface: 'terminal' } as never)

  const ui = await $.ui.mount({ plugin: 'context-bar', surface: 'terminal', ...BAND, props: BAND.props as never })
  expect(await ui.find({ type: 'Text', text: /120k/ })).toBeUndefined()
})

test('a new session measures and draws at once', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal' } as never)

  const ui = await $.ui.mount({ plugin: 'context-bar', surface: 'terminal', ...BAND, props: BAND.props as never })
  expect(await ui.find({ type: 'Text', text: /60% · 120k/ })).toBeDefined()
})
