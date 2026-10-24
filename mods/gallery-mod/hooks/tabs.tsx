// The gallery pane: a tab bar and one tab per technique. The terminal draws
// Raster and Image; desktop, VS Code and mobile have Svg instead, and each
// tab draws there the nearest thing they allow.

import type { Elements, RenderElement } from 'claude-code'

import type { GalleryCall, GalleryTab } from '../types'
import type { Heat, Life } from './cells'
import { encodeCells, heatCells, heatOf, lifeCells } from './cells'
import { plasmaSource } from './pixels'
import { bandTab, hoverTab, linksTab, tabOfLink } from './pointer'
import { sitesTab } from './sites'
import { barChart } from './svg'

type Common = Pick<Elements['mobile'], 'Box' | 'Text' | 'Button' | 'Markdown'>
type Terminal = Elements['terminal']
type WithSvg = Elements['desktop'] | Elements['vscode'] | Elements['mobile']

export const TABS: readonly { id: GalleryTab; label: string; hotkey: string }[] = [
  { id: 'raster', label: 'Raster', hotkey: '1' },
  { id: 'image', label: 'Image', hotkey: '2' },
  { id: 'svg', label: 'Svg', hotkey: '3' },
  { id: 'links', label: 'Links', hotkey: '4' },
  { id: 'hover', label: 'Hover', hotkey: '5' },
  { id: 'band', label: 'Band', hotkey: '6' },
  { id: 'sites', label: 'Sites', hotkey: '7' },
]

export const LIFE_KEY = 'life'
export const HEAT_KEY = 'heat'
export const PLASMA_KEY = 'plasma'
export const PLASMA_COLUMNS = 32
export const PLASMA_ROWS = 8
const HEAT_ROWS = 6
const NAME_WIDTH = 14

/** What a drawing shows: the state, and the animation's frame as it stands. */
export type GalleryModel = {
  tab: GalleryTab
  isPlaying: boolean
  /** Why the animation last stopped on its own, its blits refused; null if it did not. */
  refusal: string | null
  calls: readonly GalleryCall[]
  isBandShown: boolean
  areSitesOn: boolean
  life: Life
  frame: number
  now: number
  columns: number
}

export type GalleryActions = {
  pick: (tab: GalleryTab) => void
  togglePlay: () => void
  step: () => void
  toggleBand: () => void
  toggleSites: () => void
}

export function isTab(word: string): word is GalleryTab {
  return TABS.some(tab => tab.id === word)
}

/** How many minutes of heat fit beside the tool names. */
export function heatMinutes(columns: number): number {
  return Math.max(10, Math.min(60, columns - NAME_WIDTH - 2))
}

