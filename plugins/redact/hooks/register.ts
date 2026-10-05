import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { addHits, buildRules, countHits, redactBlocks } from './rules'

const hits = atom({ plugin: 'redact', key: 'hits' } as const, {})
const isPaused = atom({ plugin: 'redact', key: 'isPaused' } as const, false)

/** The doors rows from the outside world come in by: what a tool, a file or another agent put there. */
const DOORS = new Set(['tool-result', 'tool-message', 'attachment', 'hook-context', 'delivery'])

/** Who may pause it: the person, never another agent, a channel or a peer session. */
const PERSON = new Set(['composer', 'bridge', 'sdk'])

async function showStatus($: EngineInterface) {
  const paused = await read($, isPaused)
  const count = countHits(await read($, hits))
  $.ui.status(paused ? 'redact: paused' : count > 0 ? `redact: ${count} hidden` : undefined)
}

export const register: Register = (on, options) => {
  const { rules, allow, problems } = buildRules(options)
  const doors = new Set(DOORS)
  if (options.prompts === true) doors.add('prompt')

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'redact',
      description: 'Show what redact hid from the model this session; /redact off or /redact on pauses it',
      argumentHint: '[on|off]',
    })
    if (problems.length > 0) $.ui.toast(`redact: ${problems.join('; ')}`)

    return next(e)
  })

  // The row as the chain answers it is what the transcript keeps and the next
  // request sends: a secret replaced here never reaches the model.
  on('session.append', async ($, e, next) => {
    if (!doors.has(e.door) || (await read($, isPaused))) return next(e)

    const redacted = redactBlocks(e.message.content, rules, allow)
    if (countHits(redacted.hits) === 0) return next(e)

    await update($, hits, sum => addHits(sum, redacted.hits))
    await showStatus($)

    return next({ ...e, message: { ...e.message, content: redacted.content } })
  })

  on('command.run', { command: 'redact' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()

    if (arg === 'off' || arg === 'on') {
      if (!PERSON.has(e.origin.kind)) {
        return { text: `/redact ${arg} is only accepted from the person at the prompt (got ${e.origin.kind}).` }
      }
      await update($, isPaused, () => arg === 'off')
      await showStatus($)

      return { text: arg === 'off' ? 'Paused for this session: secrets reach the model. /redact on resumes it.' : 'Active.' }
    }
    if (arg !== '') return { text: 'Usage: /redact [on|off]' }

    const sum = await read($, hits)
    const kinds = Object.entries(sum).sort(([, a], [, b]) => b - a)
    const lines = [
      (await read($, isPaused)) ? 'Paused for this session (/redact on resumes it).' : 'Active.',
      kinds.length === 0
        ? 'Nothing hidden this session.'
        : `Hidden from the model this session: ${kinds.map(([kind, n]) => `${kind} ${n}`).join(', ')}`,
    ]

    return { text: lines.join('\n') }
  })
}
