import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CiBudgetSnapshot, CiBudgetWatch } from '../types'
import { isWorkflowPath, lintWorkflow } from './lint'
import {
  INCLUDED_MINUTES,
  actionsBudget,
  formatBytes,
  formatMinutes,
  fromBilling,
  fromJobs,
  parseRemote,
  period,
  setupHint,
} from './usage'
import type { Job, UsageItem } from './usage'

const snapshot = atom({ plugin: 'ci-budget', key: 'snapshot' } as const, null)
const watch = atom({ plugin: 'ci-budget', key: 'watch' } as const, null)
const isPaused = atom({ plugin: 'ci-budget', key: 'isPaused' } as const, false)

/** Who may pause the block: the person, never another agent, a channel or a peer session. */
const PERSON = new Set(['composer', 'bridge', 'sdk'])

/** Runs whose jobs are counted per refresh at most, so a busy repo does not stall a refresh. */
const MAX_NEW_RUNS = 40
const MAX_RUN_PAGES = 3

type Options = {
  warnAt: number[]
  blockAt: number
  includedMinutes: number
  stuckMs: number
  refreshMs: number
  isLintOn: boolean
  isWatchOn: boolean
}

type Gh = { ok: true; data: unknown } | { ok: false; stderr: string }

/** Finished runs' minutes by run id, per repo and month: a finished run never changes. */
type RunCache = Record<string, { minutes: Record<string, number>; quotaMinutes: number }>

let warnedAt = 0
let stopWatch: (() => void) | undefined

/** `gh api <path>` as the person is logged in. */
async function gh($: EngineInterface, path: string): Promise<Gh> {
  const ran = await $.process.run(['gh', 'api', path], { timeoutMs: 30_000 }).catch(() => undefined)
  if (!ran) return { ok: false, stderr: 'gh could not start: install the GitHub CLI (https://cli.github.com) and run `gh auth login`.' }
  if (ran.exitCode !== 0) return { ok: false, stderr: `${ran.stderr}\n${ran.stdout}` }
  try {
    return { ok: true, data: JSON.parse(ran.stdout) }
  } catch {
    return { ok: false, stderr: 'gh answered something that is not JSON' }
  }
}

async function git($: EngineInterface, argv: string[]): Promise<string | undefined> {
  const ran = await $.process.run(['git', ...argv], { timeoutMs: 10_000 }).catch(() => undefined)
  return ran && ran.exitCode === 0 ? ran.stdout.trim() : undefined
}

/** The current repo's finished runs this month, their jobs read once and kept. */
async function estimateRepo($: EngineInterface, repo: string, since: string, periodLabel: string) {
  const key = `runs:${repo}:${periodLabel}`
  const cache = ((await $.store.get(key)) ?? {}) as RunCache
  const ids: number[] = []

  for (let page = 1; page <= MAX_RUN_PAGES; page++) {
    const listed = await gh($, `repos/${repo}/actions/runs?created=%3E%3D${since}&status=completed&per_page=100&page=${page}`)
    if (!listed.ok) return { ok: false as const, stderr: listed.stderr }
    const runs = (listed.data as { workflow_runs?: { id: number }[] }).workflow_runs ?? []
    ids.push(...runs.map(run => run.id))
    if (runs.length < 100) break
  }

  const missing = ids.filter(id => cache[id] === undefined)
  for (const id of missing.slice(0, MAX_NEW_RUNS)) {
    const jobs = await gh($, `repos/${repo}/actions/runs/${id}/jobs?filter=all&per_page=100`)
    if (jobs.ok) cache[id] = fromJobs(((jobs.data as { jobs?: Job[] }).jobs ?? []) as Job[])
  }
  await $.store.set(key, cache)

  const minutes: Record<string, number> = {}
  let quotaMinutes = 0
  for (const id of ids) {
    const run = cache[id]
    if (!run) continue
    quotaMinutes += run.quotaMinutes
    for (const [runner, n] of Object.entries(run.minutes)) minutes[runner] = (minutes[runner] ?? 0) + n
  }

  return { ok: true as const, minutes, quotaMinutes, pending: Math.max(0, missing.length - MAX_NEW_RUNS), runs: ids.length }
}

