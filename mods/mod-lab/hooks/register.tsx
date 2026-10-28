// mod-lab: run calls on $ in a live session and see what each one
// dispatched and returned. What the mod does, how it is laid out and how to
// run it are in ../README.md.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { LabArgText, LabRun } from '../types'
import { noteAgentEnd, registerAgents } from './agents'
import { labCommand } from './commands'
import { initLessonsCommand } from './lessons'
import { ARGUMENT_HINT, drawHelpBox, HELP_INTRO } from './help'
import { registerExplorer } from './explorer'
import { noteRequest, registerCompactor } from './compactor'
import { registerConfig } from './config'
import { inspect, replay } from './inspect'
import { INTERCEPTABLE } from './intercept'
import {
  applyDraft,
  clearIntercept,
  inspected,
  inspectedStream,
  metered,
  readInterception,
  setDraftField,
  startIntercepts,
  submitDraftField,
} from './interception'
import { registerKeys } from './keys'
import type { TraceLink } from './ledger'
import { attachmentKey, noteAttachment, noteBlocks, noteContext, noteTool } from './ledger'
import type { PaneActions, PaneModel } from './pane'
import { drawCompact, drawPane } from './pane'
import { readPaneState, setHelp, setView } from './pane-state'
import { availableProbes, findProbe } from './probes'
import { registerRows } from './rows'
import { noteTrace, readRecords, runAndRecord, setTracing, startTracing } from './runs'
import { messageOf, serial } from './runner'
import { readSpend } from './spend'
import { streamOf } from './streams'
import { registerToolCalls, registerTools } from './tools'

type Dollar = EngineInterface

// What the pane shows: the probe chosen, the arguments typed for each probe, and the view.
const selected = atom({ plugin: 'mod-lab', key: 'probe' } as const, 'session.cwd')
const drafts = atom({ plugin: 'mod-lab', key: 'drafts' } as const, {})

async function pickProbe($: Dollar, id: string): Promise<void> {
  await serial(() => update($, selected, () => id))
}

async function setArg($: Dollar, probe: string, name: string, value: string): Promise<void> {
  await serial(() => update($, drafts, all => ({ ...all, [probe]: { ...(all[probe] ?? {}), [name]: value } })))
}

async function runSelected($: Dollar): Promise<LabRun> {
  const id = await serial(() => read($, selected))
  const all = await serial(() => read($, drafts))
  return runAndRecord($, id, draftFor(id, all[id]), 'pane')
}

/** One step of session.start, in its own try/catch: a failure is logged in the transcript and the next step runs. */
async function startStep($: Dollar, what: string, step: () => Promise<unknown>): Promise<void> {
  try {
    await step()
  } catch (error) {
    $.ui.log(`mod-lab: ${what} failed at session start, and the rest of the lab runs: ${messageOf(error)}`)
  }
}

/** Keeps only the arguments the probe still takes: a stored draft may predate a change to its params. */
function draftFor(id: string, draft: LabArgText | undefined): LabArgText {
  const params = findProbe(id)?.params ?? []
  return Object.fromEntries(Object.entries(draft ?? {}).filter(([name]) => params.some(param => param.name === name)))
}

