declare module 'claude-code' {
  interface PluginState {
    'svg-mod': {
      /** Tool calls this session, by tool. */
      counts: { [tool: string]: number }
    }
  }
}
