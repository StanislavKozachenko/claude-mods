export type TurnStats = {
  /** Tool calls by tool name, subagents' included. */
  tools: Record<string, number>
  /** Calls whose result was an error. */
  failed: number
  /** Files Edit, Write or NotebookEdit changed. */
  files: string[]
  /** What the turn cost, in US dollars, when the session reports a cost. */
  costUsd?: number
}

declare module 'claude-code' {
  interface PluginState {
    'turn-stats': {
      /** Summaries by the uuid of their turn_duration row (the line's requestId). */
      lines: Record<string, TurnStats>
    }
  }
}
