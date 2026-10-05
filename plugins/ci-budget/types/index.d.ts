/** Where the numbers came from: GitHub's own billing, or an estimate from the repo's jobs. */
export type CiBudgetSource = 'billing' | 'estimate' | 'none'

export type CiBudgetBudget = {
  /** US dollars for the month; 0 means no paid usage at all. */
  amount: number
  /** GitHub stops the product once the budget is spent. */
  stops: boolean
}

export type CiBudgetSnapshot = {
  /** The account or organisation that pays for the current repo's runs. */
  owner: string
  ownerType: 'Organization' | 'User'
  /** `owner/name` of the session's repo, when it has a GitHub remote. */
  repo?: string
  isPrivate?: boolean
  /** `2026-10` */
  period: string
  source: CiBudgetSource
  /** Raw minutes this month by runner (`Linux`, `macOS`, a billing SKU). */
  minutes: Record<string, number>
  /** Minutes counted against the included quota: Linux 1×, Windows 2×, macOS 10×. */
  quotaMinutes: number
  includedMinutes?: number
  /** quotaMinutes over includedMinutes, 0 to 100+. */
  percent?: number
  grossUsd?: number
  /** What was actually charged, beyond the included quota. */
  netUsd?: number
  /** The current repo's quota minutes (billing: from the owner's usage). */
  repoQuotaMinutes?: number
  /** The Actions budget: null when the owner has none, absent when it cannot be read. */
  budget?: CiBudgetBudget | null
  cacheBytes?: number
  artifactBytes?: number
  /** What is missing and how to set it up, one line each. */
  hints: string[]
  /** When measured, ms since the epoch. */
  at: number
}

export type CiBudgetWatch = {
  /** What started it: `git push` or `gh workflow run`. */
  trigger: string
  runs: { id: number; name: string; status: string; conclusion: string | null; url: string }[]
  /** Jobs already reported as stuck. */
  stuck: number[]
}

declare module 'claude-code' {
  interface PluginState {
    'ci-budget': {
      snapshot: CiBudgetSnapshot | null
      watch: CiBudgetWatch | null
      isPaused: boolean
    }
  }
}
