import type { EngineInterface, Register } from 'claude-code'

import { doneToast, permissionToast, questionToast, title, toastCommand } from './toast'
import type { Platform, Toast } from './toast'

const EVENTS = ['done', 'permission', 'question'] as const
type NotifyEvent = (typeof EVENTS)[number]

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
  } else {
    const uname = await $.process.run(['uname', '-s'], { timeoutMs: 5_000 }).catch(() => undefined)
    platform = uname?.stdout.trim() === 'Darwin' ? 'macos' : 'linux'
  }

  return platform
}

/** Shows the toast; resolves to why it failed, or undefined. */
async function show($: EngineInterface, toast: Toast, isSpoken: boolean): Promise<string | undefined> {
  const command = toastCommand(await detectPlatform($), toast)
  const ran = await $.process
    .run(command.argv, { ...(command.stdin === undefined ? {} : { stdin: command.stdin }), timeoutMs: 15_000 })
    .catch((error: unknown) => ({ exitCode: -1, stdout: '', stderr: String(error) }))
  if (isSpoken) await $.audio.speak(toast.body).catch(() => undefined)

  return ran.exitCode === 0 ? undefined : ran.stderr.trim() || `exit code ${ran.exitCode}`
}

/** Shows the toast after `delayMs`, unless something happened by then. */
function showUnlessAnswered($: EngineInterface, toast: Toast, delayMs: number, isSpoken: boolean) {
  const mark = activity
  $.clock.after(delayMs, () => {
    if (activity === mark) void show($, toast, isSpoken)
  })
}

export const register: Register = (on, options) => {
  const listed = Array.isArray(options.events) ? options.events : EVENTS
  const events = new Set(listed.filter((event): event is NotifyEvent => (EVENTS as readonly string[]).includes(event)))
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
    if (events.has('question') && String(e.tool) === 'AskUserQuestion') {
      const { questions } = e as { questions?: { question?: unknown }[] }
      const question = questions?.[0]?.question
      showUnlessAnswered($, questionToast(await $.session.cwd(), typeof question === 'string' ? question : ''), delayMs, isSpoken)
    }
    const ran = await next(e)
    activity += 1

    return ran
  })

  on('classic.Notification', async ($, e, next) => {
    if (events.has('permission') && e.notification_type === 'permission_prompt') {
      showUnlessAnswered($, permissionToast(await $.session.cwd(), e.message), delayMs, isSpoken)
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    activity += 1
    // An interrupted turn was stopped by the person, who is there to see it
    if (events.has('done') && e.agentId === undefined && !e.isAborted && e.durationMs >= minMs) {
      await show($, doneToast(await $.session.cwd(), e.durationMs, e.answer), isSpoken)
    }

    return done
  })

  on('command.run', { command: 'notify' }, async ($, e) => {
    if (e.args.trim() !== 'test') return { text: 'Usage: /notify test' }

    const cwd = await $.session.cwd()
    const failure = await show($, { title: title(cwd), body: 'Notifications work.' }, isSpoken)

    return { text: failure === undefined ? `Sent a test notification (${await detectPlatform($)}).` : `Failed: ${failure}` }
  })
}
