export type SnapshotCategory = {
  /** The row's label as /context prints it. */
  name: string
  tokens: number
  /** The theme colour /context draws the row in, by its key in the theme. */
  color: string
  kind: 'used' | 'free' | 'buffer' | 'deferred'
}

export type ContextSnapshot = {
  categories: SnapshotCategory[]
  /** Tokens in use, as /context counts them. */
  usedTokens: number
  /** The window measured against (the compaction window). */
  maxTokens: number
  /** usedTokens over maxTokens, 0 to 100. */
  percent: number
  /** When it was measured, in ms since the epoch. */
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    'context-bar': {
      snapshot: ContextSnapshot | null
      isHidden: boolean
    }
  }
}
