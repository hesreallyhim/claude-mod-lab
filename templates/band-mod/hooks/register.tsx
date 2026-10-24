// band-mod: a line above the prompt, the AbovePrompt site: the session's tool
// calls and the last one. /band-mod off hands the site back. One of the
// gallery's techniques as a mod of its own; templates/README.md says where
// the rest are.

import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

const calls = atom({ plugin: 'band-mod', key: 'calls' } as const, 0)
const last = atom({ plugin: 'band-mod', key: 'last' } as const, null)
const isShown = atom({ plugin: 'band-mod', key: 'isShown' } as const, true)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'band-mod', description: 'A line above the prompt: /band-mod on, /band-mod off' })
    return next(e)
  })

  on('command.run', { command: 'band-mod' }, async ($, e) => {
    const shown = e.args.trim() !== 'off'
    await update($, isShown, () => shown)
    return { text: shown ? 'The line above the prompt is shown.' : 'The band is handed back.' }
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    await update($, calls, n => n + 1)
    await update($, last, () => e.tool)
    return result
  }).catch(($, e, next) => next(e))

  // The band's site, drawn while shown; a survey has it otherwise, or the next plugin.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, isShown))) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const n = await read($, calls)
    const tool = await read($, last)
    return (
      <Box flexDirection="row" columnGap={1}>
        <Text dimColor>band-mod</Text>
        <Text>{`${n} tool call${n === 1 ? '' : 's'}`}</Text>
        {tool !== null && <Text dimColor>{`last: ${tool}`}</Text>}
      </Box>
    )
  })
}
