// quiet: a challenge. ../README.md says what to do; the checks in
// learn/challenges/2-quiet/checks say when it is done.

import type { Register } from 'claude-code'

const REMINDER_MS = 20 * 60 * 1000

let isQuiet = false

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'quiet', description: 'Holds the stretch reminders: /quiet on, /quiet off' })
    $.clock.every(REMINDER_MS, () => $.ui.toast('Time to stand up and stretch.'))
    return next(e)
  })

  on('command.run', { command: 'quiet' }, async ($, e) => {
    isQuiet = e.args.trim() === 'on'
    return { text: isQuiet ? 'Quiet: reminders are held.' : 'Reminders are back on.' }
  })

  // While quiet, this mod's own toasts are held: answered here, never shown.
  on('ui.toast', ($, e, next) => (isQuiet && next.origin.plugin === $.plugin.name ? { value: undefined } : next(e)))
}
