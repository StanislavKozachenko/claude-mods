import type { EngineInterface, Register, ThemeResult } from 'claude-code'

import { DEFAULT_RULES, describe, judge, lookKey, lookOf, repoName, segments } from './look'
import type { Place, Rules } from './look'

const list = (value: unknown, fallback: readonly string[]) =>
  Array.isArray(value) ? value.map(String).filter(item => item.trim() !== '') : fallback

/** Where the session works now: its working copy, else its folder. */
async function placeOf($: EngineInterface): Promise<Place> {
  const cwd = await $.session.cwd()
  const copy = await $.vcs.detect({ path: cwd }).catch(() => null)
  if (copy === null) {
    return { name: segments(cwd).pop() ?? cwd, root: cwd, branch: null, defaultBranch: null }
  }
  // Worktrees and clones of one repository share its name, so they share a tint.
  const main = copy.mainRoot ?? copy.root

  return {
    name: repoName(copy.remote) ?? segments(main).pop() ?? main,
    root: copy.root,
    branch: copy.branch,
    defaultBranch: copy.defaultBranch,
  }
}

/** The look standing now, so an unchanged place sets nothing. */
let shown: string | undefined

async function refresh($: EngineInterface, rules: Rules) {
  const place = await placeOf($)
  const verdict = judge(place, rules)
  const key = lookKey(verdict)
  let set: ThemeResult | undefined
  if (key !== shown) {
    shown = key
    set = await $.theme.set(lookOf(verdict))
  }

  return { place, verdict, set }
}

/** Subagents run turns of their own inside the main one. */
const isSubagent = (e: object) => 'agentId' in e && e.agentId !== undefined

export const register: Register = (on, options) => {
  const rules: Rules = {
    riskyBranches: list(options.riskyBranches, DEFAULT_RULES.riskyBranches),
    riskyPaths: list(options.riskyPaths, DEFAULT_RULES.riskyPaths),
    isDefaultBranchRisky: options.defaultBranch !== false,
  }
  shown = undefined

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tint',
      description: 'Say why the desktop backdrop has the tint it has',
    })
    await refresh($, rules)

    return next(e)
  })

  // A turn may have switched the branch or the folder.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (!isSubagent(e)) await refresh($, rules)

    return done
  })

  on('command.run', { command: 'tint' }, async $ => {
    // Set again even if unchanged, in case another mod's theme replaced this one.
    shown = undefined
    const { place, verdict, set } = await refresh($, rules)
    const drawn = set === undefined || set.isDrawn ? '' : ` Not drawn here: ${set.reason}`

    return { text: describe(place, verdict) + drawn }
  })
}
