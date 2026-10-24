export type ScratchCount = number

declare module 'claude-code' {
  interface PluginState {
    'scratch-mod': { count: ScratchCount }
  }
}
