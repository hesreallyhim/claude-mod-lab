// Shared by the scrub checks; not a check itself.

import type { CommandRunInput, On } from 'claude-code'
import type { Plugin } from 'claude-code/testing'

/** A made-up key of the kind the mod redacts. */
export const KEY = 'sk-ant-api03-k9Qw2Xc7Vb1Nm4Lp8Rt5Yz3Hj6Gf0Dd'

export type Piece = { stream: 'stdout' | 'stderr'; text: string }
export const out = (text: string): Piece => ({ stream: 'stdout', text })
export const err = (text: string): Piece => ({ stream: 'stderr', text })

/**
 * Another plugin, whose /run starts a child and answers, as JSON, every piece
 * it read and how the child ended. `/run toast` also shows each piece as a
 * toast the moment it reads it.
 */
export const runner: Plugin = {
  name: 'runner',
  register(on) {
    on('command.run', { command: 'run' }, async ($, e) => {
      const read: Piece[] = []
      const stream = $.process.spawn({ argv: ['make', 'build'] })
      for await (const piece of stream) {
        read.push({ stream: piece.stream, text: piece.text })
        if (e.args === 'toast') await $.ui.toast(piece.text)
      }
      return { text: JSON.stringify({ read, ended: await stream.result }) }
    })
  },
}

export function run(args = ''): CommandRunInput {
  return { command: 'run', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 100 } }
}

/** What the runner read, and how the child ended, from its answer. */
export function readBy(answer: { text?: string }): { read: Piece[]; ended: { code: number | null } } {
  return JSON.parse(answer.text ?? '{}')
}

/** The text the runner read on one pipe, its pieces joined. */
export function textOn(read: readonly Piece[], pipe: Piece['stream']): string {
  return read
    .filter(piece => piece.stream === pipe)
    .map(piece => piece.text)
    .join('')
}

/**
 * The child beneath every plugin: these pieces, then its exit code.
 * `asked` hears each piece after the first being asked for.
 */
export function child(on: On, pieces: readonly Piece[], code = 0, asked?: () => void): void {
  on('process.spawn', async function* () {
    for (const [index, piece] of pieces.entries()) {
      if (index > 0) asked?.()
      yield piece
    }
    return { value: { code, signal: null } }
  })
}