/** Measures the budget of whoever pays for the current repo's runs. */
async function measure($: EngineInterface, options: Options): Promise<CiBudgetSnapshot> {
  const now = new Date(await $.clock.now())
  const { label, year, month, since } = period(now)
  const hints: string[] = []

  const me = await gh($, 'user')
  if (!me.ok) {
    const result: CiBudgetSnapshot = {
      owner: '?',
      ownerType: 'User',
      period: label,
      source: 'none',
      minutes: {},
      quotaMinutes: 0,
      hints: [setupHint(me.stderr, { owner: 'GitHub', ownerType: 'User' })],
      at: now.getTime(),
    }
    await update($, snapshot, () => result)
    return result
  }
  const login = String((me.data as { login?: string }).login ?? '')

  const remoteUrl = await git($, ['remote', 'get-url', 'origin'])
  const remote = remoteUrl === undefined ? undefined : parseRemote(remoteUrl)
  if (!remote) hints.push('This folder has no GitHub `origin` remote: showing your own account.')
  const owner = remote?.owner ?? login
  const repo = remote ? `${remote.owner}/${remote.name}` : undefined

  const ownerInfo = await gh($, `users/${owner}`)
  const ownerType = ownerInfo.ok && (ownerInfo.data as { type?: string }).type === 'Organization' ? 'Organization' : 'User'
  const who = { owner, ownerType } as const

  let isPrivate: boolean | undefined
  if (repo) {
    const repoInfo = await gh($, `repos/${repo}`)
    if (repoInfo.ok) isPrivate = (repoInfo.data as { private?: boolean }).private === true
    else hints.push(`Cannot read ${repo} with your gh login: ${setupHint(repoInfo.stderr, who)}`)
  }

  const base = ownerType === 'Organization' ? `organizations/${owner}` : `users/${owner}`
  const canAskBilling = ownerType === 'Organization' || owner.toLowerCase() === login.toLowerCase()
  const billing = canAskBilling ? await gh($, `${base}/settings/billing/usage?year=${year}&month=${month}`) : undefined

  const result: CiBudgetSnapshot = {
    owner,
    ownerType,
    ...(repo === undefined ? {} : { repo }),
    ...(isPrivate === undefined ? {} : { isPrivate }),
    period: label,
    source: 'none',
    minutes: {},
    quotaMinutes: 0,
    hints,
    at: now.getTime(),
  }

  if (billing?.ok) {
    const items = ((billing.data as { usageItems?: UsageItem[] }).usageItems ?? []) as UsageItem[]
    const counted = fromBilling(items, label, remote?.name)
    Object.assign(result, {
      source: 'billing',
      minutes: counted.minutes,
      quotaMinutes: counted.quotaMinutes,
      grossUsd: counted.grossUsd,
      netUsd: counted.netUsd,
      ...(repo === undefined ? {} : { repoQuotaMinutes: counted.repoQuotaMinutes }),
    })

    const budgets = await gh($, `${base}/settings/billing/budgets`)
    if (budgets.ok) {
      result.budget = actionsBudget(((budgets.data as { budgets?: Record<string, unknown>[] }).budgets ?? []) as Record<string, unknown>[])
    }
  } else {
    if (billing) hints.push(setupHint(billing.stderr, who))
    else hints.push(`Billing of ${owner} is visible to ${owner} only. Showing an estimate from this repo's jobs.`)

    if (repo && isPrivate === false) {
      hints.push(`${repo} is public: its runs on GitHub-hosted runners are free.`)
    } else if (repo && isPrivate) {
      const estimate = await estimateRepo($, repo, since, label)
      if (estimate.ok) {
        Object.assign(result, {
          source: 'estimate',
          minutes: estimate.minutes,
          quotaMinutes: estimate.quotaMinutes,
          repoQuotaMinutes: estimate.quotaMinutes,
        })
        if (estimate.pending > 0) hints.push(`${estimate.pending} of ${estimate.runs} runs are not counted yet; they are added on the next refreshes.`)
      } else {
        hints.push(`Cannot read the Actions runs of ${repo}: ${setupHint(estimate.stderr, who)}`)
      }
    }
  }

  const plan =
    ownerType === 'Organization'
      ? await gh($, `orgs/${owner}`)
      : owner.toLowerCase() === login.toLowerCase()
        ? me
        : undefined
  const planName = plan?.ok ? String((plan.data as { plan?: { name?: string } }).plan?.name ?? '').toLowerCase() : ''
  const included = options.includedMinutes > 0 ? options.includedMinutes : INCLUDED_MINUTES[planName]
  if (included !== undefined && result.source === 'billing') {
    result.includedMinutes = included
    result.percent = Math.round((result.quotaMinutes / included) * 100)
  }

  if (repo && isPrivate !== undefined) {
    const cache = await gh($, `repos/${repo}/actions/cache/usage`)
    if (cache.ok) result.cacheBytes = Number((cache.data as { active_caches_size_in_bytes?: number }).active_caches_size_in_bytes ?? 0)
    const artifacts = await gh($, `repos/${repo}/actions/artifacts?per_page=100`)
    if (artifacts.ok) {
      const list = (artifacts.data as { artifacts?: { size_in_bytes?: number; expired?: boolean }[] }).artifacts ?? []
      result.artifactBytes = list.filter(a => !a.expired).reduce((sum, a) => sum + Number(a.size_in_bytes ?? 0), 0)
    }
  }

  await update($, snapshot, () => result)
  await warnOnThreshold($, result, options)
  await showStatus($)

  return result
}

