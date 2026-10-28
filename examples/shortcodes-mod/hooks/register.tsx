// shortcodes-mod: your own shortcodes in the prompt box. Type :tests: and the
// closing colon writes the prompt it stands for; while one is half typed, the
// rest of it and what it stands for follow the cursor as ghost text. Claude
// Code's own :emoji: shortcodes go on as before. Edit SHORTCODES to make
// them yours.

// Inactive when loaded. /shortcodes-mod enables this session; /shortcodes-mod off disables it.

import type { Register } from 'claude-code'

export const SHORTCODES: Record<string, string> = {
  tests: 'Run the tests and fix any that fail.',
  explain: 'Explain what this code does, step by step.',
  review: 'Review the uncommitted changes for bugs before I commit.',
  commit: 'Write a commit message for the staged changes.',
  plan: 'Before changing anything, write a short plan and wait for my go-ahead.',
  lgtm: 'Looks good to me.',
  shrug: '¯\\_(ツ)_/¯',
  tableflip: '(╯°□°)╯︵ ┻━┻',
}

// A shortcode being typed just before the cursor, its opening colon included.
const OPEN = /:([a-z0-9_+-]+)$/
// How much of what a shortcode stands for the ghost text shows.
const PREVIEW = 40

/** The ghost text for a half-typed name: the rest of the first shortcode it starts, and what that stands for. */
export function ghostFor(typed: string): string | null {
  const name = Object.keys(SHORTCODES).find(one => one.startsWith(typed))
  if (name === undefined) return null
  const text = SHORTCODES[name] ?? ''
  return `${name.slice(typed.length)}: ${text.length > PREVIEW ? `${text.slice(0, PREVIEW - 1)}…` : text}`
}

export const register: Register = on => {
  let enabled = false

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'shortcodes-mod', description: 'Enable shortcodes-mod; /shortcodes-mod off disables it' })
    return next(e)
  })

  on('command.run', { command: 'shortcodes-mod' }, async ($, e) => {
    const action = e.args.trim()
    if (!['', 'on', 'off'].includes(action)) return { text: 'Usage: /shortcodes-mod [on|off]' }
    enabled = action !== 'off'
    return { text: enabled ? 'shortcodes-mod is on for this session.' : 'shortcodes-mod is off.' }
  })

  on('prompt.edit', async ($, e, next) => {
    if (!enabled) return next(e)
    // The closing colon: the shortcode before it becomes its text, the key spent on that.
    const isColon = e.key !== undefined && e.start === e.end && e.inputText === ':'
    const closed = isColon ? OPEN.exec(e.text.slice(0, e.start)) : null
    const text = closed === null ? undefined : SHORTCODES[closed[1] ?? '']
    if (closed !== null && text !== undefined) {
      const at = e.start - closed[0].length
      return { text: e.text.slice(0, at) + text + e.text.slice(e.end), cursor: at + text.length }
    }
    // Any other edit: a half-typed shortcode before the cursor gets its ghost text.
    const box = await next(e)
    const open = OPEN.exec(box.text.slice(0, box.cursor))
    const ghost = open === null ? null : ghostFor(open[1] ?? '')
    if (ghost === null) return box
    return { ...box, decorations: [...(box.decorations ?? []), { start: box.cursor, end: box.cursor, virtualText: ghost, dimColor: true }] }
  }).catch(($, e, next) => next(e))
}
