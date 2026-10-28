declare module 'claude-code' {
  interface PluginState {
    'band-mod': {
      /** Tool calls observed while the band is enabled in this session. */
      calls: number
      /** The last tool called, if any. */
      last: string | null
      /** Whether the mod draws its line in the band. */
      isShown: boolean
    }
  }
}
