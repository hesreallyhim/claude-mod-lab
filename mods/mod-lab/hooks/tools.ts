// The lab's tools for the model, which the engine names mcp__mod-lab__<name>.
// probe runs a call on $; runs, trace and intercepts read what the lab has
// recorded in this session, and lesson the workspace's lesson state, which
// the explorer and the checker write; those four run nothing. The lab's own
// tool.call hooks answer them, so no call on them reaches the permission check.

import type { EngineInterface, Register } from 'claude-code'

import type { LabRun, LabTraceRow } from '../types'
import { callLine, chainLine, clock, formatIntercepts, formatRun, quietNote, runStatus } from './format'
import { readInterception } from './interception'
import { clip, compact } from './json'
import { availableProbes, findProbe } from './probes'
import { readRecords, runAndRecord } from './runs'

type Dollar = EngineInterface

type Tool = Parameters<Dollar['tool']['register']>[0]

type Fields = Readonly<Record<string, unknown>>

/** The longest answer a reading tool gives, in characters: some two thousand tokens. */
const MAX_CHARS = 8000

/** How many of a run's dispatches its brief lists. */
const MAX_DISPATCHES = 6

/** How many records each reading tool answers unless asked, and at most. */
const RUNS = { last: 5, max: 20 }
const TRACE = { last: 20, max: 100 }
const TAPS = { last: 10, max: 20 }

/** The workspace's lesson state, from the session's folder (web/lib/progress.mjs writes it). */
const PROGRESS = '.claude-mod-lab/progress.json'

type LessonCheck = { passed: number; total: number; at: number; report: string }

function lastField(what: string, counts: { last: number; max: number }) {
  return { type: 'integer', description: `How many of the newest ${what}: ${counts.last} unless given, at most ${counts.max}` }
}

const TOOLS: readonly Tool[] = [
  {
    name: 'probe',
    description:
      'Runs one mod-lab probe: a call on the Claude Code mod API ($) made from inside this session. ' +
      'Answers with the value, every event the call dispatched with the chain of hooks that answered, ' +
      "and the probe's source. Probe ids are noun.method, as in session.cwd or fs.read.",
    inputSchema: {
      type: 'object',
      properties: {
        probe: { type: 'string', enum: availableProbes().map(probe => probe.id) },
        args: { type: 'object', description: "Named arguments; each probe's defaults fill the rest." },
      },
      required: ['probe'],
    },
    isDeferred: false,
  },
  {
    name: 'runs',
    description:
      "Reads mod-lab's record of the probes run in this session (from /mod-lab, its pane, the explorer or the probe tool), newest last: " +
      'each with its arguments, outcome and value, and the events it dispatched with the chain of hooks that answered each. Runs nothing.',
    inputSchema: {
      type: 'object',
      properties: {
        last: lastField('runs', RUNS),
        probe: { type: 'string', description: 'Only the runs of this probe, as fs.read' },
        seq: { type: 'integer', description: "One run in full, by its number, with the probe's source" },
      },
    },
    isDeferred: true,
  },
  {
    name: 'trace',
    description:
      "Reads mod-lab's trace of this session's events, newest last: prompts, turns and each model request in them, tool calls and commands, " +
      'each with a summary, its time and the chain of hooks that answered it. Runs nothing.',
    inputSchema: {
      type: 'object',
      properties: {
        last: lastField('events', TRACE),
        event: { type: 'string', description: 'Only this event, as tool.call or prompt.submit' },
      },
    },
    isDeferred: true,
  },
  {
    name: 'intercepts',
    description:
      'Reads the intercepts mod-lab has put on op events (with /mod-lab intercept or from the explorer) and the calls they acted on, newest last: ' +
      'the plugin that made each call, what it received and returned, and the chain of hooks beneath the lab. Runs nothing.',
    inputSchema: {
      type: 'object',
      properties: {
        event: { type: 'string', description: 'Only the intercept on this event, as fs.read' },
        last: lastField('calls', TAPS),
      },
    },
    isDeferred: true,
  },
  {
    name: 'lesson',
    description:
      "Reads the lab's lesson state in this session's folder: the lesson the person is on, the one whose page they last opened in the explorer or checked, " +
      "and the report of the last check of their mod against the lesson's steps, which the explorer runs each time they save it. Runs nothing.",
    inputSchema: { type: 'object', properties: {} },
    isDeferred: true,
  },
]

