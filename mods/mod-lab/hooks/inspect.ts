import type { EngineInterface, HookStream } from 'claude-code'

import type { LabDispatch, LabIntercept, LabJson, LabLink, LabTap } from '../types'
import { interceptFor, interpose, isDelaying } from './intercept'
import { summarize, summarizeResult, TRACE_LIMITS } from './json'

type Dollar = EngineInterface

/** The parts of `next` the inspector reads. */
export type Chain = {
  readonly event: string
  readonly origin: { readonly plugin: string }
  readonly signal?: AbortSignal
  readonly trace: readonly {
    readonly plugin: string
    readonly tier: string
    readonly outcome: string
    readonly ms: number
    readonly received?: unknown
    readonly chunks?: number
  }[]
}

let capture: LabDispatch[] | null = null

export function startCapture(): void {
  capture = []
}

export function stopCapture(): LabDispatch[] {
  const captured = [...(capture ?? [])]
  capture = null
  return captured
}

let taps: Omit<LabTap, 'seq'>[] = []

/** The calls intercepts acted on since the last take; register.tsx keeps them in state. */
export function takeTaps(): Omit<LabTap, 'seq'>[] {
  const taken = taps
  taps = []
  return taken
}

export function hasTaps(): boolean {
  return taps.length > 0
}

/**
 * Each link of a chain. A link whose input differs from `sent`, what the
 * caller's hook passed on, keeps it as `received`: a hook above it rewrote `e`.
 */
export function linksOf(trace: Chain['trace'], sent?: LabJson): LabLink[] {
  const base = sent === undefined ? undefined : JSON.stringify(sent)
  return trace.map(link => {
    const out: LabLink = { plugin: link.plugin, tier: link.tier, outcome: link.outcome, ms: Math.round(link.ms * 100) / 100 }
    if (link.chunks !== undefined) out.chunks = link.chunks
    if (base === undefined || link.received === undefined) return out
    const received = summarize(link.received, TRACE_LIMITS)
    return JSON.stringify(received) === base ? out : { ...out, received }
  })
}

/** A chain read once next has settled; a hook that answered without calling next has none. */
function settledLinks(next: Chain, sent: LabJson): LabLink[] {
  try {
    return linksOf(next.trace ?? [], sent)
  } catch {
    return []
  }
}

const ABANDONED = 'abandoned before this hook settled (its budget ran out, or the caller gave up); its .catch answered in its place'

/** The state probes use `counter`; the pane's own reads and writes of its other keys belong to no probe. */
function isBookkeeping(event: string, e: unknown): boolean {
  return event.startsWith('state.') && (e as { key?: unknown } | null)?.key !== 'counter'
}

/**
 * A hook for an op event. While a probe runs, it records each dispatch the
 * lab itself raised: the event, `e` as it arrived, what the chain beneath
 * answered, and each link of that chain, in the order the calls started.
 * Where an intercept covers the call, the intercept decides what happens to
 * it and the call is reported as a tap. Every other dispatch passes through.
 * `e` goes on to `next` unchanged, so its type, the event's own, is not needed.
 */
export async function inspect<R>($: Dollar, e: unknown, next: ((e: never) => Promise<R>) & Chain): Promise<R> {
  const origin = next.origin.plugin
  const isOurs = origin === $.plugin.name
  if (isOurs && isBookkeeping(next.event, e)) return next(e as never)
  // An intercept's own delay is the lab's doing, not the probe's.
  if (isOurs && next.event === 'clock.sleep' && isDelaying()) return next(e as never)
  const intercept = interceptFor(next.event, isOurs, Date.now())
  const record = capture !== null && isOurs ? capture : null
  if (record === null && intercept === undefined) return next(e as never)
  const started = Date.now()
  // Recorded as it starts, so a call still running when the probe returns shows as pending.
  const dispatch: LabDispatch = { event: next.event, received: summarize(e), returned: 'pending', chain: [] }
  if (intercept !== undefined) dispatch.intercepted = intercept.behavior
  record?.push(dispatch)
  // Said at once: an abandoned hook settles later, if at all, after its run is kept.
  const abandoned = () => {
    if (dispatch.returned === 'pending') dispatch.returned = { abandoned: ABANDONED }
  }
  next.signal?.addEventListener('abort', abandoned, { once: true })
  try {
    const result = intercept === undefined ? await next(e as never) : await interpose($, e, next, intercept, origin)
    if (dispatch.returned === 'pending') dispatch.returned = summarizeResult(result, next.event)
    return result
  } catch (error) {
    if (dispatch.returned === 'pending') dispatch.returned = { rejected: error instanceof Error ? error.message : String(error) }
    throw error
  } finally {
    next.signal?.removeEventListener('abort', abandoned)
    settle(next, e, dispatch, intercept, origin, started)
  }
}

/** Keeps a finished dispatch's chain, and the call as a tap when an intercept acted on it. */
function settle(next: Chain, e: unknown, dispatch: LabDispatch, intercept: LabIntercept | undefined, origin: string, started: number): void {
  const sent = summarize(e, TRACE_LIMITS)
  dispatch.chain = settledLinks(next, sent)
  if (intercept === undefined) return
  taps.push({
    at: started,
    event: next.event,
    origin,
    behavior: intercept.behavior,
    received: sent,
    returned: summarize(dispatch.returned, TRACE_LIMITS),
    chain: dispatch.chain,
    ms: Date.now() - started,
  })
}

/**
 * inspect, for a streaming event (process.spawn): the chunks pass on as they
 * come, and the record says how the stream ended and how many passed. Of the
 * intercepts, a watch keeps the call as a tap and a refusal answers
 * `{ deny }`, which rejects the caller's stream.
 */
export async function* inspectStream<C, R>($: Dollar, e: unknown, next: ((e: never) => HookStream<C, R>) & Chain): AsyncGenerator<C, R> {
  const origin = next.origin.plugin
  const isOurs = origin === $.plugin.name
  const intercept = interceptFor(next.event, isOurs, Date.now())
  const record = capture !== null && isOurs ? capture : null
  if (record === null && intercept === undefined) return yield* next(e as never)
  const started = Date.now()
  const dispatch: LabDispatch = { event: next.event, received: summarize(e), returned: 'pending', chain: [] }
  if (intercept !== undefined) dispatch.intercepted = intercept.behavior
  record?.push(dispatch)
  let chunks = 0
  try {
    if (intercept?.behavior === 'refuse') {
      const refused = { deny: `mod-lab intercepted ${origin}'s ${intercept.event} and refused it` }
      dispatch.returned = refused
      return refused as R
    }
    const stream = next(e as never)
    for await (const chunk of stream) {
      chunks += 1
      yield chunk
    }
    const result = await stream.result
    const kept = summarize(result)
    dispatch.returned = kept !== null && typeof kept === 'object' && !Array.isArray(kept) ? { ...kept, chunks } : { result: kept, chunks }
    return result
  } catch (error) {
    dispatch.returned = { rejected: error instanceof Error ? error.message : String(error), chunks }
    throw error
  } finally {
    // Still pending here, the caller left the loop: that ends the child.
    if (dispatch.returned === 'pending') dispatch.returned = { closed: 'the caller stopped reading', chunks }
    settle(next, e, dispatch, intercept, origin, started)
  }
}

/** The `.catch` of a hook that calls `next` first: replays what `next` settled to. */
export function replay<R>($: Dollar, e: unknown, next: (e: never) => Promise<R>): Promise<R> {
  return next(e as never)
}
