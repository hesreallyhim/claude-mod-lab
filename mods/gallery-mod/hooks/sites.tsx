// The engine's own sites: a badge under each finished tool call's row,
// wrapping the row the engine draws, and /mod-gallery chart's output row drawn
// as a chart from the text the model reads.

import { atom, memberOf, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register, RenderElement } from 'claude-code'

import { encodeCells } from './cells'
import type { Cell } from './cells'
import { formatMs } from './pointer'
import { barChart } from './svg'

type Dollar = EngineInterface
type Common = Pick<Elements['mobile'], 'Box' | 'Text' | 'Button'>

const CHART_ROWS = 12
const NAME_WIDTH = 14

const areSitesOn = atom({ plugin: 'gallery-mod', key: 'areSitesOn' } as const, false)
// One member per tool call, keyed by its tool_use_id: each tool row reads its own, and redraws for it alone.
const durations = atom({ plugin: 'gallery-mod', key: 'durations' } as const, null)

export async function readSites($: Dollar): Promise<boolean> {
  return read($, areSitesOn)
}

/** Turns the badges on or off; `toggle` flips them. */
export async function setSites($: Dollar, isOn: boolean | 'toggle'): Promise<void> {
  await update($, areSitesOn, now => (isOn === 'toggle' ? !now : isOn))
}

/** Keeps how long a call ran, for its row's badge. */
export async function noteDuration($: Dollar, id: string, ms: number): Promise<void> {
  await update($, memberOf(durations, { requestId: id }), () => ms)
}

/** What `/mod-gallery chart` answers: the counts as a table, which the model reads and the row is drawn from. */
export function chartText(counts: readonly (readonly [string, number])[]): string {
  if (counts.length === 0) return 'No tool call has finished in this session yet.'
  return ['Tool calls this session:', '', '| Tool | Calls |', '| --- | --- |', ...counts.map(([tool, count]) => `| ${tool} | ${count} |`)].join('\n')
}

/** The counts back out of the row's text, so the row draws what it said when it ran, not what holds now. */
export function countsOfText(text: string): [string, number][] {
  return text
    .split('\n')
    .map(line => /^\| (.+?) \| (\d+) \|$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null && match[1] !== 'Tool')
    .map(match => [match[1] ?? '', Number(match[2])])
}

/** One row of cells a tool: a bar shading from the accent to a pale orange, the rest the terminal's own. */
function barCells(counts: readonly (readonly [string, number])[], width: number): Cell[] {
  const most = Math.max(1, ...counts.map(([, count]) => count))
  return counts.flatMap(([, count]) => {
    const length = Math.max(1, Math.round((width * count) / most))
    return Array.from({ length: width }, (_, column): Cell => {
      if (column >= length) return [0x20, 0x01000000, 0x01000000]
      const level = column / Math.max(1, width - 1)
      const color = (0xd9 << 16) | (Math.round(0x77 + level * 0x5a) << 8) | Math.round(0x57 + level * 0x30)
      return [0x2588, color, 0x01000000]
    })
  })
}

function chartOnTerminal(ui: Elements['terminal'], counts: readonly (readonly [string, number])[], columns: number): RenderElement {
  const { Box, Raster, Text } = ui
  const shown = counts.slice(0, CHART_ROWS)
  const width = Math.max(10, Math.min(60, columns - NAME_WIDTH - 8))
  return (
    <Box flexDirection="row" columnGap={1}>
      <Box flexDirection="column" width={NAME_WIDTH}>
        {shown.map(([tool]) => (
          <Text key={`tool:${tool}`} wrap="truncate-end">
            {tool}
          </Text>
        ))}
      </Box>
      <Raster key="chart" columns={width} rows={shown.length} cells={encodeCells(barCells(shown, width))} />
      <Box flexDirection="column">
        {shown.map(([tool, count]) => (
          <Text key={`count:${tool}`} dimColor>
            {String(count)}
          </Text>
        ))}
      </Box>
    </Box>
  )
}

function chartElsewhere(ui: Elements['desktop'] | Elements['vscode'] | Elements['mobile'], counts: readonly (readonly [string, number])[]): RenderElement {
  const { Svg } = ui
  return <Svg source={barChart(counts.slice(0, CHART_ROWS), false)} alt={counts.map(([tool, count]) => `${tool} ${count}`).join(', ')} />
}

export function sitesTab(ui: Common, isOn: boolean, toggle: () => void): RenderElement {
  const { Box, Button, Text } = ui
  return (
    <Box flexDirection="column" rowGap={1}>
      <Text bold>The engine's own rows</Text>
      <Button key="sites" label={isOn ? 'Stop badging tool rows' : 'Badge tool rows'} hotkey="r" onPress={toggle} />
      <Text dimColor>
        Each finished tool call's row in the transcript gets a line saying how long it ran. The hook calls next(e), which answers the engine's own drawing of the row, and returns
        it inside a Box of its own with the line beneath: the row is wrapped, never replaced. Off until asked for, in each session, since it changes the person's transcript;
        /mod-gallery sites on and /mod-gallery sites off do the same from the prompt.
      </Text>
      <Text dimColor>
        /mod-gallery chart answers the session's tool calls as a table, which is what the model reads. Its output row is drawn as a chart instead: a Raster on the terminal, an Svg
        elsewhere, made from the row's own text so it shows what held when the command ran.
      </Text>
    </Box>
  )
}

export const registerSites: Register = on => {
  // A tool call's row, with a badge beneath once it has finished, while sites are on.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const own = await next(e)
    if (e.props.isRunning || !(await read($, areSitesOn))) return own
    const ms = await read($, memberOf(durations, e))
    if (ms === null) return own
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {own}
        <Text dimColor>{`  gallery: ran ${formatMs(ms)}`}</Text>
      </Box>
    )
  })

  // /mod-gallery chart's row, drawn from its text; every other /mod-gallery row as the engine draws it.
  on('ui.render', { component: 'CommandOutput', props: { command: 'mod-gallery' } }, async ($, e, next) => {
    if (e.props.isErrored || e.props.args.trim() !== 'chart') return next(e)
    const counts = countsOfText(e.props.text)
    if (counts.length === 0) return next(e)
    if (e.surface === 'terminal') return chartOnTerminal($.ui.resolve(e), counts, e.viewport?.columns ?? 80)
    return chartElsewhere($.ui.resolve(e), counts)
  })
}
