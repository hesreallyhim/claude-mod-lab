// Shared by the tick checks; not a check itself. The checks' own hooks sit
// beneath the mod and stand for the engine: the test kit's clock, which moves
// only when a check moves it, and `$.ui.mount`, which stands for a surface
// drawing the pane.

import type { On, RenderPropsOf } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const PROPS: RenderPropsOf['Pane'] = {
  title: 'tick',
  isFocused: true,
  bodyColumns: 40,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
}

/** The pane, drawn as the terminal draws it, with the test kit's clock in place of the real one. */
export async function openPane($: Engine, on: On) {
  const clock = mock.clock(on, { now: 0 })
  const ui = await $.ui.mount({
    plugin: 'tick',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'tick',
    props: PROPS,
    viewport: { columns: 60, rows: 30 },
  })
  /** The line under the big digits: the time, and whether it runs, as `0:07  running`. */
  const reading = async () => (await ui.findAll({ type: 'Text', text: /\d:\d\d +(running|stopped)/ }))[0]?.text ?? ''
  /** What the Start button says. */
  const startLabel = async () => (await ui.findAll({ type: 'Button', key: 'start' }))[0]?.props.label
  return { clock, ui, reading, startLabel }
}
