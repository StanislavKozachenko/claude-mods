/** What log-trim condensed this session. */
export type LogTrimStats = {
  outputs: number
  linesBefore: number
  linesAfter: number
  charsSaved: number
}

declare module 'claude-code' {
  interface PluginState {
    'log-trim': {
      stats: LogTrimStats
      isPaused: boolean
    }
  }
}
