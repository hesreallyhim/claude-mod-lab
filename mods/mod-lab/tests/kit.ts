// Shared by the lab's tests; not a test file itself.

import type { CommandRunInput, On, SessionStartInput } from 'claude-code'
import type { Plugin } from 'claude-code/testing'

import type { LabIntercept as Intercept, LabRun as Run, LabTap as Tap, LabTraceRow as TraceRow } from '../types'

/** `/<command> <args>` as the person types it at the prompt. */
export function slash(command: string, args: string): CommandRunInput {
  return { command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } }
}

/** The name the kit gives a test's own hooks, as a chain lists them. */
export const TEST = 'test'

/** Another plugin, whose /read reads a file through $.fs.read and answers the text or the refusal. */
export const reader: Plugin = {
  name: 'reader',
  register(on) {
    on('command.run', { command: 'read' }, async ($, e) => {
      try {
        return { text: await $.fs.read(e.args) }
      } catch (error) {
        return { text: `refused: ${error instanceof Error ? error.message : String(error)}` }
      }
    })
  },
}

/** `/read <path>`, the reader plugin's command. */
export function read(path: string): CommandRunInput {
  return slash('read', path)
}

/** `/mod-lab <args>`. */
export function lab(args: string): CommandRunInput {
  return slash('mod-lab', args)
}

export type Recorded = { runs: Run[][]; traces: TraceRow[][]; taps: Tap[][]; intercepts: Intercept[][] }

/**
 * Records each list of runs, traces, taps and intercepts the lab stores, read through the
 * test's own state.set hook (the test's $ has no state noun).
 */
export function recordState(on: On): Recorded {
  const recorded: Recorded = { runs: [], traces: [], taps: [], intercepts: [] }
  // Typed loosely: the event's own type is a union over every declared state key.
  on('state.set', <R>($: unknown, e: unknown, next: (e: never) => Promise<R>) => {
    const { plugin, key, value } = e as { plugin: string; key: string; value: unknown }
    if (plugin === 'mod-lab' && key === 'runs') recorded.runs.push(value as Run[])
    if (plugin === 'mod-lab' && key === 'traces') recorded.traces.push(value as TraceRow[])
    if (plugin === 'mod-lab' && key === 'taps') recorded.taps.push(value as Tap[])
    if (plugin === 'mod-lab' && key === 'intercepts') recorded.intercepts.push(value as Intercept[])
    return next(e as never)
  })
  return recorded
}

export function lastRun(recorded: Recorded): Run | undefined {
  return recorded.runs.at(-1)?.at(-1)
}

/** compat.json's text as the lab reads its copy, with the given fields over an empty one. */
export function compatText(fields: { floor: string; testedThrough: string; plugins?: object; capabilities?: object }): string {
  return JSON.stringify({ plugins: {}, capabilities: {}, ...fields })
}

/** The build a test's session runs: its version, the lab's compat.json, and the registration to refuse, if any. Change it between starts. */
export type Build = { version: string; compat: string; refuse?: 'tool.register' }

/**
 * session.start as the engine raises it once the lab loads, its calls answered
 * from the bottom: the build's version, the lab's compat.json, and the command
 * and tool registered unless `refuse` names one. `logged` holds every line the
 * lab logs from then on.
 */
export function labStart($: unknown, on: On, build: Build): { logged: string[]; start: () => Promise<void> } {
  const logged: string[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.version', () => ({ value: { version: build.version, base: build.version, builtAt: '' } }) as never)
  on('fs.read', () => ({ value: build.compat }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('tool.register', ($, e) => (build.refuse === 'tool.register' ? { deny: 'refused-r1' } : { value: { tool: `mcp__mod-lab__${e.name}` } }))
  on('ui.log', ($, e) => {
    logged.push(e.text)
    return { value: undefined }
  })
  // The test's `$` raises session.start, though its type does not list it.
  const session = ($ as { session: { start: (e: SessionStartInput) => Promise<unknown> } }).session
  return { logged, start: async () => void (await session.start({ cwd: '/work/s1' } as SessionStartInput)) }
}
