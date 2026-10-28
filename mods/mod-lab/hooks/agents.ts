// The lab's agents: types it registers, every spawn in the session as its
// hook on agent.spawn sees it, each agent's end at turn.complete, the types it
// hides from the model, and a route that sends every new spawn to one model.

import { atom, read, update } from 'claude-code'
import type { AgentSpec, EngineInterface, Register } from 'claude-code'

import type { LabAgentRun, LabAgents } from '../types'
import { formatAgentTranscript, readAgentTranscript } from './agent-transcript'
import { jsonOrText, splitCommand } from './args'
import { serial } from './runner'

type Dollar = EngineInterface

export const EMPTY_AGENTS: LabAgents = { types: [], runs: [], hidden: [], route: null }
const MAX_RUNS = 50
const PROMPT_CHARS = 500
const ANSWER_CHARS = 4_000
const NEWEST = 8

const agents = atom({ plugin: 'mod-lab', key: 'agents' } as const, EMPTY_AGENTS)

function cut(text: string, chars: number): string {
  return text.length > chars ? `${text.slice(0, chars)}…` : text
}

/** Keeps a run once: the lab's own spawn records it, and another plugin's or the model's reaches the lab's hook. */
export function withRun(kept: LabAgents, run: LabAgentRun): LabAgents {
  if (kept.runs.some(one => one.agentId === run.agentId)) return kept
  return { ...kept, runs: [...kept.runs, run].slice(-MAX_RUNS) }
}

/** Marks a run's end with its answer, as its turn.complete carried it. */
export function withEnd(kept: LabAgents, agentId: string, end: { answer: string; durationMs: number; isAborted: boolean }): LabAgents {
  return {
    ...kept,
    runs: kept.runs.map(run =>
      run.agentId === agentId ? { ...run, status: end.isAborted ? 'aborted' : 'done', answer: cut(end.answer, ANSWER_CHARS), durationMs: end.durationMs } : run,
    ),
  }
}

export function formatAgents(kept: LabAgents, listed: number): string {
  const lines = [
    `Agent types the lab registered: ${kept.types.length === 0 ? 'none' : kept.types.map(type => type.agent).join(', ')}.`,
    `Hidden from the model: ${kept.hidden.length === 0 ? 'none' : kept.hidden.join(', ')}.`,
    kept.route === null ? 'Spawns run on the model they ask for.' : `Every new spawn is sent to ${kept.route}.`,
    `$.agent.list() has ${listed} agent${listed === 1 ? '' : 's'} in the session now.`,
  ]
  if (kept.runs.length === 0) return [...lines, 'No agent has been spawned in this session yet.'].join('\n')
  lines.push('', 'Spawned:')
  for (const run of kept.runs.slice(-NEWEST).reverse()) {
    const routed = run.isRouted ? ', routed' : ''
    const took = run.durationMs === null ? '' : ` in ${Math.round(run.durationMs / 100) / 10}s`
    lines.push(`  ${run.agentId} ${run.type} by ${run.by} on ${run.model ?? 'its own model'}${routed}: ${run.status}${took}`)
    if (run.answer !== null) lines.push(`    ${cut(run.answer.replace(/\s+/g, ' '), 160)}`)
  }
  return lines.join('\n')
}

/** Keeps a change. The write is not awaited: it waits behind any run in progress, which may be waiting on this call. */
function save($: Dollar, change: (kept: LabAgents) => LabAgents): void {
  void serial(() => update($, agents, change))
}

/** Called from the lab's turn.complete hook: an agent's turn ended, so its run did. */
export function noteAgentEnd($: Dollar, e: { agentId?: string; answer: string; durationMs: number; isAborted: boolean }): void {
  const { agentId } = e
  if (agentId === undefined) return
  save($, kept => withEnd(kept, agentId, e))
}

function isSpec(value: unknown): value is AgentSpec {
  if (value === null || typeof value !== 'object') return false
  const { name, description, prompt } = value as Record<string, unknown>
  return typeof name === 'string' && typeof description === 'string' && typeof prompt === 'string'
}

async function registerType($: Dollar, text: string): Promise<string> {
  const spec = jsonOrText(text)
  if (!isSpec(spec)) return 'Give the type as JSON with at least name, description and prompt, as {"name": "summarizer", "description": "...", "prompt": "...", "model": "haiku"}.'
  try {
    const { agent } = await $.agent.register(spec)
    const type = { agent, description: spec.description, model: spec.model ?? null, tools: [...(spec.tools ?? [])], at: Date.now() }
    await serial(() => update($, agents, kept => ({ ...kept, types: [...kept.types.filter(one => one.agent !== agent), type] })))
    return `Registered ${agent}. The model can dispatch it from its next turn; /mod-lab agent spawn ${agent} <prompt> starts one now.`
  } catch (error) {
    return `Not registered: ${error instanceof Error ? error.message : String(error)}`
  }
}

