// Collecting and formatting a turn's stats as pure functions: no `$`, so
// tests call them directly.

import type { TurnStats } from '../types'

/** The tools whose calls change a file, and the input field naming it. */
export const FILE_TOOLS: Record<string, string> = {
  Edit: 'file_path',
  Write: 'file_path',
  NotebookEdit: 'notebook_path',
}

export const emptyStats = (): TurnStats => ({ tools: {}, failed: 0, files: [] })

/** An edit held for the machine owner's review: the file is unchanged. */
const isStaged = (result: unknown) => typeof result === 'object' && result !== null && (result as { staged?: unknown }).staged === true

/** Lines in a file's content: `a\nb\n` and `a\nb` are 2, `` is 0. */
const countLines = (content: string) => (content === '' ? 0 : content.replace(/\r?\n$/, '').split(/\r?\n/).length)

/**
 * The lines an `Edit` or `Write` result added and removed, from its patch, or
 * a new file's whole content when the patch is empty; undefined when it says
 * nothing of them (a `NotebookEdit`, a diff too large to make).
 */
export function changedLines(result: unknown): [added: number, removed: number] | undefined {
  if (typeof result !== 'object' || result === null) return undefined
  const { structuredPatch, type, content } = result as { structuredPatch?: unknown; type?: unknown; content?: unknown }

  if (Array.isArray(structuredPatch) && structuredPatch.length > 0) {
    let added = 0
    let removed = 0
    for (const hunk of structuredPatch as { lines?: unknown }[]) {
      for (const line of Array.isArray(hunk?.lines) ? hunk.lines : []) {
        if (typeof line !== 'string') continue
        if (line.startsWith('+')) added++
        else if (line.startsWith('-')) removed++
      }
    }
    return [added, removed]
  }
  if (type === 'create' && typeof content === 'string') return [countLines(content), 0]

  return undefined
}

/** What the turn added and removed across its files, `[0, 0]` when nothing was counted. */
export function totalLines(stats: TurnStats): [added: number, removed: number] {
  return Object.values(stats.lines ?? {}).reduce<[number, number]>(([a, r], [x, y]) => [a + x, r + y], [0, 0])
}

/** Adds one finished tool call to the stats; `result` is what the tool answered. */
export function addCall(
  stats: TurnStats,
  tool: string,
  input: Readonly<Record<string, unknown>>,
  isError: boolean,
  result?: unknown,
): TurnStats {
  const field = FILE_TOOLS[tool]
  const path = field === undefined ? undefined : input[field]
  const isChanged = typeof path === 'string' && !isError && !isStaged(result)
  const files = isChanged && !stats.files.includes(path) ? [...stats.files, path] : stats.files
  let lines = stats.lines
  const diff = isChanged ? changedLines(result) : undefined
  if (isChanged && diff) {
    const [added, removed] = lines?.[path] ?? [0, 0]
    lines = { ...lines, [path]: [added + diff[0], removed + diff[1]] }
  }

  return {
    ...stats,
    tools: { ...stats.tools, [tool]: (stats.tools[tool] ?? 0) + 1 },
    failed: stats.failed + (isError ? 1 : 0),
    files,
    ...(lines === undefined ? {} : { lines }),
  }
}

/** `mcp__linear__create_issue` reads as `linear.create_issue`. */
export const toolLabel = (tool: string) => tool.replace(/^mcp__(.+?)__/, '$1.')

/** `$0.42`, `$0.003`, `<$0.001`. */
export function formatCost(usd: number): string {
  if (usd < 0.001) return '<$0.001'
  if (usd < 0.1) return `$${usd.toFixed(3)}`
  return `$${usd.toFixed(2)}`
}

/**
 * `14 tools (Bash 6, Edit 5, Read 3) · 2 failed · 4 files +120 -34 · $0.42`, or
 * undefined when the turn did nothing worth a summary.
 */
export function summarize(stats: TurnStats, options: { topTools: number; isCostShown: boolean }): string | undefined {
  const calls = Object.values(stats.tools).reduce((sum, n) => sum + n, 0)
  const parts: string[] = []

  if (calls > 0) {
    const top = Object.entries(stats.tools)
      .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
      .slice(0, Math.max(0, options.topTools))
      .map(([tool, n]) => `${toolLabel(tool)} ${n}`)
    const rest = Object.keys(stats.tools).length - top.length
    const breakdown = top.length > 0 ? ` (${top.join(', ')}${rest > 0 ? ', …' : ''})` : ''
    parts.push(`${calls} ${calls === 1 ? 'tool' : 'tools'}${breakdown}`)
  }
  if (stats.failed > 0) parts.push(`${stats.failed} failed`)
  if (stats.files.length > 0) {
    const label = `${stats.files.length} ${stats.files.length === 1 ? 'file' : 'files'}`
    parts.push(withDiff(label, totalLines(stats)))
  }
  if (options.isCostShown && stats.costUsd !== undefined && stats.costUsd > 0) parts.push(formatCost(stats.costUsd))

  return parts.length > 0 ? parts.join(' · ') : undefined
}

/** `label +12 -3`, `label -3`, or the label alone when no line was counted. */
function withDiff(label: string, [added, removed]: readonly [number, number]): string {
  return [label, added > 0 ? `+${added}` : '', removed > 0 ? `-${removed}` : ''].filter(Boolean).join(' ')
}

/** `path` relative to `cwd` when it lies inside it, else as it is. */
export function relativePath(path: string, cwd: string): string {
  const base = cwd.replace(/[\\/]+$/, '')
  if (base === '') return path

  // Windows paths compare without case, as the file system does.
  const isWindows = /^[a-z]:/i.test(base) || base.startsWith('\\\\')
  const head = path.slice(0, base.length)
  const isInside = (isWindows ? head.toLowerCase() === base.toLowerCase() : head === base) && /^[\\/]./.test(path.slice(base.length))

  return isInside ? path.slice(base.length + 1) : path
}

/** How many changed files the expanded view names before `… N more`. */
export const MAX_FILES = 20

/** The changed files as the expanded view lists them: `src/a.ts +12 -3`, … */
export function fileLines(stats: TurnStats, cwd: string): string[] {
  const named = stats.files.slice(0, MAX_FILES).map(path => withDiff(relativePath(path, cwd), stats.lines?.[path] ?? [0, 0]))
  const rest = stats.files.length - named.length

  return rest > 0 ? [...named, `… ${rest} more`] : named
}

/** Keeps the newest `max` entries of an insertion-ordered record. */
export function keepNewest<T>(record: Record<string, T>, max: number): Record<string, T> {
  const entries = Object.entries(record)
  return Object.fromEntries(entries.slice(Math.max(0, entries.length - max)))
}
