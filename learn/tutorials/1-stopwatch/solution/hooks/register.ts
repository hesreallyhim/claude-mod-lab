// stopwatch: times the model's tool calls in a session. The finished mod of
// the first tutorial, learn/tutorials/1-stopwatch/README.md.

import { atom, read, update } from 'claude-code'
import type { Register, ToolCallResult } from 'claude-code'

import type { StopwatchTotals } from '../types'

const totals = atom({ plugin: 'stopwatch', key: 'totals' } as const, {})

/** `40 ms` under a second, `1.2 s` from one on. */
function duration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`
}

function calls(n: number): string {
  return `${n} tool call${n === 1 ? '' : 's'}`
}

/** Whether the model got an error back: the tool failed, or the call was refused. */
function failed(result: ToolCallResult): boolean {
  return result.isError === true || result.deny !== undefined
}

function describe(all: StopwatchTotals): string {
  const rows = Object.entries(all).sort(([, a], [, b]) => b.ms - a.ms)
  if (rows.length === 0) return 'No tool calls yet.'
  const n = rows.reduce((sum, [, row]) => sum + row.calls, 0)
  const ms = rows.reduce((sum, [, row]) => sum + row.ms, 0)
  return `${calls(n)}, ${duration(ms)} in tools: ${rows.map(([tool, row]) => `${tool} ${duration(row.ms)}`).join(', ')}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'stopwatch', description: 'Time spent in tool calls this session, by tool' })
    return next(e)
  })

  on('command.run', { command: 'stopwatch' }, async $ => ({ text: describe(await read($, totals)) }))

  on('tool.call', async ($, e, next) => {
    const started = await $.clock.now()
    const result = await next(e)
    const ms = (await $.clock.now()) - started
    await update($, totals, all => {
      const row = all[e.tool] ?? { calls: 0, ms: 0 }
      return { ...all, [e.tool]: { calls: row.calls + 1, ms: row.ms + ms } }
    })
    $.ui.status(`${e.tool} ${duration(ms)}${failed(result) ? ' (failed)' : ''}`)
    return result
  })
}
