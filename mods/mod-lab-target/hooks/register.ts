// mod-lab-target: hooks that fail on purpose, for /mod-lab verify to call and read
// the outcome off the chain. What each does, and why, is in ../README.md.

import type { EngineInterface, Register } from 'claude-code'

type Dollar = EngineInterface

// The hooks answer only paths under /dev/null/mod-lab-target/, which cannot exist:
// a call names one to ask for a failure, and every other call passes untouched.

// Whether the call made from a timer, after the hook that set it returned, reached this plugin's own hook.
let isTimerCallSeen = false

class Planned extends Error {}

async function callFromTimer($: Dollar): Promise<void> {
  await $.fs.exists('/dev/null/mod-lab-target/from-timer')
}

export const register: Register = on => {
  // Throws before next, with no .catch: the hook is skipped, and the chain beneath answers.
  on('fs.exists', { path: '/dev/null/mod-lab-target/skipped' }, () => {
    throw new Planned('mod-lab-target fails before next, as asked')
  })

  // Throws before next, with a .catch: the handler's answer stands.
  on('fs.exists', { path: '/dev/null/mod-lab-target/caught' }, () => {
    throw new Planned('mod-lab-target fails before next, as asked')
  }).catch(() => ({ value: true }))

  // Throws after next settled, with no .catch: what next settled to stands.
  on('fs.exists', { path: '/dev/null/mod-lab-target/kept' }, async ($, e, next) => {
    await next(e)
    throw new Planned('mod-lab-target fails after next, as asked')
  })

  // Sets a timer and returns; the timer's call names from-timer, which the hook below notes if it sees it.
  on('fs.exists', { path: '/dev/null/mod-lab-target/arm-timer' }, ($, e, next) => {
    isTimerCallSeen = false
    $.clock.after(10, () => void callFromTimer($))
    return next(e)
  })

  on('fs.exists', { path: '/dev/null/mod-lab-target/from-timer' }, ($, e, next) => {
    isTimerCallSeen = true
    return next(e)
  })

  // What the timer's call showed, answered without next.
  on('fs.read', { path: '/dev/null/mod-lab-target/report' }, () => ({ value: JSON.stringify({ isTimerCallSeen }) }))
}
