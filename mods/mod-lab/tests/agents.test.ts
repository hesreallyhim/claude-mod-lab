import type { On } from 'claude-code'
import type { Plugin } from 'claude-code/testing'
import { expect, test } from 'claude-code/testing'

import { EMPTY_AGENTS, formatAgents, withEnd, withRun } from '../hooks/agents'
import { lab, slash } from './kit'

/** The engine's agents beneath the plugins: registers, spawns (keeping what each asked for) and lists none. */
function engine(on: On) {
  const spawned: { model?: string; subagentType: string; resume?: unknown }[] = []
  on('agent.register', ($, e) => ({ value: { agent: `mod-lab:${e.name}` } }))
  on('agent.spawn', ($, e) => {
    spawned.push(e)
    return { model: e.model ?? 'model-inherited', agentId: `agent-${spawned.length}` }
  })
  on('agent.list', () => ({ value: [] }))
  return spawned
}

/** Another plugin, whose /delegate spawns an agent on the model it names. */
const delegator: Plugin = {
  name: 'delegator',
  register(on) {
    on('command.run', { command: 'delegate' }, async ($, e) => {
      const spawned = await $.agent.spawn({ subagentType: 'general-purpose', prompt: 'look around', model: e.args })
      return { text: spawned.deny ?? `spawned ${spawned.agentId} on ${spawned.model}` }
    })
  },
}

test('a type registered from the lab is listed under its full name', async ($, on) => {
  engine(on)

  const answer = await $.command.run(lab('agent register {"name": "summarizer", "description": "Summarizes a file", "prompt": "Summarize.", "model": "haiku"}'))
  const listed = await $.command.run(lab('agent'))

  expect(answer.text).toContain('Registered mod-lab:summarizer')
  expect(listed.text).toContain('registered: mod-lab:summarizer')
})

test('a spawn is kept once, then ends with its answer, as its turn.complete carries it', () => {
  // In the kit no spawn starts an agent: agentId is set by the engine's core alone. The live run covers that part.
  const run = { agentId: 'agent-r1', type: 'general-purpose', by: 'engine', description: 'd', prompt: 'p', model: 'model-m1', isRouted: true, at: 1, status: 'running' as const, answer: null, durationMs: null }

  const kept = withRun(withRun(EMPTY_AGENTS, run), run)
  const done = withEnd(kept, 'agent-r1', { answer: 'answer-a7', durationMs: 2_400, isAborted: false })

  expect(kept.runs).toHaveLength(1)
  expect(formatAgents(kept, 1)).toContain('agent-r1 general-purpose by engine on model-m1, routed: running')
  expect(formatAgents(done, 0)).toContain('agent-r1 general-purpose by engine on model-m1, routed: done in 2.4s')
  expect(formatAgents(done, 0)).toContain('answer-a7')
})

test("in the kit a spawn starts no agent, and the lab says so rather than list one", async ($, on) => {
  engine(on)

  const answer = await $.command.run(lab('agent spawn general-purpose List the docs.'))

  expect(answer.text).toBe('A hook answered the spawn without starting an agent.')
})

test("the route sends another plugin's spawn to its model while set, and none after", { plugins: [delegator] }, async ($, on) => {
  const spawned = engine(on)

  await $.command.run(lab('agent route model-cheap'))
  const answer = await $.command.run(slash('delegate', 'model-dear'))
  await $.command.run(lab('agent route off'))
  await $.command.run(slash('delegate', 'model-dear'))
  const listed = await $.command.run(lab('agent'))

  // What reached the engine is the test: in the kit the caller's result names the model it asked for.
  expect(answer.text).toContain('spawned')
  expect(spawned.map(one => one.model)).toEqual(['model-cheap', 'model-dear'])
  expect(listed.text).toContain('Spawns run on the model they ask for.')
})

test('a hidden type is not offered to the model, and the rest still are', async ($, on) => {
  engine(on)
  on('agent.offer', () => ({ isOffered: true }))
  const offer = (agent: string) => ({ agent, description: 'a type', source: 'built-in', provider: { plugin: 'engine', tier: 'core' } }) as const

  await $.command.run(lab('agent hide Plan'))
  const plan = await $.agent.offer(offer('Plan'))
  const other = await $.agent.offer(offer('general-purpose'))
  await $.command.run(lab('agent show Plan'))
  const again = await $.agent.offer(offer('Plan'))

  expect([plan.isOffered, other.isOffered, again.isOffered]).toEqual([false, true, true])
})

test("an agent's transcript is its own rows, one a line", async ($, on) => {
  on('session.messages', ($, e) =>
    (e.agentId === 'agent-t1'
      ? { value: [{ role: 'user', text: 'task-t2', toolUses: [] }, { role: 'assistant', text: 'reply-t3', toolUses: [{ id: 'u1', tool: 'Read', input: {} }] }] }
      : { value: { deny: "not one of this session's agents" } }) as never,
  )

  const transcript = await $.command.run(lab('agent transcript agent-t1'))
  const refused = await $.command.run(lab('agent transcript agent-zz'))

  expect(transcript.text).toBe('user: task-t2\nassistant [Read]: reply-t3')
  expect(refused.text).toContain("not one of this session's agents")
})
