// Runs and the trace: each probe run as the lab keeps it, and each session
// event the tracing hooks record, in $.state; /mod-lab eject and /mod-lab trace.

import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { LabRun, LabRunSource, LabStream, LabTraceRow } from '../types'
import { formatEject } from './eject'
import type { Chain } from './inspect'
import { execute, serial } from './runner'
import { traceRow } from './trace'

type Dollar = EngineInterface

const MAX_RUNS = 100

const MAX_TRACES = 300

const runs = atom({ plugin: 'mod-lab', key: 'runs' } as const, [])

const traces = atom({ plugin: 'mod-lab', key: 'traces' } as const, [])

const isTracing = atom({ plugin: 'mod-lab', key: 'isTracing' } as const, true)

// Module variables start over on a reload; session.start sets them again.
let tracing = true

let pending: Omit<LabTraceRow, 'seq'>[] = []

// A plugin's own hooks see the calls it makes only from inside one of its
// hooks while that hook runs: not from a press handler, nor from a timer
// that fires after the hook that set it returned. So every probe runs from a
// hook: /mod-lab's command.run, the tool's tool.call, the pane's ui.press and
// ui.input, and lab.run for other plugins such as the explorer bridge.
export async function runAndRecord(
  $: Dollar,
  id: string,
  given: Readonly<Record<string, unknown>>,
  from: LabRunSource,
): Promise<LabRun> {
  return serial(async () => {
    const outcome = await execute($, id, given)
    let run: LabRun = { ...outcome, seq: 0, from, at: Date.now() }
    await update($, runs, list => {
      run = { ...run, seq: (list.at(-1)?.seq ?? 0) + 1 }
      return [...list, run].slice(-MAX_RUNS)
    })
    return run
  })
}

/**
 * Called from the tracing hooks; the write waits behind any run in progress.
 * `started` gives a row its wall time, for a step whose chain time is not.
 */
export function noteTrace($: Dollar, next: Chain, input: unknown, result: unknown, started?: number, stream?: LabStream): void {
  if (!tracing) return
  const at = Date.now()
  const row = traceRow(next, input, result, at, stream)
  pending.push(started === undefined ? row : { ...row, ms: at - started })
  void serial(() => flushTraces($))
}

async function flushTraces($: Dollar): Promise<void> {
  if (pending.length === 0) return
  const fresh = pending
  pending = []
  await update($, traces, list => {
    const start = list.at(-1)?.seq ?? 0
    const rows = fresh.map((row, index) => ({ ...row, seq: start + index + 1 }))
    return [...list, ...rows].slice(-MAX_TRACES)
  })
}

/** /mod-lab eject [run]: the run's calls as bottom hooks for a test, copied to the clipboard where there is one. */
export async function ejectCommand($: Dollar, which: string): Promise<string> {
  const all = await serial(() => read($, runs))
  const seq = Number(which.replace(/^#/, ''))
  const run = which === '' ? all.at(-1) : all.find(one => one.seq === seq)
  if (run === undefined) return which === '' ? 'No run yet: run a probe first.' : `No run #${which} is kept; the pane's Runs view (h) lists them.`
  const text = formatEject(run)
  const copied = await $.ui.copy({ text })
  return copied.isCopied ? `${text}\n\n(Copied to the clipboard.)` : text
}

export async function setTracing($: Dollar, on: boolean | 'toggle'): Promise<boolean> {
  tracing = await serial(() => update($, isTracing, now => (on === 'toggle' ? !now : on)))
  return tracing
}

/** At session.start: tracing as the stored setting says. */
export async function startTracing($: Dollar): Promise<void> {
  tracing = await read($, isTracing)
}

/** For the pane's drawing, which reads them to redraw as they change. */
export async function readRecords($: Dollar): Promise<{ runs: LabRun[]; traces: LabTraceRow[]; isTracing: boolean }> {
  return { runs: await read($, runs), traces: await read($, traces), isTracing: await read($, isTracing) }
}
