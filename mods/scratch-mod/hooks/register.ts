// scratch-mod: small hook patterns, each with a test in ../tests that shows what
// it does. From this mod’s directory, run `claude plugin test .` after changing
// a pattern, and read what the tests say.
// ../README.md lists the patterns and what to try.

import { atom, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

type Dollar = EngineInterface

const count = atom({ plugin: 'scratch-mod', key: 'count' } as const, 0)

// For the frames pattern: who made each session.cwd call this plugin's own hook saw.
let caller = 'nobody'
const seenByOwnHook: string[] = []

async function cwdAs($: Dollar, who: string) {
  caller = who
  return $.session.cwd()
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'scratch-count', description: 'scratch: count up in $.state' })
    await $.command.register({ name: 'scratch-home', description: "scratch: HOME as this plugin's own env.get hook answers it" })
    await $.command.register({ name: 'scratch-frames', description: "scratch: which calls this plugin's own hook saw" })
    // Frames: a timer set here fires after this hook has returned.
    $.clock.after(10, () => void cwdAs($, 'timer'))
    return next(e)
  })

  // Rewrite: hand the rest of the chain a changed copy of e.
  on('prompt.submit', ($, e, next) =>
    next({ ...e, text: e.text.trim(), context: [...(e.context ?? []), 'scratch saw this prompt'] }),
  )

  // Guard: answer without next to refuse. The .catch refuses too if the guard
  // itself fails, since a failed hook is otherwise skipped and the call goes on.
  on('tool.call', { tool: 'Write' }, ($, e, next) =>
    e.file_path.includes('/secrets/') ? { deny: 'scratch: nothing is written under secrets/' } : next(e),
  ).catch(($, e, next) => (next.called ? next(e) : { deny: 'scratch: the guard failed' }))

  // After next: let the call run, then act on its result. A failure after next
  // keeps what next settled to (the trace says kept); the .catch replays that
  // same result, and the trace says caught.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if ('isError' in ran && ran.isError === true) $.ui.status(`scratch: ${e.command} failed`)
    return ran
  }).catch(($, e, next) => next(e))

  // Answer a $ call: env.get is an event like any other. This answers only the
  // calls this plugin makes; every other plugin's go on to the engine.
  on('env.get', ($, e, next) =>
    next.origin.plugin === $.plugin.name && e.name === 'HOME' ? { value: '/pretend/home' } : next(e),
  )

  on('command.run', { command: 'scratch-home' }, async $ => ({ text: `HOME is ${await $.env.get('HOME')}` }))

  // State: update reads, changes and writes with ifVersion, retrying on a miss.
  on('command.run', { command: 'scratch-count' }, async $ => {
    const now = await update($, count, value => value + 1)
    return { text: `count is ${now}` }
  })

  // Frames: this plugin's own session.cwd hook, recording who made each call it sees.
  on('session.cwd', ($, e, next) => {
    seenByOwnHook.push(caller)
    return next(e)
  })

  on('command.run', { command: 'scratch-frames' }, async $ => {
    await cwdAs($, 'command')
    return { text: `seen by this plugin's own hook: ${seenByOwnHook.join(', ') || 'none'}` }
  })
}
