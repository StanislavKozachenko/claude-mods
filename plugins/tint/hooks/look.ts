import type { ThemeColor, ThemeSetArgs } from 'claude-code'

/** Where the session works, as the backdrop is chosen from it. */
export type Place = {
  /** What names the project: the remote's repository, else the main copy's folder. */
  name: string
  /** The working copy's root, or the session's folder outside one. */
  root: string
  /** The checked-out branch; null when detached or outside a repository. */
  branch: string | null
  defaultBranch: string | null
}

export type Rules = {
  riskyBranches: readonly string[]
  riskyPaths: readonly string[]
  isDefaultBranchRisky: boolean
}

export type Verdict = { isRisky: true; reason: string } | { isRisky: false; hue: number }

export const DEFAULT_RULES: Rules = {
  riskyBranches: ['main', 'master', 'release/*', 'hotfix/*', 'prod*', 'production'],
  riskyPaths: ['prod', 'production', 'deploy'],
  isDefaultBranchRisky: true,
}

/** Case-insensitive glob where `*` stands for any run of characters and `?` for one. */
export function matches(pattern: string, text: string): boolean {
  const source = pattern
    .trim()
    .split('')
    .map(char => (char === '*' ? '.*' : char === '?' ? '.' : char.replace(/[.+^${}()|[\]\\]/g, '\\$&')))
    .join('')

  return source !== '' && new RegExp(`^${source}$`, 'i').test(text)
}

/** The folder names of a path, either slash, without a drive letter. */
export function segments(path: string): string[] {
  return path
    .split(/[\\/]+/)
    .filter(part => part !== '' && !/^[a-z]:$/i.test(part))
}

/** The repository a remote URL names: `git@host:org/app.git` and `https://host/org/app` are both `app`. */
export function repoName(remote: string | null): string | undefined {
  if (!remote) return undefined
  const last = remote.trim().replace(/\/+$/, '').split(/[/:]/).pop()

  return last?.replace(/\.git$/i, '') || undefined
}

// The warm band (reds, oranges, ambers) is kept for risky places, so a calm
// project never reads as a warning.
const CALM_FROM = 100
const CALM_TO = 320

/** A hue for the project, the same on every machine for the same name. */
export function hueOf(name: string): number {
  // FNV-1a, 32 bit
  let hash = 0x811c9dc5
  for (const char of name.toLowerCase()) {
    hash ^= char.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193) >>> 0
  }

  return CALM_FROM + (hash % (CALM_TO - CALM_FROM))
}

export function judge(place: Place, rules: Rules): Verdict {
  const { branch } = place
  if (branch !== null) {
    const pattern = rules.riskyBranches.find(glob => matches(glob, branch))
    if (pattern !== undefined) return { isRisky: true, reason: `branch ${branch} matches ${pattern}` }
    if (rules.isDefaultBranchRisky && branch === place.defaultBranch) {
      return { isRisky: true, reason: `${branch} is the default branch` }
    }
  }
  for (const folder of segments(place.root)) {
    const pattern = rules.riskyPaths.find(glob => matches(glob, folder))
    if (pattern !== undefined) return { isRisky: true, reason: `folder ${folder} matches ${pattern}` }
  }

  return { isRisky: false, hue: hueOf(place.name) }
}

/**
 * The look for a verdict: a still radial ground that keeps the page's own
 * surface in the middle, where the words are, and tints the edges.
 * A palette name follows light and dark by itself; the calm hue is a mid
 * tone that reads on both.
 */
export function lookOf(verdict: Verdict): ThemeSetArgs {
  const surface: ThemeColor = 'surface-0'
  const edge: ThemeColor = verdict.isRisky ? 'fill-warning' : `hsl(${verdict.hue} 45% 55%)`
  const clear = verdict.isRisky ? 0.35 : 0.55

  return {
    backdrop: {
      gradient: {
        shape: 'radial',
        stops: [
          { at: 0, color: surface },
          { at: clear, color: surface },
          { at: 1, color: edge },
        ],
      },
    },
  }
}

/** One stable key per look, so an unchanged place sets nothing. */
export const lookKey = (verdict: Verdict) => (verdict.isRisky ? 'risky' : `calm:${verdict.hue}`)

/** What `/tint` says about the place. */
export function describe(place: Place, verdict: Verdict): string {
  const where = place.branch === null ? place.name : `${place.name} on ${place.branch}`

  return verdict.isRisky ? `${where}: warning tint, ${verdict.reason}.` : `${where}: calm tint, hue ${verdict.hue}.`
}
