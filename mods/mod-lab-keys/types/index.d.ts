/**
 * One change to the prompt box made other than by an edit, as `prompt.change`
 * reported it; `origin` says where it came from (prompt history, clearing
 * the box, an undo, a plugin, the app or the engine). Lengths only: the
 * draft is not kept.
 */
export type KeyChange = {
  /** Numbered from 1 in the order kept, across the session. */
  seq: number
  at: number
  /** `history`, `clear`, `undo`, `plugin <name>`, `app`, `engine`, or a kind a newer build adds. */
  origin: string
  /** The box's length once changed. */
  length: number
  cursor: number
}

/** The newest changes, oldest first. */
export type KeyChanges = { rows: KeyChange[] }

declare module 'claude-code' {
  interface PluginState {
    'mod-lab-keys': {
      changes: KeyChanges
    }
  }
}
