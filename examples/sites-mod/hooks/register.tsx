// sites-mod: a line under each finished tool call's row in the transcript,
// saying how long it ran. The hook wraps the row the engine draws, never
// replaces it. One of the gallery's techniques as a mod of its own;
// examples/README.md says where the rest are.

// Inactive when loaded. /sites-mod enables this session; /sites-mod off disables it.

import { atom, memberOf, read, update } from 'claude-code'
import type { Register } from 'claude-code'

// One member per tool call, keyed by its tool_use_id: each row reads its own and redraws for it alone.
const isShown = atom({ plugin: 'sites-mod', key: 'isShown' } as const, false)
const durations = atom({ plugin: 'sites-mod', key: 'durations' } as const, null)

function formatMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'sites-mod', description: 'Show tool-call durations; /sites-mod off disables them' })
    return next(e)
  })

  on('command.run', { command: 'sites-mod' }, async ($, e) => {
    const action = e.args.trim()
    if (!['', 'on', 'off'].includes(action)) return { text: 'Usage: /sites-mod [on|off]' }
    const shown = action !== 'off'
    await update($, isShown, () => shown)
    return { text: shown ? 'Tool-call durations are on for this session.' : 'Tool-call durations are off.' }
  })

  on('tool.call', async ($, e, next) => {
    if (!(await read($, isShown))) return next(e)
    const started = await $.clock.now()
    const result = await next(e)
    if (e.tool_use_id !== undefined) {
      const ran = (await $.clock.now()) - started
      await update($, memberOf(durations, { requestId: e.tool_use_id }), () => ran)
    }
    return result
  }).catch(($, e, next) => next(e))

  // next(e) answers the engine's own drawing of the row; it goes back inside a Box of the mod's, the line beneath.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (!(await read($, isShown))) return next(e)
    const own = await next(e)
    if (e.props.isRunning) return own
    const ms = await read($, memberOf(durations, e))
    if (ms === null) return own
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {own}
        <Text dimColor>{`  ran ${formatMs(ms)}`}</Text>
      </Box>
    )
  })
}
