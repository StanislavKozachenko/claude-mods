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

/** Adds one finished tool call to the stats. */
export function addCall(stats: TurnStats, tool: string, input: Readonly<Record<string, unknown>>, isError: boolean): TurnStats {
  const field = FILE_TOOLS[tool]
  const path = field === undefined ? undefined : input[field]
  const files = typeof path === 'string' && !isError && !stats.files.includes(path) ? [...stats.files, path] : stats.files

  return {
    ...stats,
    tools: { ...stats.tools, [tool]: (stats.tools[tool] ?? 0) + 1 },
    failed: stats.failed + (isError ? 1 : 0),
    files,
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
 * `14 tools (Bash 6, Edit 5, Read 3) · 2 failed · 4 files · $0.42`, or
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
  if (stats.files.length > 0) parts.push(`${stats.files.length} ${stats.files.length === 1 ? 'file' : 'files'}`)
  if (options.isCostShown && stats.costUsd !== undefined && stats.costUsd > 0) parts.push(formatCost(stats.costUsd))

  return parts.length > 0 ? parts.join(' · ') : undefined
}

/** Keeps the newest `max` entries of an insertion-ordered record. */
export function keepNewest<T>(record: Record<string, T>, max: number): Record<string, T> {
  const entries = Object.entries(record)
  return Object.fromEntries(entries.slice(Math.max(0, entries.length - max)))
}
