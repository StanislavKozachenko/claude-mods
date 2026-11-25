import type { On, ThemeSetArgs, VcsWorkingCopy } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { hueOf } from '../hooks/look'

// The engine beneath the mod: a folder no platform resolves elsewhere (on
// macOS /home does, and the engine then drops a copy whose root is spelled
// otherwise), a working copy the test moves, and the
// themes the mod set.
const engine = (on: On, copy: VcsWorkingCopy | null) => {
  const state = { copy, themes: [] as ThemeSetArgs[] }
  on('session.cwd', () => ({ value: '/work/app' }) as never)
  on('vcs.detect', () => state.copy as never)
  on('theme.set', (_$, e) => {
    state.themes.push(e as ThemeSetArgs)
    return { value: { isDrawn: false, reason: 'no desktop attached' } } as never
  })
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))

  return state
}

const COPY: VcsWorkingCopy = {
  vcs: 'git',
  root: '/work/app',
  mainRoot: '/work/app',
  revision: 'abc',
  branch: 'feat/login',
  defaultBranch: 'main',
  remote: 'git@github.com:org/shop.git',
}

const START = { cwd: '/work/app', surface: 'desktop', isInteractive: true } as const

const TURN = { answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as const

const edge = (theme: ThemeSetArgs | undefined) => JSON.stringify(theme?.backdrop)

test('a feature branch gets the calm hue of the remote repository', async ($, on) => {
  const state = engine(on, COPY)
  await $.session.start(START)

  expect(state.themes).toHaveLength(1)
  expect(edge(state.themes[0])).toContain(`hsl(${hueOf('shop')} 45% 55%)`)
})

test('switching to main during a turn turns the tint to a warning, once', async ($, on) => {
  const state = engine(on, COPY)
  await $.session.start(START)

  state.copy = { ...COPY, branch: 'main' }
  await $.turn.complete(TURN)
  await $.turn.complete(TURN)

  expect(state.themes).toHaveLength(2)
  expect(edge(state.themes[1])).toContain('fill-warning')
})

test('outside a repository the folder names the hue', async ($, on) => {
  const state = engine(on, null)
  await $.session.start(START)

  expect(edge(state.themes[0])).toContain(`hsl(${hueOf('app')} 45% 55%)`)
})

test('/tint says why and sets the look again', async ($, on) => {
  const state = engine(on, { ...COPY, branch: 'release/2.0' })
  await $.session.start(START)

  const said = await $.command.run({ command: 'tint', args: '' } as never)
  expect(said.text).toBe('shop on release/2.0: warning tint, branch release/2.0 matches release/*. Not drawn here: no desktop attached')
  expect(state.themes).toHaveLength(2)
})
