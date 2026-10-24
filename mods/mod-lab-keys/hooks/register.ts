// mod-lab-keys: keeps each change to the prompt box that came another way
// than an edit, for /mod-lab keys. What it keeps, and why it is a plugin of
// its own, are in ../README.md.

import { atom, update } from 'claude-code'
import type { PromptChangeInput, Register } from 'claude-code'

import type { KeyChange, KeyChanges } from '../types'

const MAX_ROWS = 100

const EMPTY: KeyChanges = { rows: [] }

const changes = atom({ plugin: 'mod-lab-keys', key: 'changes' } as const, EMPTY)

export function changeRow(e: PromptChangeInput, at: number): Omit<KeyChange, 'seq'> {
  const origin = e.origin.kind === 'plugin' ? `plugin ${e.origin.name}` : e.origin.kind
  return { at, origin, length: e.text.length, cursor: e.cursor }
}

export function withRow(kept: KeyChanges, row: Omit<KeyChange, 'seq'>): KeyChanges {
  const seq = (kept.rows.at(-1)?.seq ?? 0) + 1
  return { rows: [...kept.rows, { ...row, seq }].slice(-MAX_ROWS) }
}

export const register: Register = on => {
  // The box has already changed when this runs: watch only, passed on unchanged.
  on('prompt.change', async ($, e, next) => {
    const result = await next(e)
    await update($, changes, kept => withRow(kept, changeRow(e, Date.now())))
    return result
  }).catch(($, e, next) => next(e))
}
