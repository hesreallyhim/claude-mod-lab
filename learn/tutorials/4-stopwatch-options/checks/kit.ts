// Shared by the stopwatch-options checks; not a check itself. The checks'
// own hooks sit beneath the mod and stand for the engine: the tools, the
// status line, the /config menu, and a surface that mounts the pane. The
// clock is the test kit's, which moves only when a check moves it.

import type {
  CommandRunInput,
  ConfigDescribeInput,
  ConfigDescribeResult,
  ConfigSetInput,
  ConfigSetResult,
  ConfigValue,
  On,
  RenderPropsOf,
  ToolCallArgs,
  ToolCallResult,
} from 'claude-code'
import { mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

export function slash(name: string, args = ''): CommandRunInput {
  return { command: name, args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 100 } }
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

/** Records each event the mod asks the engine to run again, as `$.ui.invalidate` names it. */
export function invalidations(on: On): string[] {
  const asked: string[] = []
  on('ui.invalidate', ($, e) => {
    asked.push(e.event)
    return { value: undefined }
  })
  return asked
}

/** The pane as a terminal mounts it, its body `columns` wide. */
export function pane(columns: number) {
  const props: RenderPropsOf['Pane'] = { title: 'stopwatch', isFocused: true, bodyColumns: columns, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} }
  return { plugin: 'stopwatch', surface: 'terminal' as const, component: 'Pane' as const, requestId: 'stopwatch', props, viewport: { columns: columns + 20, rows: 40 } }
}

/** Every text the pane drew, a line each, so a failed match shows the whole pane. */
export async function drawn(ui: { findAll: (query: { type: string }) => Promise<readonly { text: string }[]> }): Promise<string> {
  return (await ui.findAll({ type: 'Text' })).map(text => text.text).join('\n')
}

/** The /config menu beneath every plugin: it writes what reaches it. */
export function menu(on: On): void {
  on('config.set', ($, e) => ({ value: e.value }))
  on('config.describe', ($, e) => ({ label: e.label, description: e.description, isHidden: e.isHidden }))
}

// The test's `$` raises these with all of the engine's fields, which a plugin's own call leaves to the engine.
type ConfigEvents = {
  config: {
    set: (e: ConfigSetInput) => Promise<ConfigSetResult>
    describe: (e: ConfigDescribeInput) => Promise<ConfigDescribeResult>
  }
}

/** The person setting `key` in the /config menu, from `previous`. */
export function setting($: unknown, key: string, value: ConfigValue, previous: ConfigValue, plugin = 'stopwatch'): Promise<ConfigSetResult> {
  return ($ as ConfigEvents).config.set({ key, value, previous, provider: { plugin, tier: 'user' }, origin: { kind: 'composer' } })
}

/** The menu listing the row `key` with the manifest's title for its label. */
export function describing($: unknown, key: string, label: string, plugin = 'stopwatch'): Promise<ConfigDescribeResult> {
  return ($ as ConfigEvents).config.describe({ key, label, description: '', isHidden: false, provider: { plugin, tier: 'user' } })
}
