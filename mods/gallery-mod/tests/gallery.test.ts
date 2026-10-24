import type { On, RenderPropsOf, RenderSurface } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { heatOf, seedLife, stepLife } from '../hooks/cells'

const PANE: RenderPropsOf['Pane'] = {
  title: 'gallery',
  isFocused: true,
  bodyColumns: 80,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}

function mountOn(surface: RenderSurface) {
  return { plugin: 'gallery-mod', surface, component: 'Pane' as const, requestId: 'gallery', props: PANE, viewport: { columns: 100, rows: 44 } }
}

/** Answers what the gallery asks of the engine beneath it, keeping each blit; `deny` refuses them, and `isHoldingTools` leaves tool calls to the test. */
function engine(on: On, options: { deny?: string; isHoldingTools?: boolean } = {}) {
  const blits: { key: string; cells?: string; source?: unknown }[] = []
  on('ui.blit', ($, e) => {
    blits.push(e as never)
    return { value: options.deny === undefined ? {} : { deny: options.deny } }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  if (options.isHoldingTools !== true) on('tool.call', () => ({ result: 'done' }))
  return { blits }
}

const gallery = (args: string) =>
  ({ command: 'mod-gallery', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 100 } }) as const

/** A drawn tree's elements, outermost first. `find` leaves out an element's hover; the drawn tree keeps it. */
type Drawn = { props?: Record<string, unknown>; hover?: Record<string, unknown>; children?: unknown[] }
function elementsOf(node: unknown, found: Drawn[] = []): Drawn[] {
  if (node === null || typeof node !== 'object') return found
  found.push(node as Drawn)
  for (const child of (node as Drawn).children ?? []) elementsOf(child, found)
  return found
}

/** Bytes a base64 string decodes to. */
function decodedLength(text: string): number {
  return (text.length / 4) * 3 - (text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0)
}

test('the terminal draws each tab with its own element: Raster, Image, and no Svg', async ($, on) => {
  mock.clock(on, { now: 3_600_000 })
  engine(on)
  const ui = await $.ui.mount(mountOn('terminal'))

  const life = await ui.find({ type: 'Raster', key: 'life' })
  expect(life).toBeDefined()
  const { columns, rows, cells } = life?.props as { columns: number; rows: number; cells: string }
  expect(decodedLength(cells)).toBe(columns * rows * 12)

  await ui.press({ key: 'tab:image' })
  expect(await ui.find({ type: 'Image', key: 'plasma' })).toBeDefined()

  await ui.press({ key: 'tab:svg' })
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /no Svg/ })).toBeDefined()
})

test('desktop, VS Code and mobile draw no Raster or Image, and the Svg tab as vector bars', async ($, on) => {
  const clock = mock.clock(on, { now: 3_600_000 })
  engine(on)
  await $.tool.call({ tool: 'Read', file_path: '/x' } as never)
  await clock.settle()

  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount(mountOn(surface))
    await ui.press({ key: 'tab:raster' })
    expect(await ui.find({ type: 'Raster' })).toBeUndefined()
    await ui.press({ key: 'tab:image' })
    expect(await ui.find({ type: 'Image' })).toBeUndefined()
    expect(await ui.find({ type: 'Svg' })).toBeDefined()
    await ui.press({ key: 'tab:svg' })
    expect(await ui.findAll({ type: 'Svg' })).toHaveLength(2)
    await ui.unmount()
  }
})

test('Play repaints the grid by blit on the frame clock, and Pause stops it', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  const { blits } = engine(on)
  const ui = await $.ui.mount(mountOn('terminal'))
  const drawn = ((await ui.find({ type: 'Raster', key: 'life' }))?.props as { cells: string }).cells

  await ui.press({ key: 'play' })
  await clock.advance(80 * 3)

  expect(blits.length).toBeGreaterThanOrEqual(3)
  expect(blits.every(blit => blit.key === 'life')).toBe(true)
  expect(blits.at(-1)?.cells).not.toBe(drawn)
  expect(await ui.find({ key: 'play', text: 'Pause' })).toBeDefined()

  await ui.press({ key: 'play' })
  const paused = blits.length
  await clock.advance(80 * 5)
  expect(blits.length).toBe(paused)
})

