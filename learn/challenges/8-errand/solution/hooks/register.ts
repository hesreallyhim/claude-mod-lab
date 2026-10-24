// errand: the solution to the challenge in ../README.md.

import type { EngineInterface, Register } from 'claude-code'

type Dollar = EngineInterface

// The type's full name: the plugin's, then the name it registers.
const TYPE = 'errand:errand'

/** Whether the agent that just ended is one of this type; the session's agent list knows each one's type. */
async function isErrand($: Dollar, agentId: string): Promise<boolean> {
  const agents = await $.agent.list()
  return agents.some(agent => agent.id === agentId && agent.type === TYPE)
}

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

  // Only the mod starts an errand: the model is not offered the type.
  on('agent.offer', { agent: TYPE }, () => ({ isOffered: false }))

  on('command.run', { command: 'errand' }, async ($, e) => {
    const task = e.args.trim()
    if (task === '') return { text: 'Use /errand <what to find out>.' }
    const spawned = await $.agent.spawn({ subagentType: TYPE, prompt: task, description: 'errand' })
    return { text: spawned.deny ?? 'Sent the errand to a background agent; its answer comes back here.' }
  })

  // An errand's answer, when its agent's turn ends, as a line for the person;
  // the model reads the agent's answer from the engine already. Other agents'
  // turns, and the main loop's, are not errands.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined && (await isErrand($, e.agentId))) $.ui.log(`came back: ${e.answer}`)
    return result
  }).catch(($, e, next) => next(e))
}
