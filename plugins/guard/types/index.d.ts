export type GuardBlock = {
  /** The tool whose call was denied. */
  tool: string
  /** The rule that fired. */
  rule: string
  /** The command segment or path it matched. */
  subject: string
  /** When, in ms since the epoch. */
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    guard: {
      isPaused: boolean
      blocks: GuardBlock[]
    }
  }
}
