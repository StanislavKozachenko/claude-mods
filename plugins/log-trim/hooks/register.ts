import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { header, isNoisy, persistedPath, trim } from './trim'
import type { Trimmed } from './trim'

const stats = atom({ plugin: 'log-trim', key: 'stats' } as const, { outputs: 0, linesBefore: 0, linesAfter: 0, charsSaved: 0 })
const isPaused = atom({ plugin: 'log-trim', key: 'isPaused' } as const, false)

/** The shells whose results it condenses. */
const SHELLS = new Set(['Bash', 'PowerShell'])

/** Who may pause it: the person, never another agent, a channel or a peer session. */
const PERSON = new Set(['composer', 'bridge', 'sdk'])

/** session.append does not say which command made a result: tool.call records it by its id. */
const commands = new Map<string, string>()
const MAX_REMEMBERED = 200

type Block = { type: string; [field: string]: unknown }

const textOf = (content: unknown): string | undefined => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return undefined
  const texts = content.filter((part): part is { type: 'text'; text: string } => part?.type === 'text' && typeof part.text === 'string')
  return texts.length === content.length ? texts.map(part => part.text).join('\n') : undefined
}

/** Keeps the full output where the model can read it if the digest is not enough. */
async function keepFull($: EngineInterface, id: string, text: string): Promise<string | undefined> {
  const base = (await $.env.get('TMPDIR')) ?? (await $.env.get('TEMP')) ?? (await $.env.get('TMP')) ?? '/tmp'
  const path = `${base.replace(/[\\/]+$/, '')}/claude-log-trim/${id.replace(/[^\w-]/g, '')}.log`
  return $.fs
    .write(path, text)
    .then(() => path)
    .catch(() => undefined)
}

/** The condensed text for one result, or undefined to leave it as it is. */
async function condense($: EngineInterface, id: string, text: string, maxLines: number): Promise<{ text: string; trimmed: Trimmed } | undefined> {
  const saved = persistedPath(text)
  if (saved !== undefined) {
    // Claude Code kept only the first ~2 KB: the digest of the whole file replaces that preview
    const full = await $.fs.read(saved).catch(() => undefined)
    if (typeof full !== 'string') return undefined
    const trimmed = trim(full, { maxLines, minSaving: 0 })
    return trimmed ? { text: `${header(trimmed, saved)}\n${trimmed.text}`, trimmed } : undefined
  }

  const trimmed = trim(text, { maxLines })
  if (!trimmed) return undefined
  return { text: `${header(trimmed, await keepFull($, id, text))}\n${trimmed.text}`, trimmed }
}

export const register: Register = (on, options) => {
  const maxLines = Math.max(40, Number(options.maxLines ?? 150))
  const extra = (Array.isArray(options.commands) ? options.commands : []).flatMap(source => {
    try {
      return [new RegExp(source)]
    } catch {
      return []
    }
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'log-trim',
      description: 'What log-trim condensed this session; /log-trim off or /log-trim on pauses it',
      argumentHint: '[on|off]',
    })
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (SHELLS.has(String(e.tool))) {
      const { command } = e as { command?: unknown }
      if (typeof command === 'string') {
        commands.set(e.tool_use_id, command)
        if (commands.size > MAX_REMEMBERED) commands.delete(commands.keys().next().value!)
      }
    }
    return next(e)
  })

  // The row as the chain answers it is what the model reads and every later
  // request carries: condensed here, the noise never takes context.
  on('session.append', async ($, e, next) => {
    const tool = e.origin.kind === 'tool' ? e.origin.tool : undefined
    if (e.door !== 'tool-result' || !tool || !SHELLS.has(tool) || (await read($, isPaused))) return next(e)

    let changed = false
    const content: Block[] = []
    for (const block of e.message.content as Block[]) {
      const id = typeof block.tool_use_id === 'string' ? block.tool_use_id : undefined
      const command = id === undefined ? undefined : commands.get(id)
      const text = textOf(block.content)
      if (block.type !== 'tool_result' || !id || !command || text === undefined || !isNoisy(command, extra)) {
        content.push(block)
        continue
      }

      const condensed = await condense($, id, text, maxLines)
      if (!condensed) {
        content.push(block)
        continue
      }
      changed = true
      content.push({ ...block, content: condensed.text })
      await update($, stats, sum => ({
        outputs: sum.outputs + 1,
        linesBefore: sum.linesBefore + condensed.trimmed.linesBefore,
        linesAfter: sum.linesAfter + condensed.trimmed.linesAfter,
        charsSaved: sum.charsSaved + condensed.trimmed.charsSaved,
      }))
    }

    return next(changed ? { ...e, message: { ...e.message, content } } : e)
  })

  on('command.run', { command: 'log-trim' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'off' || arg === 'on') {
      if (!PERSON.has(e.origin.kind)) return { text: `/log-trim ${arg} is only accepted from the person at the prompt (got ${e.origin.kind}).` }
      await update($, isPaused, () => arg === 'off')
      return { text: arg === 'off' ? 'Paused for this session: command output reaches the model as it is.' : 'Active.' }
    }
    if (arg !== '') return { text: 'Usage: /log-trim [on|off]' }

    const sum = await read($, stats)
    const paused = await read($, isPaused)
    const lines = [
      paused ? 'Paused for this session (/log-trim on resumes it).' : 'Active.',
      sum.outputs === 0
        ? 'Nothing condensed this session.'
        : `Condensed ${sum.outputs} command ${sum.outputs === 1 ? 'output' : 'outputs'}: ${sum.linesBefore} → ${sum.linesAfter} lines, about ${Math.round(sum.charsSaved / 4).toLocaleString('en')} tokens kept out of the context.`,
    ]
    return { text: lines.join('\n') }
  })
}
