// only-mine: a challenge. ../README.md says what to do; the checks in
// learn/challenges/1-only-mine/checks say when it is done.

import type { Register } from 'claude-code'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'where', description: 'The directory this mod is told it works in' })
    return next(e)
  })

  // Leave this hook as it is: /where keeps asking $.session.cwd().
  on('command.run', { command: 'where' }, async $ => ({ text: await $.session.cwd() }))

  // Your hook goes here.
}