async function warnOnThreshold($: EngineInterface, measured: CiBudgetSnapshot, options: Options) {
  if (measured.percent === undefined) return
  const crossed = options.warnAt.filter(level => measured.percent! >= level && level > warnedAt).at(-1)
  if (crossed === undefined) return
  warnedAt = crossed
  $.ui.toast(`ci-budget: ${measured.owner} has used ${measured.percent}% of its included Actions minutes this month`)
}

async function showStatus($: EngineInterface) {
  const measured = await read($, snapshot)
  const watching = await read($, watch)
  const parts: string[] = []

  if (measured?.source === 'billing' && measured.percent !== undefined) parts.push(`Actions ${measured.percent}% · ${measured.owner}`)
  else if (measured?.source === 'billing') parts.push(`Actions ${formatMinutes(measured.quotaMinutes)} min · ${measured.owner}`)
  else if (measured?.source === 'estimate') parts.push(`Actions ~${formatMinutes(measured.quotaMinutes)} min (estimate) · ${measured.repo}`)
  if (await read($, isPaused)) parts.push('block paused')
  if (watching && watching.runs.length > 0) parts.push(`CI ${watchSummary(watching)}`)

  $.ui.status(parts.length > 0 ? parts.join(' · ') : undefined)
}

function watchSummary(watching: CiBudgetWatch): string {
  const running = watching.runs.filter(run => run.status !== 'completed').length
  const failed = watching.runs.filter(run => run.status === 'completed' && run.conclusion !== 'success' && run.conclusion !== 'skipped').length
  if (running > 0) return `${running} running${failed > 0 ? `, ${failed} failed` : ''}`
  return failed > 0 ? `✗ ${failed} failed` : '✓'
}

/** Polls the runs a push or a dispatch started until they finish. */
function startWatch($: EngineInterface, repo: string, query: string, trigger: string, options: Options) {
  stopWatch?.()
  const startedAt = Date.now()
  let isPolling = false

  const poll = async () => {
    if (isPolling) return
    isPolling = true
    try {
      const listed = await gh($, `repos/${repo}/actions/runs?${query}&per_page=30`)
      if (!listed.ok) return
      const runs = ((listed.data as { workflow_runs?: Record<string, unknown>[] }).workflow_runs ?? []).map(run => ({
        id: Number(run.id),
        name: String(run.name ?? run.display_title ?? 'workflow'),
        status: String(run.status),
        conclusion: run.conclusion === null || run.conclusion === undefined ? null : String(run.conclusion),
        url: String(run.html_url ?? ''),
      }))
      const previous = await read($, watch)
      const stuck = previous?.stuck ?? []

      for (const run of runs.filter(r => r.status === 'in_progress')) {
        const jobs = await gh($, `repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`)
        if (!jobs.ok) continue
        for (const job of ((jobs.data as { jobs?: Job[] }).jobs ?? []) as Job[]) {
          if (job.status !== 'in_progress' || !job.started_at || stuck.includes(job.id)) continue
          const runningMs = Date.now() - Date.parse(job.started_at)
          if (runningMs < options.stuckMs) continue
          stuck.push(job.id)
          $.ui.toast(`ci-budget: "${job.name}" in ${run.name} has run ${Math.round(runningMs / 60_000)} min. Cancel: gh run cancel ${run.id}`)
        }
      }

      await update($, watch, () => ({ trigger, runs, stuck }))
      await showStatus($)

      const isDone = runs.length > 0 && runs.every(run => run.status === 'completed')
      const isQuiet = runs.length === 0 && Date.now() - startedAt > 5 * 60_000
      if (isDone || isQuiet || Date.now() - startedAt > 3 * 60 * 60_000) {
        stopWatch?.()
        stopWatch = undefined
        if (isDone) {
          const failed = runs.filter(run => run.conclusion !== 'success' && run.conclusion !== 'skipped')
          if (failed.length > 0) $.ui.toast(`ci-budget: ${failed.map(run => run.name).join(', ')} failed after ${trigger}`)
          await measure($, options)
        }
      }
    } finally {
      isPolling = false
    }
  }

  const timer = $.clock.every(60_000, () => void poll())
  stopWatch = () => timer.cancel()
  $.clock.after(15_000, () => void poll())
}

