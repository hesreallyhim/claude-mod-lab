// stopwatch: times the model's tool calls in a session and draws the totals in
// a pane, with options. The finished mod of tutorials 1, 3 and 4:
// learn/tutorials/1-stopwatch, 3-stopwatch-pane and 4-stopwatch-options.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ToolCallResult } from 'claude-code'

import type { StopwatchCall, StopwatchTotals } from '../types'

type Dollar = EngineInterface

const totals = atom({ plugin: 'stopwatch', key: 'totals' } as const, {})
const latest = atom({ plugin: 'stopwatch', key: 'latest' } as const, null)
const slowCalls = atom({ plugin: 'stopwatch', key: 'slowCalls' } as const, 0)

// The slowest the slowAfter option may be set to, in seconds: the Bash tool stops a command at ten minutes.
const MAX_SLOW_AFTER = 600

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

/** The tools, most time first. */
function byTime(all: StopwatchTotals): [string, { calls: number; ms: number }][] {
  return Object.entries(all).sort(([, a], [, b]) => b.ms - a.ms)
}

/** `3 tool calls, 5.1 s in tools`, or that there are none yet. */
function headline(all: StopwatchTotals): string {
  const rows = Object.values(all)
  if (rows.length === 0) return 'No tool calls yet.'
  const n = rows.reduce((sum, row) => sum + row.calls, 0)
  const ms = rows.reduce((sum, row) => sum + row.ms, 0)
  return `${calls(n)}, ${duration(ms)} in tools`
}

function describe(all: StopwatchTotals): string {
  const rows = byTime(all)
  if (rows.length === 0) return headline(all)
  return `${headline(all)}: ${rows.map(([tool, row]) => `${tool} ${duration(row.ms)}`).join(', ')}`
}

/** One row per tool, most time first, each bar sized so the longest fills the room the pane has. */
function bars(all: StopwatchTotals, columns: number): string[] {
  const rows = byTime(all)
  const most = Math.max(1, rows[0]?.[1].ms ?? 0)
  const name = Math.max(0, ...rows.map(([tool]) => tool.length))
  const time = Math.max(0, ...rows.map(([, row]) => duration(row.ms).length))
  const room = Math.max(1, columns - name - time - 2)
  return rows.map(([tool, row]) => `${tool.padEnd(name)} ${'█'.repeat(Math.max(1, Math.round((row.ms / most) * room)))} ${duration(row.ms)}`)
}

/** A call as the status line and the pane show it: `Bash 1.2 s`, marked when it failed or took longer than `slowMs`. */
function callLine(call: StopwatchCall, slowMs: number): string {
  const marks = [...(call.failed ? ['failed'] : []), ...(call.ms > slowMs ? ['slow'] : [])]
  return `${call.tool} ${duration(call.ms)}${marks.length > 0 ? ` (${marks.join(', ')})` : ''}`
}

/** What a call was about: its command, path or pattern. */
function detailOf(input: unknown): string {
  const fields = input as { command?: unknown; file_path?: unknown; pattern?: unknown }
  const detail = [fields.command, fields.file_path, fields.pattern].find(value => typeof value === 'string')
  return typeof detail === 'string' ? detail : ''
}

// The engine refuses a whole drawing whose text holds an escape sequence or a
// control character, and a command can hold both.
function printable(text: string): string {
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x1f\x7f]/g, ' ')
}

async function reset($: Dollar): Promise<void> {
  await update($, totals, () => ({}))
  await update($, latest, () => null)
  $.ui.status(undefined)
}

/** The tool names in the ignore option's text. */
function toolNames(text: string): Set<string> {
  return new Set(text.split(',').map(name => name.trim()).filter(name => name !== ''))
}

/** Whether a /config row is this plugin's field `field`: its key is `<plugin>.<field>`. */
function isField(key: string, plugin: string, field: string): boolean {
  return key === `${plugin}.${field}` || key.startsWith(`${plugin}@`) && key.endsWith(`.${field}`)
}

export const register: Register = (on, options) => {
  // Fixed while the plugin is loaded: a change in /config reloads it with the new values.
  const ignored = toolNames(typeof options.ignore === 'string' ? options.ignore : '')
  const slowMs = 1000 * (typeof options.slowAfter === 'number' ? options.slowAfter : 5)

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'stopwatch', description: 'Time spent in tool calls this session, by tool' })
    return next(e)
  })

  on('command.run', { command: 'stopwatch' }, async ($, e) => {
    if (e.args.trim() === 'pane') {
      const opened = await $.ui.open({ id: 'stopwatch', title: 'stopwatch' })
      return { text: opened.isPlaced ? 'Opened the stopwatch pane.' : `The pane is waiting for room: ${opened.reason}` }
    }
    return { text: describe(await read($, totals)) }
  })

  on('tool.call', async ($, e, next) => {
    if (ignored.has(e.tool)) return next(e)
    const started = await $.clock.now()
    const result = await next(e)
    const ms = (await $.clock.now()) - started
    await update($, totals, all => {
      const row = all[e.tool] ?? { calls: 0, ms: 0 }
      return { ...all, [e.tool]: { calls: row.calls + 1, ms: row.ms + ms } }
    })
    const call = { tool: e.tool, detail: detailOf(e), ms, failed: failed(result) }
    await update($, latest, () => call)
    $.ui.status(callLine(call, slowMs))
    if (ms > slowMs) {
      await update($, slowCalls, n => n + 1)
      // The /config row's label counts the slow calls; the engine keeps the old one until told.
      $.ui.invalidate('config.describe')
    }
    return result
  })

  // Slow after: more than 0 seconds, cut to MAX_SLOW_AFTER.
  on('config.set', ($, e, next) => {
    if (!isField(e.key, $.plugin.name, 'slowAfter')) return next(e)
    const seconds = typeof e.value === 'number' ? e.value : Number.NaN
    if (!Number.isFinite(seconds) || seconds <= 0) return { deny: 'slow after takes a number of seconds above 0' }
    return next({ ...e, value: Math.min(seconds, MAX_SLOW_AFTER) })
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'stopwatch could not check the value' }))

  // The slowAfter row says how many calls have gone over it this session.
  on('config.describe', async ($, e, next) => {
    const described = await next(e)
    if (!isField(e.key, $.plugin.name, 'slowAfter')) return described
    const n = await read($, slowCalls)
    return n === 0 ? described : { ...described, label: `${described.label} (${n} call${n === 1 ? '' : 's'} over)` }
  })

  on('ui.render', { component: 'Pane', requestId: 'stopwatch' }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const all = await read($, totals)
    const last = await read($, latest)
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" columnGap={2}>
          <Text bold>{headline(all)}</Text>
          <Button key="reset" label="Reset" hotkey="r" onPress={() => void reset($)} />
        </Box>
        {bars(all, e.props.bodyColumns).map(row => (
          <Text wrap="truncate-end">{row}</Text>
        ))}
        {last !== null && (
          <Text dimColor wrap="truncate-end">
            {`latest: ${callLine(last, slowMs)}  ${printable(last.detail)}`}
          </Text>
        )}
      </Box>
    )
  })
}
