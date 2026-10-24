// Shared by the stopwatch-pane checks; not a check itself. The checks' own
// hooks sit beneath the mod and stand for the engine; `$.ui.mount` stands for
// a surface drawing the pane. The clock is the test kit's, which moves only
// when a check moves it.

import type { CommandRunInput, On, RenderPropsOf, RenderSurface, ToolCallArgs, ToolCallResult } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

/** What tutorial 1's stopwatch answers before any call, and what the pane draws then. */
export const EMPTY = 'No tool calls yet.'

export function slash(name: string, args = ''): CommandRunInput {
  return { command: name, args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 100 } }
}

/** The pane as a surface mounts it, its body `columns` wide. */
export function pane(columns: number, surface: RenderSurface = 'terminal') {
  const props: RenderPropsOf['Pane'] = {
    title: 'stopwatch',
    isFocused: true,
    bodyColumns: columns,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  }
  return { plugin: 'stopwatch', surface, component: 'Pane' as const, requestId: 'stopwatch', props, viewport: { columns: columns + 20, rows: 40 } }
}

/** Where the mocked clock starts: an ordinary time of day. */
const START = Date.UTC(2026, 9, 19, 9, 30)

export type Tools = {
  /** One call that takes `ms` on the clock; resolves to what the model gets. */
  call: (input: ToolCallArgs, ms: number, answer?: ToolCallResult) => Promise<ToolCallResult>
  /** Each text the mod put on the status line, in order. */
  status: (string | undefined)[]
}

/**
 * Installs the mocked clock, and stands for every tool and for the status
 * line: a call is held until the clock has moved on by its `ms`, then answers
 * `answer`, or `<tool> ran` when not given.
 */
export function runTools($: Engine, on: On): Tools {
  const clock = mock.clock(on, { now: START })
  const held: ((result: ToolCallResult) => void)[] = []
  const status: (string | undefined)[] = []
  on('tool.call', () => new Promise<ToolCallResult>(resolve => held.push(resolve)))
  on('ui.status', ($, e) => {
    status.push(e.text)
    return { value: undefined }
  })

  async function call(input: ToolCallArgs, ms: number, answer?: ToolCallResult): Promise<ToolCallResult> {
    const result = $.tool.call(input)
    await clock.settle()
    const finish = held.shift()
    if (finish === undefined) throw new Error(`the ${input.tool} call never reached the tool: does the mod's hook call next(e)?`)
    await clock.advance(ms)
    finish(answer ?? { result: `${input.tool} ran` })
    return result
  }

  return { call, status }
}

/** Every text the pane drew, a line each, so a failed match shows the whole pane. */
export async function drawn(ui: { findAll: (query: { type: string }) => Promise<readonly { text: string }[]> }): Promise<string> {
  return (await ui.findAll({ type: 'Text' })).map(text => text.text).join('\n')
}

/** Answers `$.ui.open` as a surface with room does, recording the ids opened. */
export function answerOpen(on: On): string[] {
  const opened: string[] = []
  on('ui.open', ($, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  return opened
}

/** A row's time at its end, as `1.7 s` or `860 ms`. */
const TIME = /\s\d+(?:\.\d)? m?s$/

/**
 * The rows of the pane that draw a bar for one of `tools`: the tool's name,
 * then the bar, then its time. A bar's length is its longest run of one
 * repeated character, whichever character draws it.
 */
export function barsOf(texts: readonly string[], tools: readonly string[]): { tool: string; text: string; length: number }[] {
  return texts.flatMap(text => {
    const tool = tools.find(name => text.startsWith(`${name} `) && TIME.test(text))
    if (tool === undefined) return []
    const runs = text.slice(tool.length).replace(TIME, '').match(/(\S)\1*/g) ?? []
    return [{ tool, text, length: Math.max(0, ...runs.map(run => run.length)) }]
  })
}
