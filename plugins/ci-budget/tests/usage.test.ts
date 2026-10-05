import { describe, expect, test } from 'claude-code/testing'

import {
  actionsBudget,
  formatBytes,
  formatMinutes,
  fromBilling,
  fromJobs,
  jobMinutes,
  multiplier,
  parseRemote,
  period,
  setupHint,
} from '../hooks/usage'

// Rows as /organizations/{org}/settings/billing/usage returns them
const ITEMS = [
  { date: '2026-10-01T00:00:00Z', product: 'actions', sku: 'Actions Linux', quantity: 600, unitType: 'Minutes', grossAmount: 3.6, netAmount: 0, repositoryName: 'backend' },
  { date: '2026-10-02T00:00:00Z', product: 'actions', sku: 'Actions macOS', quantity: 20, unitType: 'Minutes', grossAmount: 1.24, netAmount: 0, repositoryName: 'app' },
  { date: '2026-10-02T00:00:00Z', product: 'actions', sku: 'Actions Windows', quantity: 50, unitType: 'Minutes', grossAmount: 0.6, netAmount: 0, repositoryName: 'backend' },
  { date: '2026-10-03T00:00:00Z', product: 'actions', sku: 'Actions Linux 4-core', quantity: 10, unitType: 'Minutes', grossAmount: 0.12, netAmount: 0.12, repositoryName: 'backend' },
  { date: '2026-10-03T00:00:00Z', product: 'actions', sku: 'Actions storage', quantity: 2, unitType: 'GigabyteHours', grossAmount: 0.01, netAmount: 0 },
  { date: '2026-09-30T00:00:00Z', product: 'actions', sku: 'Actions Linux', quantity: 999, unitType: 'Minutes', grossAmount: 6, netAmount: 0 },
  { date: '2026-10-01T00:00:00Z', product: 'packages', sku: 'Packages data transfer', quantity: 1, unitType: 'GigaBytes', grossAmount: 0.5, netAmount: 0 },
]

describe('reading GitHub', () => {
  test('parseRemote', async () => {
    expect(parseRemote('git@github.com:central-platform/backend.git')).toEqual({ owner: 'central-platform', name: 'backend' })
    expect(parseRemote('https://github.com/o/r')).toEqual({ owner: 'o', name: 'r' })
    expect(parseRemote('ssh://git@github.com/o/r.git\n')).toEqual({ owner: 'o', name: 'r' })
    expect(parseRemote('https://gitlab.com/o/r.git')).toBeUndefined()
  })

  test('period', async () => {
    expect(period(new Date('2026-10-05T12:00:00Z'))).toEqual({ label: '2026-10', year: 2026, month: 10, since: '2026-10-01' })
  })

  test('fromBilling counts this month, weighs runners, keeps larger runners out of the quota', async () => {
    const counted = fromBilling(ITEMS, '2026-10', 'backend')
    expect(counted.minutes).toEqual({ Linux: 600, macOS: 20, Windows: 50, 'Linux 4-core': 10 })
    // 600×1 + 20×10 + 50×2; the 4-core runner is billed apart from the included minutes
    expect(counted.quotaMinutes).toBe(900)
    expect(counted.repoQuotaMinutes).toBe(700)
    expect(Math.round(counted.grossUsd * 100)).toBe(556)
    expect(Math.round(counted.netUsd * 100)).toBe(12)
  })

  test('actionsBudget', async () => {
    expect(actionsBudget([{ budget_product_sku: 'codespaces', budget_amount: 0 }])).toBeNull()
    expect(actionsBudget([{ budget_product_sku: 'actions', budget_amount: 0, prevent_further_usage: true }])).toEqual({ amount: 0, stops: true })
    expect(actionsBudget([{ budget_product_sku: 'actions', budget_amount: 25, prevent_further_usage: false }])).toEqual({ amount: 25, stops: false })
  })
})

describe('estimating from jobs', () => {
  const job = (labels: string[], seconds: number) => ({
    id: 1,
    name: 'build',
    labels,
    status: 'completed',
    started_at: '2026-10-05T10:00:00Z',
    completed_at: new Date(Date.parse('2026-10-05T10:00:00Z') + seconds * 1000).toISOString(),
  })

  test('each job is rounded up to the minute and weighed by its runner', async () => {
    expect(jobMinutes(job(['ubuntu-latest'], 61))).toEqual({ runner: 'Linux', minutes: 2, quotaMinutes: 2 })
    expect(jobMinutes(job(['macos-14'], 30))).toEqual({ runner: 'macOS', minutes: 1, quotaMinutes: 10 })
    expect(jobMinutes(job(['windows-latest'], 120))).toEqual({ runner: 'Windows', minutes: 2, quotaMinutes: 4 })
    expect(jobMinutes(job(['self-hosted', 'linux'], 600))).toEqual({ runner: 'self-hosted', minutes: 10, quotaMinutes: 0 })
    expect(jobMinutes({ ...job(['ubuntu-latest'], 0), completed_at: null })).toEqual({ runner: 'Linux', minutes: 0, quotaMinutes: 0 })
  })

  test('fromJobs', async () => {
    expect(fromJobs([job(['ubuntu-latest'], 100), job(['macos-latest'], 59), job(['ubuntu-22.04'], 5)])).toEqual({
      minutes: { Linux: 3, macOS: 1 },
      quotaMinutes: 13,
    })
  })

  test('multiplier', async () => {
    expect([multiplier('Actions Linux'), multiplier('Actions Windows'), multiplier('Actions macOS'), multiplier('self-hosted')]).toEqual([1, 2, 10, 0])
  })
})

describe('setup hints', () => {
  const org = { owner: 'acme', ownerType: 'Organization' } as const
  const me = { owner: 'me', ownerType: 'User' } as const

  test('say what to run', async () => {
    expect(setupHint('To get started with GitHub CLI, please run:  gh auth login', me)).toContain('gh auth login')
    expect(setupHint('gh: This API operation needs the "user" scope. To request it, run:  gh auth refresh -h github.com -s user', me)).toContain(
      'gh auth refresh -h github.com -s user',
    )
    const orgHint = setupHint('gh: Not Found (HTTP 404)\ngh: This API operation needs the "admin:org" scope.', org)
    expect(orgHint).toContain('owners and billing managers')
    expect(orgHint).toContain('admin:org')
    expect(setupHint('gh: Not Found (HTTP 404)', me)).toContain('404')
  })

  test('formatting', async () => {
    expect([formatMinutes(1240.4), formatMinutes(12_500)]).toEqual(['1240', '12.5k'])
    expect([formatBytes(1_151_299_410), formatBytes(340_000_000), formatBytes(2_000)]).toEqual(['1.2 GB', '340 MB', '2 KB'])
  })
})
