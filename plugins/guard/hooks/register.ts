import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { GuardBlock } from '../types'
import { buildPolicy, checkCommand, checkPath, denyMessage, describePolicy } from './rules'
import type { Policy, Verdict } from './rules'

const isPaused = atom({ plugin: 'guard', key: 'isPaused' } as const, false)
const blocks = atom({ plugin: 'guard', key: 'blocks' } as const, [])

/** Who may pause the guard: the person, never another agent, a channel or a peer session. */
const PERSON = new Set(['composer', 'bridge', 'sdk'])

const MAX_BLOCKS = 50

async function showStatus($: EngineInterface) {
  const count = (await read($, blocks)).length
  const paused = await read($, isPaused)
  $.ui.status(paused ? 'guard: paused' : count > 0 ? `guard: ${count} blocked` : undefined)
}

async function deny($: EngineInterface, tool: string, verdict: Verdict) {
  const block: GuardBlock = { tool, rule: verdict.rule, subject: verdict.subject, at: await $.clock.now() }
  await update($, blocks, list => [...list, block].slice(-MAX_BLOCKS))
  await showStatus($)

  return { deny: denyMessage(verdict) }
}

// The path as given, then where it really leads: a symlink to a secret file is
// a secret file. A path that does not exist yet has no realPath.
async function checkFile($: EngineInterface, path: string | undefined, policy: Policy) {
  if (path === undefined || path === '') return undefined
  const spelled = checkPath(path, policy)
  if (spelled) return spelled

  const stat = await $.fs.stat(path, { resolve: true }).catch(() => undefined)
  const real = stat?.realPath
  const resolved = real !== undefined && real !== path ? checkPath(real, policy) : undefined

  return resolved ? { ...resolved, subject: `${path} → ${real}` } : undefined
}

export const register: Register = (on, options) => {
  const { policy, problems } = buildPolicy(options)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'guard',
      description: 'Show the guard rules and what it blocked; /guard off or /guard on pauses it for this session',
      argumentHint: '[on|off]',
    })
    if (problems.length > 0) $.ui.toast(`guard: ${problems.join('; ')}`)

    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (await read($, isPaused)) return next(e)
    const verdict = checkCommand(e.command, policy)

    return verdict ? deny($, e.tool, verdict) : next(e)
  })

  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    if (await read($, isPaused)) return next(e)
    const verdict = await checkFile($, e.file_path, policy)

    return verdict ? deny($, e.tool, verdict) : next(e)
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    if (await read($, isPaused)) return next(e)
    const verdict = await checkFile($, e.file_path, policy)

    return verdict ? deny($, e.tool, verdict) : next(e)
  })

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    if (await read($, isPaused)) return next(e)
    const verdict = await checkFile($, e.file_path, policy)

    return verdict ? deny($, e.tool, verdict) : next(e)
  })

  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => {
    if (await read($, isPaused)) return next(e)
    const verdict = await checkFile($, e.notebook_path, policy)

    return verdict ? deny($, e.tool, verdict) : next(e)
  })

  // Grep is a built-in tool on some builds only (others search through Bash),
  // so it is matched by name rather than by this build's tool types.
  on('tool.call', async ($, e, next) => {
    if (String(e.tool) !== 'Grep' || (await read($, isPaused))) return next(e)
    const { path } = e as { path?: unknown }
    const verdict = typeof path === 'string' ? await checkFile($, path, policy) : undefined

    return verdict ? deny($, e.tool, verdict) : next(e)
  })

  on('command.run', { command: 'guard' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()

    if (arg === 'off' || arg === 'on') {
      if (!PERSON.has(e.origin.kind)) {
        return { text: `/guard ${arg} is only accepted from the person at the prompt (got ${e.origin.kind}).` }
      }
      await update($, isPaused, () => arg === 'off')
      await showStatus($)

      return {
        text: arg === 'off' ? 'Paused for this session. /guard on resumes it.' : 'Active.',
      }
    }
    if (arg !== '' && arg !== 'status') return { text: 'Usage: /guard [on|off]' }

    const list = await read($, blocks)
    const paused = await read($, isPaused)
    const lines = [
      paused ? 'Paused for this session (/guard on resumes it).' : 'Active.',
      ...describePolicy(policy).map(line => `  ${line}`),
      list.length === 0 ? 'Nothing blocked this session.' : `Blocked this session (${list.length}):`,
      ...list.slice(-10).map(block => `  ${block.tool} · ${block.rule} · ${block.subject.slice(0, 80)}`),
    ]

    return { text: lines.join('\n') }
  })
}