test('on the Image tab the frames swap the picture by its key', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  const { blits } = engine(on)
  const ui = await $.ui.mount(mountOn('terminal'))
  await ui.press({ key: 'tab:image' })

  await ui.press({ key: 'play' })
  await clock.advance(80 * 2)
  await ui.press({ key: 'play' })

  expect(blits.length).toBeGreaterThanOrEqual(2)
  expect(blits.every(blit => blit.key === 'plasma')).toBe(true)
  expect(blits.at(-1)?.source).toMatchObject({ width: 96, height: 48 })
})

test('blits refused three times running stop the animation, as when the pane closed', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  const { blits } = engine(on, { deny: 'nothing of this plugin is mounted there' })
  const ui = await $.ui.mount(mountOn('terminal'))

  await ui.press({ key: 'play' })
  await clock.advance(80 * 10)

  expect(blits).toHaveLength(3)
  expect(await ui.find({ key: 'play', text: 'Play' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /refused \(nothing of this plugin is mounted there\)/ })).toBeDefined()
})

test('a tab picked while playing is animated at once, its own element blitted', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000 })
  const { blits } = engine(on)
  const ui = await $.ui.mount(mountOn('terminal'))
  await ui.press({ key: 'play' })
  await clock.advance(80)

  await ui.press({ key: 'tab:image' })
  const switched = blits.length
  await clock.advance(80 * 2)

  expect(blits.slice(switched).map(blit => blit.key)).toEqual(['plasma', 'plasma'])
})

test('finished tool calls fill the heat map, one row a tool', async ($, on) => {
  const clock = mock.clock(on, { now: 3_600_000 })
  engine(on)
  for (const path of ['/a', '/b']) await $.tool.call({ tool: 'Read', file_path: path } as never)
  await clock.settle()

  const ui = await $.ui.mount(mountOn('terminal'))

  const heat = await ui.find({ type: 'Raster', key: 'heat' })
  expect(heat?.props).toMatchObject({ rows: 1 })
  expect(await ui.find({ type: 'Text', text: 'Read' })).toBeDefined()
})

test('/mod-gallery opens the pane at a tab, and names the tabs for a word that is none', async ($, on) => {
  mock.clock(on)
  engine(on)

  const opened = await $.command.run(gallery('image'))
  const unknown = await $.command.run(gallery('sketch'))

  expect(opened.text).toBe('Opened the gallery at image.')
  expect(unknown.text).toContain('raster, image, svg')
  const ui = await $.ui.mount(mountOn('terminal'))
  expect(await ui.find({ type: 'Image', key: 'plasma' })).toBeDefined()
})

const BAND: RenderPropsOf['AbovePrompt'] = { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 90, scroll: { offset: 0, bodyRows: 6 }, view: {} }

function bandOn(surface: 'terminal' | 'desktop', props: RenderPropsOf['AbovePrompt'] = BAND) {
  return { plugin: 'gallery-mod', surface, component: 'AbovePrompt' as const, requestId: 'band', props, viewport: { columns: 100, rows: 44 } }
}

test("a gallery link in the Links tab's Markdown switches the tab, and only those links are the plugin's", async ($, on) => {
  mock.clock(on)
  engine(on)
  const ui = await $.ui.mount(mountOn('terminal'))
  await ui.press({ key: 'tab:links' })

  const markdown = await ui.find({ type: 'Markdown', key: 'links' })
  expect((markdown?.props as { pressableLinks: string[] }).pressableLinks).toContain('https://gallery.invalid/tab/image')
  expect((markdown?.props as { pressableLinks: string[] }).pressableLinks.every(href => href.startsWith('https://gallery.invalid/'))).toBe(true)

  await ui.press({ key: 'links', link: { href: 'https://gallery.invalid/tab/image' } })
  expect(await ui.find({ type: 'Image', key: 'plasma' })).toBeDefined()
})

