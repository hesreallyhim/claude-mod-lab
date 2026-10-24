/** A timer that is set: how long it was set for, and when it ends, both in milliseconds. */
export type Egg = { ms: number; endsAt: number }

declare module 'claude-code' {
  interface PluginState {
    egg: { egg: Egg | null }
  }
}
