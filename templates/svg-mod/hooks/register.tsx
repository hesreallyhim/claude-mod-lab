// svg-mod: the session's tool calls as an Svg bar chart on the surfaces that
// have Svg (desktop, VS Code, mobile), and as block glyphs on the terminal,
// which has none. One of the gallery's techniques as a mod of its own;
// templates/README.md says where the rest are.

import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

const PANE = 'svg-mod'
const BAR_WIDTH = 240
const ROW = 22

const counts = atom({ plugin: 'svg-mod', key: 'counts' } as const, {})

function escaped(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** The bars as Svg markup: a row a tool, most calls first, each with a tooltip. */
export function chart(rows: readonly (readonly [string, number])[]): string {
  const most = Math.max(1, ...rows.map(([, n]) => n))
  const bars = rows.map(([tool, n], index) => {
    const y = index * ROW
    const width = Math.max(2, Math.round((n / most) * BAR_WIDTH))
    return `<g><title>${escaped(tool)}: ${n}</title><text x="0" y="${y + 15}" font-size="13" fill="currentColor">${escaped(tool)}</text><rect x="110" y="${y + 4}" width="${width}" height="14" rx="3" fill="#7aa2f7"/><text x="${116 + width}" y="${y + 15}" font-size="12" fill="currentColor">${n}</text></g>`
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${BAR_WIDTH + 160}" height="${rows.length * ROW + 4}">${bars.join('')}</svg>`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'svg-mod', description: 'Tool calls as an Svg bar chart: /svg-mod' })
    return next(e)
  })

  on('command.run', { command: 'svg-mod' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: 'svg-mod' })
    return { text: opened.isPlaced ? 'Opened the chart.' : `The pane is waiting for room: ${opened.reason}` }
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    await update($, counts, all => ({ ...all, [e.tool]: (all[e.tool] ?? 0) + 1 }))
    return result
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const rows = Object.entries(await read($, counts)).sort(([, a], [, b]) => b - a)
    if (e.surface === 'terminal') {
      const { Box, Text } = $.ui.resolve(e)
      const most = Math.max(1, ...rows.map(([, n]) => n))
      return (
        <Box flexDirection="column">
          {rows.length === 0 && <Text dimColor>No tool calls yet.</Text>}
          {rows.map(([tool, n]) => (
            <Text>{`${tool.padEnd(12)} ${'█'.repeat(Math.max(1, Math.round((n / most) * 30)))} ${n}`}</Text>
          ))}
          <Text dimColor>The terminal has no Svg: these are block glyphs. Desktop, VS Code and mobile draw the chart.</Text>
        </Box>
      )
    }
    const { Box, Svg, Text } = $.ui.resolve(e)
    if (rows.length === 0) return <Text dimColor>No tool calls yet.</Text>
    return (
      <Box flexDirection="column">
        <Svg source={chart(rows)} alt={rows.map(([tool, n]) => `${tool} ${n}`).join(', ')} isInteractive />
      </Box>
    )
  })
}
