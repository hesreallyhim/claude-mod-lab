// remind: reminders Claude can set for you. The starter of a tutorial,
// learn/tutorials/0d-remind/README.md. Claude can already call the mod's
// tool; each step of the tutorial fills in one place marked `Step`.

import type { EngineInterface, Register } from 'claude-code'

type Dollar = EngineInterface

/** The tool's name as Claude calls it: `mcp__`, the plugin's name, two underscores, the tool's own name. */
const TOOL = 'mcp__remind__remind_me'

/** What Claude must send with each call, as a JSON Schema: the engine shows it to Claude with the tool. */
const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    minutes: { type: 'number', description: 'How many minutes from now; more than 0' },
    about: { type: 'string', description: 'What to remind the person of, in a few words' },
  },
  required: ['minutes', 'about'],
}

type Reminder = { minutes: number; about: string }

/** The reminder going off: said aloud, then passed to Claude, who reminds you in the conversation. */
async function remind($: Dollar, about: string): Promise<void> {
  $.audio.speak(`Reminder: ${about}`).catch(() => {})
  // Step 4: tell Claude the reminder has gone off, and what it is about.
}

/** Sets `reminder` to go off in its number of minutes. */
function set($: Dollar, reminder: Reminder): void {
  // Step 3: in `reminder.minutes` minutes, call remind($, reminder.about).
}

// Plain helpers: nothing to change from here to `register`.

/** The reminder in what was sent, or what is wrong with it. */
function reminderOf(input: unknown): Reminder | string {
  const { minutes, about } = input as { minutes?: unknown; about?: unknown }
  if (typeof minutes !== 'number' || !(minutes > 0 && minutes <= 24 * 60)) return 'minutes must be a number above 0, a day at most'
  if (typeof about !== 'string' || about.trim() === '') return 'about must say what the reminder is for'
  return { minutes, about: about.trim().slice(0, 200) }
}

/** `90 seconds`, `1 minute`, `2.5 minutes`. */
function inWords(minutes: number): string {
  if (minutes < 1) return `${Math.round(minutes * 60)} seconds`
  return `${minutes} minute${minutes === 1 ? '' : 's'}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'remind_me',
      description:
        'Reminds the person of something after a number of minutes: when the time comes the reminder is said aloud and sent back to you, so you can remind them. Use it when they ask to be reminded of something.',
      inputSchema: INPUT_SCHEMA,
      isDeferred: false,
    })
    await $.command.register({ name: 'remind', description: 'Sets a reminder yourself: /remind 5 stretch' })
    return next(e)
  })

  // Claude calls the tool. What this hook returns is what Claude reads back.
  on('tool.call', { tool: TOOL }, async ($, e) => {
    const reminder = reminderOf(e)
    if (typeof reminder === 'string') return { deny: `remind: ${reminder}` }
    set($, reminder)
    return { result: 'Reminders do not work yet.' } // Step 2: tell Claude it is set: what about, and in how long.
  })

  // The same, typed by you: /remind 5 stretch.
  on('command.run', { command: 'remind' }, async ($, e) => {
    const [minutes = '', ...words] = e.args.trim().split(/\s+/)
    const reminder = reminderOf({ minutes: Number(minutes), about: words.join(' ') })
    if (typeof reminder === 'string') return { text: `Use /remind <minutes> <what about>: ${reminder}.` }
    set($, reminder)
    return { text: `Reminder set: ${reminder.about}, in ${inWords(reminder.minutes)}.` }
  })
}