async function spawnAgent($: Dollar, text: string): Promise<string> {
  const { head: type, rest: prompt } = splitCommand(text)
  if (type === '' || prompt === '') return 'Use /mod-lab agent spawn <type> <prompt>, as /mod-lab agent spawn general-purpose List the files in docs.'
  const spawned = await $.agent.spawn({ subagentType: type, prompt, description: 'spawned from the lab' })
  if (spawned.deny !== undefined) return `Not spawned: ${spawned.deny}`
  if (spawned.agentId === undefined) return 'A hook answered the spawn without starting an agent.'
  const run: LabAgentRun = { agentId: spawned.agentId, type, by: 'mod-lab', description: 'spawned from the lab', prompt: cut(prompt, PROMPT_CHARS), model: spawned.model, isRouted: false, at: Date.now(), status: 'running', answer: null, durationMs: null }
  await serial(() => update($, agents, kept => withRun(kept, run)))
  return `Spawned ${spawned.agentId} as ${type} on ${spawned.model}. It runs in the background; its answer arrives with its turn.complete, and /mod-lab agent shows it.`
}

async function setHidden($: Dollar, agent: string, isHidden: boolean): Promise<string> {
  if (agent === '') return `Use /mod-lab agent ${isHidden ? 'hide' : 'show'} <type>, as /mod-lab agent hide Plan.`
  await serial(() => update($, agents, kept => ({ ...kept, hidden: isHidden ? [...new Set([...kept.hidden, agent])] : kept.hidden.filter(one => one !== agent) })))
  return isHidden
    ? `${agent} is hidden from the model from its next turn: the Agent tool neither lists nor dispatches it. A plugin's own $.agent.spawn still starts one.`
    : `${agent} is offered to the model again from its next turn.`
}

async function setRoute($: Dollar, model: string): Promise<string> {
  const route = model === '' || model === 'off' ? null : model
  await serial(() => update($, agents, kept => ({ ...kept, route })))
  return route === null ? 'Spawns run on the model they ask for.' : `Every new spawn is sent to ${route}, whatever it asked for; resumes and forks keep theirs.`
}

/** /mod-lab agent and what follows it. */
export async function agentCommand($: Dollar, text: string): Promise<string> {
  const { head, rest } = splitCommand(text)
  switch (head) {
    case '':
    case 'list':
      return formatAgents(await serial(() => read($, agents)), (await $.agent.list()).length)
    case 'register':
      return registerType($, rest)
    case 'spawn':
      return spawnAgent($, rest)
    case 'hide':
      return setHidden($, rest, true)
    case 'show':
      return setHidden($, rest, false)
    case 'route':
      return setRoute($, rest)
    case 'transcript':
      return formatAgentTranscript(await readAgentTranscript($, rest))
    case 'transcript-json':
      return JSON.stringify(await readAgentTranscript($, rest))
    default:
      return `No /mod-lab agent ${head}: the words are list, register {json}, spawn <type> <prompt>, hide <type>, show <type>, route <model>|off, transcript <agentId>.`
  }
}

export const registerAgents: Register = on => {
  // A hidden type is left out of the model's listing and refused at dispatch; plugins still spawn it.
  on('agent.offer', async ($, e, next) => ((await read($, agents)).hidden.includes(e.agent) ? { isOffered: false } : next(e)))

  // Every spawn the lab's hook sees, the model's Agent tool's among them, sent to the route's model if one is set.
  on('agent.spawn', async ($, e, next) => {
    const { route } = await read($, agents)
    const isRouted = route !== null && e.model !== route && e.resume === undefined && !e.fork
    const result = await next(isRouted && route !== null ? { ...e, model: route } : e)
    if (result.agentId !== undefined) {
      const run: LabAgentRun = { agentId: result.agentId, type: e.subagentType, by: e.provider?.plugin ?? 'engine', description: e.description, prompt: cut(e.prompt, PROMPT_CHARS), model: result.model, isRouted, at: Date.now(), status: 'running', answer: null, durationMs: null }
      save($, kept => withRun(kept, run))
    }
    return result
  }).catch(($, e, next) => next(e))
}
