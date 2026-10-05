// Reading GitHub's answers and turning them into a budget, as pure functions:
// no `$`, so tests call them directly with recorded API responses.

import type { CiBudgetBudget } from '../types'

export type Remote = { owner: string; name: string }

/** `git@github.com:o/r.git`, `https://github.com/o/r`, `ssh://git@github.com/o/r.git` */
export function parseRemote(url: string): Remote | undefined {
  const match = url.trim().match(/github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i)
  return match ? { owner: match[1]!, name: match[2]! } : undefined
}

/** `2026-10`, and the first day of that month as GitHub's `created` filter takes it. */
export function period(now: Date): { label: string; year: number; month: number; since: string } {
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth() + 1
  const label = `${year}-${String(month).padStart(2, '0')}`
  return { label, year, month, since: `${label}-01` }
}

/**
 * Included Actions minutes per month by plan, as GitHub's plans list them;
 * the `includedMinutes` option overrides it. Larger runners are never included.
 */
export const INCLUDED_MINUTES: Record<string, number> = {
  free: 2_000,
  pro: 3_000,
  team: 3_000,
  business: 50_000,
  enterprise: 50_000,
}

/** How many quota minutes one minute on a runner costs. */
export function multiplier(runner: string): number {
  const r = runner.toLowerCase()
  if (r.includes('self-hosted')) return 0
  if (r.includes('mac')) return 10
  if (r.includes('windows')) return 2
  return 1
}

/** One row of `/settings/billing/usage`. */
export type UsageItem = {
  date: string
  product: string
  sku: string
  quantity: number
  unitType: string
  grossAmount?: number
  netAmount?: number
  repositoryName?: string
}

/** Standard runners draw on the included minutes; larger runners are billed separately. */
const STANDARD_SKU = /^actions (linux|windows|macos)$/i

/** This month's Actions minutes from the owner's billing usage. */
export function fromBilling(items: readonly UsageItem[], periodLabel: string, repoName?: string) {
  const actions = items.filter(
    item => item.product === 'actions' && /minute/i.test(item.unitType) && item.date.startsWith(periodLabel),
  )
  const minutes: Record<string, number> = {}
  let quotaMinutes = 0
  let repoQuotaMinutes = 0
  let grossUsd = 0
  let netUsd = 0

  for (const item of actions) {
    const sku = item.sku.replace(/^Actions /, '')
    minutes[sku] = (minutes[sku] ?? 0) + item.quantity
    const quota = STANDARD_SKU.test(item.sku) ? item.quantity * multiplier(item.sku) : 0
    quotaMinutes += quota
    if (repoName !== undefined && item.repositoryName === repoName) repoQuotaMinutes += quota
    grossUsd += item.grossAmount ?? 0
    netUsd += item.netAmount ?? 0
  }

  return { minutes, quotaMinutes, repoQuotaMinutes, grossUsd, netUsd }
}

/** The Actions budget among `/settings/billing/budgets`, or null when there is none. */
export function actionsBudget(budgets: readonly Record<string, unknown>[]): CiBudgetBudget | null {
  const budget = budgets.find(b => b.budget_product_sku === 'actions' || b.budget_product_sku === 'actions_minutes')
  if (!budget) return null
  return { amount: Number(budget.budget_amount ?? 0), stops: budget.prevent_further_usage === true }
}

export type Job = { id: number; name: string; labels: readonly string[]; started_at: string | null; completed_at: string | null; status: string }

/**
 * A finished job's billable minutes: GitHub rounds each job up to the minute.
 * The runner is read from its labels.
 */
export function jobMinutes(job: Job): { runner: string; minutes: number; quotaMinutes: number } {
  const runner = runnerOf(job.labels)
  if (!job.started_at || !job.completed_at) return { runner, minutes: 0, quotaMinutes: 0 }
  const ms = Date.parse(job.completed_at) - Date.parse(job.started_at)
  const minutes = ms > 0 ? Math.ceil(ms / 60_000) : 0
  return { runner, minutes, quotaMinutes: minutes * multiplier(runner) }
}

export function runnerOf(labels: readonly string[]): string {
  const joined = labels.join(' ').toLowerCase()
  if (joined.includes('self-hosted')) return 'self-hosted'
  if (joined.includes('mac')) return 'macOS'
  if (joined.includes('windows')) return 'Windows'
  return 'Linux'
}

/** Sums finished jobs into minutes by runner and quota minutes. */
export function fromJobs(jobs: readonly Job[]) {
  const minutes: Record<string, number> = {}
  let quotaMinutes = 0
  for (const job of jobs) {
    const counted = jobMinutes(job)
    if (counted.minutes === 0) continue
    minutes[counted.runner] = (minutes[counted.runner] ?? 0) + counted.minutes
    quotaMinutes += counted.quotaMinutes
  }
  return { minutes, quotaMinutes }
}

/** What to tell the person when a `gh` call was refused, from its stderr. */
export function setupHint(stderr: string, what: { owner: string; ownerType: 'Organization' | 'User' }): string {
  const text = stderr.toLowerCase()
  if (/not logged|gh auth login|authentication required/.test(text)) {
    return 'GitHub CLI is not logged in: run `gh auth login`.'
  }
  if (text.includes('"user" scope')) {
    return 'Billing of your own account needs the `user` scope: run `gh auth refresh -h github.com -s user`.'
  }
  if (text.includes('admin:org') || (what.ownerType === 'Organization' && /404|403|not found|forbidden/.test(text))) {
    return `Billing of ${what.owner} is visible to its owners and billing managers only; if you are one, run \`gh auth refresh -h github.com -s admin:org\`. Showing an estimate from this repo's jobs instead.`
  }
  if (/404|not found/.test(text)) return `No billing data for ${what.owner} (404). Showing an estimate from this repo's jobs instead.`
  return `gh failed: ${stderr.trim().split('\n')[0]?.slice(0, 160) ?? 'unknown error'}`
}

/** `1 240`, `12.5k` */
export function formatMinutes(minutes: number): string {
  return minutes < 10_000 ? String(Math.round(minutes)) : `${(minutes / 1000).toFixed(1).replace(/\.0$/, '')}k`
}

/** `1.1 GB`, `340 MB` */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`
  return `${Math.round(bytes / 1e3)} KB`
}
