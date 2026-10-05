import { describe, expect, test } from 'claude-code/testing'

import type { ContextSnapshot } from '../types'
import { allocate, formatTokens, legend, summary } from '../hooks/layout'

const SNAPSHOT: ContextSnapshot = {
  categories: [
    { name: 'System prompt', tokens: 3_000, color: 'promptBorder', kind: 'used' },
    { name: 'System tools', tokens: 12_000, color: 'inactive', kind: 'used' },
    { name: 'MCP tools', tokens: 9_000, color: 'cyan_FOR_SUBAGENTS_ONLY', kind: 'deferred' },
    { name: 'Memory files', tokens: 200, color: 'claude', kind: 'used' },
    { name: 'Messages', tokens: 45_000, color: 'purple_FOR_SUBAGENTS_ONLY', kind: 'used' },
    { name: 'Free space', tokens: 106_800, color: 'promptBorder', kind: 'free' },
    { name: 'Autocompact buffer', tokens: 33_000, color: 'inactive', kind: 'buffer' },
  ],
  usedTokens: 60_200,
  maxTokens: 200_000,
  percent: 30,
  at: 0,
}

describe('formatTokens', () => {
  test('keeps it short', async () => {
    expect(formatTokens(950)).toBe('950')
    expect(formatTokens(3_000)).toBe('3k')
    expect(formatTokens(12_345)).toBe('12k')
    expect(formatTokens(1_250)).toBe('1.3k')
    expect(formatTokens(200_000)).toBe('200k')
    expect(formatTokens(1_000_000)).toBe('1M')
  })
})

describe('allocate', () => {
  test('fills the width exactly, in proportion, without deferred rows', async () => {
    for (const width of [10, 37, 60, 143]) {
      const segments = allocate(SNAPSHOT, width)
      expect(segments.reduce((sum, segment) => sum + segment.cells, 0)).toBe(width)
      expect(segments.some(segment => segment.name === 'MCP tools')).toBe(false)
    }
    const wide = allocate(SNAPSHOT, 200)
    expect(wide.find(segment => segment.name === 'Messages')?.cells).toBe(45)
    // Memory files (0.2 of a cell) takes its one cell from the largest segment
    expect(wide.find(segment => segment.name === 'Free space')?.cells).toBe(106)
    expect(wide.find(segment => segment.name === 'Memory files')?.cells).toBe(1)
  })

  test('a small used category keeps one cell', async () => {
    const segments = allocate(SNAPSHOT, 40)
    expect(segments.find(segment => segment.name === 'Memory files')?.cells).toBe(1)
    expect(segments.reduce((sum, segment) => sum + segment.cells, 0)).toBe(40)
  })

  test('nothing to draw', async () => {
    expect(allocate(SNAPSHOT, 0)).toEqual([])
    expect(allocate({ ...SNAPSHOT, categories: [] }, 40)).toEqual([])
  })
})

describe('summary and legend', () => {
  test('summary', async () => {
    expect(summary(SNAPSHOT)).toBe('30% · 60k / 200k')
  })

  test('legend lists used space largest first, then the buffer, free space last', async () => {
    const wide = legend(SNAPSHOT, 200).map(item => item.label)
    expect(wide).toEqual([
      'Messages 45k',
      'System tools 12k',
      'System prompt 3k',
      'Memory files 200',
      'Autocompact buffer 33k',
      'Free space 107k',
    ])

    const narrow = legend(SNAPSHOT, 40)
    const width = narrow.reduce((sum, item, i) => sum + (i > 0 ? 2 : 0) + (item.name === '' ? 0 : 2) + item.label.length, 0)
    expect(width <= 40).toBe(true)
    expect(narrow.at(-1)?.label).toMatch(/^\+\d more$/)
  })
})
