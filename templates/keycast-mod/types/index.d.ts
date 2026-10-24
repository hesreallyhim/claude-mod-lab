declare module 'claude-code' {
  interface PluginState {
    'keycast-mod': {
      /** The keys drawn above the prompt, the newest last: each keycap's face, and how many times in a row it was pressed. */
      caps: { face: string; count: number }[]
      /** Whether the mod draws in the band above the prompt. */
      isShown: boolean
    }
  }
}