/** Calls per tool, busiest first. */
export function countsOf(calls: readonly GalleryCall[]): [string, number][] {
  const totals = new Map<string, number>()
  for (const call of calls) totals.set(call.tool, (totals.get(call.tool) ?? 0) + 1)
  return [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

function tabBar(ui: Common, model: GalleryModel, act: GalleryActions): RenderElement {
  const { Box, Button } = ui
  return (
    <Box flexDirection="row" columnGap={1} marginBottom={1}>
      {TABS.map(tab => (
        <Button key={`tab:${tab.id}`} label={tab.label} hotkey={tab.hotkey} variant={tab.id === model.tab ? 'primary' : 'secondary'} onPress={() => act.pick(tab.id)} />
      ))}
    </Box>
  )
}

function note(ui: Common, text: string): RenderElement {
  const { Text } = ui
  return <Text dimColor>{text}</Text>
}

function playButtons(ui: Common, model: GalleryModel, act: GalleryActions, withStep: boolean): RenderElement {
  const { Box, Button, Text } = ui
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" columnGap={1}>
        <Button key="play" label={model.isPlaying ? 'Pause' : 'Play'} hotkey="p" onPress={act.togglePlay} />
        {withStep && <Button key="step" label="Step" hotkey="s" onPress={act.step} />}
      </Box>
      {!model.isPlaying && model.refusal !== null && <Text color="warning">{`Stopped: the frames were refused (${model.refusal}).`}</Text>}
    </Box>
  )
}

function heatNames(ui: Common, heat: Heat): RenderElement {
  const { Box, Text } = ui
  return (
    <Box flexDirection="column" width={NAME_WIDTH}>
      {heat.tools.map(tool => (
        <Text key={`name:${tool}`} wrap="truncate-end">
          {tool}
        </Text>
      ))}
    </Box>
  )
}

function heatAxis(ui: Common, minutes: number): RenderElement {
  const { Text } = ui
  const left = `-${minutes} min`
  return <Text dimColor>{`${' '.repeat(NAME_WIDTH)}${left}${'now'.padStart(minutes - left.length)}`}</Text>
}

function rasterTab(ui: Terminal, model: GalleryModel, act: GalleryActions): RenderElement {
  const { Box, Raster, Text } = ui
  const minutes = heatMinutes(model.columns)
  const heat = heatOf(model.calls, model.now, minutes, HEAT_ROWS)
  return (
    <Box flexDirection="column" rowGap={1}>
      <Text bold>A grid of colored cells, one element</Text>
      <Raster key={LIFE_KEY} columns={model.life.width} rows={model.life.height / 2} cells={encodeCells(lifeCells(model.life))} />
      {playButtons(ui, model, act, true)}
      {note(ui, 'Each frame is one $.ui.blit with new cells, and no render pass. The engine accepts up to 120 blits a second, but the screen repaints about sixty times a second, so blits that land between two repaints merge into one. An upper half block (▀) holds two cells of the grid, its foreground the upper and its background the lower.')}
      <Text bold>Tool calls by minute</Text>
      {heat.tools.length === 0 ? (
        note(ui, 'No tool call has finished in the last hour of this session yet.')
      ) : (
        <Box flexDirection="column">
          <Box flexDirection="row">
            {heatNames(ui, heat)}
            <Raster key={HEAT_KEY} columns={minutes} rows={heat.tools.length} cells={encodeCells(heatCells(heat))} />
          </Box>
          {heatAxis(ui, minutes)}
        </Box>
      )}
      {note(ui, 'A static Raster is drawn again when its state changes, as any element is. Limits: 1 to 512 columns, 1 to 256 rows, 1024 color pairs at once, one printable width-1 character per cell.')}
    </Box>
  )
}

const SHADES = ' ░▒▓█'

/** Off the terminal: the heat map as one Text a row, a count shaded by glyph rather than color. */
function shadedHeat(ui: Common, model: GalleryModel): RenderElement {
  const { Box, Text } = ui
  const minutes = heatMinutes(model.columns)
  const heat = heatOf(model.calls, model.now, minutes, HEAT_ROWS)
  const most = Math.max(1, ...heat.counts.flat())
  if (heat.tools.length === 0) return note(ui, 'No tool call has finished in the last hour of this session yet.')
  return (
    <Box flexDirection="column">
      {heat.tools.map((tool, row) => (
        <Text key={`shade:${tool}`} mono>
          {`${tool.slice(0, NAME_WIDTH - 1).padEnd(NAME_WIDTH)}${(heat.counts[row] ?? []).map(count => SHADES[Math.ceil((count / most) * 4)] ?? ' ').join('')}`}
        </Text>
      ))}
    </Box>
  )
}

function remoteRasterTab(ui: WithSvg, model: GalleryModel): RenderElement {
  const { Box, Text } = ui
  return (
    <Box flexDirection="column" rowGap={1}>
      {note(ui, 'Raster is the terminal\'s alone, and so is repainting one with $.ui.blit. Here the heat map is drawn as text, a count shaded by glyph.')}
      <Text bold>Tool calls by minute</Text>
      {shadedHeat(ui, model)}
    </Box>
  )
}

function imageTab(ui: Terminal, model: GalleryModel, act: GalleryActions): RenderElement {
  const { Box, Image, Text } = ui
  return (
    <Box flexDirection="column" rowGap={1}>
      <Text bold>Pixels over a box of cells</Text>
      <Image key={PLASMA_KEY} source={plasmaSource(model.frame)} columns={PLASMA_COLUMNS} rows={PLASMA_ROWS} alt="A plasma in moving color. This terminal shows the alt text: pictures need the kitty graphics protocol (kitty, Ghostty)." />
      {playButtons(ui, model, act, false)}
      {note(ui, 'Made here as RGBA bytes, 96 by 48 pixels, and swapped by $.ui.blit with a new source on each frame. Where the terminal cannot show pictures the alt text stands in, dim. A source may also be a PNG, a file or a POSIX shared-memory object another process wrote, which the terminal reads itself: those pixels never cross $.')}
    </Box>
  )
}

/** Off the terminal: the same colors as an Svg gradient, which needs no pixels at all. */
function remoteImageTab(ui: WithSvg): RenderElement {
  const { Box, Svg } = ui
  const stops = [0, 60, 120, 180, 240, 300, 360].map((degrees, index) => `<stop offset="${index / 6}" stop-color="hsl(${degrees} 90% 55%)"/>`).join('')
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="80"><defs><linearGradient id="g">${stops}</linearGradient></defs><rect width="320" height="80" rx="8" fill="url(#g)"/></svg>`
  return (
    <Box flexDirection="column" rowGap={1}>
      {note(ui, 'Image is the terminal\'s alone. Here the plasma\'s hues stand in as an Svg gradient.')}
      <Svg source={source} alt="A band of hues from red through the spectrum back to red" />
    </Box>
  )
}

/** On the terminal: Svg is absent, so the counts are bars of block glyphs. */
function svgTabOnTerminal(ui: Terminal, model: GalleryModel): RenderElement {
  const { Box, Text } = ui
  const counts = countsOf(model.calls).slice(0, 8)
  const most = Math.max(1, ...counts.map(([, count]) => count))
  const room = Math.max(10, model.columns - NAME_WIDTH - 8)
  return (
    <Box flexDirection="column" rowGap={1}>
      {note(ui, 'The terminal has no Svg: desktop, VS Code and mobile draw this tab as vector bars. Here they are block glyphs.')}
      {counts.length === 0 ? (
        note(ui, 'No tool call has finished in this session yet.')
      ) : (
        <Box flexDirection="column">
          {counts.map(([tool, count]) => (
            <Text key={`bar:${tool}`}>
              {tool.slice(0, NAME_WIDTH - 1).padEnd(NAME_WIDTH)}
              <Text color="claude">{'█'.repeat(Math.max(1, Math.round((room * count) / most)))}</Text> {count}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  )
}

function svgTab(ui: WithSvg, model: GalleryModel): RenderElement {
  const { Box, Svg, Text } = ui
  const counts = countsOf(model.calls).slice(0, 8)
  if (counts.length === 0) return note(ui, 'No tool call has finished in this session yet.')
  return (
    <Box flexDirection="column" rowGap={1}>
      <Text bold>Drawn as an image</Text>
      <Svg source={barChart(counts, false)} alt={counts.map(([tool, count]) => `${tool} ${count}`).join(', ')} />
      <Text bold>Drawn interactive: hover a bar</Text>
      <Svg source={barChart(counts, true)} alt={counts.map(([tool, count]) => `${tool} ${count}`).join(', ')} isInteractive />
      {note(ui, 'isInteractive draws the markup in a sandboxed frame with no scripts, so CSS :hover and <title> tooltips work. A press other plugins should see belongs on an enclosing element. At most 131,072 characters of markup.')}
    </Box>
  )
}

/** The tabs every surface draws alike, or null for one drawn per surface. */
function sharedTab(ui: Common, model: GalleryModel, act: GalleryActions): RenderElement | null {
  const onLink = (href: string) => {
    const chosen = tabOfLink(href, TABS.map(tab => tab.id))
    if (chosen !== null) act.pick(chosen)
  }
  if (model.tab === 'links') return linksTab(ui, TABS, onLink)
  if (model.tab === 'hover') return hoverTab(ui, model.calls, model.columns, model.isBandShown)
  if (model.tab === 'band') return bandTab(ui, model.isBandShown, act.toggleBand)
  if (model.tab === 'sites') return sitesTab(ui, model.areSitesOn, act.toggleSites)
  return null
}

export function drawTerminal(ui: Terminal, model: GalleryModel, act: GalleryActions): RenderElement {
  const { Box } = ui
  return (
    <Box flexDirection="column">
      {tabBar(ui, model, act)}
      {model.tab === 'raster' && rasterTab(ui, model, act)}
      {model.tab === 'image' && imageTab(ui, model, act)}
      {model.tab === 'svg' && svgTabOnTerminal(ui, model)}
      {sharedTab(ui, model, act)}
    </Box>
  )
}

export function drawRemote(ui: WithSvg, model: GalleryModel, act: GalleryActions): RenderElement {
  const { Box } = ui
  return (
    <Box flexDirection="column">
      {tabBar(ui, model, act)}
      {model.tab === 'raster' && remoteRasterTab(ui, model)}
      {model.tab === 'image' && remoteImageTab(ui)}
      {model.tab === 'svg' && svgTab(ui, model)}
      {sharedTab(ui, model, act)}
    </Box>
  )
}
