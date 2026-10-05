import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const ROW = 'b0d1c2e3-0000-4000-8000-000000000001'

// The engine beneath the mod: a session whose cost the test moves, a store,
// tool calls that succeed unless the command is `false`, the engine's own
// "Worked for" line, and the rows a session appends.
const engine = (on: On, stored: Record<string, unknown> = {}) => {
  const session = { costUsd: 1 }
  const store = new Map(Object.entries(stored))

  on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context: { window: 200_000 }, cost: { usd: session.costUsd } } }) as never)
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('session.start', (_$, e) => e as never)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }) as never)
  on('turn.complete', (_$, e) => ({ text: e.answer }) as never)
  on('tool.call', (_$, e) =>
    (String(e.tool) === 'Bash' && (e as { command?: string }).command === 'false'
      ? { result: { stdout: '', stderr: 'failed', interrupted: false }, isError: true }
      : { result: { stdout: 'ok', stderr: '', interrupted: false } }) as never,
  )
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, { key: 'engine' }, 'Worked for 1m 4s') as never
  })

  return { session, store }
}

const LINE = { component: 'TurnDuration', requestId: ROW, props: { word: 'Worked', durationMs: 64_000 } } as const

async function runTurn($: Engine, session: { costUsd: number }) {
  await $.turn.start({ text: 'do it', turnId: 't1' } as never)
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await $.tool.call({ tool: 'Bash', command: 'false' })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' })
  session.costUsd += 0.42
  await $.turn.complete({ text: 'done', turnId: 't1', durationMs: 64_000, isAborted: false, answer: 'done', reason: 'completed' } as never)
  // The kit has no store beneath session.append, so the append itself rejects;
  // the mod binds the summary before passing the row on, which is what counts.
  await $.session
    .append({ message: { type: 'system', name: 'turn_duration', content: [] }, door: 'notice', uuid: ROW } as never)
    .catch(() => undefined)
}

test('the turn summary follows the engine line', async ($, on) => {
  const { session } = engine(on)
  await runTurn($, session)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'turn-stats', surface, ...LINE, props: LINE.props as never })
    expect(await ui.find({ type: 'Text', text: 'Worked for 1m 4s' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /3 tools \(Bash 2, Edit 1\) · 1 failed · 1 file · \$0\.42/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a line it has no summary for is the engine line alone', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ plugin: 'turn-stats', surface: 'terminal', ...LINE, props: LINE.props as never })
  expect(await ui.find({ type: 'Text', text: 'Worked for 1m 4s' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /tools/ })).toBeUndefined()
})

test('summaries are stored and come back in the next session', async ($, on) => {
  const { session, store } = engine(on)
  await runTurn($, session)
  expect(Object.keys(store.get('lines') as object)).toEqual([ROW])
})

test('a resumed session draws the stored summary', async ($, on) => {
  engine(on, { lines: { [ROW]: { tools: { Read: 2 }, failed: 0, files: [] } } })
  await $.session.start({ cwd: '/repo', surface: 'terminal' } as never)

  const ui = await $.ui.mount({ plugin: 'turn-stats', surface: 'terminal', ...LINE, props: LINE.props as never })
  expect(await ui.find({ type: 'Text', text: /2 tools \(Read 2\)/ })).toBeDefined()
})

test('cost: false and topTools: 0', { options: { cost: false, topTools: 0 } }, async ($, on) => {
  const { session } = engine(on)
  await runTurn($, session)

  const ui = await $.ui.mount({ plugin: 'turn-stats', surface: 'terminal', ...LINE, props: LINE.props as never })
  expect(await ui.find({ type: 'Text', text: /^3 tools · 1 failed · 1 file$/ })).toBeDefined()
})