test("a recent call's glyph, its hidden card and its hidden band entry share one hover group", async ($, on) => {
  const clock = mock.clock(on, { now: 60_000 })
  engine(on)
  await $.tool.call({ tool: 'Bash', tool_use_id: 'toolu_h1', command: 'ls   -la' } as never)
  await clock.settle()
  await $.command.run(gallery('band on'))

  const pane = await $.ui.mount(mountOn('desktop'))
  await pane.press({ key: 'tab:hover' })
  const drawn = elementsOf(await pane.drawn())
  const glyph = drawn.find(element => element.props?.key === 'glyph:0')
  const card = drawn.find(element => element.props?.position === 'absolute')
  const band = await $.ui.mount(bandOn('terminal'))
  const entry = elementsOf(await band.drawn()).find(element => element.props?.key === 'entry:0')

  const scope = glyph?.hover?.scope
  expect(scope).toBe('gallery:toolu_h1')
  expect(card).toMatchObject({ props: { display: 'none' }, hover: { scope, display: 'flex' } })
  expect(await pane.find({ type: 'Text', text: 'ls -la' })).toBeDefined()
  expect(entry).toMatchObject({ props: { display: 'none' }, hover: { scope, display: 'flex' } })
})

test('the short inline hover pane puts its targets before the explanation and opens cards below them', async ($, on) => {
  const clock = mock.clock(on, { now: 60_000 })
  engine(on)
  await $.tool.call({ tool: 'Bash', tool_use_id: 'toolu_short', command: 'ls' } as never)
  await clock.settle()
  await $.command.run(gallery('hover'))
  const pane = await $.ui.mount({
    ...mountOn('terminal'),
    props: { ...PANE, placement: 'inline', bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 } },
  })
  expect(await pane.find({ type: 'Text', text: 'Hover a dot to inspect a recent tool call.' })).toBeDefined()
  const drawn = elementsOf(await pane.drawn())
  const glyphIndex = drawn.findIndex(element => element.props?.key === 'glyph:0')
  const explanationIndex = drawn.findIndex(element => element.children?.some(child => typeof child === 'string' && child.includes('Each dot is a recent tool call.')))
  expect(glyphIndex).toBeGreaterThan(-1)
  expect(explanationIndex).toBeGreaterThan(glyphIndex)
  expect(drawn.some(element => Number(element.props?.marginTop ?? 0) > 0)).toBe(false)
  expect(drawn.find(element => element.props?.position === 'absolute')).toMatchObject({ props: { top: 1, display: 'none' } })
})

test('the band is the others\' until shown, then counts the calls, and yields to a survey', async ($, on) => {
  const clock = mock.clock(on, { now: 60_000 })
  engine(on)
  // The engine's own band, where no plugin draws: an empty Box.
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Box', children: [] }))
  await $.tool.call({ tool: 'Read', file_path: '/r' } as never)
  await clock.settle()

  const hidden = await $.ui.mount(bandOn('terminal'))
  expect(await hidden.find({ type: 'Text', text: 'gallery' })).toBeUndefined()
  await hidden.unmount()

  const pane = await $.ui.mount(mountOn('terminal'))
  await pane.press({ key: 'tab:band' })
  await pane.press({ key: 'band' })
  const shown = await $.ui.mount(bandOn('desktop'))
  expect(await shown.find({ type: 'Text', text: /1 tool call$/ })).toBeDefined()
  expect(await shown.find({ type: 'Text', text: /last: Read/ })).toBeDefined()
  await shown.unmount()

  const surveyed = await $.ui.mount(bandOn('terminal', { ...BAND, hasSurvey: true }))
  expect(await surveyed.find({ type: 'Text', text: 'gallery' })).toBeUndefined()
})

/** The engine's own drawing of a site, stood in for by a Text naming it. */
function engineDraws(on: On, component: 'ToolUse' | 'CommandOutput') {
  const own = () => ({ type: 'Text' as const, children: [`engine's ${component}`] })
  if (component === 'ToolUse') on('ui.render', { component: 'ToolUse' }, own)
  else on('ui.render', { component: 'CommandOutput' }, own)
}

function toolRow(id: string, isRunning = false) {
  const props: RenderPropsOf['ToolUse'] = { tool_use_id: id, tool: 'Bash', input: { command: 'ls' }, isRunning, isErrored: false, isInterrupted: false }
  return { plugin: 'gallery-mod', surface: 'terminal' as const, component: 'ToolUse' as const, requestId: id, props, viewport: { columns: 100, rows: 44 } }
}

