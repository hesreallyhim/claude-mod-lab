export type GalleryTab = 'raster' | 'image' | 'svg' | 'links' | 'hover' | 'band' | 'sites'

/** A tool call the gallery saw finish: when it started, which tool, its id, how long it ran, and its input in brief. */
export type GalleryCall = { at: number; tool: string; id: string | null; ms: number; summary: string }

declare module 'claude-code' {
  interface PluginState {
    'gallery-mod': {
      tab: GalleryTab
      /** The newest tool calls, oldest first. */
      calls: GalleryCall[]
      /** Whether the gallery draws its line in the band above the prompt. */
      isBandShown: boolean
      /** Whether finished tool calls' rows carry the gallery's badge; off in each new session. */
      areSitesOn: boolean
      /** How long each tool call ran, by its tool_use_id. */
      durations: StateFamily<number | null>
    }
  }
}
