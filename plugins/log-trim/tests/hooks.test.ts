import type { CommandRunInput, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const NOISY_LOG = [
  '> app@1.0.0 test',
  ...Array.from({ length: 300 }, (_, i) => `PASS src/test-${i}.spec.ts (${i % 9}.1 s)`),
  'FAIL src/api.spec.ts',
  '  ● client › retries',
  '    Expected: 3',
  'Tests: 1 failed, 300 passed',
].join('\n')

// The engine beneath the mod: shell calls whose ids the test reads back, files
// in memory, and the row as it reaches the bottom of session.append (the kit
// stores nothing there, so the call itself rejects after the row was seen).
/** The engine resolves paths for the platform (`/tmp/x` is `C:\tmp\x` on Windows): compare them without drive or slash style. */
const norm = (path: unknown) => String(path).replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')

const engine = (on: On) => {
  const ids: string[] = []
  const files = new Map<string, string>()
  const stored: unknown[] = []
  const asked: string[] = []
  mock.env(on, { TMPDIR: '/tmp' })
  on('tool.call', (_$, e) => {
    ids.push(e.tool_use_id)
    return { result: { stdout: '', stderr: '', interrupted: false } } as never
  })
  on('fs.read', (_$, e) => {
    asked.push(norm((e as { path?: unknown }).path))
    return { value: files.get(norm((e as { path?: unknown }).path)) } as never
  })
  on('fs.write', (_$, e) => {
    const { path, text } = e as { path?: unknown; text?: unknown }
    files.set(norm(path), String(text))
    return { value: undefined } as never
  })
  on('session.append', (_$, e) => {
    stored.push(e.message.content)
    return { message: e.message, uuid: e.uuid } as never
  })
  return { ids, files, stored, asked }
}

async function run($: Engine, ids: string[], command: string, output: string, tool = 'Bash') {
  await $.tool.call({ tool: 'Bash', command })
  const id = ids.at(-1)!
  await $.session
    .append({
      message: { type: 'user', role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: output }] },
      door: 'tool-result',
      origin: { kind: 'tool', tool },
      uuid: crypto.randomUUID(),
    } as never)
    .catch(() => undefined)
  return id
}

const resultText = (stored: unknown[]) => ((stored.at(-1) as { content: string }[])[0]!).content

test('a noisy command reaches the model condensed, the full log kept in a file', async ($, on) => {
  const { ids, files, stored } = engine(on)
  const id = await run($, ids, 'npm test', NOISY_LOG)

  const text = resultText(stored)
  expect(text.split('\n')[0]).toBe(`[log-trim: 305 → 8 lines; full output: /tmp/claude-log-trim/${id.replace(/[^\w-]/g, '')}.log]`)
  expect(text).toContain('… 298 similar lines')
  expect(text).toContain('FAIL src/api.spec.ts')
  expect(text).toContain('Tests: 1 failed, 300 passed')
  expect(files.get(`/tmp/claude-log-trim/${id.replace(/[^\w-]/g, '')}.log`)).toBe(NOISY_LOG)
})

test('output Claude Code saved to a file is replaced by the digest of the whole file', async ($, on) => {
  const { ids, files, stored } = engine(on)
  files.set('/home/me/tool-results/abc.txt', NOISY_LOG)
  const note = '<persisted-output>\nOutput too large (120KB). Full output saved to: /home/me/tool-results/abc.txt\n\nPreview (first 2KB):\n> app@1.0.0 test\n...\n</persisted-output>'
  await run($, ids, 'npm test', note)

  const text = resultText(stored)
  expect(text.split('\n')[0]).toBe('[log-trim: 305 → 8 lines; full output: /home/me/tool-results/abc.txt]')
  expect(text).toContain('FAIL src/api.spec.ts')
})

test('readers, other tools and short output pass untouched', async ($, on) => {
  const { ids, stored } = engine(on)
  await run($, ids, 'cat build.log', NOISY_LOG)
  expect(resultText(stored)).toBe(NOISY_LOG)
  await run($, ids, 'npm test', NOISY_LOG, 'Read')
  expect(resultText(stored)).toBe(NOISY_LOG)
  await run($, ids, 'npm ci', 'added 3 packages in 2s')
  expect(resultText(stored)).toBe('added 3 packages in 2s')
})

test('commands extends the noisy list', { options: { commands: ['^node scripts/build'] } }, async ($, on) => {
  const { ids, stored } = engine(on)
  await run($, ids, 'node scripts/build.js', NOISY_LOG)
  expect(resultText(stored)).toContain('[log-trim: 305 → 8 lines')
})

test('/log-trim reports what was saved; /log-trim off from the person pauses it', async ($, on) => {
  const { ids, stored } = engine(on)
  const command = (args: string, kind = 'composer'): CommandRunInput => ({
    command: 'log-trim',
    args,
    origin: { kind } as CommandRunInput['origin'],
    presentation: { isFullscreen: false, columns: 100 },
  })
  await run($, ids, 'npm test', NOISY_LOG)
  expect((await $.command.run(command(''))).text).toContain('Condensed 1 command output: 305 → 8 lines')

  expect((await $.command.run(command('off', 'peer'))).text).toContain('only accepted from the person')
  await $.command.run(command('off'))
  await run($, ids, 'npm test', NOISY_LOG)
  expect(resultText(stored)).toBe(NOISY_LOG)
})
