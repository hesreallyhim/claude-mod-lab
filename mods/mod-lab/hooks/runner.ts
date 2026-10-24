import type { EngineInterface } from 'claude-code'

import type { LabRun } from '../types'
import { resolveArgs } from './args'
import { isAvailable, NEEDS_NEWER } from './compat'
import { startCapture, stopCapture } from './inspect'
import { summarize } from './json'
import { findProbe, runProbe } from './probes'

type Dollar = EngineInterface

export type Outcome = Omit<LabRun, 'seq' | 'from' | 'at'>

let queue: Promise<unknown> = Promise.resolve()

/**
 * Runs `task` once every task queued before it has settled. Probe runs and
 * the lab's own state writes go through here, so the dispatches captured
 * during a run are that run's alone.
 */
export function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task)
  queue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

export async function execute($: Dollar, id: string, given: Readonly<Record<string, unknown>>): Promise<Outcome> {
  const probe = findProbe(id)
  if (probe === undefined) return refused(id, `no probe is named ${id}; /mod-lab list shows them`)
  // The capability table first; a call this build lacks still fails inside the try below.
  if (!isAvailable(id)) return refused(id, NEEDS_NEWER)
  const resolved = resolveArgs(given, probe.params)
  if (!resolved.ok) return refused(id, resolved.error)
  const args = { ...resolved.value }
  const started = Date.now()
  startCapture()
  try {
    const value = await runProbe($, id, resolved.value)
    const ms = Date.now() - started
    return { probe: id, args, ok: true, value: summarize(value), error: null, ms, dispatches: stopCapture() }
  } catch (error) {
    const ms = Date.now() - started
    return { probe: id, args, ok: false, value: null, error: messageOf(error), ms, dispatches: stopCapture() }
  }
}

function refused(id: string, error: string): Outcome {
  return { probe: id, args: {}, ok: false, value: null, error, ms: 0, dispatches: [] }
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}
