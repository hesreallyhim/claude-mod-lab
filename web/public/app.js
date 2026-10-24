// The explorer page: the header with its three areas (areas.js), the current
// area's pages or the $ reference on the left, the page in the middle, and in
// the Session area the session's runs, events and intercepted calls on the
// right as they arrive.

import { agentsPage, refreshAgents } from './agents.js'
import { api, pageToken } from './api.js'
import { refreshComponentCommands, resetComponentCommands } from './components.js'
import { pageHead, renderAreas, routeOf } from './areas.js'
import { galleryPage } from './gallery.js'
import { el } from './view.js'
import { refreshWorkbench, workbenchPage } from './workbench.js'
import { refreshCompaction } from './compaction.js'
import { refreshStreams, streamsPage } from './streams.js'
import { keysPage, refreshKeys } from './keys.js'
import { configPage, refreshConfig } from './config.js'
import { sandboxPage } from './sandbox.js'
import { workshopPage } from './workshop.js'
import { refreshXray, xrayPage } from './xray.js'
import { homePage } from './home.js'
import { controls, lede, notes } from './page.js'
import { apiPage, eventPage, manLine, memberPage, renderTree, seenOnLine, typePage, usesLine } from './reference.js'
import { probeForm, probesHint, queueRun, runRow, sendCommand, updateJob } from './runs.js'
import { refreshCensus, refreshInterceptState, refreshInterceptStatus, tapRow } from './intercepts.js'
import { turnsPage } from './turns.js'
import { modsPage } from './mods.js'
import { lessonPage, lessonsPage, stopWatching } from './lessons.js'
import { prependToFeed, refreshTrace, renderFeed } from './feed.js'
import { engineText, sessionVersion, updateText } from './versions.js'

/** What each mirrored value of the lab's state is before the session has sent it. */
const MIRROR_DEFAULTS = {
  intercepts: [],
  spend: { calls: [], totals: {} },
  agents: { types: [], runs: [], hidden: [], route: null },
  rows: { rows: [] },
  compactor: { keep: null, compactions: [] },
  keys: { rows: [] },
  config: [],
}

const state = {
  catalog: null,
  catalogError: null,
  typeNames: new Set(),
  session: null,
  // A bridge the server refused for its protocol number, with the message saying which side to update.
  mismatch: null,
  runs: [],
  traces: [],
  taps: [],
  // Values of the lab's state the bridge mirrors, by key.
  mirror: { ...MIRROR_DEFAULTS },
  jobs: new Map(),
  feed: 'runs',
  filter: '',
}

/** What the page modules are handed: the state, and the job queue's two calls on it. */
const ctx = {
  state,
  queueRun: (probe, args, target) => queueRun(state, probe, args, target),
  sendCommand: (text, target) => sendCommand(state, text, target),
}

// Header

function sessionFact(label, value) {
  return el(
    'span',
    { class: 'tip-fact' },
    el('span', { class: 'tip-label' }, label),
    el('span', { class: 'tip-value' }, value),
  )
}

function renderHeader() {
  refreshInterceptStatus(state)
  const pill = document.getElementById('session')
  const text = document.getElementById('session-text')
  const where = document.getElementById('session-where')
  const session = state.session
  if (state.mismatch !== null && !session?.isConnected) {
    text.textContent = 'no session connected'
    where.textContent = state.mismatch.message
    pill.dataset.state = 'off'
  } else if (session === null) {
    text.textContent = 'no session connected'
    where.textContent = 'Run npx claude-mod-lab@alpha run in your project to connect a session.'
    pill.dataset.state = 'off'
  } else {
    text.textContent = session.isConnected ? 'session connected' : 'session not polling'
    where.replaceChildren(
      sessionFact('Workspace', session.facts.cwd ?? 'Not reported'),
      sessionFact('Session ID', String(session.facts.id ?? 'Not reported')),
    )
    pill.dataset.state = session.isConnected ? 'on' : 'stale'
  }
  renderEngine(session)
  renderReference(session)
}

function renderReference(session) {
  const reference = document.getElementById('reference')
  if (state.catalog !== null) {
    const sessionRuns = session?.facts.version ?? null
    const isSame = sessionRuns !== null && sessionRuns === state.catalog.version
    // Where the reference is the session's own version, the build line says it.
    reference.replaceChildren(
      ...(isSame
        ? []
        : [
            sessionFact('API reference', `Claude Code ${state.catalog.version ?? '(no version stated)'}`),
            sessionFact('Reference file', state.catalog.path),
          ]),
    )
  } else {
    reference.textContent = state.catalogError ?? ''
  }
}

/** The session's Claude Code version in the lamp's tooltip, the page's one place for the version number; below compat.json's floor, a word to update. */
function renderEngine(session) {
  const engine = document.getElementById('engine')
  const text = session === null ? null : engineText(session)
  const update = text === null || !session.compat ? null : updateText(sessionVersion(session), session.compat)
  engine.replaceChildren(
    ...(text === null ? [] : [sessionFact('Runtime', update === null ? text : `${text}. ${update}`)]),
  )
}

