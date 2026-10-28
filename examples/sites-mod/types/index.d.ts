declare module 'claude-code' {
  interface PluginState {
    'sites-mod': {
      /** Whether this session records and draws tool-call durations. */
      isShown: boolean
      /** How long each tool call ran, in ms, by its tool_use_id. */
      durations: StateFamily<number | null>
    }
  }
}
