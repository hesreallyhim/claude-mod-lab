declare module 'claude-code' {
  interface PluginState {
    'sites-mod': {
      /** How long each tool call ran, in ms, by its tool_use_id. */
      durations: StateFamily<number | null>
    }
  }
}