function ledgerPage() {
  const result = el('div', { class: 'result' })
  return el(
    'div',
    { class: 'page' },
    pageHead('Context ledger'),
    lede('What the model reads in this session, and where each part of it comes from.'),
    probesHint(state),
    controls(
      'Measure',
      el(
        'p',
        {},
        "The engine's count of each part of the context, as /context gives it; then the system prompt's sections, the tools, the context added to prompts and the messages injected, each by the plugin or engine that owns it.",
      ),
      el(
        'button',
        { type: 'button', onclick: () => void sendCommand(state, 'ledger', result) },
        'Measure in the session',
      ),
      result,
    ),
    notes(
      "The lab reads plugins' additions off the chains beneath it, so it can name the plugin each came from; the parts it has seen grow as the session runs. Plugins loaded above the lab are not in the chains it reads.",
    ),
  )
}

function probesPage() {
  const probes = state.session?.probes ?? []
  const nouns = [...new Set(probes.map(probe => probe.noun))]
  return el(
    'div',
    { class: 'page sheet single probes' },
    manLine(state, 'probes', '1'),
    el(
      'header',
      { class: 'sheet-head' },
      el('p', { class: 'kicker' }, `Mod API · ${probes.length} probes on ${nouns.length} nouns`),
      el('h1', {}, 'All probes'),
      el(
        'p',
        { class: 'lede' },
        'Each probe is a short function in mods/mod-lab/hooks/probes.ts that calls $ and returns what it got. The effect says what it does beyond reading. Open a noun to run its probes here, or follow a probe to its method.',
      ),
    ),
    probesHint(state),
    nouns.map(noun => {
      const mine = probes.filter(probe => probe.noun === noun)
      return el(
        'details',
        { class: 'noun' },
        el(
          'summary',
          {},
          el('span', { class: 'noun-name' }, `$.${noun}`),
          el('span', { class: 'count' }, String(mine.length)),
          el('span', { class: 'noun-probes' }, mine.map(probe => probe.id.replace(`${noun}.`, '')).join(' · ')),
        ),
        mine.map(probe => probeForm(state, probe)),
      )
    }),
  )
}

/** Each route's page, by the first part of the hash; the rest of it is the page's target. */
const ROUTES = new Map([
  ['api', apiPage],
  ['$', memberPage],
  ['event', eventPage],
  ['type', typePage],
  ['probes', probesPage],
  ['ledger', ledgerPage],
  ['turns', turnsPage],
  ['streams', streamsPage],
  ['keys', keysPage],
  ['config', configPage],
  ['sandbox', sandboxPage],
  ['workshop', workshopPage],
  // modsPage's second parameter says to read the mods again, so it is not handed the target.
  ['mods', ctx => modsPage(ctx)],
  ['gallery', galleryPage],
  ['workbench', workbenchPage],
  ['agents', agentsPage],
  ['xray', xrayPage],
  ['learn', (ctx, target) => (target === '' ? lessonsPage(ctx) : lessonPage(ctx, target))],
])

// Counts the renders asked for, so a page that was still loading when the route changed is dropped.
let renderAsked = 0

async function renderMain() {
  const asked = ++renderAsked
  stopWatching()
  renderAreas()
  const main = document.getElementById('main')
  const { kind, target } = routeOf(location.hash)
  const made = (ROUTES.get(kind) ?? homePage)(ctx, target)
  // A page that fills its live parts in a microtask must be in place by then, so only a promise is awaited.
  const page = made instanceof Promise ? await made : made
  if (asked !== renderAsked) return
  // The link across areas: a Session page's parts of $, or the Session pages that show a method or event.
  const cross = kind === '$' || kind === 'event' ? seenOnLine(target) : usesLine(state, kind)
  if (cross !== null) page.querySelector('h1')?.after(cross)
  main.replaceChildren(page)
}

function renderAll() {
  renderHeader()
  renderTree(state)
  void renderMain()
  renderFeed(state)
}

// Wiring

/**
 * Asks for the reference, and answers whether it changed. The server looks
 * for the declarations again when a session connects, so it is asked again then.
 */
async function loadCatalog() {
  try {
    const catalog = await api('/api/catalog')
    if (catalog.path === state.catalog?.path && catalog.version === state.catalog?.version) return false
    state.catalog = catalog
    state.catalogError = null
    state.typeNames = new Set(catalog.typeNames)
    return true
  } catch (error) {
    // Once the server has a reference it keeps one, so a failed request leaves the page's.
    if (state.catalog === null) state.catalogError = error.message
    return false
  }
}