/** notify turns the budget warning into a desktop notification; it registers /notify. */
async function hasNotify($: EngineInterface): Promise<boolean> {
  const commands = await $.command.list().catch(() => [])
  return commands.some(command => command.name === 'notify')
}

const NOTIFY_HINT =
  'For a desktop notification when the budget runs low, install the notify mod: /plugin install notify@claude-mods.'

function report(measured: CiBudgetSnapshot | null, watching: CiBudgetWatch | null, paused: boolean, blockAt: number, isNotifyMissing: boolean): string {
  if (!measured) return 'Not measured yet: /ci-budget refresh.'
  const lines: string[] = []
  const source = { billing: 'from GitHub billing', estimate: "estimated from this repo's jobs", none: 'no usage data' }[measured.source]
  lines.push(`${measured.owner} (${measured.ownerType === 'Organization' ? 'organisation' : 'account'}) · ${measured.period} · ${source}`)

  const byRunner = Object.entries(measured.minutes)
    .sort(([, a], [, b]) => b - a)
    .map(([runner, n]) => `${runner} ${formatMinutes(n)}`)
    .join(', ')
  if (measured.source === 'billing') {
    const of = measured.includedMinutes === undefined ? '' : ` of ${formatMinutes(measured.includedMinutes)} included (${measured.percent}%)`
    lines.push(`Actions: ${formatMinutes(measured.quotaMinutes)} minutes${of}${byRunner ? ` · ${byRunner}` : ''}`)
    lines.push(`Cost: $${(measured.grossUsd ?? 0).toFixed(2)} gross, $${(measured.netUsd ?? 0).toFixed(2)} charged beyond the included minutes`)
    if (measured.budget === null) {
      lines.push('No GitHub budget for Actions: usage past the included minutes is charged. Set one that stops usage: Settings → Billing and licensing → Budgets and alerts.')
    } else if (measured.budget) {
      lines.push(`GitHub budget for Actions: $${measured.budget.amount}${measured.budget.stops ? ', stops usage at the limit' : ', alerts only (does not stop usage)'}`)
    }
  } else if (measured.source === 'estimate') {
    lines.push(`Actions: ~${formatMinutes(measured.quotaMinutes)} quota minutes in ${measured.repo} this month${byRunner ? ` · ${byRunner}` : ''} (this repo only; the owner's other repos are not counted)`)
  }
  if (measured.repo && measured.source === 'billing' && measured.repoQuotaMinutes !== undefined) {
    lines.push(`${measured.repo}${measured.isPrivate ? ' (private)' : ' (public: free)'}: ${formatMinutes(measured.repoQuotaMinutes)} of those minutes`)
  }
  const storage = [
    measured.cacheBytes === undefined ? '' : `cache ${formatBytes(measured.cacheBytes)} of 10 GB`,
    measured.artifactBytes === undefined ? '' : `artifacts ${formatBytes(measured.artifactBytes)}`,
  ].filter(Boolean)
  if (storage.length > 0) lines.push(`Storage: ${storage.join(', ')}`)
  if (watching && watching.runs.length > 0) {
    lines.push(`Runs after ${watching.trigger}: ${watching.runs.map(run => `${run.name} ${run.status === 'completed' ? run.conclusion : run.status}`).join(', ')}`)
  }
  lines.push(
    blockAt > 0
      ? `gh workflow run is blocked from ${blockAt}% (billing data only)${paused ? ': paused for this session' : ''}.`
      : 'gh workflow run is never blocked (blockAt 0).',
  )
  for (const hint of measured.hints) lines.push(`→ ${hint}`)
  if (isNotifyMissing && measured.source === 'billing') lines.push(`→ ${NOTIFY_HINT}`)

  return lines.join('\n')
}

