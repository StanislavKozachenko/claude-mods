import type { EngineInterface, Register } from 'claude-code'

import { budgetLevel, budgetToast, doneToast, permissionToast, questionToast, title, toastCommand } from './toast'
import type { BudgetSnapshot, Platform, Toast } from './toast'

let platform: Platform | undefined

/**
 * Bumps whenever the person or the turn moves on (a prompt, a tool call
 * starting or ending, a turn starting or ending). A delayed toast is shown
 * only if nothing moved in the meantime: an answered prompt sends none.
 */
let activity = 0

async function detectPlatform($: EngineInterface): Promise<Platform> {
  if (platform) return platform
  if ((await $.env.get('OS')) === 'Windows_NT') {
    platform = 'windows'
  } else if ((await $.env.get('WSL_DISTRO_NAME')) !== undefined) {
    // Linux under WSL draws on the Windows desktop, where notify-send shows nothing
    platform = 'wsl'
  } else {
    const uname = await $.process.run(['uname', '-s'], { timeoutMs: 5_000 }).catch(() => undefined)
    platform = uname?.stdout.trim() === 'Darwin' ? 'macos' : 'linux'
  }

  return platform
}

/** What to do when a platform's notifier is missing. */
const INSTALL_HINT: Record<Platform, string> = {
  windows: 'Windows PowerShell ships with Windows 10 and 11; check that powershell is on PATH.',
  wsl: 'Check that WSL interop is on (powershell.exe must run from WSL).',
  macos: 'osascript ships with macOS; check that /usr/bin is on PATH.',
  linux: 'Install libnotify (apt install libnotify-bin, dnf install libnotify, pacman -S libnotify).',
}

/** Shows the toast; resolves to why it failed, or undefined. */
async function show($: EngineInterface, toast: Toast, isSpoken: boolean): Promise<string | undefined> {
  const command = toastCommand(await detectPlatform($), toast)
  const ran = await $.process
    .run(command.argv, { ...(command.stdin === undefined ? {} : { stdin: command.stdin }), timeoutMs: 15_000 })
    .catch(() => undefined)
  if (isSpoken) await $.audio.speak(toast.body).catch(() => undefined)

  if (ran === undefined) return `${command.argv[0]} could not start. ${INSTALL_HINT[platform ?? 'linux']}`
  return ran.exitCode === 0 ? undefined : ran.stderr.trim() || `exit code ${ran.exitCode}`
}

/** Shows the toast after `delayMs`, unless something happened by then. */
function showUnlessAnswered($: EngineInterface, toast: Toast, delayMs: number, isSpoken: boolean) {
  const mark = activity
  $.clock.after(delayMs, () => {
    if (activity === mark) void show($, toast, isSpoken)
  })
}

/**
 * Sends the budget notification a ci-budget measurement is worth, once per
 * owner, month and level (threshold, then 100%), across sessions.
 */
async function notifyBudget($: EngineInterface, snapshot: BudgetSnapshot, threshold: number, isSpoken: boolean) {
  const level = budgetLevel(snapshot, threshold)
  if (level === 0) return

  const key = `budget:${String(snapshot.owner)}:${String(snapshot.period)}`
  const sent = Number((await $.store.get(key)) ?? 0)
  if (level <= sent) return

  await $.store.set(key, level)
  await show($, budgetToast(await $.session.cwd(), snapshot), isSpoken)
}

export const register: Register = (on, options) => {
  const isOn = (name: string) => options[name] !== false
  const budgetPercent = Math.min(100, Math.max(1, Number(options.budgetPercent ?? 80)))
  const minMs = Math.max(0, Number(options.minSeconds ?? 30)) * 1000
  const delayMs = Math.max(0, Number(options.permissionDelaySeconds ?? 10)) * 1000
  const isSpoken = options.speak === true

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'notify',
      description: 'Send a sample desktop notification (/notify test)',
      argumentHint: 'test',
    })

    return next(e)
  })

  on('prompt.submit', ($, e, next) => {
    activity += 1
    return next(e)
  })

  on('turn.start', ($, e, next) => {
    activity += 1
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    activity += 1
    // AskUserQuestion holds the call until the person answers
    if (isOn('question') && String(e.tool) === 'AskUserQuestion') {
      const { questions } = e as { questions?: { question?: unknown }[] }
      const question = questions?.[0]?.question
      showUnlessAnswered($, questionToast(await $.session.cwd(), typeof question === 'string' ? question : ''), delayMs, isSpoken)
    }
    const ran = await next(e)
    activity += 1

    return ran
  })

  on('classic.Notification', async ($, e, next) => {
    if (isOn('permission') && e.notification_type === 'permission_prompt') {
      showUnlessAnswered($, permissionToast(await $.session.cwd(), e.message), delayMs, isSpoken)
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    activity += 1
    // An interrupted turn was stopped by the person, who is there to see it
    if (isOn('done') && e.agentId === undefined && !e.isAborted && e.durationMs >= minMs) {
      await show($, doneToast(await $.session.cwd(), e.durationMs, e.answer), isSpoken)
    }

    return done
  })

  // ci-budget, when it is installed, writes its measurement to its own state;
  // watching that write needs no dependency on it.
  on('state.set', async ($, e, next) => {
    const written = await next(e)
    const write = e as unknown as { plugin?: string; key?: string; value?: unknown }
    if (isOn('budget') && write.plugin === 'ci-budget' && write.key === 'snapshot' && write.value !== null && typeof write.value === 'object') {
      await notifyBudget($, write.value as BudgetSnapshot, budgetPercent, isSpoken)
    }

    return written
  })

  on('command.run', { command: 'notify' }, async ($, e) => {
    if (e.args.trim() !== 'test') return { text: 'Usage: /notify test' }

    const cwd = await $.session.cwd()
    const failure = await show($, { title: title(cwd), body: 'Notifications work.' }, isSpoken)

    return { text: failure === undefined ? `Sent a test notification (${await detectPlatform($)}).` : `Failed: ${failure}` }
  })
}
