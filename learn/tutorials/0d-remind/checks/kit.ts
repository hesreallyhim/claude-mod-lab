// Shared by the remind checks; not a check itself. The checks' own hooks sit
// beneath the mod and stand for the engine: the test kit's clock, which moves
// only when a check moves it; a voice that writes down what it is asked to
// say; and Claude's side of the session, which writes down each prompt the
// mod hands it.

import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

/** The tool's name as Claude calls it. */
const TOOL = 'mcp__remind__remind_me'

export function desk($: Engine, on: On) {
  const clock = mock.clock(on, { now: 0 })
  const said: string[] = []
  const prompts: string[] = []
  on('prompt.submit', ($, e) => {
    prompts.push(e.text)
    return { text: e.text }
  })
  on('audio.speak', ($, e) => {
    said.push(e.text)
    return { value: { via: 'system' as const } }
  })

  /** Claude calls the tool with `input`; resolves what Claude reads back. */
  const call = (input: Record<string, unknown>) => $.tool.call({ tool: TOOL, ...input } as never)

  /** `/remind` typed with what follows it. */
  const slash = (args: string) =>
    $.command.run({ command: 'remind', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 100 } })

  return { clock, call, slash, said, prompts }
}
