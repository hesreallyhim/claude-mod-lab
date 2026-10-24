// quiet: the challenge's solution. ../README.md says what it asks.

import type { Register } from 'claude-code'

const REMINDER_MS = 20 * 60 * 1000

let isQuiet = false

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'quiet', description: 'Holds the stretch reminders: /quiet on, /quiet off' })
    // The timer fires after this hook has returned, so its toast skips this
    // plugin's own hooks: the reminder decides for itself.
    $.clock.every(REMINDER_MS, () => {
      if (!isQuiet) $.ui.toast('Time to stand up and stretch.')
    })
    return next(e)
  })

  on('command.run', { command: 'quiet' }, async ($, e) => {
    isQuiet = e.args.trim() === 'on'
    return { text: isQuiet ? 'Quiet: reminders are held.' : 'Reminders are back on.' }
  })
}
