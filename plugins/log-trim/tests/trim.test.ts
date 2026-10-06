import { describe, expect, test } from 'claude-code/testing'

import { clean, collapse, excerpt, header, isNoisy, isProgress, persistedPath, trim } from '../hooks/trim'

const ESC = String.fromCharCode(27)

// What `npm run build` of a webpack/tsc project prints, shortened
function buildLog(modules: number): string {
  const out = [`${ESC}[1m> app@1.0.0 build${ESC}[22m`]
  for (let p = 0; p <= 100; p += 10) out.push(`\r[${'#'.repeat(p / 10).padEnd(10)}] ${p}% resolving packages`)
  for (let i = 1; i <= modules; i++) out.push(`${ESC}[32m✓${ESC}[39m compiled src/m${i}.ts in ${10 + (i % 90)}ms`)
  out.push(`${ESC}[33mwarning${ESC}[39m src/legacy.ts: "moment" is deprecated`)
  out.push(`${ESC}[31mERROR${ESC}[39m in src/api/client.ts:42:7`)
  out.push("TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.")
  out.push('    at checkCall (node_modules/typescript/lib/tsc.js:1200:5)')
  out.push('build failed with 1 error')
  return out.join('\n')
}

describe('which commands', () => {
  test('noisy commands, through wrappers', async () => {
    for (const command of [
      'npm run build',
      'pnpm install',
      'cd app && yarn test --ci',
      'NODE_ENV=test npx jest',
      'sudo docker build -t app .',
      'gh run view 123 --log-failed',
      './gradlew assemble',
      'terraform plan',
    ]) {
      expect(isNoisy(command)).toBe(true)
    }
  })

  test('readers and everything else are left alone', async () => {
    for (const command of ['cat build.log', 'tail -n 200 npm-debug.log', 'git diff', 'git log -p', 'grep ERROR out.txt', 'ls -la', 'echo hi', 'node script.js']) {
      expect(isNoisy(command)).toBe(false)
    }
    expect(isNoisy('node script.js', [/^node script/])).toBe(true)
  })
})

describe('cleaning', () => {
  test('ANSI codes go, a line rewritten with \\r keeps its last state', async () => {
    expect(clean(`${ESC}[31mred${ESC}[0m plain`)).toEqual(['red plain'])
    expect(clean('10%\r50%\r100% done\r\nnext')).toEqual(['100% done', 'next'])
  })

  test('progress-only lines are recognised, errors never are', async () => {
    for (const line of ['[####      ] 40% resolving packages', '⠋', '45%', 'Downloading foo.tar.gz 3.2 MB/10 MB', '[=====================>      ]']) {
      expect(isProgress(line)).toBe(true)
    }
    for (const line of ['ERROR 50% of tests failed', 'compiled src/a.ts in 12ms', '', 'Tests: 3 failed, 97 passed']) {
      expect(isProgress(line)).toBe(false)
    }
  })

  test('runs of similar lines collapse, errors inside a run stay', async () => {
    const lines = ['start', 'compiled a1.ts in 10ms', 'compiled a2.ts in 11ms', 'compiled a3.ts in 12ms', 'compiled a4.ts in 13ms', 'end']
    expect(collapse(lines)).toEqual(['start', 'compiled a1.ts in 10ms', '… 2 similar lines', 'compiled a4.ts in 13ms', 'end'])
    const withError = ['ok 1', 'ok 2', 'error 3', 'ok 4', 'ok 5']
    expect(collapse(withError)).toEqual(withError)
  })

  test('a long output keeps head, every error with its stack, and tail', async () => {
    const lines = Array.from({ length: 1000 }, (_, i) => `line ${i} ${'x'.repeat(i % 7)}`)
    lines[500] = 'Error: boom'
    lines[501] = '    at fn (a.js:1:1)'
    lines[502] = '    at main (a.js:2:1)'
    const out = excerpt(lines, 150)
    expect(out.slice(0, 2)).toEqual(['line 0 ', 'line 1 x'])
    expect(out).toContain('Error: boom')
    expect(out).toContain('    at main (a.js:2:1)')
    expect(out.at(-1)).toBe(lines[999])
    expect(out.filter(line => /lines omitted$/.test(line))).toHaveLength(2)
  })
})

describe('trim', () => {
  test('a build log shrinks to what matters', async () => {
    const trimmed = trim(buildLog(400), { maxLines: 150 })!
    expect(trimmed.linesBefore).toBeGreaterThan(400)
    expect(trimmed.linesAfter).toBeLessThan(15)
    expect(trimmed.text).not.toContain(ESC)
    expect(trimmed.text).not.toContain('resolving packages')
    expect(trimmed.text).toContain('… 398 similar lines')
    expect(trimmed.text).toContain('ERROR in src/api/client.ts:42:7')
    expect(trimmed.text).toContain('    at checkCall')
    expect(trimmed.text).toContain('build failed with 1 error')
  })

  test('short or already clean output is left alone', async () => {
    expect(trim('added 3 packages in 2s\nfound 0 vulnerabilities', { maxLines: 150 })).toBeUndefined()
  })

  test('persistedPath and header', async () => {
    const note = '<persisted-output>\nOutput too large (164.9KB). Full output saved to: C:\\Users\\me\\tool-results\\abc.txt\n\nPreview (first 2KB):\n1\n2\n</persisted-output>'
    expect(persistedPath(note)).toBe('C:\\Users\\me\\tool-results\\abc.txt')
    expect(persistedPath('plain output')).toBeUndefined()
    expect(header({ text: '', linesBefore: 3100, linesAfter: 27, charsSaved: 1 }, '/tmp/x.log')).toBe('[log-trim: 3100 → 27 lines; full output: /tmp/x.log]')
  })
})
