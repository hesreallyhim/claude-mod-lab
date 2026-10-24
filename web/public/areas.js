// The explorer's three areas, each a tab in the header: the $ reference (Mod
// API), the live views of the connected session (Session), and the person's own
// mods (Build). Every route belongs to one, or to none for the home page; the
// left column lists the current area's pages, and the feed shows in Session
// alone. A Session page names the parts of $ it shows, and their reference pages
// name it back.

import { el } from './view.js'

/**
 * Each area: its tab's label, the route its tab opens first, and the pages its
 * left column lists as [route, label]. Mod API's column is the reference tree.
 */
export const AREAS = [
  { id: 'api', label: 'Mod API', home: '#/api', pages: [] },
  {
    id: 'session',
    label: 'Session',
    home: '#/turns',
    pages: [
      ['turns', 'Turn timeline'],
      ['streams', 'Streams'],
      ['xray', 'Conversation X-ray'],
      ['ledger', 'Context ledger'],
      ['workbench', 'Model workbench'],
      ['agents', 'Agents'],
      ['keys', 'Prompt box'],
      ['config', 'Settings'],
    ],
  },
  {
    id: 'build',
    label: 'Build',
    home: '#/learn',
    pages: [
      ['learn', 'Lessons'],
      ['workshop', 'Workshop'],
      ['sandbox', 'Sandbox'],
      ['gallery', 'Gallery'],
      ['mods', 'Installed mods'],
    ],
  },
]

const API_ROUTES = new Set(['api', '$', 'event', 'type', 'probes'])

/**
 * The events and methods each Session page shows, as the lab's hooks and probes
 * behind it use them (mods/mod-lab/hooks).
 * @type {Record<string, readonly string[]>}
 */
export const USES = {
  turns: ['turn.start', 'turn.step', 'turn.complete', 'tool.call'],
  streams: ['process.spawn', 'turn.step'],
  xray: ['session.append', 'session.compact'],
  ledger: ['prompt.context', 'tool.describe', 'prompt.attachment'],
  workbench: ['model.complete', 'model.fork'],
  agents: ['agent.spawn', 'agent.offer'],
  keys: ['prompt.edit', 'prompt.change', 'prompt.fill', 'prompt.suggest'],
  config: ['config.list', 'config.set', 'config.describe'],
}

/** A hash's route: its first part, which names the page, and the rest, the page's target. */
export function routeOf(hash) {
  const [kind, ...rest] = decodeURIComponent(hash.replace(/^#\/?/, '')).split('/')
  return { kind, target: rest.join('/') }
}

/** The area a route's first part belongs to: `api`, `session`, `build`, or `home` for the home page and unknown routes. */
export function areaOf(kind) {
  if (API_ROUTES.has(kind)) return 'api'
  return AREAS.find(area => area.pages.some(([route]) => route === kind))?.id ?? 'home'
}

/** The Session pages that show an event or method, as [route, label]. */
export function pagesShowing(name) {
  const session = AREAS.find(area => area.id === 'session')
  return (session?.pages ?? []).filter(([route]) => USES[route]?.includes(name))
}

/**
 * A Session or Build page's title in the head the Mod API's sheets have
 * (lab.css): a kicker naming the area above it, and the rule beneath. The home
 * page belongs to no area, so its head has the title alone.
 */
export function pageHead(title) {
  const area = AREAS.find(one => one.id === areaOf(routeOf(location.hash).kind))
  return el(
    'header',
    { class: 'sheet-head page-head' },
    area === undefined ? null : el('p', { class: 'kicker' }, area.label),
    el('h1', {}, title),
  )
}

/** The route each area showed last, so its tab returns there. */
const latest = new Map()

/** Marks the current area on the page and in the header's tabs, and remembers the route as the area's latest. */
export function renderAreas() {
  const current = areaOf(routeOf(location.hash).kind)
  if (current !== 'home') latest.set(current, location.hash)
  document.body.dataset.area = current
  document.getElementById('areas').replaceChildren(
    ...AREAS.map(area =>
      el(
        'a',
        // The current area's tab goes to the area's first page; another's, back to where it was left.
        {
          href: area.id === current ? area.home : (latest.get(area.id) ?? area.home),
          'aria-current': area.id === current ? 'page' : null,
        },
        area.label,
      ),
    ),
  )
}
