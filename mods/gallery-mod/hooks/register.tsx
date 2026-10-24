// gallery-mod: rendering techniques for mods, one tab each, drawn as well as the
// surface allows. What it shows and how to run it are in ../README.md.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer, UiBlitResult } from 'claude-code'

import type { GalleryCall, GalleryTab } from '../types'
import type { Life } from './cells'
import { encodeCells, lifeCells, seedLife, stepLife } from './cells'
import { plasmaSource } from './pixels'
import { drawBand } from './pointer'
import { chartText, noteDuration, readSites, registerSites, setSites } from './sites'
import type { GalleryActions, GalleryModel } from './tabs'
import { countsOf, drawRemote, drawTerminal, isTab, LIFE_KEY, PLASMA_KEY, TABS } from './tabs'

type Dollar = EngineInterface

const PANE = 'gallery'
const FRAME_MS = 80
const MAX_CALLS = 500
// Raster rows; the grid is twice as tall, two cells to a half block.
const LIFE_ROWS = 10
const MAX_LIFE_COLUMNS = 120
// Refused this many times running, a blit's element is gone: the pane was closed, or the tab changed.
const MAX_MISSES = 3

const tab = atom({ plugin: 'gallery-mod', key: 'tab' } as const, 'raster')
const calls = atom({ plugin: 'gallery-mod', key: 'calls' } as const, [])
const isBandShown = atom({ plugin: 'gallery-mod', key: 'isBandShown' } as const, false)

// The animation is kept in module variables, not state: a reload stops its
// timer, so a state value saying it plays would be wrong after one.
let timer: Timer | null = null
let isTicking = false
let misses = 0
// Why the animation last stopped on its own: the reason its blits were refused.
let refusal: string | null = null
let frame = 0
let life: Life = seedLife(MAX_LIFE_COLUMNS, LIFE_ROWS * 2)
// The tab last drawn, which the timer animates.
let shown: GalleryTab = 'raster'

function counted(result: UiBlitResult, $: Dollar): void {
  if (result.deny === undefined) {
    misses = 0
    return
  }
  misses += 1
  if (misses < MAX_MISSES) return
  refusal = result.deny
  stop($)
}

async function tick($: Dollar): Promise<void> {
  if (shown === 'raster') {
    life = stepLife(life)
    counted(await $.ui.blit({ requestId: PANE, key: LIFE_KEY, cells: encodeCells(lifeCells(life)) }), $)
  } else if (shown === 'image') {
    frame += 1
    counted(await $.ui.blit({ requestId: PANE, key: PLASMA_KEY, source: plasmaSource(frame) }), $)
  } else {
    stop($)
  }
}

function start($: Dollar): void {
  if (timer !== null) return
  misses = 0
  refusal = null
  timer = $.clock.every(FRAME_MS, () => {
    if (isTicking) return
    isTicking = true
    void tick($)
      .catch(() => stop($))
      .finally(() => {
        isTicking = false
      })
  })
  $.ui.invalidate('ui.render')
}

function stop($: Dollar): void {
  if (timer === null) return
  timer.cancel()
  timer = null
  $.ui.invalidate('ui.render')
}

/** One generation, painted by a blit while the pane shows it. */
async function stepOnce($: Dollar): Promise<void> {
  life = stepLife(life)
  await $.ui.blit({ requestId: PANE, key: LIFE_KEY, cells: encodeCells(lifeCells(life)) })
}

/** Shows another tab; the timer animates it from now, not from the redraw. */
async function pick($: Dollar, chosen: GalleryTab): Promise<void> {
  shown = chosen
  misses = 0
  refusal = null
  await update($, tab, () => chosen)
}

/** A call's input in brief: the field that names what it acted on, else its fields as JSON. */
function summaryOf(e: Record<string, unknown>): string {
  for (const field of ['command', 'file_path', 'pattern', 'path', 'url', 'query', 'description']) {
    const value = e[field]
    if (typeof value === 'string' && value !== '') return value.replace(/\s+/g, ' ').slice(0, 120)
  }
  const { tool: _tool, tool_use_id: _id, ...rest } = e
  return JSON.stringify(rest).slice(0, 120)
}