function outputRow(surface: RenderSurface, args: string, text: string) {
  const props: RenderPropsOf['CommandOutput'] = { command: 'mod-gallery', args, text, isErrored: false }
  return { plugin: 'gallery-mod', surface, component: 'CommandOutput' as const, requestId: `message-${surface}-${args}`, props, viewport: { columns: 100, rows: 44 } }
}

test("a finished call's row is wrapped with how long it ran, only once sites are on", async ($, on) => {
  const clock = mock.clock(on, { now: 60_000 })
  engine(on, { isHoldingTools: true })
  engineDraws(on, 'ToolUse')
  let finish = () => {}
  on('tool.call', () => new Promise(resolve => (finish = () => resolve({ result: 'done' }))))
  const call = $.tool.call({ tool: 'Bash', tool_use_id: 'toolu_s1', command: 'ls' } as never)
  await clock.advance(1_500)
  finish()
  await call
  await clock.settle()

  const off = await $.ui.mount(toolRow('toolu_s1'))
  expect(await off.find({ type: 'Text', text: /\bgallery: ran/ })).toBeUndefined()
  await off.unmount()

  await $.command.run(gallery('sites on'))
  const finished = await $.ui.mount(toolRow('toolu_s1'))
  expect(await finished.find({ type: 'Text', text: "engine's ToolUse" })).toBeDefined()
  expect(await finished.find({ type: 'Text', text: 'gallery: ran 1.5 s' })).toBeDefined()
  await finished.unmount()

  const running = await $.ui.mount(toolRow('toolu_s1', true))
  expect(await running.find({ type: 'Text', text: /\bgallery: ran/ })).toBeUndefined()
  await running.unmount()
  const unknown = await $.ui.mount(toolRow('toolu_other'))
  expect(await unknown.find({ type: 'Text', text: /\bgallery: ran/ })).toBeUndefined()
})

test("/mod-gallery chart answers a table the model reads, and its row is drawn as a chart from that text", async ($, on) => {
  const clock = mock.clock(on, { now: 60_000 })
  engine(on)
  engineDraws(on, 'CommandOutput')
  for (const tool of ['Bash', 'Bash', 'Read']) await $.tool.call({ tool, tool_use_id: `toolu_${Math.random()}` } as never)
  await clock.settle()

  const answer = await $.command.run(gallery('chart'))
  expect(answer.text).toContain('| Bash | 2 |')
  expect(answer.text).toContain('| Read | 1 |')

  const terminal = await $.ui.mount(outputRow('terminal', 'chart', answer.text ?? ''))
  expect((await terminal.find({ type: 'Raster', key: 'chart' }))?.props).toMatchObject({ rows: 2 })
  const desktop = await $.ui.mount(outputRow('desktop', 'chart', answer.text ?? ''))
  expect(await desktop.find({ type: 'Svg' })).toBeDefined()
  const other = await $.ui.mount(outputRow('terminal', 'image', 'Opened the gallery at image.'))
  expect(await other.find({ type: 'Text', text: "engine's CommandOutput" })).toBeDefined()
})

test('a blinker turns between its two phases', () => {
  const life = seedLife(5, 5)
  life.age.fill(0)
  for (const x of [1, 2, 3]) life.age[2 * 5 + x] = 1

  const turned = stepLife(life)
  const back = stepLife(turned)

  expect([1, 2, 3].map(y => turned.age[y * 5 + 2])).toEqual([1, 2, 1])
  expect([1, 2, 3].map(x => back.age[2 * 5 + x] !== 0)).toEqual([true, true, true])
})

test('the heat map counts each tool by the minute its call started, the newest minute last', () => {
  const now = 10 * 60_000
  const calls = [
    { at: now - 30_000, tool: 'Bash' },
    { at: now - 90_000, tool: 'Bash' },
    { at: now - 30_000, tool: 'Read' },
    { at: now - 11 * 60_000, tool: 'Grep' },
  ]

  const heat = heatOf(calls, now, 10, 6)

  expect(heat.tools).toEqual(['Bash', 'Read'])
  expect(heat.counts[0]?.slice(-2)).toEqual([1, 1])
  expect(heat.counts[1]?.slice(-2)).toEqual([0, 1])
})
