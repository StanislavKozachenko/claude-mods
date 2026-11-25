import { describe, expect, test } from 'claude-code/testing'

import { DEFAULT_RULES, describe as say, hueOf, judge, lookKey, lookOf, matches, repoName, segments } from '../hooks/look'
import type { Place } from '../hooks/look'

const place = (over: Partial<Place> = {}): Place => ({
  name: 'app',
  root: '/home/me/src/app',
  branch: 'feat/login',
  defaultBranch: 'main',
  ...over,
})

describe('matches', () => {
  test('globs whole names, ignoring case', async () => {
    expect(matches('main', 'main')).toBe(true)
    expect(matches('main', 'Main')).toBe(true)
    expect(matches('main', 'main-old')).toBe(false)
    expect(matches('release/*', 'release/2.4')).toBe(true)
    expect(matches('release/*', 'feat/release')).toBe(false)
    expect(matches('prod*', 'production')).toBe(true)
    expect(matches('v?', 'v2')).toBe(true)
  })

  test('takes regex characters literally and an empty glob as nothing', async () => {
    expect(matches('a.b', 'axb')).toBe(false)
    expect(matches('a+b', 'a+b')).toBe(true)
    expect(matches('  ', '')).toBe(false)
  })
})

describe('segments and repoName', () => {
  test('splits both slashes and drops the drive', async () => {
    expect(segments('C:\\Users\\me\\deploy\\app')).toEqual(['Users', 'me', 'deploy', 'app'])
    expect(segments('/srv/prod/app/')).toEqual(['srv', 'prod', 'app'])
  })

  test('names the repository from ssh and https remotes', async () => {
    expect(repoName('git@github.com:org/claude-mods.git')).toBe('claude-mods')
    expect(repoName('https://github.com/org/claude-mods/')).toBe('claude-mods')
    expect(repoName(null)).toBeUndefined()
  })
})

describe('hueOf', () => {
  test('is the same for the same name and stays out of the warm band', async () => {
    expect(hueOf('claude-mods')).toBe(hueOf('Claude-Mods'))
    for (const name of ['a', 'b', 'api', 'web', 'claude-mods', 'infra', 'docs', 'x'.repeat(40)]) {
      const hue = hueOf(name)
      expect(hue >= 75 && hue < 320).toBe(true)
    }
  })

  test('spreads different names apart', async () => {
    const hues = new Set(['api', 'web', 'docs', 'infra', 'mobile', 'billing'].map(hueOf))
    expect(hues.size).toBeGreaterThan(4)
  })
})

describe('judge', () => {
  test('a feature branch is calm, with the project hue', async () => {
    expect(judge(place(), DEFAULT_RULES)).toEqual({ isRisky: false, hue: hueOf('app') })
  })

  test('a listed branch warns', async () => {
    const verdict = judge(place({ branch: 'release/3.1' }), DEFAULT_RULES)
    expect(verdict).toEqual({ isRisky: true, reason: 'branch release/3.1 matches release/*' })
  })

  test('the default branch warns by any name, unless turned off', async () => {
    const develop = place({ branch: 'develop', defaultBranch: 'develop' })
    expect(judge(develop, DEFAULT_RULES).isRisky).toBe(true)
    expect(judge(develop, { ...DEFAULT_RULES, isDefaultBranchRisky: false }).isRisky).toBe(false)
  })

  test('a folder on the path warns, even outside a repository', async () => {
    const verdict = judge(place({ root: 'D:\\work\\deploy\\site', branch: null, defaultBranch: null }), DEFAULT_RULES)
    expect(verdict).toEqual({ isRisky: true, reason: 'folder deploy matches deploy' })
  })

  test('a detached head is judged by its folder alone', async () => {
    expect(judge(place({ branch: null }), DEFAULT_RULES).isRisky).toBe(false)
  })

  test('empty rules never warn', async () => {
    const none = { riskyBranches: [], riskyPaths: [], isDefaultBranchRisky: false }
    expect(judge(place({ branch: 'main', root: '/srv/prod' }), none).isRisky).toBe(false)
  })
})

describe('lookOf', () => {
  test('keeps the middle on the page surface and tints the edges', async () => {
    const calm = lookOf({ isRisky: false, hue: 200 })
    expect(calm).toEqual({
      backdrop: {
        gradient: {
          shape: 'radial',
          stops: [
            { at: 0, color: 'surface-0' },
            { at: 0.55, color: 'surface-0' },
            { at: 1, color: 'hsl(200 45% 55%)' },
          ],
        },
      },
    })
    const risky = lookOf({ isRisky: true, reason: 'x' })
    expect(JSON.stringify(risky)).toContain('fill-warning')
  })

  test('keys only by what is drawn', async () => {
    expect(lookKey({ isRisky: true, reason: 'a' })).toBe(lookKey({ isRisky: true, reason: 'b' }))
    expect(lookKey({ isRisky: false, hue: 100 })).not.toBe(lookKey({ isRisky: false, hue: 101 }))
  })

  test('says why', async () => {
    expect(say(place({ branch: 'main' }), { isRisky: true, reason: 'branch main matches main' })).toBe(
      'app on main: warning tint, branch main matches main.',
    )
    expect(say(place({ branch: null }), { isRisky: false, hue: 120 })).toBe('app: calm tint, hue 120.')
  })
})
