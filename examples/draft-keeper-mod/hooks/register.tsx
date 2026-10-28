// draft-keeper-mod: the draft Ctrl+C clears from the prompt box comes back as a
// suggestion, dim in the empty box, and Tab takes it. The mod follows the box
// through prompt.edit and prompt.change.
//
// Sending a prompt clears the box too. On 2.1.303 that clear comes a
// millisecond or two before the prompt's prompt.submit, so a cleared draft is
// offered only after WAIT_MS with no prompt.submit; on 2.1.302 the
// prompt.submit came first, and the clear after it is told by its text. A
// slash command raises no prompt.submit, so a draft that starts with / is not
// kept.

// Inactive when loaded. /draft-keeper-mod enables this session; /draft-keeper-mod off disables it.

import type { Register, Timer } from 'claude-code'

/** How long a clear waits for the prompt.submit of a sent prompt, which follows it within milliseconds. */
const WAIT_MS = 200

// The box as the last edit or change left it, the draft a prompt.submit took
// (2.1.302's order), and the offer waiting out WAIT_MS.
let draft = ''
let sent: string | null = null
let offer: Timer | null = null

function withdraw(): void {
  offer?.cancel()
  offer = null
}

export const register: Register = on => {
  let enabled = false

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'draft-keeper-mod', description: 'Enable draft-keeper-mod; /draft-keeper-mod off disables it' })
    return next(e)
  })

  on('command.run', { command: 'draft-keeper-mod' }, async ($, e) => {
    const action = e.args.trim()
    if (!['', 'on', 'off'].includes(action)) return { text: 'Usage: /draft-keeper-mod [on|off]' }
    enabled = action !== 'off'
    withdraw()
    draft = ''
    sent = null
    return { text: enabled ? 'draft-keeper-mod is on for this session.' : 'draft-keeper-mod is off.' }
  })

  on('prompt.edit', async ($, e, next) => {
    if (!enabled) return next(e)
    const box = await next(e)
    draft = box.text
    return box
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    if (!enabled) return next(e)
    withdraw()
    sent = draft
    return next(e)
  }).catch(($, e, next) => next(e))

  on('prompt.change', async ($, e, next) => {
    if (!enabled) return next(e)
    const cleared = draft
    draft = e.text
    withdraw()
    const isCleared = e.origin.kind === 'clear' && e.text === '' && cleared.trim() !== ''
    const isLost = isCleared && cleared !== sent && !cleared.trimStart().startsWith('/')
    sent = null
    if (isLost) {
      offer = $.clock.after(WAIT_MS, () => {
        offer = null
        void $.prompt.suggest({ text: cleared }).catch(() => undefined)
      })
    }
    return next(e)
  }).catch(($, e, next) => next(e))
}