async function setBand($: Dollar, isShown: boolean): Promise<void> {
  await update($, isBandShown, () => isShown)
}


async function openAt($: Dollar, chosen: GalleryTab | null): Promise<string> {
  if (chosen !== null) await pick($, chosen)
  const opened = await $.ui.open({ id: PANE, title: 'gallery' })
  if (!opened.isPlaced) return `The pane is waiting for room: ${opened.reason}`
  return chosen === null ? 'Opened the gallery.' : `Opened the gallery at ${chosen}.`
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'mod-gallery',
      description: 'Rendering techniques for mods, one tab each: /mod-gallery [tab | play | pause | band on|off | sites on|off | chart]',
      argumentHint: `[${TABS.map(one => one.id).join(' | ')} | play | pause | band on|off | sites on|off | chart]`,
    })
    return next(e)
  })

  on('command.run', { command: 'mod-gallery' }, async ($, e) => {
    const word = e.args.trim().toLowerCase()
    if (word === 'play') {
      start($)
      return { text: 'Playing the shown tab, where it animates.' }
    }
    if (word === 'pause') {
      stop($)
      return { text: 'Paused.' }
    }
    if (word === 'band on' || word === 'band off') {
      await setBand($, word === 'band on')
      return { text: word === 'band on' ? 'The gallery draws its line above the prompt.' : 'The band is left to the others.' }
    }
    if (word === 'sites on' || word === 'sites off') {
      await setSites($, word === 'sites on')
      return { text: word === 'sites on' ? "Finished tool calls' rows carry the gallery's badge." : 'Tool rows are drawn as the engine draws them.' }
    }
    if (word === 'chart') return { text: chartText(countsOf(await read($, calls))) }
    if (word === '') return { text: await openAt($, null) }
    if (!isTab(word)) return { text: `No tab is named ${word}. The tabs: ${TABS.map(one => one.id).join(', ')}.` }
    return { text: await openAt($, word) }
  })

  // Every finished tool call, for the heat map and the bars. A failure to
  // record replays what next settled to, so the call is never affected.
  on('tool.call', async ($, e, next) => {
    const at = await $.clock.now()
    const result = await next(e)
    const call: GalleryCall = { at, tool: e.tool, id: e.tool_use_id ?? null, ms: (await $.clock.now()) - at, summary: summaryOf(e as Record<string, unknown>) }
    await update($, calls, kept => [...kept.slice(-(MAX_CALLS - 1)), call])
    if (call.id !== null) await noteDuration($, call.id, call.ms)
    return result
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const columns = e.props.bodyColumns
    const width = Math.min(MAX_LIFE_COLUMNS, Math.max(10, columns - 2))
    if (life.width !== width) life = seedLife(width, LIFE_ROWS * 2)
    shown = await read($, tab)
    const model: GalleryModel = {
      tab: shown,
      isPlaying: timer !== null,
      refusal,
      calls: await read($, calls),
      isBandShown: await read($, isBandShown),
      areSitesOn: await readSites($),
      life,
      frame,
      now: await $.clock.now(),
      columns,
    }
    const act: GalleryActions = {
      pick: chosen => void pick($, chosen),
      togglePlay: () => (timer === null ? start($) : stop($)),
      step: () => void stepOnce($),
      toggleBand: () => void update($, isBandShown, now => !now),
      toggleSites: () => void setSites($, 'toggle'),
    }
    if (e.surface === 'terminal') return drawTerminal($.ui.resolve(e), model, act)
    return drawRemote($.ui.resolve(e), model, act)
  })

  registerSites(on, options)

  // The band: the gallery's line while it is shown, and never over a survey.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, isBandShown))) return next(e)
    return drawBand($.ui.resolve(e), await read($, calls))
  })
}
