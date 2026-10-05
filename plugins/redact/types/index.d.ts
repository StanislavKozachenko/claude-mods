/** Secrets hidden from the model, by kind (`github-token`, `secret-value`, ...). */
export type RedactHits = Record<string, number>

declare module 'claude-code' {
  interface PluginState {
    redact: {
      hits: RedactHits
      isPaused: boolean
    }
  }
}
