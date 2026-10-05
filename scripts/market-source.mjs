// Where installs take a mod from. A released mod comes from its release tag,
// so main may move ahead of what is published without reaching anyone; a mod
// not released yet (0.0.0) comes from main. scripts/release.mjs writes this
// shape and scripts/check.mjs requires it.

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')

export const REPO_URL = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).repository.url

export const releaseTag = (mod, version) => `${mod}--v${version}`

export const marketSource = (mod, version) =>
  version === '0.0.0'
    ? `./plugins/${mod}`
    : { source: 'git-subdir', url: REPO_URL, path: `plugins/${mod}`, ref: releaseTag(mod, version) }
