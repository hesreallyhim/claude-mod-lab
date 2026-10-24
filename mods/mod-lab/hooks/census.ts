import type { LabTap } from '../types'

/** One plugin's link in the chains of an event, over every call recorded. */
export type CensusLink = { plugin: string; tier: string; count: number; outcomes: Record<string, number>; medianMs: number }

/**
 * What the taps on one event add up to: how many calls, who made them, who
 * answered them (the last link of each chain), and each link beneath the lab.
 */
export type Census = {
  event: string
  calls: number
  callers: [string, number][]
  answeredBy: [string, number][]
  links: CensusLink[]
}

function tally(names: readonly string[]): [string, number][] {
  const counts = new Map<string, number>()
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1)
  return [...counts].sort(([, a], [, b]) => b - a)
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const value = sorted.length % 2 === 1 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
  return Math.round(value * 100) / 100
}

/** The census of each event the taps cover, in the order the events were first seen. */
export function censusOf(taps: readonly LabTap[]): Census[] {
  const events = [...new Set(taps.map(tap => tap.event))]
  return events.map(event => {
    const mine = taps.filter(tap => tap.event === event)
    const links = new Map<string, { plugin: string; tier: string; outcomes: string[]; ms: number[] }>()
    for (const tap of mine) {
      for (const link of tap.chain) {
        const key = `${link.plugin}\u0000${link.tier}`
        const seen = links.get(key) ?? { plugin: link.plugin, tier: link.tier, outcomes: [], ms: [] }
        seen.outcomes.push(link.outcome)
        seen.ms.push(link.ms)
        links.set(key, seen)
      }
    }
    return {
      event,
      calls: mine.length,
      callers: tally(mine.map(tap => tap.origin)),
      answeredBy: tally(mine.map(tap => tap.chain.at(-1)?.plugin ?? `mod-lab intercept (${tap.behavior})`)),
      links: [...links.values()].map(link => ({
        plugin: link.plugin,
        tier: link.tier,
        count: link.outcomes.length,
        outcomes: Object.fromEntries(tally(link.outcomes)),
        medianMs: median(link.ms),
      })),
    }
  })
}

function counted(pairs: readonly [string, number][]): string {
  return pairs.map(([name, n]) => `${name} ${n}`).join(', ')
}

function linkLine(link: CensusLink): string {
  const outcomes = Object.entries(link.outcomes)
    .map(([outcome, n]) => `${outcome} ${n}`)
    .join(', ')
  return `${link.plugin} (${link.tier}): ${outcomes}; median ${link.medianMs} ms`
}

/** One census as lines of text, for the transcript and the pane. */
export function censusLines(census: Census): string[] {
  return [
    `${census.event}: ${census.calls} call${census.calls === 1 ? '' : 's'}, made by ${counted(census.callers)}; answered by ${counted(census.answeredBy)}`,
    ...census.links.map(link => `  ${linkLine(link)}`),
  ]
}
