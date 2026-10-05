import type { CommandRunInput, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

// The engine beneath the mod: a Windows host whose process runs are recorded,
// a clock the test moves, and calls that pass.
const engine = (on: On) => {
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
  on('tool.call', () => ({ result: { answers: {} } }) as never)

  const toasts = () => runs.filter(run => run.argv[0] === 'powershell').map(run => JSON.parse(run.stdin ?? '{}'))

  return { clock, toasts }
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

test('events limits what is sent', { options: { events: ['permission'] } }, async ($, on) => {
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
  expect((await $.command.run(input)).text).toBe('Sent a test notification (windows).')
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
  expect((await $.command.run(TEST_COMMAND)).text).toBe('Sent a test notification (macos).')
  expect(runs.at(-1)?.[0]).toBe('osascript')
})

test('Linux is notified through notify-send', async ($, on) => {
  const runs = host(on, {}, 'Linux')
  expect((await $.command.run(TEST_COMMAND)).text).toBe('Sent a test notification (linux).')
  expect(runs.at(-1)?.slice(0, 3)).toEqual(['notify-send', '--app-name=Claude Code', '--'])
})

test('WSL notifies on the Windows desktop through powershell.exe', async ($, on) => {
  const runs = host(on, { WSL_DISTRO_NAME: 'Ubuntu' }, 'Linux')
  expect((await $.command.run(TEST_COMMAND)).text).toBe('Sent a test notification (wsl).')
  expect(runs.at(-1)?.[0]).toBe('powershell.exe')
  expect(runs.some(argv => argv[0] === 'uname')).toBe(false)
})

test('a missing notifier says how to install it', async ($, on) => {
  host(on, {}, 'Linux', true)
  const { text } = await $.command.run(TEST_COMMAND)
  expect(text).toContain('notify-send could not start')
  expect(text).toContain('libnotify')
})
