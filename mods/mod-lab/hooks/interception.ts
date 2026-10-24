// The intercepts in force, the pane's draft of one, and the calls they acted
// on, in $.state; the inspector hooks that keep those calls; /mod-lab intercept
// and /mod-lab free.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, HookStream } from 'claude-code'

import type { LabIntercept, LabInterceptDraft, LabTap } from '../types'
import { splitCommand } from './args'
import { formatCensus, formatIntercepts } from './format'
import type { Chain } from './inspect'
import { hasTaps, inspect, inspectStream, takeTaps } from './inspect'
import { DEFAULT_DRAFT, describeIntercept, INTERCEPTABLE, isLapsed, LAPSE_MS, makeIntercept, parseIntercept, setActive } from './intercept'
import { FREE_ANSWER, FREE_EVENTS, freeDraft, noteSpend, spendCall } from './spend'
import { serial } from './runner'

type Dollar = EngineInterface

const MAX_TAPS = 200

const intercepts = atom({ plugin: 'mod-lab', key: 'intercepts' } as const, [])

const interceptDraft = atom({ plugin: 'mod-lab', key: 'interceptDraft' } as const, DEFAULT_DRAFT)

const taps = atom({ plugin: 'mod-lab', key: 'taps' } as const, [])

/**
 * inspect, then keeps the calls its intercepts acted on. The write is not
 * awaited: it waits behind any run in progress, which may be waiting on this call.
 */
export async function inspected<R>($: Dollar, e: unknown, next: ((e: never) => Promise<R>) & Chain): Promise<R> {
  try {
    return await inspect($, e, next)
  } finally {
    if (hasTaps()) void serial(() => flushTaps($))
  }
}

/** inspected, for a model call: the meter keeps what the call cost and whether it reached the model. */
export async function metered<R>($: Dollar, e: unknown, next: ((e: never) => Promise<R>) & Chain): Promise<R> {
  const at = Date.now()
  let result: unknown = null
  try {
    result = await inspected($, e, next)
    return result as R
  } finally {
    noteSpend($, spendCall({ event: next.event, plugin: next.origin.plugin, e, trace: next.trace, result, at, ms: Date.now() - at }))
  }
}

async function flushTaps($: Dollar): Promise<void> {
  const fresh = takeTaps()
  if (fresh.length === 0) return
  await update($, taps, list => {
    const start = list.at(-1)?.seq ?? 0
    return [...list, ...fresh.map((tap, index) => ({ ...tap, seq: start + index + 1 }))].slice(-MAX_TAPS)
  })
}

/** Sets an intercept in state and in force, replacing any on the same event and dropping lapsed ones. */
async function setIntercept($: Dollar, made: LabIntercept): Promise<void> {
  const now = Date.now()
  const list = await serial(() =>
    update($, intercepts, all => [...all.filter(one => one.event !== made.event && !isLapsed(one, now)), made]),
  )
  setActive(list)
}

export async function clearIntercept($: Dollar, event: string | null): Promise<void> {
  const list = await serial(() => update($, intercepts, all => (event === null ? [] : all.filter(one => one.event !== event))))
  setActive(list)
}

export async function setDraftField($: Dollar, field: keyof LabInterceptDraft, value: string): Promise<void> {
  await serial(() => update($, interceptDraft, draft => ({ ...draft, [field]: value })))
}

/** Enter in one of the form's fields: what it holds, then Set. */
export async function submitDraftField($: Dollar, field: keyof LabInterceptDraft, value: string): Promise<void> {
  await setDraftField($, field, value)
  await applyDraft($)
}

/** The pane's Set: the form's intercept, if it reads; the form shows why when it does not. */
export async function applyDraft($: Dollar): Promise<void> {
  const made = makeIntercept(await serial(() => read($, interceptDraft)), Date.now())
  if (made.ok) await setIntercept($, made.value)
}

function lapseNote(made: LabIntercept): string {
  return made.until === null ? '' : ` It changes other plugins' calls, so it lapses in ${LAPSE_MS / 1000} s.`
}

/** /mod-lab intercept and what follows it. */
export async function interceptCommand($: Dollar, rest: string): Promise<string> {
  const { head, rest: more } = splitCommand(rest)
  if (head === '') return formatIntercepts(await serial(() => read($, intercepts)), await serial(() => read($, taps)), Date.now())
  if (head === 'events') return `The lab can intercept: ${INTERCEPTABLE.join(', ')}`
  if (head === 'census') return formatCensus(await serial(() => read($, taps)), more)
  if (head === 'clear') {
    await clearIntercept($, more === '' ? null : more)
    return more === '' ? 'Cleared every intercept.' : `Cleared the intercept on ${more}.`
  }
  const parsed = parseIntercept(rest)
  if (!parsed.ok) return parsed.error
  const made = makeIntercept(parsed.value, Date.now())
  if (!made.ok) return made.error
  await setIntercept($, made.value)
  return `Intercepting ${describeIntercept(made.value)}.${lapseNote(made.value)} /mod-lab intercept lists the calls it acts on.`
}

/** Whether free mode's intercepts are both in force. */
export async function isFree($: Dollar): Promise<boolean> {
  const list = await serial(() => read($, intercepts))
  const now = Date.now()
  return FREE_EVENTS.every(event =>
    list.some(one => one.event === event && one.behavior === 'answer' && !isLapsed(one, now) && (one.value as { text?: unknown } | null)?.text === FREE_ANSWER.text),
  )
}

/** /mod-lab free on|off: intercepts that answer the lab's own model calls, so nothing is sent. */
export async function freeCommand($: Dollar, rest: string): Promise<string> {
  if (rest === 'on') {
    for (const event of FREE_EVENTS) {
      const made = makeIntercept(freeDraft(event), Date.now())
      if (!made.ok) return made.error
      await setIntercept($, made.value)
    }
    return "Free mode is on: the lab answers its own model.complete and model.fork calls itself, and sends nothing. /mod-lab free off ends it."
  }
  if (rest === 'off') {
    if (await isFree($)) for (const event of FREE_EVENTS) await clearIntercept($, event)
    return 'Free mode is off: the lab\'s model calls are sent.'
  }
  return (await isFree($)) ? 'Free mode is on. /mod-lab free off ends it.' : 'Free mode is off. /mod-lab free on starts it.'
}

/** inspected, for a streaming event: the taps are kept once the stream has ended. */
export async function* inspectedStream<C, R>($: Dollar, e: unknown, next: ((e: never) => HookStream<C, R>) & Chain): AsyncGenerator<C, R> {
  try {
    return yield* inspectStream($, e, next)
  } finally {
    if (hasTaps()) void serial(() => flushTaps($))
  }
}

/** At session.start: the intercepts kept in $.state put in force. */
export async function startIntercepts($: Dollar): Promise<void> {
  setActive(await read($, intercepts))
}

/** For the pane's drawing, which reads them to redraw as they change. */
export async function readInterception($: Dollar): Promise<{ intercepts: LabIntercept[]; interceptDraft: LabInterceptDraft; taps: LabTap[] }> {
  return { intercepts: await read($, intercepts), interceptDraft: await read($, interceptDraft), taps: await read($, taps) }
}
