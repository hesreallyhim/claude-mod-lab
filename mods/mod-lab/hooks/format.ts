import type { LabDispatch, LabIntercept, LabLink, LabProbe, LabRun, LabTap } from '../types'
import { censusLines, censusOf } from './census'
import { NEEDS_NEWER } from './compat'
import { describeIntercept, isLapsed } from './intercept'
import { UNINSPECTED } from './inspect'
import { compact, pretty } from './json'
import { availableProbes } from './probes'

/** Events whose hooks do not run in plugins the person installed, where an organization manages Claude Code. */
const MANAGED = new Set(['session.compact', 'prompt.context', 'prompt.attachment', 'settings.read'])

/** What to say when a run recorded no dispatch. */
export function quietNote(probe: LabProbe | undefined): string {
  const managed = (probe?.calls ?? []).filter(call => MANAGED.has(call))
  if (managed.length > 0) return `none recorded: where an organization manages Claude Code, the lab's hooks on ${managed.join(', ')} do not run in a plugin the person installed`
  const skipped = (probe?.calls ?? []).filter(call => UNINSPECTED[call] !== undefined)
  if (skipped.length === 0) return 'none: the probe made no call on $ that dispatches'
  return `none recorded: the lab does not inspect ${skipped.map(call => `${call}, as ${UNINSPECTED[call]}`).join('; ')}`
}

export function callLine(dispatch: LabDispatch): string {
  return `${dispatch.event}(${compact(dispatch.received, 80)})`
}

function linkText(link: LabLink): string {
  const received = link.received === undefined ? '' : ` received ${compact(link.received, 60)}`
  const chunks = link.chunks === undefined ? '' : `, ${link.chunks} chunks`
  return `${link.plugin} (${link.tier}) ${link.outcome} ${link.ms}ms${chunks}${received}`
}

/** The chain beneath the lab, led by the lab's intercept when one acted on the call. */
export function chainLine(dispatch: { chain: readonly LabLink[]; intercepted?: string }): string {
  const links = dispatch.chain.map(linkText).join(' > ')
  if (dispatch.intercepted === undefined) return links
  const lead = `mod-lab intercept (${dispatch.intercepted})`
  if (links !== '') return `${lead} > ${links}`
  return dispatch.intercepted === 'refuse' || dispatch.intercepted === 'answer' ? `${lead}, answered without next` : lead
}

const PLAIN_OUTCOMES = new Set(['returned', 'passed'])

/** A chain in a few words, for a row: each plugin, with its outcome when that is not the usual one. */
export function chainBrief(links: readonly LabLink[]): string {
  return links.map(link => (PLAIN_OUTCOMES.has(link.outcome) ? link.plugin : `${link.plugin} ${link.outcome}`)).join(' > ')
}

/** A run's outcome in a word: a feature the capability table kept from running is "not run", not "failed". */
export function runStatus(run: LabRun): 'ok' | 'not run' | 'failed' {
  if (run.ok) return 'ok'
  return run.error?.startsWith(NEEDS_NEWER) === true ? 'not run' : 'failed'
}

/** A run as the transcript and the model read it. */
export function formatRun(run: LabRun, probe: LabProbe | undefined): string {
  const status = runStatus(run)
  if (status === 'not run') return [`${run.probe}: not run, ${run.error}`, ...(probe === undefined ? [] : ['', 'source:', probe.source])].join('\n')
  const lines = [`${run.probe}: ${status} in ${run.ms} ms`]
  lines.push(run.ok ? pretty(run.value) : `error: ${run.error}`)
  if (run.dispatches.length === 0) {
    lines.push('', `dispatches: ${quietNote(probe)}`)
  } else {
    lines.push('', `dispatches (${run.dispatches.length}):`)
    for (const dispatch of run.dispatches) {
      lines.push(`  ${callLine(dispatch)} -> ${compact(dispatch.returned, 100)}`)
      lines.push(`    chain: ${chainLine(dispatch)}`)
    }
  }
  if (probe !== undefined) lines.push('', 'source:', probe.source)
  return lines.join('\n')
}

export function clock(at: number): string {
  return new Date(at).toTimeString().slice(0, 8)
}

/** A call an intercept acted on, in a line; what it received and returned clipped to `chars` each. */
export function tapLine(tap: LabTap, chars = 60): string {
  return `${clock(tap.at)} ${tap.origin} ${tap.event}(${compact(tap.received, chars)}) -> ${compact(tap.returned, chars)}`
}

/** The intercepts and the newest `count` calls they acted on, newest last, as the transcript and the model read them. */
export function formatIntercepts(list: readonly LabIntercept[], taps: readonly LabTap[], now: number, { count = 10, chars = 60 } = {}): string {
  if (list.length === 0) return 'No intercepts. /mod-lab intercept <event> <behavior> sets one; /mod-lab help shows how.'
  const lines = ['Intercepts:']
  for (const one of list) {
    const seen = taps.filter(tap => tap.event === one.event && tap.at >= one.since).length
    const state = isLapsed(one, now) ? 'lapsed' : one.until === null ? 'in force' : `until ${clock(one.until)}`
    lines.push(`  ${describeIntercept(one)}: ${state}, ${seen} seen`)
  }
  const recent = taps.slice(-count)
  if (recent.length > 0) {
    lines.push('', 'Latest calls they acted on:')
    for (const tap of recent) lines.push(`  ${tapLine(tap, chars)}`, `    chain: ${chainLine({ chain: tap.chain, intercepted: tap.behavior })}`)
  }
  return lines.join('\n')
}

/** What the recorded calls add up to, per event, for the transcript and the model. */
export function formatCensus(taps: readonly LabTap[], event: string): string {
  const list = censusOf(event === '' ? taps : taps.filter(tap => tap.event === event))
  if (list.length === 0) {
    return "No calls recorded yet. /mod-lab intercept <event> watch others records every other plugin's calls on an event."
  }
  const lead = `The newest ${taps.length} calls intercepts recorded, by event. Links are those beneath the lab, in the order they ran.`
  return [lead, '', ...list.flatMap(census => [...censusLines(census), ''])].join('\n').trimEnd()
}

export function formatList(): string {
  const probes = availableProbes()
  const groups = new Map<string, string[]>()
  for (const probe of probes) {
    const label = probe.id.slice(probe.noun.length + 1) + (probe.effect === 'read' ? '' : ` (${probe.effect})`)
    groups.set(probe.noun, [...(groups.get(probe.noun) ?? []), label])
  }
  // One line per noun, without column padding: the desktop app draws the transcript in a proportional face.
  const lines = [...groups].map(([noun, labels]) => `${noun}: ${labels.join(', ')}`)
  return [
    `${probes.length} probes, a line per noun. Run one with /mod-lab <noun.method> [value | {json}], for example /mod-lab fs.read README.md.`,
    'A probe marked (ui), (write), (spend), (tool), (dialog) or (network) does more than read: it draws, changes something, costs tokens, calls a tool, asks, or reaches the network.',
    '',
    ...lines,
  ].join('\n')
}