function connect() {
  const source = new EventSource(`/api/stream?token=${encodeURIComponent(pageToken())}`)
  source.addEventListener('snapshot', message => {
    const snapshot = JSON.parse(message.data)
    state.session = snapshot.session
    state.mismatch = snapshot.mismatch ?? null
    state.runs = snapshot.runs
    state.traces = snapshot.traces
    state.taps = snapshot.taps ?? []
    state.mirror = { ...MIRROR_DEFAULTS, ...snapshot.mirror }
    resetComponentCommands()
    refreshComponentCommands(snapshot.session?.isConnected ? snapshot.mirror?.commands : null)
    state.jobs = new Map(snapshot.jobs.map(job => [job.id, job]))
    renderAll()
  })
  // The server repeats the session every few seconds; the middle pane is redrawn
  // only when it connects or goes away, so a half-typed probe form survives.
  source.addEventListener('session', message => {
    const was = state.session
    state.session = JSON.parse(message.data)
    renderHeader()
    if (
      was?.client !== state.session?.client ||
      was?.isConnected !== state.session?.isConnected ||
      was?.facts?.cwd !== state.session?.facts?.cwd ||
      was?.lab?.lessons !== state.session?.lab?.lessons
    ) {
      resetComponentCommands()
      renderTree(state)
      void renderMain()
    }
    if (state.session !== null && was?.client !== state.session.client) {
      void loadCatalog().then(isChanged => {
        renderHeader()
        if (isChanged) {
          renderTree(state)
          void renderMain()
        }
      })
    }
  })
  source.addEventListener('mismatch', message => {
    state.mismatch = JSON.parse(message.data)
    renderHeader()
  })
  source.addEventListener('run', message => {
    const run = JSON.parse(message.data)
    state.runs = [...state.runs, run].slice(-300)
    prependToFeed(state, 'runs', runRow(state, run))
    refreshStreams(state)
  })
  source.addEventListener('traces', message => {
    const rows = JSON.parse(message.data)
    state.traces = [...state.traces, ...rows].slice(-1000)
    refreshTrace(state)
    refreshStreams(state)
    // The timeline page follows the trace as it grows.
    if (document.querySelector('[data-live="turns"]') !== null) void renderMain()
  })
  source.addEventListener('taps', message => {
    const taps = JSON.parse(message.data)
    state.taps = [...state.taps, ...taps].slice(-500)
    if (state.feed === 'taps' && document.querySelector('#feed-body > .census') === null) renderFeed(state)
    else for (const tap of taps) prependToFeed(state, 'taps', tapRow(tap))
    refreshCensus(state)
    refreshInterceptState(state)
  })
  source.addEventListener('mirror', message => {
    const { key, value } = JSON.parse(message.data)
    state.mirror = { ...state.mirror, [key]: value }
    if (key === 'commands') refreshComponentCommands(value)
    if (key === 'intercepts') refreshInterceptState(state)
    if (key === 'agents') refreshAgents(state, ctx.sendCommand)
    if (key === 'rows') refreshXray(state)
    if (key === 'compactor') refreshCompaction(state)
    if (key === 'keys') refreshKeys(state)
    if (key === 'config') refreshConfig(state)
    renderHeader()
    refreshWorkbench(state)
  })
  source.addEventListener('job', message => {
    const job = JSON.parse(message.data)
    state.jobs.set(job.id, job)
    updateJob(state, job)
  })
  source.addEventListener('error', () => {
    refreshInterceptStatus({ ...state, session: { ...state.session, isConnected: false } })
    const pill = document.getElementById('session')
    document.getElementById('session-text').textContent = 'the explorer server is not answering'
    document.getElementById('session-where').textContent =
      'Reconnecting to the explorer server. Session details may be out of date.'
    pill.dataset.state = 'off'
  })
}

async function start() {
  await loadCatalog()
  document.getElementById('search').addEventListener('input', event => {
    state.filter = /** @type {HTMLInputElement} */ (event.currentTarget).value.trim().toLowerCase()
    renderTree(state)
  })
  document.getElementById('tab-runs').addEventListener('click', () => {
    state.feed = 'runs'
    renderFeed(state)
  })
  document.getElementById('tab-trace').addEventListener('click', () => {
    state.feed = 'trace'
    renderFeed(state)
  })
  document.getElementById('tab-taps').addEventListener('click', () => {
    state.feed = 'taps'
    renderFeed(state)
  })
  // As in a pager, / goes to the filter, from anywhere but a field.
  document.addEventListener('keydown', event => {
    if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return
    const target = /** @type {HTMLElement} */ (event.target)
    if (target.closest?.('input, textarea, select, [contenteditable]')) return
    const search = /** @type {HTMLInputElement | null} */ (document.getElementById('search'))
    if (search === null || search.offsetParent === null) return
    event.preventDefault()
    search.focus()
    search.select()
  })
  window.addEventListener('hashchange', () => {
    renderTree(state)
    void renderMain()
    // A new page opens at its title: focus alone would scroll the main column's top under the sticky header.
    window.scrollTo(0, 0)
    document.getElementById('main').focus({ preventScroll: true })
  })
  renderAll()
  connect()
}

void start()
