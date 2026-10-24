// only-mine: the challenge's solution. ../README.md says what it asks.

import type { Register } from 'claude-code'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'where', description: 'The directory this mod is told it works in' })
    return next(e)
  })

  on('command.run', { command: 'where' }, async $ => ({ text: await $.session.cwd() }))

  on('session.cwd', ($, e, next) => (next.origin.plugin === $.plugin.name ? { value: '/sandbox' } : next(e)))
}
