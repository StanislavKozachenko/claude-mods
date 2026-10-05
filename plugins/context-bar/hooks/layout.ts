// The bar's layout as pure functions: no `$`, so tests call them directly.

import type { ContextSnapshot, SnapshotCategory } from '../types'

export type Segment = {
  name: string
  color: string
  kind: SnapshotCategory['kind']
  cells: number
}

export type LegendItem = { name: string; color: string; kind: SnapshotCategory['kind']; label: string }

/** The glyph a segment is drawn with: used space solid, the buffer shaded, free space light. */
export const GLYPH: Record<SnapshotCategory['kind'], string> = {
  used: '█',
  buffer: '▒',
  free: '░',
  deferred: '',
}

/** `950`, `12.3k`, `124k`, `1.2M`: short enough for a band. */
export function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(Math.round(tokens))
  if (tokens < 10_000) return `${(tokens / 1000).toFixed(1).replace(/\.0$/, '')}k`
  if (tokens < 1_000_000) return `${Math.round(tokens / 1000)}k`
  return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

/** The categories the bar draws: deferred tool schemas are not in the window, empty rows take no room. */
export const drawn = (snapshot: ContextSnapshot) =>
  snapshot.categories.filter(category => category.kind !== 'deferred' && category.tokens > 0)

/**
 * Splits `width` cells between the categories in proportion to their tokens,
 * by largest remainder so the cells add up to `width` exactly. Every used
 * category keeps at least one cell while there is room, taken from the
 * largest segment, so a small one does not vanish.
 */
export function allocate(snapshot: ContextSnapshot, width: number): Segment[] {
  const categories = drawn(snapshot)
  const total = categories.reduce((sum, category) => sum + category.tokens, 0)
  if (width <= 0 || total <= 0) return []

  const exact = categories.map(category => (category.tokens / total) * width)
  const cells = exact.map(Math.floor)
  let left = width - cells.reduce((sum, n) => sum + n, 0)
  const byRemainder = exact.map((value, i) => ({ i, rest: value - Math.floor(value) })).sort((a, b) => b.rest - a.rest)
  for (const { i } of byRemainder) {
    if (left <= 0) break
    cells[i]! += 1
    left -= 1
  }

  categories.forEach((category, i) => {
    if (category.kind !== 'used' || cells[i]! > 0) return
    const largest = cells.indexOf(Math.max(...cells))
    if (cells[largest]! > 1) {
      cells[largest]! -= 1
      cells[i] = 1
    }
  })

  return categories
    .map((category, i) => ({ name: category.name, color: category.color, kind: category.kind, cells: cells[i]! }))
    .filter(segment => segment.cells > 0)
}

/** `62% · 124k / 200k` */
export function summary(snapshot: ContextSnapshot): string {
  return `${snapshot.percent}% · ${formatTokens(snapshot.usedTokens)} / ${formatTokens(snapshot.maxTokens)}`
}

/** Legend order: what takes the space first, then the buffer, free space last. */
const KIND_ORDER: Record<SnapshotCategory['kind'], number> = { used: 0, buffer: 1, free: 2, deferred: 3 }

/**
 * The legend's items, used categories largest first, then the buffer and free
 * space, as many as fit in `width` cells (`■ name 12k` and two spaces between
 * items); the rest are counted in a final `+N more` when that fits.
 */
export function legend(snapshot: ContextSnapshot, width: number): LegendItem[] {
  const items = drawn(snapshot)
    .slice()
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.tokens - a.tokens)
    .map(category => ({
      name: category.name,
      color: category.color,
      kind: category.kind,
      label: `${category.name} ${formatTokens(category.tokens)}`,
    }))

  const fitted: LegendItem[] = []
  let used = 0
  for (const [i, item] of items.entries()) {
    const gap = fitted.length > 0 ? 2 : 0
    const after = items.length - i - 1
    const reserve = after > 0 ? 2 + `+${after} more`.length : 0
    if (used + gap + 2 + item.label.length + reserve <= width) {
      fitted.push(item)
      used += gap + 2 + item.label.length
      continue
    }
    const more = `+${items.length - i} more`
    if (used + gap + more.length <= width) fitted.push({ name: '', color: '', kind: 'free', label: more })
    break
  }

  return fitted
}
