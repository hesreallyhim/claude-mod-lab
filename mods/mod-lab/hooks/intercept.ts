import type { EngineInterface } from 'claude-code'

import type { LabIntercept, LabInterceptBehavior, LabInterceptDraft, LabInterceptScope, LabJson } from '../types'
import type { Parsed } from './args'
import { jsonOrText } from './args'
import { summarize } from './json'

type Dollar = EngineInterface

/** The op events the lab hooks with `inspect` (`inspectStream` for process.spawn), in the order register.tsx registers them; each can be intercepted. */
export const INTERCEPTABLE: readonly string[] = [
  'session.cwd',
  'session.root',
  'session.id',
  'session.model',
  'session.turns',
  'session.version',
  'session.repo',
  'session.surfaces',
  'session.usage',
  'session.messages',
  'clock.now',
  'clock.sleep',
  'clock.after',
  'store.keys',
  'store.get',
  'store.set',
  'store.delete',
  'state.get',
  'state.set',
  'ui.toast',
  'ui.status',
  'ui.log',
  'ui.notify',
  'ui.panes',
  'ui.copy',
  'ui.selection',
  'prompt.read',
  'prompt.fill',
  'prompt.suggest',
  'tool.list',
  'tool.check',
  'command.list',
  'config.list',
  'agent.list',
  'fs.list',
  'fs.exists',
  'fs.stat',
  'fs.read',
  'fs.ancestors',
  'fs.write',
  'env.get',
  'settings.read',
  'process.run',
  'process.spawn',
  'http.fetch',
  'model.complete',
  'model.classify',
  'model.fork',
  'audio.speak',
]

export const BEHAVIORS: readonly LabInterceptBehavior[] = ['watch', 'refuse', 'answer', 'rewrite', 'delay']
/** The events that stream; inspectStream acts on them with these behaviors alone. */
const STREAMING: Readonly<Record<string, readonly LabInterceptBehavior[]>> = { 'process.spawn': ['watch', 'refuse'] }
export const SCOPES: readonly LabInterceptScope[] = ['lab', 'others', 'all']

export const SCOPE_LABEL: Readonly<Record<LabInterceptScope, string>> = {
  lab: "the lab's calls",
  others: "other plugins' calls",
  all: "every plugin's calls",
}

/** An intercept that changes other plugins' calls lapses after this long, so a forgotten one cannot keep breaking them. */
export const LAPSE_MS = 60_000

/** A delay may outlast the hook's ten-second budget, to show what happens when it runs out. */
export const MAX_DELAY_MS = 15_000

export const DEFAULT_DRAFT: LabInterceptDraft = { event: 'fs.read', behavior: 'watch', scope: 'others', value: '', ms: '1000' }

// The intercepts in force, by event. inspect runs for every plugin's calls on
// the events above, so it reads them here rather than from $.state; register.tsx
// sets them from state at session.start and after every change.
let active = new Map<string, LabIntercept>()

export function setActive(list: readonly LabIntercept[]): void {
  active = new Map(list.map(one => [one.event, one]))
}

export function isLapsed(intercept: LabIntercept, now: number): boolean {
  return intercept.until !== null && now > intercept.until
}

/** The intercept that acts on a call to `event`, if any: in force, and covering the caller. */
export function interceptFor(event: string, isLab: boolean, now: number): LabIntercept | undefined {
  const found = active.get(event)
  if (found === undefined || isLapsed(found, now)) return undefined
  return found.scope === 'all' || (found.scope === 'lab') === isLab ? found : undefined
}

