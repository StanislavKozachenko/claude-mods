// Prepares a mod's release: bumps its version in plugin.json and
// marketplace.json and prepends a CHANGELOG.md entry built from the mod's
// commits since its last tag. The Release workflow commits and tags the result.
//
//   node scripts/release.mjs <mod> [auto|patch|minor|major] [--dry-run]
//
// auto: a breaking commit (`feat(guard)!: ...`) → major (minor while 0.x),
// feat → minor, fix / perf / refactor / docs → patch.

import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const BUMPS = ['auto', 'patch', 'minor', 'major']

const args = process.argv.slice(2)
const isDry = args.includes('--dry-run')
const [mod, bump = 'auto'] = args.filter(arg => !arg.startsWith('--'))

const fail = message => {
  console.error(`release: ${message}`)
  process.exit(1)
}

if (!mod) fail('usage: node scripts/release.mjs <mod> [auto|patch|minor|major] [--dry-run]')
if (!BUMPS.includes(bump)) fail(`bump must be one of ${BUMPS.join(', ')}, got "${bump}"`)

const manifestPath = join(ROOT, 'plugins', mod, '.claude-plugin', 'plugin.json')
const marketPath = join(ROOT, '.claude-plugin', 'marketplace.json')
const changelogPath = join(ROOT, 'CHANGELOG.md')
if (!existsSync(manifestPath)) fail(`plugins/${mod} has no .claude-plugin/plugin.json`)

const git = (...argv) => execFileSync('git', argv, { cwd: ROOT, encoding: 'utf8' }).trim()

const manifestText = readFileSync(manifestPath, 'utf8')
const current = JSON.parse(manifestText).version
const lastTag = git('tag', '--list', `${mod}--v*`, '--sort=-v:refname').split('\n')[0] || undefined
const range = lastTag ? [`${lastTag}..HEAD`] : ['HEAD']
const subjects = git('log', ...range, '--format=%s', '--', `plugins/${mod}`).split('\n').filter(Boolean)

const COMMIT = /^(feat|fix|perf|refactor|docs)(\([^)]+\))?(!)?: (.+)$/
const commits = subjects.flatMap(subject => {
  const match = subject.match(COMMIT)
  return match ? [{ type: match[1], isBreaking: match[3] === '!', text: match[4] }] : []
})
if (commits.length === 0) {
  fail(`no releasable commits (feat/fix/perf/refactor/docs) in plugins/${mod} since ${lastTag ?? 'the beginning'}`)
}

const [major, minor, patch] = current.split('.').map(Number)
const isBreaking = commits.some(commit => commit.isBreaking)
const hasFeature = commits.some(commit => commit.type === 'feat')
const level =
  bump !== 'auto' ? bump : isBreaking ? (major === 0 ? 'minor' : 'major') : hasFeature ? 'minor' : 'patch'
const version =
  level === 'major' ? `${major + 1}.0.0` : level === 'minor' ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`
const tag = `${mod}--v${version}`

const line = commit => `- ${commit.isBreaking ? '**Breaking:** ' : ''}${commit.text}`
const section = (title, types) => {
  const lines = commits.filter(commit => types.includes(commit.type)).map(line)
  return lines.length > 0 ? `### ${title}\n\n${lines.join('\n')}\n\n` : ''
}
const notes = section('Added', ['feat']) + section('Fixed', ['fix']) + section('Changed', ['perf', 'refactor', 'docs'])
const date = new Date().toISOString().slice(0, 10)
const entry = `## [${mod} ${version}] - ${date}\n\n${notes}---\n\n`

console.log(`${mod}: ${current} → ${version} (${level}${bump === 'auto' ? ', auto' : ''}), ${commits.length} commit(s) since ${lastTag ?? 'the beginning'}\n`)
console.log(entry)
if (isDry) process.exit(0)

writeFileSync(manifestPath, manifestText.replace(/"version":\s*"[^"]*"/, `"version": "${version}"`))

const market = JSON.parse(readFileSync(marketPath, 'utf8'))
const listed = market.plugins.find(entry => entry.name === mod)
if (!listed) fail(`${mod} is not listed in marketplace.json`)
listed.version = version
writeFileSync(marketPath, `${JSON.stringify(market, null, 2)}\n`)

const changelog = readFileSync(changelogPath, 'utf8')
const cut = changelog.indexOf('\n---\n')
if (cut < 0) fail('CHANGELOG.md has no --- line under its header')
writeFileSync(changelogPath, `${changelog.slice(0, cut + 5)}\n${entry}${changelog.slice(cut + 5).replace(/^\n+/, '')}`)

const notesPath = join(ROOT, 'release-notes.md')
writeFileSync(notesPath, notes.trim() + '\n')

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\ntag=${tag}\nnotes=${notesPath}\n`)
}
