/** The seconds on the stopwatch. */
export type Seconds = number

declare module 'claude-code' {
  interface PluginState {
    tick: { seconds: Seconds }
  }
}
