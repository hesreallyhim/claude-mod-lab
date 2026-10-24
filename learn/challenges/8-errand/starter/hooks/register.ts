// errand: a challenge. ../README.md says what to do; the checks in
// learn/challenges/8-errand/checks say when it is done.

import type { Register } from 'claude-code'

// The type's full name: the plugin's, then the name it registers.
const TYPE = 'errand:errand'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'errand', description: 'Send a small read-only errand to a background agent', argumentHint: '<what to find out>' })
    await $.agent.register({
      name: 'errand',
      description: 'Finds something out in the repository and reports it in a few lines',
      prompt: 'You run one small errand: find out what you are asked, by reading files, and report it in at most five lines. Change nothing.',
      model: 'haiku',
      tools: ['Read', 'Glob', 'Grep'],
    })
    return next(e)
  })

  on('command.run', { command: 'errand' }, async ($, e) => {
    const task = e.args.trim()
    if (task === '') return { text: 'Use /errand <what to find out>.' }
    const spawned = await $.agent.spawn({ subagentType: TYPE, prompt: task, description: 'errand' })
    return { text: spawned.deny ?? 'Sent the errand to a background agent; its answer comes back here.' }
  })

  // An agent's answer, when its turn ends, as a line for the person.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) $.ui.log(`came back: ${e.answer}`)
    return result
  })
}
