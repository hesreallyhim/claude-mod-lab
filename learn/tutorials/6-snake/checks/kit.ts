// Shared by the snake checks; not a check itself. The checks mount the pane
// on a surface that draws a Client, and act on the board through the kit's
// Client acts: its frame clock (advance), a key, a post.

import type { CommandRunInput, On, RenderPropsOf, RenderSurface } from 'claude-code'

export function slash(name: string, args = ''): CommandRunInput {
  return { command: name, args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 100 } }
}

/** The pane as a surface mounts it; the surface's own type, so the drawing has that surface's acts. */
export function pane<S extends RenderSurface = 'terminal'>(surface: S = 'terminal' as S) {
  const props: RenderPropsOf['Pane'] = { title: 'snake', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} }
  return { plugin: 'snake', surface, component: 'Pane' as const, requestId: 'snake', props, viewport: { columns: 80, rows: 40 } }
}

/** The surfaces that draw a Client. */
export const CLIENT_SURFACES = ['terminal', 'desktop'] as const

/** The board's text rows, read from inside the Client keyed `board`. */
export async function boardOf(ui: { findAll: (query: { type: string; in?: string }) => Promise<readonly { text: string }[]> }): Promise<string[]> {
  return (await ui.findAll({ type: 'Text', in: 'board' })).map(text => text.text)
}

/** Where the snake's head is: the column and row of the first █ found on the side it heads. */
export function cellsOf(rows: readonly string[], glyph: string): [number, number][] {
  return rows.flatMap((row, y) => [...row].flatMap((char, x) => (char === glyph ? [[x, y] as [number, number]] : [])))
}

/** A click on the board, which starts its game. */
export async function click(ui: { pointer: (event: { type: 'down'; x: number; y: number; button: 'left'; in?: string }) => Promise<void> }): Promise<void> {
  await ui.pointer({ type: 'down', x: 2, y: 2, button: 'left', in: 'board' })
}

/** A Map standing in for the mod's $.store during a check, seeded with `entries`. */
export function store(on: On, entries: Record<string, unknown> = {}): Map<string, unknown> {
  const kept = new Map(Object.entries(entries))
  on('store.get', ($, e) => ({ value: kept.get(e.key) }))
  on('store.set', ($, e) => {
    kept.set(e.key, e.value)
    return { value: undefined }
  })
  return kept
}