export const register: Register = (on, raw) => {
  const options: Options = {
    warnAt: (Array.isArray(raw.warnAt) ? raw.warnAt : ['80']).map(Number).filter(n => n > 0).sort((a, b) => a - b),
    blockAt: Math.max(0, Number(raw.blockAt ?? 100)),
    includedMinutes: Math.max(0, Number(raw.includedMinutes ?? 0)),
    stuckMs: Math.max(1, Number(raw.stuckMinutes ?? 30)) * 60_000,
    refreshMs: Math.max(1, Number(raw.refreshMinutes ?? 15)) * 60_000,
    isLintOn: raw.lint !== false,
    isWatchOn: raw.watch !== false,
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'ci-budget',
      description: 'GitHub Actions minutes, budget and storage for this repo and its owner; refresh, off, on',
      argumentHint: '[refresh|off|on]',
    })
    // Measured in the background: the first prompt does not wait for GitHub
    $.clock.after(0, () => void measure($, options))
    $.clock.every(options.refreshMs, () => void measure($, options))

    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const isDispatch = /\bgh\s+workflow\s+run\b/.test(e.command)
    const isPush = /\bgit\s+push\b/.test(e.command)
    if (!isDispatch && !isPush) return next(e)

    const measured = await read($, snapshot)
    const isOver = measured?.source === 'billing' && measured.percent !== undefined && options.blockAt > 0 && measured.percent >= options.blockAt
    if (isDispatch && isOver && !(await read($, isPaused))) {
      return {
        deny: `ci-budget blocked this: ${measured!.owner} has used ${measured!.percent}% of its included Actions minutes this month (block at ${options.blockAt}%). Ask the user; they can allow it with /ci-budget off.`,
      }
    }

    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran

    const repo = measured?.repo
    if (options.isWatchOn && repo) {
      if (isPush) {
        const sha = await git($, ['rev-parse', 'HEAD'])
        if (sha) startWatch($, repo, `head_sha=${sha}`, 'git push', options)
      } else {
        const since = new Date(Date.now() - 60_000).toISOString().slice(0, 19)
        startWatch($, repo, `event=workflow_dispatch&created=%3E%3D${since}`, 'gh workflow run', options)
      }
    }

    const warnFrom = options.warnAt[0]
    if (isPush && measured?.percent !== undefined && warnFrom !== undefined && measured.percent >= warnFrom) {
      return { ...ran, context: [...(ran.context ?? []), `ci-budget: ${measured.owner} has used ${measured.percent}% of its included Actions minutes this month; this push starts CI runs. Mention it to the user if more pushes are planned.`] }
    }

    return ran
  })

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    if (!options.isLintOn || !isWorkflowPath(e.file_path) || ran.deny !== undefined || ran.isError === true) return ran
    const measured = await read($, snapshot)
    return withLint($, ran, e.file_path, e.content, measured?.isPrivate)
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const ran = await next(e)
    if (!options.isLintOn || !isWorkflowPath(e.file_path) || ran.deny !== undefined || ran.isError === true) return ran
    const text = await $.fs.read(e.file_path).catch(() => undefined)
    if (typeof text !== 'string') return ran
    const measured = await read($, snapshot)
    return withLint($, ran, e.file_path, text, measured?.isPrivate)
  })

  on('command.run', { command: 'ci-budget' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()

    if (arg === 'off' || arg === 'on') {
      if (!PERSON.has(e.origin.kind)) return { text: `/ci-budget ${arg} is only accepted from the person at the prompt (got ${e.origin.kind}).` }
      await update($, isPaused, () => arg === 'off')
      await showStatus($)
      return { text: arg === 'off' ? 'The block is paused for this session.' : 'The block is on.' }
    }
    if (arg !== '' && arg !== 'refresh') return { text: 'Usage: /ci-budget [refresh|off|on]' }

    const measured = arg === 'refresh' || (await read($, snapshot)) === null ? await measure($, options) : await read($, snapshot)
    return { text: report(measured, await read($, watch), await read($, isPaused), options.blockAt, !(await hasNotify($))) }
  })
}

function withLint<R extends { context?: readonly string[] }>($: EngineInterface, ran: R, path: string, text: string, isPrivate: boolean | undefined): R {
  const warnings = lintWorkflow(text, isPrivate === undefined ? {} : { isPrivate })
  if (warnings.length === 0) return ran

  const file = path.replace(/\\/g, '/').split('/').pop()
  $.ui.toast(`ci-budget: ${warnings.length} spend ${warnings.length === 1 ? 'risk' : 'risks'} in ${file}`)
  const note = `ci-budget found spend risks in ${file}:\n${warnings.map(w => `- ${w}`).join('\n')}\nFix them unless the user wants them.`

  return { ...ran, context: [...(ran.context ?? []), note] }
}