/** Reads an intercept from the form or a command, checking each field. */
export function makeIntercept(draft: LabInterceptDraft, now: number): Parsed<LabIntercept> {
  const { event, behavior, scope } = draft
  if (!INTERCEPTABLE.includes(event)) return { ok: false, error: `the lab does not hook ${event}; /mod-lab intercept events lists those it does` }
  if (!BEHAVIORS.includes(behavior)) return { ok: false, error: `behavior must be one of ${BEHAVIORS.join(', ')}` }
  const streamed = STREAMING[event]
  if (streamed !== undefined && !streamed.includes(behavior)) return { ok: false, error: `${event} streams: the lab can ${streamed.join(' or ')} it` }
  if (!SCOPES.includes(scope)) return { ok: false, error: `scope must be one of ${SCOPES.join(', ')}` }
  let value: LabJson = null
  if (behavior === 'answer') value = summarize(jsonOrText(draft.value))
  if (behavior === 'rewrite') {
    const fields = jsonOrText(draft.value)
    if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) {
      return { ok: false, error: 'rewrite takes a JSON object of the fields to change in e, as {"path": "README.md"}' }
    }
    value = summarize(fields)
  }
  const ms = Number(draft.ms)
  if (behavior === 'delay' && !(Number.isFinite(ms) && ms >= 0 && ms <= MAX_DELAY_MS)) {
    return { ok: false, error: `delay takes milliseconds from 0 to ${MAX_DELAY_MS}` }
  }
  const lapses = behavior !== 'watch' && scope !== 'lab'
  return {
    ok: true,
    value: { event, behavior, scope, value, ms: behavior === 'delay' ? ms : 0, since: now, until: lapses ? now + LAPSE_MS : null },
  }
}

// Set while an intercept sleeps for a delay, so inspect leaves that sleep out of the run it interrupts.
let delaying = 0

export function isDelaying(): boolean {
  return delaying > 0
}

/**
 * The lab's own hook body for an intercepted call: passes it on, refuses it,
 * answers it, passes on a rewritten `e`, or waits first. A function at the
 * top of the module, as anything handed `$` must be.
 */
export async function interpose<R>(
  $: Dollar,
  e: unknown,
  next: ((e: never) => Promise<R>) & { readonly signal?: AbortSignal },
  intercept: LabIntercept,
  origin: string,
): Promise<R> {
  switch (intercept.behavior) {
    case 'refuse':
      return { deny: `mod-lab intercepted ${origin}'s ${intercept.event} and refused it` } as R
    case 'answer':
      return { value: intercept.value } as R
    case 'rewrite': {
      const fields = intercept.value
      if (e === null || typeof e !== 'object' || fields === null || typeof fields !== 'object') return next(e as never)
      return next({ ...e, ...fields } as never)
    }
    case 'delay':
      delaying += 1
      try {
        await $.clock.sleep(intercept.ms)
      } finally {
        delaying -= 1
      }
      // Past the budget the dispatch is gone, and the lab's .catch has passed the call on.
      next.signal?.throwIfAborted()
      return next(e as never)
    case 'watch':
      return next(e as never)
  }
}

/**
 * Reads `/mod-lab intercept <event> <behavior> [lab|others|all] [value | ms]`.
 * Without a scope, watch covers every plugin's calls and the rest the lab's.
 */
export function parseIntercept(text: string): Parsed<LabInterceptDraft> {
  const parts = /^(\S+)\s+(\S+)\s*(.*)$/s.exec(text.trim())
  if (parts === null) {
    return { ok: false, error: 'Use /mod-lab intercept <event> <behavior> [lab|others|all] [value | ms], as in /mod-lab intercept fs.read refuse' }
  }
  const [, event = '', behavior = '', after = ''] = parts
  const first = after.split(/\s+/)[0]
  const named = SCOPES.find(scope => scope === first)
  const scope = named ?? (behavior === 'watch' ? 'all' : 'lab')
  const rest = named === undefined ? after : after.slice(named.length).trim()
  return { ok: true, value: { event, behavior: behavior as LabInterceptBehavior, scope, value: rest, ms: rest === '' ? '0' : rest } }
}

export function describeIntercept(intercept: LabIntercept): string {
  const detail =
    intercept.behavior === 'answer' || intercept.behavior === 'rewrite'
      ? ` ${JSON.stringify(intercept.value)}`
      : intercept.behavior === 'delay'
        ? ` ${intercept.ms} ms`
        : ''
  return `${intercept.event} ${intercept.behavior}${detail}, ${SCOPE_LABEL[intercept.scope]}`
}
