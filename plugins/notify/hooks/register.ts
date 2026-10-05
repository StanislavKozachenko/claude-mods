import type { EngineInterface, Register } from 'claude-code'

import { budgetLevel, budgetToast, doneToast, permissionToast, pushMessage, pushReason, questionToast, title, toastCommand } from './toast'
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

/** Where a notification goes. */
type Channels = { isDesktop: boolean; isPush: boolean; isSpoken: boolean }

/** What each channel did: undefined is sent, a string is why not. */
type Sent = { desktop?: string; push?: string }

/** The desktop toast; resolves to why it failed, or undefined. */
async function showDesktop($: EngineInterface, toast: Toast): Promise<string | undefined> {
  const command = toastCommand(await detectPlatform($), toast)
  const ran = await $.process
    .run(command.argv, { ...(command.stdin === undefined ? {} : { stdin: command.stdin }), timeoutMs: 15_000 })
    .catch(() => undefined)

  if (ran === undefined) return `${command.argv[0]} could not start. ${INSTALL_HINT[platform ?? 'linux']}`
  return ran.exitCode === 0 ? undefined : ran.stderr.trim() || `exit code ${ran.exitCode}`
}

/**
 * Claude Code's own push: it reaches the Claude app on your phone when you are
 * away, and sends nothing while you are at the terminal. Resolves to why
 * nothing was sent, or undefined.
 */
async function sendPush($: EngineInterface, toast: Toast): Promise<{ failure?: string; isLocalShown: boolean }> {
  const ran = await $.tool
    .call({ tool: 'PushNotification', message: pushMessage(toast), status: 'proactive' } as never)
    .catch(() => undefined)
  const result = (ran as { result?: { pushSent?: boolean; localSent?: boolean; disabledReason?: string } } | undefined)?.result
  if (!result) return { failure: 'Claude Code has no push notifications in this version', isLocalShown: false }
  const isLocalShown = result.localSent === true
  if (result.pushSent) return { isLocalShown }

  return { failure: isLocalShown ? 'shown on this desktop by Claude Code; no phone is connected' : pushReason(result.disabledReason), isLocalShown }
}

/**
 * Sends a notification on every channel that is on. Push goes first: Claude
 * Code shows its own desktop notification with it when you are away, and then
 * the mod's desktop toast would be the same thing twice.
 */
async function show($: EngineInterface, toast: Toast, channels: Channels): Promise<Sent> {
  const sent: Sent = {}
  let isLocalShown = false
  if (channels.isPush) {
    const pushed = await sendPush($, toast)
    isLocalShown = pushed.isLocalShown
    if (pushed.failure !== undefined) sent.push = pushed.failure
  }
  if (channels.isDesktop && !isLocalShown) {
    const failure = await showDesktop($, toast)
    if (failure !== undefined) sent.desktop = failure
  }
  if (channels.isSpoken) await $.audio.speak(toast.body).catch(() => undefined)

  return sent
}

/** Shows the notification after `delayMs`, unless something happened by then. */
function showUnlessAnswered($: EngineInterface, toast: Toast, delayMs: number, channels: Channels) {
  const mark = activity
  $.clock.after(delayMs, () => {
    if (activity === mark) void show($, toast, channels)
  })
}

/**
 * Sends the budget notification a ci-budget measurement is worth, once per
 * owner, month and level (threshold, then 100%), across sessions.
 */
async function notifyBudget($: EngineInterface, snapshot: BudgetSnapshot, threshold: number, channels: Channels) {
  const level = budgetLevel(snapshot, threshold)
  if (level === 0) return

  const key = `budget:${String(snapshot.owner)}:${String(snapshot.period)}`
  const sent = Number((await $.store.get(key)) ?? 0)
  if (level <= sent) return

  await $.store.set(key, level)
  await show($, budgetToast(await $.session.cwd(), snapshot), channels)
}

export const register: Register = (on, options) => {
  const isOn = (name: string) => options[name] !== false
  const budgetPercent = Math.min(100, Math.max(1, Number(options.budgetPercent ?? 80)))
  const minMs = Math.max(0, Number(options.minSeconds ?? 30)) * 1000
  const delayMs = Math.max(0, Number(options.permissionDelaySeconds ?? 10)) * 1000
  const channels: Channels = { isDesktop: options.desktop !== false, isPush: options.push !== false, isSpoken: options.speak === true }

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
      showUnlessAnswered($, questionToast(await $.session.cwd(), typeof question === 'string' ? question : ''), delayMs, channels)
    }
    const ran = await next(e)
    activity += 1

    return ran
  })

  on('classic.Notification', async ($, e, next) => {
    if (isOn('permission') && e.notification_type === 'permission_prompt') {
      showUnlessAnswered($, permissionToast(await $.session.cwd(), e.message), delayMs, channels)
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    activity += 1
    // An interrupted turn was stopped by the person, who is there to see it
    if (isOn('done') && e.agentId === undefined && !e.isAborted && e.durationMs >= minMs) {
      await show($, doneToast(await $.session.cwd(), e.durationMs, e.answer), channels)
    }

    return done
  })

  // ci-budget, when it is installed, writes its measurement to its own state;
  // watching that write needs no dependency on it.
  on('state.set', async ($, e, next) => {
    const written = await next(e)
    const write = e as unknown as { plugin?: string; key?: string; value?: unknown }
    if (isOn('budget') && write.plugin === 'ci-budget' && write.key === 'snapshot' && write.value !== null && typeof write.value === 'object') {
      await notifyBudget($, write.value as BudgetSnapshot, budgetPercent, channels)
    }

    return written
  })

  on('command.run', { command: 'notify' }, async ($, e) => {
    if (e.args.trim() !== 'test') return { text: 'Usage: /notify test' }

    const cwd = await $.session.cwd()
    const sent = await show($, { title: title(cwd), body: 'Notifications work.' }, channels)
    const lines = [
      channels.isDesktop
        ? sent.desktop === undefined
          ? `Desktop: sent (${await detectPlatform($)}).`
          : `Desktop: failed: ${sent.desktop}`
        : 'Desktop: off (desktop: false).',
      channels.isPush ? (sent.push === undefined ? 'Phone: sent through Claude Code push.' : `Phone: not sent: ${sent.push}`) : 'Phone: off (push: false).',
    ]

    return { text: lines.join('\n') }
  })
}
