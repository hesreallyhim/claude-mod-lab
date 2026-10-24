// Shared by the stopwatch checks; not a check itself. The checks' own hooks
// sit beneath the mod and stand for the engine: what one answers is what the
// mod's next(e) resolves to. The clock is the test kit's, which moves only
// when a check moves it.

import type { CommandRunInput, On, ToolCallArgs, ToolCallResult } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

/** `/<name> <args>` as typed at the prompt. */
export function slash(name: string, args = ''): CommandRunInput {
  return { command: name, args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 100 } }
}

/** Answers a session's start and each command registration, recording the names registered. */
export function answerStart(on: On): string[] {
  const registered: string[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => {
    registered.push(e.name)
    return { value: { command: e.name } }
  })
  return registered
}

/** Records each text the mod puts on the status line, which a check answers as the engine would. */
export function recordStatus(on: On): (string | undefined)[] {
  const texts: (string | undefined)[] = []
  on('ui.status', ($, e) => {
    texts.push(e.text)
    return { value: undefined }
  })
  return texts
}

/** Where the mocked clock starts: an ordinary time of day, so a mod that mixes in Date.now() reads nonsense. */
const START = Date.UTC(2026, 9, 19, 9, 30)

/**
 * A call a check makes: its input, when it starts (`at`, in ms after the
 * first one starts) and how long the tool takes (`ms`). `answer` is what the
 * tool answers, `<tool> ran` when not given. Each call's input differs from
 * the others', which is how its answer finds it.
 */
export type Timed = { input: ToolCallArgs; at?: number; ms: number; answer?: ToolCallResult }

export type Tools = {
  /** One call that takes `ms` on the clock; resolves to what the model gets. */
  call: (input: ToolCallArgs, ms: number, answer?: ToolCallResult) => Promise<ToolCallResult>
  /** Calls that may overlap, each answered when the clock reaches its end; calls that end together are answered together. */
  calls: (all: readonly Timed[]) => Promise<ToolCallResult[]>
}

/**
 * Installs the mocked clock, and stands for every tool: a call is held until
 * the clock has moved on by the call's `ms`, then answered. That is the time
 * the mod's two `$.clock.now()` reads see pass around `next(e)`.
 */
export function runTools($: Engine, on: On): Tools {
  const clock = mock.clock(on, { now: START })
  const held: { input: ToolCallArgs; answer: (result: ToolCallResult) => void }[] = []
  on('tool.call', ($, e) => new Promise<ToolCallResult>(resolve => held.push({ input: e as ToolCallArgs, answer: resolve })))

  function finish(call: Timed): void {
    const index = held.findIndex(one => Object.entries(call.input).every(([field, value]) => (one.input as Record<string, unknown>)[field] === value))
    const one = held[index]
    if (one === undefined) throw new Error(`the ${call.input.tool} call never reached the tool: does the mod's hook call next(e)?`)
    held.splice(index, 1)
    one.answer(call.answer ?? { result: `${call.input.tool} ran` })
  }

  async function calls(all: readonly Timed[]): Promise<ToolCallResult[]> {
    const zero = clock.now()
    const results: Promise<ToolCallResult>[] = []
    const times = [...new Set(all.flatMap(call => [call.at ?? 0, (call.at ?? 0) + call.ms]))].sort((a, b) => a - b)
    for (const time of times) {
      await clock.set(zero + time)
      // The calls that end now are answered together, so their hooks run after next(e) side by side.
      for (const call of all) if ((call.at ?? 0) + call.ms === time) finish(call)
      all.forEach((call, index) => {
        if ((call.at ?? 0) === time) results[index] = $.tool.call(call.input)
      })
      await clock.settle()
    }
    return Promise.all(results)
  }

  async function call(input: ToolCallArgs, ms: number, answer?: ToolCallResult): Promise<ToolCallResult> {
    const [result] = await calls([{ input, ms, answer }])
    if (result === undefined) throw new Error(`the ${input.tool} call did not resolve`)
    return result
  }

  return { call, calls }
}
