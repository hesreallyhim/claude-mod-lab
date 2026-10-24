// Shared by the egg checks; not a check itself. The checks' own hooks sit
// beneath the mod and stand for the engine: the test kit's clock, which moves
// only when a check moves it, and `$.ui.mount`, which stands for the terminal
// drawing the band above the prompt.

import type { CommandRunInput, On } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

/** `/egg`, and what was typed after it. */
function slash(args: string): CommandRunInput {
  return { command: 'egg', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 100 } }
}

/** The test kit's clock, `/egg`, and what the band above the prompt shows. */
export function kitchen($: Engine, on: On) {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 20, 8, 0) })
  // What the band shows when no plugin draws it: nothing.
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Box', children: [] }) as never)
  const egg = (args = '') => $.command.run(slash(args))
  // Each look mounts the band anew, so it is drawn as it stands at that moment.
  let looks = 0
  const mount = () =>
    $.ui.mount({
      plugin: 'egg',
      surface: 'terminal',
      component: 'AbovePrompt',
      requestId: `band-${(looks += 1)}`,
      props: { hasSurvey: false },
    } as never)
  /** Every text the band draws, joined: `egg ████████░░ 2:00 left`. */
  const shown = async () =>
    (await (await mount()).findAll({ type: 'Text' })).map(text => text.text).join(' ')
  /** The colour the bar is drawn in. */
  const barColor = async () => (await (await mount()).findAll({ type: 'Text', text: /[█░]/ }))[0]?.props.color
  return { clock, egg, shown, barColor }
}
