// Checks the marketplace and the mods the way CI does, against the Claude Code
// version pinned in package.json.
//
//   npm run check                 marketplace + every mod
//   npm run check -- guard        marketplace + the named mods
//   npm run check -- --no-market  skip the marketplace step (CI runs it once)
//   npm run check -- --market-only  the marketplace step alone

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const PLUGINS = join(ROOT, 'plugins')
const BIN = join(ROOT, 'node_modules', '.bin')
const isWindows = process.platform === 'win32'

const args = process.argv.slice(2)
const isMarketSkipped = args.includes('--no-market')
const isMarketOnly = args.includes('--market-only')
const named = args.filter(arg => !arg.startsWith('--'))

const allMods = () =>
  existsSync(PLUGINS)
    ? readdirSync(PLUGINS, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .sort()
    : []

const readJson = path => JSON.parse(readFileSync(path, 'utf8'))

const run = (bin, argv, options = {}) => {
  const command = join(BIN, isWindows ? `${bin}.cmd` : bin)
  console.log(`$ ${bin} ${argv.join(' ')}`)
  const result = spawnSync(command, argv, {
    cwd: ROOT,
    stdio: options.isQuiet ? 'pipe' : 'inherit',
    shell: isWindows,
    env: options.env ?? process.env,
    timeout: options.timeoutMs,
  })

  return result.status === 0
}

const failures = []
const step = (label, isOk) => {
  console.log(isOk ? `ok   ${label}\n` : `FAIL ${label}\n`)
  if (!isOk) failures.push(label)
}

const checkMarketplace = () => {
  const market = readJson(join(ROOT, '.claude-plugin', 'marketplace.json'))
  const listed = new Map(market.plugins.map(entry => [entry.name, entry]))
  const problems = []

  for (const mod of allMods()) {
    const entry = listed.get(mod)
    const manifest = readJson(join(PLUGINS, mod, '.claude-plugin', 'plugin.json'))

    if (manifest.name !== mod) problems.push(`plugins/${mod}: plugin.json name is "${manifest.name}"`)
    if (!entry) {
      problems.push(`plugins/${mod}: not listed in marketplace.json`)
      continue
    }
    if (entry.source !== `./plugins/${mod}`) problems.push(`${mod}: source should be "./plugins/${mod}"`)
    if (entry.version !== manifest.version) {
      problems.push(`${mod}: marketplace version ${entry.version} != plugin.json ${manifest.version}`)
    }
    listed.delete(mod)
  }
  for (const name of listed.keys()) problems.push(`${name}: listed in marketplace.json but plugins/${name} is missing`)

  problems.forEach(problem => console.log(`  ${problem}`))
  step('marketplace consistency', problems.length === 0)
  // --strict fails an empty marketplace, which is what it is until the first mod
  const strict = market.plugins.length > 0 ? ['--strict'] : []
  step('marketplace validate', run('claude', ['plugin', 'validate', ...strict, '.']))
}

// Loading a mod makes Claude Code write the API's types for its build into
// <mod>/.claude-plugin/types. The load happens even when the run is not logged
// in, so the run gets an empty config dir and no credentials: it never reaches
// the model, and it exits non-zero, which is expected.
const writeTypes = dir => {
  const config = mkdtempSync(join(tmpdir(), 'claude-mods-'))
  const env = { ...process.env, CLAUDE_CONFIG_DIR: config, CLAUDE_CODE_ENABLE_FUNCTION_HOOKS: '1' }
  for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN']) delete env[key]

  rmSync(join(dir, '.claude-plugin', 'types'), { recursive: true, force: true })
  run('claude', ['-p', '--plugin-dir', dir, 'types'], { env, isQuiet: true, timeoutMs: 60_000 })
  rmSync(config, { recursive: true, force: true })

  return existsSync(join(dir, '.claude-plugin', 'types', 'claude-code', 'index.d.ts'))
}

const hasTests = dir =>
  readdirSync(dir, { recursive: true }).some(
    path => /\.test\.tsx?$/.test(String(path)) && !String(path).includes('node_modules'),
  )

const checkMod = mod => {
  const dir = join(PLUGINS, mod)
  const rel = `plugins/${mod}`

  if (!existsSync(join(dir, '.claude-plugin', 'plugin.json'))) {
    step(`${mod}: exists`, false)
    return
  }

  step(`${mod}: validate`, run('claude', ['plugin', 'validate', '--strict', rel]))
  step(`${mod}: types`, writeTypes(dir))
  step(`${mod}: typecheck`, run('tsc', ['-p', rel]))
  if (!hasTests(dir)) {
    console.log(`  ${rel} has no *.test.ts files`)
    step(`${mod}: test`, false)
    return
  }
  step(`${mod}: test`, run('claude', ['plugin', 'test', rel]))
}

if (!isMarketSkipped) checkMarketplace()
if (!isMarketOnly) for (const mod of named.length > 0 ? named : allMods()) checkMod(mod)

if (failures.length > 0) {
  console.log(`${failures.length} check(s) failed:\n${failures.map(label => `  - ${label}`).join('\n')}`)
  process.exit(1)
}
console.log('All checks passed.')