export const register: Register = (on, options) => {
  registerAgents(on, options)
  registerRows(on, options)
  registerCompactor(on, options)
  registerKeys(on, options)
  registerConfig(on, options)
  registerExplorer(on, options)

  // $.lab, for other plugins. Its methods are reached only when no hook
  // answers; the lab answers lab.run and lab.command itself, so a run is
  // inspected and a command's state is written from a hook of the lab's, and
  // lab.root, since only its own hooks have its $.plugin.
  on('engine.create', async ($, e, next) => {
    const built = await next(e)
    return {
      ...built,
      lab: {
        run: async () => {
          throw new Error('lab.run is answered by the mod-lab hook, which did not run')
        },
        probes: async () => availableProbes(),
        command: async () => {
          throw new Error('lab.command is answered by the mod-lab hook, which did not run')
        },
        interceptable: async () => INTERCEPTABLE,
        root: async () => {
          throw new Error('lab.root is answered by the mod-lab hook, which did not run')
        },
      },
    }
  })

  on('lab.root', async $ => ({ value: $.plugin.root }))

  on('lab.command', async ($, e) => ({ value: await labCommand($, e.text, e.from ?? 'explorer') }))

  on('lab.run', async ($, e) => {
    const run = await runAndRecord($, e.probe, e.args ?? {}, e.from ?? 'explorer')
    return { value: run }
  })

  // Each step stands alone, so one that a build refuses leaves the others running.
  on('session.start', async ($, e, next) => {
    await startStep($, 'the /mod-lab command', () =>
      $.command.register({
        name: 'mod-lab',
        description: 'Run calls on $ and see what they dispatch: /mod-lab opens the pane, /mod-lab help lists the rest',
        argumentHint: ARGUMENT_HINT,
      }),
    )
    await startStep($, 'the /init-lessons command', () =>
      $.command.register({ name: 'init-lessons', description: 'Enable lessons in this project without leaving the session' }),
    )
    await startStep($, "the model's tools", () => registerTools($))
    await startStep($, 'tracing', () => startTracing($))
    await startStep($, 'the intercepts', () => startIntercepts($))
    noteTrace($, next, e, { cwd: e.cwd })
    return next(e)
  })

  on('command.run', { command: 'mod-lab' }, async ($, e) => ({ text: await labCommand($, e.args, 'command') }))
  on('command.run', { command: 'init-lessons' }, async ($, e) => ({ text: await initLessonsCommand($, e.args) }))

  // The pane's Run button and Enter in its argument fields.
  on('ui.press', { requestId: 'lab', element: 'run' }, async ($, e, next) => {
    await runSelected($)
    return next(e)
  })

  on('ui.input', { requestId: 'lab', kind: 'submit' }, async ($, e, next) => {
    if (!e.element.startsWith('arg:')) return next(e)
    await setArg($, await serial(() => read($, selected)), e.element.slice('arg:'.length), e.value)
    await runSelected($)
    return next(e)
  })

  // Session events, recorded for the trace. Each calls next first; should the
  // recording fail, its .catch replays what next settled to.
  on('tool.call', async ($, e, next) => {
    const result = await inspect($, e, next)
    noteTrace($, next, e, result)
    return result
  }).catch(replay)

  registerToolCalls(on, options)

  on('prompt.submit', async ($, e, next) => {
    const result = await next(e)
    noteTrace($, next, e, result)
    noteContext($, e.context ?? [], next.trace as unknown as readonly TraceLink[])
    return result
  }).catch(replay)

  // The ledger's hooks: what plugins beneath the lab add to the model's input,
  // and every message the engine injects for it. Each passes e on unchanged.
  on('prompt.context', async ($, e, next) => {
    const result = await next(e)
    noteBlocks($, e.blocks, next.trace as unknown as readonly TraceLink[])
    return result
  }).catch(replay)

  on('tool.describe', async ($, e, next) => {
    const result = await next(e)
    const isDeferred = result.isDeferred ?? e.isDeferred === true
    noteTool($, e.tool, { provider: e.provider.plugin, isDeferred, chars: e.tool.length + result.description.length })
    return result
  }).catch(replay)

  on('prompt.attachment', async ($, e, next) => {
    const result = await next(e)
    if (result.text !== null) noteAttachment($, attachmentKey(e.origin, e.type), result.text)
    return result
  }).catch(replay)

  on('command.run', async ($, e, next) => {
    const result = await next(e)
    noteTrace($, next, e, result)
    return result
  }).catch(replay)

  on('turn.start', async ($, e, next) => {
    const result = await next(e)
    noteTrace($, next, e, result)
    return result
  }).catch(replay)

  // Each model request of a turn, for the explorer's turn timeline, with when
  // each chunk arrived. A hook on a streaming event is a generator: each chunk
  // is passed on as it comes, and the stream's result once it has ended.
  on('turn.step', async function* ($, e, next) {
    const started = Date.now()
    const arrivals: { kind: string; ms: number }[] = []
    const stream = next(e)
    for await (const chunk of stream) {
      arrivals.push({ kind: chunk.kind, ms: Date.now() - started })
      yield chunk
    }
    const result = await stream.result
    noteTrace($, next, e, result, started, streamOf(arrivals, Date.now() - started))
    noteRequest($, e, result.usage)
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    noteTrace($, next, e, result)
    noteAgentEnd($, e)
    return result
  }).catch(replay)

  // The op events the probes raise, as intercept.ts lists them. Each records
  // the lab's own dispatches while a probe runs, lets an intercept act on the
  // calls it covers, and passes everything else straight through.
  on('session.cwd', inspected).catch(replay)
  on('session.root', inspected).catch(replay)
  on('session.id', inspected).catch(replay)
  on('session.model', inspected).catch(replay)
  on('session.turns', inspected).catch(replay)
  on('session.version', inspected).catch(replay)
  on('session.repo', inspected).catch(replay)
  on('session.surfaces', inspected).catch(replay)
  on('session.usage', inspected).catch(replay)
  on('session.messages', inspected).catch(replay)
  on('clock.now', inspected).catch(replay)
  on('clock.sleep', inspected).catch(replay)
  on('clock.after', inspected).catch(replay)
  on('store.keys', inspected).catch(replay)
  on('store.get', inspected).catch(replay)
  on('store.set', inspected).catch(replay)
  on('store.delete', inspected).catch(replay)
  on('state.get', inspected).catch(replay)
  on('state.set', inspected).catch(replay)
  on('ui.toast', inspected).catch(replay)
  on('ui.status', inspected).catch(replay)
  on('ui.log', inspected).catch(replay)
  on('ui.notify', inspected).catch(replay)
  on('ui.panes', inspected).catch(replay)
  on('ui.copy', inspected).catch(replay)
  on('ui.selection', inspected).catch(replay)
  on('prompt.read', inspected).catch(replay)
  on('prompt.fill', inspected).catch(replay)
  on('prompt.suggest', inspected).catch(replay)
  // Capture only the lab's explicit probe calls; normal composition passes through without recording.
  on('prompt.compose', inspected).catch(replay)
  on('tool.list', inspected).catch(replay)
  on('tool.check', inspected).catch(replay)
  on('command.list', inspected).catch(replay)
  on('config.list', inspected).catch(replay)
  on('agent.list', inspected).catch(replay)
  on('fs.list', inspected).catch(replay)
  on('fs.exists', inspected).catch(replay)
  on('fs.stat', inspected).catch(replay)
  on('fs.read', inspected).catch(replay)
  on('fs.ancestors', inspected).catch(replay)
  on('fs.write', inspected).catch(replay)
  on('env.get', inspected).catch(replay)
  on('settings.read', inspected).catch(replay)
  on('process.run', inspected).catch(replay)
  on('process.spawn', async function* ($, e, next) {
    return yield* inspectedStream($, e, next)
  })
  on('http.fetch', inspected).catch(replay)
  on('model.complete', metered).catch(replay)
  on('model.classify', metered).catch(replay)
  on('model.fork', metered).catch(replay)
  on('audio.speak', inspected).catch(replay)

  on('ui.render', { component: 'Pane', requestId: 'lab' }, async ($, e) => {
    const probe = findProbe(await read($, selected)) ?? availableProbes()[0]
    if (probe === undefined) throw new Error('the probe catalog is empty')
    const records = await readRecords($)
    const model: PaneModel = {
      ...(await readPaneState($)),
      probe,
      draft: draftFor(probe.id, (await read($, drafts))[probe.id]),
      last: records.runs.findLast(run => run.probe === probe.id),
      ...records,
      ...(await readInterception($)),
      spend: await readSpend($),
      now: Date.now(),
      rows: e.viewport?.rows ?? 24,
    }
    const act: PaneActions = {
      setView: chosen => void setView($, chosen),
      setHelp: help => void setHelp($, help),
      pickNoun: noun => void pickProbe($, availableProbes().find(one => one.noun === noun)?.id ?? probe.id),
      pickProbe: id => void pickProbe($, id),
      setArg: (name, value) => void setArg($, probe.id, name, value),
      toggleTracing: () => void setTracing($, 'toggle'),
      setInterceptField: (field, value) => void setDraftField($, field, value),
      applyIntercept: () => void applyDraft($),
      submitInterceptField: (field, value) => void submitDraftField($, field, value),
      clearIntercept: event => void clearIntercept($, event),
    }
    if (e.surface === 'mobile') return drawCompact($.ui.resolve(e), model, act)
    return drawPane($.ui.resolve(e), model, act)
  })

  // /mod-lab help's row in the transcript: the box in place of the list, which the model reads as text. The row is
  // known by its text: its args arrive empty on 2.1.303, though the command had them.
  on('ui.render', { component: 'CommandOutput', props: { command: 'mod-lab' } }, async ($, e, next) => {
    if (e.props.isErrored || !e.props.text.includes(HELP_INTRO)) return next(e)
    return drawHelpBox($.ui.resolve(e), /http:\/\/localhost:\d+/.exec(e.props.text)?.[0] ?? null)
  })
}
