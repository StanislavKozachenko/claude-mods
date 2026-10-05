import type { CommandRunInput, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

// The engine beneath the mod: a Windows host whose process runs are recorded,
// a clock the test moves, and calls that pass.
const engine = (on: On, pushRefusal?: string) => {
  const runs: { argv: readonly string[]; stdin?: string }[] = []
  const clock = mock.clock(on, { now: 0 })
  mock.env(on, { OS: 'Windows_NT' })
  on('process.run', (_$, e) => {
    runs.push({ argv: e.argv, ...(e.init?.stdin === undefined ? {} : { stdin: e.init.stdin }) })
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('session.cwd', () => ({ value: 'C:\\work\\app' }) as never)
  on('turn.complete', (_$, e) => ({ text: e.answer }) as never)
  on('classic.Notification', () => ({}) as never)
  // Claude Code's push answers as it does away from the terminal: sent
  const pushes: string[] = []
  on('tool.call', (_$, e) => {
    if (String(e.tool) !== 'PushNotification') return { result: { answers: {} } } as never
    pushes.push(String((e as { message?: string }).message))
    if (pushRefusal === 'local-only') return { result: { message: '', pushSent: false, localSent: true } } as never
    return { result: pushRefusal === undefined ? { message: '', pushSent: true, localSent: false } : { message: '', pushSent: false, localSent: false, disabledReason: pushRefusal } } as never
  })

  const toasts = () => runs.filter(run => run.argv[0] === 'powershell').map(run => JSON.parse(run.stdin ?? '{}'))

  return { clock, toasts, pushes }
}

const complete = (durationMs: number, extra: object = {}) =>
  ({ answer: 'All tests pass.\nDetails below.', durationMs, isAborted: false, turnId: 't1', reason: 'completed', ...extra }) as never

const notification = (type: string) =>
  ({ hook_event_name: 'Notification', message: 'Claude needs your permission to use Bash', notification_type: type, session_id: 's', transcript_path: '', cwd: '' }) as never

test('a long turn sends a toast with its answer', async ($, on) => {
  const { toasts } = engine(on)
  await $.turn.complete(complete(125_000))
  expect(toasts()).toEqual([{ title: 'Claude Code · app', body: 'Done in 2m 5s: All tests pass.' }])
})

test('short, interrupted and subagent turns send none', async ($, on) => {
  const { toasts } = engine(on)
  await $.turn.complete(complete(5_000))
  await $.turn.complete(complete(125_000, { isAborted: true }))
  await $.turn.complete(complete(125_000, { agentId: 'a1' }))
  expect(toasts()).toEqual([])
})

test('a permission prompt left waiting sends a toast after the delay', async ($, on) => {
  const { clock, toasts } = engine(on)
  await $.classic.Notification(notification('permission_prompt'))
  await clock.advance(9_000)
  expect(toasts()).toEqual([])
  await clock.advance(1_000)
  expect(toasts()).toEqual([{ title: 'Claude Code · app', body: 'Needs permission: Claude needs your permission to use Bash' }])
})

test('a prompt answered within the delay sends none', async ($, on) => {
  const { clock, toasts } = engine(on)
  await $.classic.Notification(notification('permission_prompt'))
  await clock.advance(3_000)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await clock.advance(10_000)
  expect(toasts()).toEqual([])
})

test('other notification types are left to Claude Code', async ($, on) => {
  const { clock, toasts } = engine(on)
  await $.classic.Notification(notification('idle_prompt'))
  await clock.advance(20_000)
  expect(toasts()).toEqual([])
})

test('done: false sends no done notification', { options: { done: false } }, async ($, on) => {
  const { toasts } = engine(on)
  await $.turn.complete(complete(125_000))
  expect(toasts()).toEqual([])
})

test('/notify test sends a sample', async ($, on) => {
  const { toasts } = engine(on)
  const input: CommandRunInput = {
    command: 'notify',
    args: 'test',
    origin: { kind: 'composer' } as CommandRunInput['origin'],
    presentation: { isFullscreen: false, columns: 100 },
  }
  expect((await $.command.run(input)).text).toBe('Desktop: sent (windows).\nPhone: sent through Claude Code push.')
  expect(toasts()).toEqual([{ title: 'Claude Code · app', body: 'Notifications work.' }])
})

// Hosts other than Windows: what the environment says, what `uname -s`
// answers, and whether the notifier exists.
const host = (on: On, env: Record<string, string>, uname: string, isNotifierMissing = false) => {
  const runs: (readonly string[])[] = []
  mock.env(on, env)
  on('process.run', (_$, e) => {
    runs.push(e.argv)
    if (e.argv[0] === 'uname') return { value: { exitCode: 0, stdout: `${uname}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    if (isNotifierMissing) throw new Error(`spawn ${e.argv[0]} ENOENT`)
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('session.cwd', () => ({ value: '/home/me/app' }) as never)

  return runs
}

const TEST_COMMAND: CommandRunInput = {
  command: 'notify',
  args: 'test',
  origin: { kind: 'composer' } as CommandRunInput['origin'],
  presentation: { isFullscreen: false, columns: 100 },
}

test('macOS is told apart by uname and notified through osascript', async ($, on) => {
  const runs = host(on, {}, 'Darwin')
  expect((await $.command.run(TEST_COMMAND)).text).toContain('Desktop: sent (macos).')
  expect(runs.at(-1)?.[0]).toBe('osascript')
})

test('Linux is notified through notify-send', async ($, on) => {
  const runs = host(on, {}, 'Linux')
  expect((await $.command.run(TEST_COMMAND)).text).toContain('Desktop: sent (linux).')
  expect(runs.at(-1)?.slice(0, 3)).toEqual(['notify-send', '--app-name=Claude Code', '--'])
})

test('WSL notifies on the Windows desktop through powershell.exe', async ($, on) => {
  const runs = host(on, { WSL_DISTRO_NAME: 'Ubuntu' }, 'Linux')
  expect((await $.command.run(TEST_COMMAND)).text).toContain('Desktop: sent (wsl).')
  expect(runs.at(-1)?.[0]).toBe('powershell.exe')
  expect(runs.some(argv => argv[0] === 'uname')).toBe(false)
})

test('a missing notifier says how to install it', async ($, on) => {
  host(on, {}, 'Linux', true)
  const { text } = await $.command.run(TEST_COMMAND)
  expect(text).toContain('notify-send could not start')
  expect(text).toContain('libnotify')
})

// ci-budget's measurement, as it writes it to its own state
const snapshot = (percent: number, extra: object = {}) => ({
  owner: 'acme',
  ownerType: 'Organization',
  period: '2026-10',
  source: 'billing',
  minutes: { Linux: percent * 20 },
  quotaMinutes: percent * 20,
  includedMinutes: 2000,
  percent,
  hints: [],
  at: 0,
  ...extra,
})

// A store in memory, as the engine keeps notify's own
const withStore = (on: On) => {
  const store = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  return store
}

// Stands for ci-budget: a plugin of that name writing its own snapshot state,
// as the real one does after each measurement; /measure <json> writes one.
// "other" writes a snapshot of the same key name under its own name.
const CI_BUDGET = {
  name: 'ci-budget',
  register: ((on: On) => {
    on('command.run', { command: 'measure' }, async ($, e) => {
      await $.state.set({ plugin: 'ci-budget', key: 'snapshot' } as never, JSON.parse(e.args) as never)
      return { text: 'measured' }
    })
  }) as never,
}
const OTHER = {
  name: 'other',
  register: ((on: On) => {
    on('command.run', { command: 'measure-other' }, async ($, e) => {
      await $.state.set({ plugin: 'other', key: 'snapshot' } as never, JSON.parse(e.args) as never)
      return { text: 'measured' }
    })
  }) as never,
}
const WITH_CI_BUDGET = { plugins: [CI_BUDGET, OTHER] }

const measure = ($: Engine, value: object, plugin = 'ci-budget') =>
  $.command.run({
    command: plugin === 'ci-budget' ? 'measure' : 'measure-other',
    args: JSON.stringify(value),
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  } as never)

test('a budget past budgetPercent notifies once, and again at 100%', WITH_CI_BUDGET, async ($, on) => {
  const { toasts } = engine(on)
  withStore(on)

  await measure($, snapshot(70))
  expect(toasts()).toEqual([])
  await measure($, snapshot(85))
  await measure($, snapshot(90))
  expect(toasts()).toEqual([
    { title: 'Claude Code · app', body: 'Actions budget: acme has used 85% of its included minutes this month (1700 of 2000 minutes)' },
  ])
  await measure($, snapshot(100))
  expect(toasts()).toHaveLength(2)
  await measure($, snapshot(120))
  expect(toasts()).toHaveLength(2)
})

test('the budget notification is remembered per owner and month across sessions', WITH_CI_BUDGET, async ($, on) => {
  const { toasts } = engine(on)
  const store = withStore(on)
  store.set('budget:acme:2026-10', 1)

  await measure($, snapshot(85))
  expect(toasts()).toEqual([])
  await measure($, snapshot(85, { period: '2026-11' }))
  expect(toasts()).toHaveLength(1)
})

test('budget: false sends nothing', { ...WITH_CI_BUDGET, options: { budget: false } }, async ($, on) => {
  const { toasts } = engine(on)
  withStore(on)
  await measure($, snapshot(95))
  expect(toasts()).toEqual([])
})

test('an estimate, or a snapshot of another plugin, sends nothing', WITH_CI_BUDGET, async ($, on) => {
  const { toasts } = engine(on)
  withStore(on)
  await measure($, snapshot(95, { source: 'estimate' }))
  await measure($, snapshot(95), 'other')
  expect(toasts()).toEqual([])
})

test('budgetPercent sets the threshold', { ...WITH_CI_BUDGET, options: { budgetPercent: 50 } }, async ($, on) => {
  const { toasts } = engine(on)
  withStore(on)
  await measure($, snapshot(55))
  expect(toasts()).toHaveLength(1)
})

test('every notification also goes to the phone through Claude Code push', async ($, on) => {
  const { pushes } = engine(on)
  await $.turn.complete(complete(125_000))
  expect(pushes).toEqual(['Claude Code · app: Done in 2m 5s: All tests pass.'])
})

test('push: false sends nothing to the phone, desktop: false nothing to the desktop', { options: { push: false } }, async ($, on) => {
  const { pushes, toasts } = engine(on)
  await $.turn.complete(complete(125_000))
  expect(pushes).toEqual([])
  expect(toasts()).toHaveLength(1)
})

test('desktop: false keeps the phone only', { options: { desktop: false } }, async ($, on) => {
  const { pushes, toasts } = engine(on)
  await $.turn.complete(complete(125_000))
  expect(toasts()).toEqual([])
  expect(pushes).toHaveLength(1)
})

test('/notify test says why the phone got nothing', async ($, on) => {
  engine(on, 'user_present')
  const { text = '' } = await $.command.run({ ...TEST_COMMAND })
  expect(text).toContain('Phone: not sent: you are at this terminal')
})

test('no second desktop notification when Claude Code showed its own', async ($, on) => {
  const { pushes, toasts } = engine(on, 'local-only')
  await $.turn.complete(complete(125_000))
  expect(pushes).toHaveLength(1)
  expect(toasts()).toEqual([])
})
