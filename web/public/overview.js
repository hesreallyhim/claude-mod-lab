// The Mod API area's first page: what $ is, a figure of the path a call on $
// takes, the catalogue (a tile per noun and per event namespace, each narrowing
// the index on the left to it), the latest run as an example, and where the
// reference was read from.

import { manLine, probesFor } from './reference.js'
import { runCard } from './runs.js'
import { setFilter } from './tree.js'
import { el } from './view.js'

/** One step of the figure: what it is, above the code that names it. */
function node(kind, label, code) {
  return el('li', { class: `node ${kind}` }, el('span', { class: 'node-label' }, label), el('code', {}, code))
}

/** An arrow between two steps, with the pulse that runs along it (overview.css). */
function edge(text) {
  return el('li', { class: 'edge', 'aria-hidden': 'true' }, el('code', {}, text), el('span', { class: 'pulse' }))
}

function figure() {
  return el(
    'figure',
    { class: 'diagram' },
    el(
      'ol',
      { class: 'path', 'aria-label': 'The path of a call on $' },
      node('caller', 'a hook of yours calls', '$.session.cwd()'),
      edge('dispatches'),
      node('event', 'the event', 'session.cwd'),
      edge('through'),
      node('hooks', "every other plugin's hooks", "on('session.cwd', …)"),
      edge('down to'),
      node('engine', 'the engine', 'answers'),
    ),
    el(
      'figcaption',
      {},
      el('span', { class: 'fig-no' }, 'Fig. 1'),
      ' A call on $ is itself an event. It passes through the hooks of every plugin except the hook that made the call, and the engine answers at the bottom. The lab records each dispatch its probes make: the event, the input the hooks saw, what came back, and each link of the chain that answered.',
    ),
  )
}

/** A tile in the catalogue: a button that narrows the index to its prefix. */
function tile(state, prefix, name, line) {
  return el(
    'button',
    {
      type: 'button',
      class: 'tile',
      title: `Filter the reference to ${prefix}`,
      onclick: () => setFilter(state, prefix),
    },
    el('span', { class: 'tile-name' }, name),
    el('span', { class: 'tile-line' }, line),
  )
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`

/** The nouns and namespaces as tiles, in alphabetical order as the index lists them. */
function catalogue(state) {
  const catalog = state.catalog
  if (catalog === null) return null
  const byName = (a, b) => a.localeCompare(b)
  const nounTiles = [...catalog.nouns]
    .sort((a, b) => byName(a.name, b.name))
    .map(noun => {
      const probed = noun.members.filter(member => probesFor(state, `${noun.name}.${member.name}`).length > 0).length
      const line = `${plural(noun.members.length, 'member')}${probed === 0 ? '' : `, ${probed} with a probe`}`
      return tile(state, `${noun.name}.`, `$.${noun.name}`, line)
    })
  const namespaces = new Map()
  for (const event of catalog.events) namespaces.set(event.namespace, (namespaces.get(event.namespace) ?? 0) + 1)
  const eventTiles = [...namespaces]
    .sort(([a], [b]) => byName(a, b))
    .map(([namespace, count]) => tile(state, `${namespace}.`, `${namespace}.*`, plural(count, 'event')))
  return el(
    'section',
    { class: 'catalogue' },
    el('h2', {}, 'The catalogue'),
    el('p', { class: 'note' }, 'Each tile narrows the index on the left to its noun or namespace.'),
    el('h3', {}, `Nouns on $ (${catalog.nouns.length})`),
    el('div', { class: 'tiles' }, nounTiles),
    el('h3', {}, `Engine events, by namespace (${catalog.events.length})`),
    el('div', { class: 'tiles events' }, eventTiles),
  )
}

/** The reference's counts, as readouts beside the title. */
function readouts(state) {
  const catalog = state.catalog
  if (catalog === null) return null
  const members = catalog.nouns.reduce((sum, noun) => sum + noun.members.length, 0)
  const counts = [
    ['nouns on $', catalog.nouns.length],
    ['members', members],
    ['engine events', catalog.events.length],
    ['declared types', catalog.typeNames.length],
    ['probes', state.session?.probes.length ?? 0],
  ]
  return el(
    'dl',
    { class: 'readouts' },
    counts.map(([label, value]) => el('div', {}, el('dt', {}, label), el('dd', {}, String(value)))),
  )
}

export function apiPage(ctx) {
  const { state } = ctx
  const latest = [...state.runs].reverse().find(run => run.dispatches?.length > 0)
  const catalog = state.catalog
  return el(
    'div',
    { class: 'page sheet overview' },
    manLine(state, '$', '7'),
    el(
      'header',
      { class: 'sheet-head' },
      el('p', { class: 'kicker' }, 'Mod API · the reference'),
      el('h1', {}, 'What ', el('code', {}, '$'), ' is'),
      el(
        'p',
        { class: 'lede' },
        'Every hook a mod registers has the shape ',
        el('code', {}, '($, e, next)'),
        '. ',
        el('code', {}, '$'),
        ' is the engine interface: its nouns (',
        el('code', {}, '$.session'),
        ', ',
        el('code', {}, '$.fs'),
        ', ',
        el('code', {}, '$.ui'),
        ' and the rest) are the only way a mod reaches anything outside its own environment, which has no DOM and no Node.',
      ),
      readouts(state),
    ),
    figure(),
    catalogue(state),
    latest === undefined
      ? null
      : el(
          'section',
          { class: 'latest' },
          el('h2', {}, 'The latest run, as an example'),
          el(
            'div',
            { class: 'term window' },
            el('p', { class: 'window-head' }, el('span', {}, `run #${latest.seq ?? ''}`), el('span', {}, latest.from)),
            el('div', { class: 'window-body' }, runCard(state, latest)),
          ),
        ),
    catalog === null
      ? el('p', { class: 'error' }, state.catalogError ?? 'loading the reference')
      : el(
          'p',
          { class: 'colophon' },
          'Reference read from ',
          el('code', {}, catalog.path),
          ` (${catalog.found}): ${catalog.nouns.length} nouns on $, ${catalog.events.length} engine events, ${catalog.typeNames.length} declared types.`,
        ),
  )
}
