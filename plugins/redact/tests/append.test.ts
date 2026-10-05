import type { CommandRunInput, On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const SECRET = 'ghp_FAKEfake0123456789abcdefghijABCDEFGHIJ'

// The kit has no store beneath session.append, so the test's own hook stands
// for it and records the row as it reached the bottom: what would be stored
// and sent. Its answer is refused (a hook must relay the row), which rejects
// the call after the row was seen.
const engine = (on: On) => {
  const stored: { door: string; content: unknown }[] = []
  on('session.append', (_$, e) => {
    stored.push({ door: e.door, content: e.message.content })
    return { message: e.message, uuid: e.uuid } as never
  })

  return stored
}

const append = ($: Engine, door: string, content: unknown[]) =>
  $.session
    .append({ message: { type: 'user', role: 'user', content }, door, uuid: crypto.randomUUID(), origin: { kind: 'engine' } } as never)
    .catch(() => undefined)

const command = (args: string, kind = 'composer'): CommandRunInput => ({
  command: 'redact',
  args,
  origin: { kind } as CommandRunInput['origin'],
  presentation: { isFullscreen: false, columns: 100 },
})

test('a tool result reaches the bottom with its secret replaced', async ($, on) => {
  const stored = engine(on)
  await append($, 'tool-result', [{ type: 'tool_result', tool_use_id: 't1', content: `GITHUB_TOKEN=${SECRET}` }])
  expect(stored).toEqual([
    { door: 'tool-result', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'GITHUB_TOKEN=[redacted:github-token]' }] },
  ])
})

test('prompts pass untouched unless prompts is on', async ($, on) => {
  const stored = engine(on)
  await append($, 'prompt', [{ type: 'text', text: `use ${SECRET}` }])
  expect(stored.at(-1)?.content).toEqual([{ type: 'text', text: `use ${SECRET}` }])
})

test('prompts: true redacts prompts too', { options: { prompts: true } }, async ($, on) => {
  const stored = engine(on)
  await append($, 'prompt', [{ type: 'text', text: `use ${SECRET}` }])
  expect(stored.at(-1)?.content).toEqual([{ type: 'text', text: 'use [redacted:github-token]' }])
})

test('/redact counts what was hidden; /redact off pauses it for the person only', async ($, on) => {
  const stored = engine(on)
  await append($, 'tool-result', [{ type: 'text', text: `${SECRET} AKIAFAKEFAKE12345678 ${SECRET}` }])
  expect((await $.command.run(command(''))).text).toContain('github-token 2, aws-access-key 1')

  expect((await $.command.run(command('off', 'peer'))).text).toContain('only accepted from the person')
  expect((await $.command.run(command('off'))).text).toContain('Paused')
  await append($, 'tool-result', [{ type: 'text', text: SECRET }])
  expect(stored.at(-1)?.content).toEqual([{ type: 'text', text: SECRET }])

  await $.command.run(command('on'))
  await append($, 'tool-result', [{ type: 'text', text: SECRET }])
  expect(stored.at(-1)?.content).toEqual([{ type: 'text', text: '[redacted:github-token]' }])
})
