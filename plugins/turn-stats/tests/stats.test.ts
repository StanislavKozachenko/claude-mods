import { describe, expect, test } from 'claude-code/testing'

import { addCall, emptyStats, formatCost, keepNewest, summarize, toolLabel } from '../hooks/stats'

const OPTIONS = { topTools: 3, isCostShown: true }

describe('addCall', () => {
  test('counts calls by tool, failures and changed files once each', async () => {
    let stats = emptyStats()
    stats = addCall(stats, 'Bash', { command: 'ls' }, false)
    stats = addCall(stats, 'Bash', { command: 'false' }, true)
    stats = addCall(stats, 'Edit', { file_path: '/a.ts' }, false)
    stats = addCall(stats, 'Edit', { file_path: '/a.ts' }, false)
    stats = addCall(stats, 'Write', { file_path: '/b.ts' }, true)
    stats = addCall(stats, 'NotebookEdit', { notebook_path: '/n.ipynb' }, false)

    expect(stats.tools).toEqual({ Bash: 2, Edit: 2, Write: 1, NotebookEdit: 1 })
    expect(stats.failed).toBe(2)
    expect(stats.files).toEqual(['/a.ts', '/n.ipynb'])
  })
})

describe('summarize', () => {
  test('tools, the most used first, then failures, files and cost', async () => {
    const stats = {
      tools: { Read: 3, Bash: 6, Edit: 5, Grep: 1 },
      failed: 2,
      files: ['/a', '/b', '/c', '/d'],
      costUsd: 0.4213,
    }
    expect(summarize(stats, OPTIONS)).toBe('15 tools (Bash 6, Edit 5, Read 3, …) · 2 failed · 4 files · $0.42')
  })

  test('singulars, no breakdown, no cost', async () => {
    const stats = { tools: { Edit: 1 }, failed: 0, files: ['/a'], costUsd: 0.2 }
    expect(summarize(stats, { topTools: 0, isCostShown: false })).toBe('1 tool · 1 file')
  })

  test('nothing to say', async () => {
    expect(summarize(emptyStats(), OPTIONS)).toBeUndefined()
    expect(summarize({ ...emptyStats(), costUsd: 0 }, OPTIONS)).toBeUndefined()
  })

  test('a turn without tools still shows its cost', async () => {
    expect(summarize({ ...emptyStats(), costUsd: 0.0123 }, OPTIONS)).toBe('$0.012')
  })
})

describe('helpers', () => {
  test('toolLabel, formatCost, keepNewest', async () => {
    expect(toolLabel('mcp__linear__create_issue')).toBe('linear.create_issue')
    expect(toolLabel('mcp__claude_ai_Notion__search')).toBe('claude_ai_Notion.search')
    expect(toolLabel('Bash')).toBe('Bash')
    expect(formatCost(0.0004)).toBe('<$0.001')
    expect(formatCost(0.05)).toBe('$0.050')
    expect(formatCost(1.234)).toBe('$1.23')
    expect(Object.keys(keepNewest({ a: 1, b: 2, c: 3 }, 2))).toEqual(['b', 'c'])
  })
})