/** At session.start: every tool, in the order of TOOLS. */
export async function registerTools($: Dollar): Promise<void> {
  for (const tool of TOOLS) await $.tool.register(tool)
}

function countOf(given: unknown, counts: { last: number; max: number }): number {
  const asked = Math.round(Number(given))
  return Number.isFinite(asked) && asked >= 1 ? Math.min(asked, counts.max) : counts.last
}

function textOf(given: unknown): string {
  return typeof given === 'string' ? given.trim() : ''
}

/** The newest of `blocks` whose text together fits in MAX_CHARS, oldest first, and how many older ones did not fit. */
function newestThatFit(blocks: readonly string[]): { kept: string[]; left: number } {
  const kept: string[] = []
  let length = 0
  for (const block of [...blocks].reverse()) {
    length += block.length + 2
    if (length > MAX_CHARS && kept.length > 0) break
    kept.unshift(clip(block, MAX_CHARS))
  }
  return { kept, left: blocks.length - kept.length }
}

function shownLine(kept: number, left: number): string {
  return `The newest ${kept}, newest last${left > 0 ? ` (${left} older ones asked for did not fit)` : ''}:`
}

/** A run in brief: what it ran, its outcome, and its first dispatches with their chains. */
function runBrief(run: LabRun): string {
  const status = runStatus(run)
  const args = Object.keys(run.args).length === 0 ? '' : ` ${compact(run.args, 120)}`
  const lines = [`#${run.seq} ${clock(run.at)} ${run.probe}${args}, from ${run.from}: ${status} in ${run.ms} ms`]
  lines.push(run.ok ? `  value: ${compact(run.value, 240)}` : `  error: ${clip(run.error ?? '', 240)}`)
  if (run.dispatches.length === 0) lines.push(`  dispatches: ${quietNote(findProbe(run.probe))}`)
  for (const dispatch of run.dispatches.slice(0, MAX_DISPATCHES)) {
    lines.push(`  ${callLine(dispatch)} -> ${compact(dispatch.returned, 100)}`, `    chain: ${clip(chainLine(dispatch), 240)}`)
  }
  const more = run.dispatches.length - MAX_DISPATCHES
  if (more > 0) lines.push(`  and ${more} more dispatches, which {"seq": ${run.seq}} lists`)
  return lines.join('\n')
}

function traceBrief(row: LabTraceRow): string {
  const chain = chainLine(row)
  return `#${row.seq} ${clock(row.at)} ${row.event} ${row.ms} ms: ${row.summary}\n  chain: ${chain === '' ? 'none recorded beneath the lab' : clip(chain, 400)}`
}

async function probeAnswer($: Dollar, input: Fields): Promise<string> {
  const given = input.args !== null && typeof input.args === 'object' ? (input.args as Fields) : {}
  const run = await runAndRecord($, String(input.probe), given, 'tool')
  return formatRun(run, findProbe(run.probe))
}

async function runsAnswer($: Dollar, input: Fields): Promise<string> {
  const { runs } = await readRecords($)
  if (runs.length === 0) return 'No probe has run yet: /mod-lab <probe>, the pane, the explorer and the probe tool each run one.'
  if (input.seq !== undefined) {
    const run = runs.find(one => one.seq === Number(input.seq))
    if (run === undefined) return `No run #${String(input.seq)} is kept; those kept are #${runs[0]?.seq} to #${runs.at(-1)?.seq}.`
    return clip(formatRun(run, findProbe(run.probe)), MAX_CHARS)
  }
  const probe = textOf(input.probe)
  const chosen = probe === '' ? runs : runs.filter(run => run.probe === probe)
  if (chosen.length === 0) return `No run of ${probe} is kept.`
  const { kept, left } = newestThatFit(chosen.slice(-countOf(input.last, RUNS)).map(runBrief))
  const lead = `Runs kept${probe === '' ? '' : ` of ${probe}`}: ${chosen.length}; {"seq": n} answers one in full. ${shownLine(kept.length, left)}`
  return [lead, ...kept].join('\n\n')
}

async function traceAnswer($: Dollar, input: Fields): Promise<string> {
  const { traces, isTracing } = await readRecords($)
  const paused = isTracing ? '' : 'Tracing is paused; /mod-lab trace on resumes it. '
  const event = textOf(input.event)
  const chosen = event === '' ? traces : traces.filter(row => row.event === event)
  if (chosen.length === 0) return `${paused}No ${event === '' ? 'session event' : `${event} event`} is in the trace.`
  const { kept, left } = newestThatFit(chosen.slice(-countOf(input.last, TRACE)).map(traceBrief))
  const lead = `${paused}Session events kept${event === '' ? '' : ` on ${event}`}: ${chosen.length}. ${shownLine(kept.length, left)}`
  return [lead, ...kept].join('\n')
}

