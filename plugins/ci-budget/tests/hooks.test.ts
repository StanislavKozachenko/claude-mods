import type { CommandRunInput, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

type Answer = { stdout?: unknown; stderr?: string; exitCode?: number }

// The engine beneath the mod: `git` and `gh api` answered from a table by the
// path asked, a store and a clock; everything recorded.
const engine = (on: On, routes: Record<string, Answer>) => {
  const asked: string[] = []
  const store = new Map<string, unknown>()
  mock.clock(on, { now: Date.parse('2026-10-05T12:00:00Z') })
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('process.run', (_$, e) => {
    const key = e.argv[0] === 'gh' ? String(e.argv[2]) : e.argv.join(' ')
    asked.push(key)
    // The longest route the path starts with: `users/acme` is not `user`
    const route = Object.entries(routes)
      .filter(([prefix]) => key === prefix || key.startsWith(prefix.endsWith('?') ? prefix : `${prefix}?`) || key.startsWith(`${prefix}/`))
      .sort(([a], [b]) => b.length - a.length)[0]?.[1] ?? { exitCode: 1, stderr: 'gh: Not Found (HTTP 404)' }
    const stdout = typeof route.stdout === 'string' ? route.stdout : JSON.stringify(route.stdout ?? {})
    return { value: { exitCode: route.exitCode ?? 0, stdout, stderr: route.stderr ?? '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false } }) as never)
  on('ui.status', () => ({ value: undefined }) as never)

  return { asked }
}

const ORG_REPO = {
  'git remote get-url origin': { stdout: 'git@github.com:acme/backend.git\n' },
  'git rev-parse HEAD': { stdout: 'abc123\n' },
  user: { stdout: { login: 'dev', plan: { name: 'free' } } },
  'users/acme': { stdout: { type: 'Organization' } },
  'repos/acme/backend/actions/cache': { stdout: { active_caches_size_in_bytes: 2_000_000_000 } },
  'repos/acme/backend/actions/artifacts': { stdout: { artifacts: [{ size_in_bytes: 5_000_000 }, { size_in_bytes: 1, expired: true }] } },
  'repos/acme/backend': { stdout: { private: true } },
  'orgs/acme': { stdout: { plan: { name: 'free' } } },
}

const usage = (linuxMinutes: number) => ({
  usageItems: [
    { date: '2026-10-02T00:00:00Z', product: 'actions', sku: 'Actions Linux', quantity: linuxMinutes, unitType: 'Minutes', grossAmount: linuxMinutes * 0.006, netAmount: 0, repositoryName: 'backend' },
  ],
})

const command = (args: string, kind = 'composer'): CommandRunInput => ({
  command: 'ci-budget',
  args,
  origin: { kind } as CommandRunInput['origin'],
  presentation: { isFullscreen: false, columns: 120 },
})

test('an organisation the person bills for: exact minutes, quota share, no-budget warning', async ($, on) => {
  engine(on, {
    ...ORG_REPO,
    'organizations/acme/settings/billing/usage': { stdout: usage(1_700) },
    'organizations/acme/settings/billing/budgets': { stdout: { budgets: [] } },
  })
  const { text = '' } = await $.command.run(command('refresh'))

  expect(text).toContain('acme (organisation) · 2026-10 · from GitHub billing')
  expect(text).toContain('Actions: 1700 minutes of 2000 included (85%)')
  expect(text).toContain('No GitHub budget for Actions')
  expect(text).toContain('acme/backend (private): 1700 of those minutes')
  expect(text).toContain('cache 2.0 GB of 10 GB, artifacts 5 MB')
})

test('an organisation the person cannot bill for: an estimate from the repo jobs, and how to get billing', async ($, on) => {
  const { asked } = engine(on, {
    ...ORG_REPO,
    'organizations/acme/settings/billing/usage': { exitCode: 1, stderr: 'gh: Not Found (HTTP 404)\ngh: This API operation needs the "admin:org" scope.' },
    'repos/acme/backend/actions/runs?': { stdout: { workflow_runs: [{ id: 7 }, { id: 8 }] } },
    'repos/acme/backend/actions/runs/7/jobs': {
      stdout: { jobs: [{ id: 1, name: 'test', labels: ['ubuntu-latest'], status: 'completed', started_at: '2026-10-03T10:00:00Z', completed_at: '2026-10-03T10:04:30Z' }] },
    },
    'repos/acme/backend/actions/runs/8/jobs': {
      stdout: { jobs: [{ id: 2, name: 'ios', labels: ['macos-14'], status: 'completed', started_at: '2026-10-03T11:00:00Z', completed_at: '2026-10-03T11:02:00Z' }] },
    },
  })
  const { text = '' } = await $.command.run(command('refresh'))

  expect(text).toContain("acme (organisation) · 2026-10 · estimated from this repo's jobs")
  // 5 Linux minutes + 2 macOS minutes × 10
  expect(text).toContain('~25 quota minutes in acme/backend this month')
  expect(text).toContain('owners and billing managers')
  expect(asked.filter(path => path.endsWith('/jobs?filter=all&per_page=100'))).toHaveLength(2)

  // Finished runs are read once: a refresh asks only for the run list again
  await $.command.run(command('refresh'))
  expect(asked.filter(path => path.endsWith('/jobs?filter=all&per_page=100'))).toHaveLength(2)
})

test('gh workflow run is denied at blockAt, and /ci-budget off from the person lets it through', async ($, on) => {
  engine(on, {
    ...ORG_REPO,
    'organizations/acme/settings/billing/usage': { stdout: usage(2_100) },
    'organizations/acme/settings/billing/budgets': { stdout: { budgets: [{ budget_product_sku: 'actions', budget_amount: 0, prevent_further_usage: true }] } },
  })
  await $.command.run(command('refresh'))

  const denied = await $.tool.call({ tool: 'Bash', command: 'gh workflow run deploy.yml' })
  expect(denied.deny).toContain('used 105% of its included Actions minutes')

  expect((await $.command.run(command('off', 'peer'))).text).toContain('only accepted from the person')
  await $.command.run(command('off'))
  expect((await $.tool.call({ tool: 'Bash', command: 'gh workflow run deploy.yml' })).deny).toBeUndefined()
})

test('a workflow written with spend risks comes back with them for the model', async ($, on) => {
  engine(on, { ...ORG_REPO, 'organizations/acme/settings/billing/usage': { stdout: usage(10) } })
  await $.command.run(command('refresh'))

  const ran = await $.tool.call({
    tool: 'Write',
    file_path: '/repo/.github/workflows/ci.yml',
    content: 'name: CI\non: [push, pull_request]\njobs:\n  test:\n    runs-on: macos-latest\n    steps:\n      - run: make\n',
  })
  const note = (ran.context ?? []).join('\n')
  expect(note).toContain('ci-budget found spend risks in ci.yml')
  expect(note).toContain('no timeout-minutes')
  expect(note).toContain('macOS runners cost 10')

  const other = await $.tool.call({ tool: 'Write', file_path: '/repo/src/index.ts', content: 'runs-on: macos-latest' })
  expect(other.context).toBeUndefined()
})

test('without a gh login everything says how to log in', async ($, on) => {
  engine(on, { user: { exitCode: 1, stderr: 'To get started with GitHub CLI, please run:  gh auth login' } })
  const { text = '' } = await $.command.run(command('refresh'))
  expect(text).toContain('no usage data')
  expect(text).toContain('gh auth login')
})

const BILLED = {
  ...ORG_REPO,
  'organizations/acme/settings/billing/usage': { stdout: usage(500) },
  'organizations/acme/settings/billing/budgets': { stdout: { budgets: [] } },
}

test('the report points to notify when it is not installed', async ($, on) => {
  engine(on, BILLED)
  on('command.list', () => ({ value: [{ name: 'ci-budget', description: '', source: 'plugin' }] }) as never)
  const { text = '' } = await $.command.run(command('refresh'))
  expect(text).toContain('install the notify mod: /plugin install notify@claude-mods')
})

test('and says nothing about it when notify is installed', async ($, on) => {
  engine(on, BILLED)
  on('command.list', () => ({ value: [{ name: 'notify', description: '', source: 'plugin' }] }) as never)
  const { text = '' } = await $.command.run(command('refresh'))
  expect(text).not.toContain('notify mod')
})
