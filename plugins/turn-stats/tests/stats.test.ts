import { describe, expect, test } from 'claude-code/testing'

import { addCall, changedLines, emptyStats, fileLines, formatCost, keepNewest, MAX_FILES, relativePath, summarize, toolLabel, totalLines } from '../hooks/stats'

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

  test('an edit held for review changes no file', async () => {
    const stats = addCall(emptyStats(), 'Edit', { file_path: '/a.ts' }, false, { filePath: '/a.ts', staged: true })
    expect(stats.tools).toEqual({ Edit: 1 })
    expect(stats.files).toEqual([])
  })
})

describe('changedLines', () => {
  const patch = (...hunks: string[][]) => ({ structuredPatch: hunks.map(lines => ({ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines })) })

  test('counts the lines a patch added and removed, across hunks', async () => {
    expect(changedLines(patch([' a', '-b', '+c', '+d'], ['-e', '\\ No newline at end of file']))).toEqual([2, 2])
  })

  test("a new file's lines, from its content when the patch is empty", async () => {
    expect(changedLines({ type: 'create', content: 'a\nb\nc\n', structuredPatch: [] })).toEqual([3, 0])
    expect(changedLines({ type: 'create', content: 'a\r\nb', structuredPatch: [] })).toEqual([2, 0])
    expect(changedLines({ type: 'create', content: '', structuredPatch: [] })).toEqual([0, 0])
  })

  test('nothing to count', async () => {
    expect(changedLines({ type: 'update', content: 'a', structuredPatch: [] })).toBeUndefined()
    expect(changedLines({ new_source: 'x', notebook_path: '/n.ipynb' })).toBeUndefined()
    expect(changedLines(undefined)).toBeUndefined()
  })

  test('addCall keeps them per file, written edits only', async () => {
    let stats = emptyStats()
    stats = addCall(stats, 'Edit', { file_path: '/a.ts' }, false, patch(['-x', '+y']))
    stats = addCall(stats, 'Edit', { file_path: '/a.ts' }, false, patch(['+z']))
    stats = addCall(stats, 'Write', { file_path: '/b.ts' }, false, { type: 'create', content: 'one\ntwo\n', structuredPatch: [] })
    stats = addCall(stats, 'Edit', { file_path: '/c.ts' }, false, { ...patch(['+q']), staged: true })
    stats = addCall(stats, 'Edit', { file_path: '/d.ts' }, true, patch(['+q']))

    expect(stats.lines).toEqual({ '/a.ts': [2, 1], '/b.ts': [2, 0] })
    expect(totalLines(stats)).toEqual([4, 1])
    expect(totalLines(emptyStats())).toEqual([0, 0])
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

  test('lines added and removed follow the files', async () => {
    const stats = { tools: { Edit: 3 }, failed: 0, files: ['/a', '/b'], lines: { '/a': [100, 30], '/b': [20, 4] } as Record<string, [number, number]> }
    expect(summarize(stats, OPTIONS)).toBe('3 tools (Edit 3) · 2 files +120 -34')
    expect(summarize({ ...stats, lines: { '/a': [0, 34] } }, OPTIONS)).toBe('3 tools (Edit 3) · 2 files -34')
    expect(summarize({ ...stats, lines: { '/a': [0, 0] } }, OPTIONS)).toBe('3 tools (Edit 3) · 2 files')
  })

  test('nothing to say', async () => {
    expect(summarize(emptyStats(), OPTIONS)).toBeUndefined()
    expect(summarize({ ...emptyStats(), costUsd: 0 }, OPTIONS)).toBeUndefined()
  })

  test('a turn without tools still shows its cost', async () => {
    expect(summarize({ ...emptyStats(), costUsd: 0.0123 }, OPTIONS)).toBe('$0.012')
  })
})

describe('expanded view', () => {
  test('relativePath', async () => {
    expect(relativePath('/repo/src/a.ts', '/repo')).toBe('src/a.ts')
    expect(relativePath('/repo/src/a.ts', '/repo/')).toBe('src/a.ts')
    expect(relativePath('/repository/a.ts', '/repo')).toBe('/repository/a.ts')
    expect(relativePath('/other/a.ts', '/repo')).toBe('/other/a.ts')
    expect(relativePath('/repo', '/repo')).toBe('/repo')
    expect(relativePath('C:\\Work\\App\\src\\a.ts', 'c:\\work\\app')).toBe('src\\a.ts')
    expect(relativePath('/Repo/a.ts', '/repo')).toBe('/Repo/a.ts')
    expect(relativePath('/repo/a.ts', '')).toBe('/repo/a.ts')
  })

  test('fileLines names each file with its lines, then how many more', async () => {
    const stats = { tools: {}, failed: 0, files: ['/repo/a.ts', '/repo/b.ts', '/n.ipynb'], lines: { '/repo/a.ts': [12, 3], '/repo/b.ts': [0, 4] } as Record<string, [number, number]> }
    expect(fileLines(stats, '/repo')).toEqual(['a.ts +12 -3', 'b.ts -4', '/n.ipynb'])

    const many = { ...emptyStats(), files: Array.from({ length: MAX_FILES + 3 }, (_, i) => `/repo/f${i}`) }
    const listed = fileLines(many, '/repo')
    expect(listed).toHaveLength(MAX_FILES + 1)
    expect(listed.at(-1)).toBe('… 3 more')
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