async function interceptsAnswer($: Dollar, input: Fields): Promise<string> {
  const { intercepts, taps } = await readInterception($)
  const event = textOf(input.event)
  const list = event === '' ? intercepts : intercepts.filter(one => one.event === event)
  const seen = event === '' ? taps : taps.filter(tap => tap.event === event)
  const now = Date.now()
  // As many of the newest calls asked for as fit.
  for (let count = countOf(input.last, TAPS); ; count -= 1) {
    const text = formatIntercepts(list, seen, now, { count, chars: 160 })
    if (text.length <= MAX_CHARS || count <= 1) return clip(text, MAX_CHARS)
  }
}

const isCheck = (value: unknown): value is LessonCheck => {
  const check = value as Partial<LessonCheck> | null
  return typeof check?.passed === 'number' && typeof check.total === 'number' && typeof check.at === 'number' && typeof check.report === 'string'
}

/** The state file's current lesson and its checks, those shaped as the lab writes them; null for text that is not JSON. */
function readLessons(text: string): { current: string | null; checks: Record<string, LessonCheck> } | null {
  let parsed: { current?: unknown; lessons?: unknown }
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  const lessons = parsed?.lessons !== null && typeof parsed?.lessons === 'object' ? (parsed.lessons as Record<string, unknown>) : {}
  const checks: Record<string, LessonCheck> = {}
  for (const [id, check] of Object.entries(lessons)) if (isCheck(check)) checks[id] = check
  return { current: typeof parsed?.current === 'string' ? parsed.current : null, checks }
}

async function lessonAnswer($: Dollar): Promise<string> {
  let text: string
  try {
    text = await $.fs.read(PROGRESS)
  } catch {
    return `No lesson has been opened or checked in this session's folder: it has no ${PROGRESS}. A lesson's page in the explorer starts one.`
  }
  const state = readLessons(text)
  if (state === null) return `${PROGRESS} in this session's folder is not JSON, so it says nothing of the lessons.`
  const { current, checks } = state
  const others = Object.entries(checks)
    .filter(([id]) => id !== current)
    .map(([id, check]) => `${id} ${check.passed}/${check.total}`)
  const lines = [current === null ? 'No lesson is current.' : `The current lesson: ${current}.`]
  const check = current === null ? undefined : checks[current]
  if (current !== null && check === undefined) lines.push('It has not been checked yet.')
  if (check !== undefined) {
    lines.push(
      `Last checked at ${new Date(check.at).toISOString()}: ${check.passed} of ${check.total} checked steps pass. The checker's report:`,
      '',
      clip(check.report, MAX_CHARS),
    )
  }
  if (others.length > 0) lines.push('', `The other lessons checked here, checked steps passing of all: ${others.join(', ')}.`)
  return lines.join('\n')
}

/** register.tsx registers these after the trace's hook on tool.call, so the trace keeps the model's calls on the tools. */
export const registerToolCalls: Register = on => {
  on('tool.call', { tool: 'mcp__mod-lab__probe' }, async ($, e) => ({ result: await probeAnswer($, e as Fields) })).catch(() => ({
    deny: 'mod-lab could not run the probe; the debug log has the reason',
  }))
  on('tool.call', { tool: 'mcp__mod-lab__runs' }, async ($, e) => ({ result: await runsAnswer($, e as Fields) })).catch(() => ({
    deny: 'mod-lab could not read its runs; the debug log has the reason',
  }))
  on('tool.call', { tool: 'mcp__mod-lab__trace' }, async ($, e) => ({ result: await traceAnswer($, e as Fields) })).catch(() => ({
    deny: 'mod-lab could not read its trace; the debug log has the reason',
  }))
  on('tool.call', { tool: 'mcp__mod-lab__intercepts' }, async ($, e) => ({ result: await interceptsAnswer($, e as Fields) })).catch(() => ({
    deny: 'mod-lab could not read its intercepts; the debug log has the reason',
  }))
  on('tool.call', { tool: 'mcp__mod-lab__lesson' }, async $ => ({ result: await lessonAnswer($) })).catch(() => ({
    deny: 'mod-lab could not read the lesson state; the debug log has the reason',
  }))
}
