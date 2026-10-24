import { expect, mock, test } from 'claude-code/testing'
import type { RenderPropsOf } from 'claude-code'

function toolRow(id: string, isRunning = false) {
  const props: RenderPropsOf['ToolUse'] = { tool_use_id: id, tool: 'Bash', input: { command: 'ls' }, isRunning, isErrored: false, isInterrupted: false }
  return { plugin: 'sites-mod', surface: 'terminal' as const, component: 'ToolUse' as const, requestId: id, props }
}

test("a finished call's row is the engine's, wrapped with how long it ran", async ($, on) => {
  const clock = mock.clock(on, { now: 60_000 })
  // The engine's own drawing of the row, stood in for by a Text naming it.
  on('ui.render', { component: 'ToolUse' }, () => ({ type: 'Text' as const, children: ["engine's row"] }))
  let finish = () => {}
  on('tool.call', () => new Promise(resolve => (finish = () => resolve({ result: 'done' }))))
  const call = $.tool.call({ tool: 'Bash', tool_use_id: 'toolu_s1', command: 'ls' } as never)
  await clock.advance(1_500)
  finish()
  await call
  await clock.settle()

  const finished = await $.ui.mount(toolRow('toolu_s1'))
  expect(await finished.find({ type: 'Text', text: "engine's row" })).toBeDefined()
  expect(await finished.find({ type: 'Text', text: '  ran 1.5 s' })).toBeDefined()
  await finished.unmount()

  const running = await $.ui.mount(toolRow('toolu_s1', true))
  expect(await running.find({ type: 'Text', text: /ran / })).toBeUndefined()
})
