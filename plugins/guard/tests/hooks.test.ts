import type { CommandRunInput, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

// The test's own tool.call hook stands for the engine beneath the mod: a call
// that reaches it was let through.
const RAN = { result: { stdout: 'ran', stderr: '', interrupted: false } } as never

const engine = (on: On) => {
  mock.clock(on, { now: 1_700_000_000_000 })
  on('tool.call', () => RAN)
}

const guard = (args: string, kind: 'composer' | 'peer' = 'composer'): CommandRunInput => ({
  command: 'guard',
  args,
  origin: { kind } as CommandRunInput['origin'],
  presentation: { isFullscreen: false, columns: 120 },
})

test('denies a destructive command with a reason the model can act on', async ($, on) => {
  engine(on)

  const denied = await $.tool.call({ tool: 'Bash', command: 'cd /tmp && rm -rf /' })
  expect(denied.deny).toContain('guard blocked this (rm-rf)')
  expect(denied.deny).toContain('force-deletes / recursively')

  const passed = await $.tool.call({ tool: 'Bash', command: 'rm -rf node_modules' })
  expect(passed.deny).toBeUndefined()
})

test('denies reading and writing secret files', async ($, on) => {
  engine(on)

  expect((await $.tool.call({ tool: 'Read', file_path: '/repo/.env' })).deny).toContain('secret-file')
  expect((await $.tool.call({ tool: 'Write', file_path: '/repo/.env.local', content: 'A=1' })).deny).toContain('secret-file')
  expect(
    (await $.tool.call({ tool: 'Edit', file_path: '/repo/id_rsa', old_string: 'a', new_string: 'b' })).deny,
  ).toContain('secret-file')
  expect((await $.tool.call({ tool: 'Grep', pattern: 'KEY', path: '/repo/.env' } as never)).deny).toContain('secret-file')
  expect((await $.tool.call({ tool: 'Read', file_path: '/repo/.env.example' })).deny).toBeUndefined()
})

test('honours userConfig', { options: { destructive: false, protectPaths: ['migrations/**'] } }, async ($, on) => {
  engine(on)

  expect((await $.tool.call({ tool: 'Bash', command: 'git reset --hard' })).deny).toBeUndefined()
  expect((await $.tool.call({ tool: 'Write', file_path: '/repo/migrations/1.sql', content: '' })).deny).toContain(
    'protected-path',
  )
})

test('/guard lists the rules and the blocks of the session', async ($, on) => {
  engine(on)
  await $.tool.call({ tool: 'Bash', command: 'git push --force' })

  const { text } = await $.command.run(guard(''))
  expect(text).toContain('Active.')
  expect(text).toContain('Blocked this session (1):')
  expect(text).toContain('Bash · git-force-push · git push --force')
})

test('/guard off pauses it for the person, /guard on resumes it', async ($, on) => {
  engine(on)

  expect((await $.command.run(guard('off'))).text).toContain('Paused')
  expect((await $.tool.call({ tool: 'Bash', command: 'git reset --hard' })).deny).toBeUndefined()

  await $.command.run(guard('on'))
  expect((await $.tool.call({ tool: 'Bash', command: 'git reset --hard' })).deny).toContain('git-reset-hard')
})

test('/guard off is refused when it does not come from the person', async ($, on) => {
  engine(on)

  expect((await $.command.run(guard('off', 'peer'))).text).toContain('only accepted from the person')
  expect((await $.tool.call({ tool: 'Bash', command: 'git reset --hard' })).deny).toContain('git-reset-hard')
})
