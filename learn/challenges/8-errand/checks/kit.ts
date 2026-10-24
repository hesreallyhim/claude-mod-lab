// Shared by the errand checks; not a check itself. The checks' own hooks sit
// beneath the mod and stand for the engine. In the kit no spawn starts an
// agent, so the checks raise an agent's turn.complete themselves.

import type { AgentInfo, AgentSpawnInput, AgentSpec, CommandRunInput, On, TurnCompleteInput } from 'claude-code'

/** The type's full name, as the engine names a plugin's type: `<plugin>:<name>`. */
export const TYPE = 'errand:errand'

export function slash(name: string, args = ''): CommandRunInput {
  return { command: name, args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 100 } }
}

export type Engine = { registered: AgentSpec[]; spawned: AgentSpawnInput[]; logged: string[] }

/**
 * The engine beneath the mod: a session's start, command and type
 * registrations, spawns (keeping what each asked for), the session's agents
 * as `agents` lists them, and the lines logged to the transcript.
 */
export function engine(on: On, agents: AgentInfo[] = []): Engine {
  const seen: Engine = { registered: [], spawned: [], logged: [] }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('agent.register', ($, e) => {
    seen.registered.push(e as AgentSpec)
    return { value: { agent: `errand:${e.name}` } }
  })
  on('agent.spawn', ($, e) => {
    seen.spawned.push(e)
    return { model: e.model ?? 'model-inherited' }
  })
  on('agent.list', () => ({ value: agents }))
  on('ui.log', ($, e) => {
    seen.logged.push(e.text)
    return { value: undefined }
  })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  return seen
}

/** The type a spawn asked for. The kit's bottom hook gets the Agent tool's input shape, `subagent_type`; hooks in a session read `subagentType`. */
export function typeOf(spawn: AgentSpawnInput): string | undefined {
  return (spawn as { subagent_type?: string }).subagent_type ?? spawn.subagentType
}

/** An agent of the session, as `$.agent.list()` lists it. */
export function agent(id: string, type: string): AgentInfo {
  return { id, type, description: 'an agent', status: 'completed' }
}

/** An agent's turn ending with `answer`; with no `agentId`, the main loop's. */
export function ended(answer: string, agentId?: string): TurnCompleteInput {
  return { answer, durationMs: 1_200, isAborted: false, reason: 'answer', turnId: 'turn-t1', ...(agentId === undefined ? {} : { agentId }) } as TurnCompleteInput
}

/** The Agent tool's list of types, as the engine asks each plugin whether to offer one to the model. */
export function offer(name: string) {
  return { agent: name, description: 'a type', source: 'plugin', provider: { plugin: 'engine', tier: 'core' } } as const
}
