// The home page: the explorer's three areas, numbered, each with what it is
// for, its pages and one thing to try there; and how to connect a session when
// none is.

import { AREAS, pageHead } from './areas.js'
import { interceptState } from './intercepts.js'
import { el } from './view.js'

/** What each area is for, in a sentence or two. */
const ABOUT = {
  api: "Every noun, method, event and type on $, read from your Claude Code's declarations. Run a method's probe in the session, or put an intercept on its event.",
  session:
    'Live views of the connected session: its turns, streams, stored rows, model input, model calls, agents, prompt box and settings, and what you can change for each one.',
  build:
    'Browse mod templates and lessons. Create a dedicated lesson workspace when you want to work through an exercise or use the Sandbox.',
}

/** The Mod API area lists its two pages; the reference tree is its own left column. */
const API_PAGES = [
  ['api', 'What $ is'],
  ['probes', 'All probes'],
]

const TOAST = 'Hello from the mod-lab!'
const DRAFT = 'Hello from the explorer: a mod wrote this.'
/** The first lesson's pane, as its README draws it. */
const STOPWATCH = [
  '███   ███ ███',
  '█ █ █ █ █ █  ',
  '█ █   █ █ ███',
  '█ █ █ █ █   █',
  '███   ███ ███',
  '',
  '0:05  running',
  '',
  '[ +1 s ]  [ Stop ]',
].join('\n')
const REWRITTEN = 'INTERCEPTION!!!'
/** The words after /mod-lab that set the card's intercept: the lab's own ui.toast calls get another text. */
const INTERCEPT = `intercept ui.toast rewrite lab ${JSON.stringify({ text: REWRITTEN })}`

/** The first lesson, where a newcomer starts. */
const firstLesson = () => el('a', { href: '#/learn/tick' }, 'A stopwatch you can click')

/**
 * One thing to try in an area. The Mod API's runs a probe in the session when
 * one is connected, and otherwise says what to type in one.
 */
function tryIt(ctx, area) {
  const { state, queueRun, sendCommand } = ctx
  if (area === 'api') {
    const probe = (state.session?.probes ?? []).find(one => one.id === 'ui.toast')
    const result = el('div', { class: 'result' })
    const status = el('div', { class: 'result' })
    const call = el('code', {}, `$.ui.toast(${JSON.stringify(TOAST)})`)
    const page = el('a', { href: '#/$/ui.toast' }, el('code', {}, '$.ui.toast'))
    if (state.session?.isConnected && probe !== undefined)
      return [
        el('p', { class: 'step' }, 'Add a toast:'),
        el('p', { class: 'step-code' }, call),
        el(
          'p',
          {},
          el(
            'button',
            {
              type: 'button',
              onclick: () => void queueRun(probe.id, { [probe.params[0]?.name ?? 'text']: TOAST }, result),
            },
            'Run in your session',
          ),
        ),
        result,
        el(
          'p',
          { class: 'step' },
          'Then enable an ',
          el(
            'button',
            { type: 'button', class: 'quiet', onclick: () => void sendCommand(INTERCEPT, status) },
            'intercept',
          ),
          ` that rewrites the text to ${JSON.stringify(REWRITTEN)}.`,
        ),
        status,
        interceptState(state, 'ui.toast'),
        el(
          'p',
          { class: 'step' },
          'Try running the toast again and see what it renders. Every kind of intercept is on the page of ',
          page,
          '.',
        ),
      ]
    return [
      el('p', { class: 'step' }, 'In a connected session, add a toast:'),
      el('p', { class: 'step-code' }, el('code', {}, `/mod-lab ui.toast ${TOAST}`)),
      el('p', { class: 'step' }, `Then enable an intercept that rewrites the text to ${JSON.stringify(REWRITTEN)}:`),
      el('p', { class: 'step-code' }, el('code', {}, `/mod-lab ${INTERCEPT}`)),
      el(
        'p',
        { class: 'step' },
        'Try running the toast again and see what it renders. Every kind of intercept is on the page of ',
        page,
        '.',
      ),
    ]
  }
  if (area === 'session') {
    const probe = (state.session?.probes ?? []).find(one => one.id === 'prompt.fill')
    const result = el('div', { class: 'result' })
    const page = el('a', { href: '#/keys' }, 'Prompt box')
    const after = el(
      'p',
      { class: 'step' },
      "The text lands in the session's prompt box as a draft. The ",
      page,
      ' page shows each key you press there as the event a mod sees.',
    )
    if (state.session?.isConnected && probe !== undefined)
      return [
        el('p', { class: 'step' }, 'Write into the prompt box:'),
        el(
          'p',
          { class: 'step-code' },
          el('code', {}, `$.prompt.fill({ text: ${JSON.stringify(DRAFT)}, mode: "append" })`),
        ),
        el(
          'p',
          {},
          el(
            'button',
            { type: 'button', onclick: () => void queueRun(probe.id, { text: DRAFT, mode: 'append' }, result) },
            'Run in your session',
          ),
        ),
        result,
        after,
      ]
    return [
      el('p', { class: 'step' }, 'In a connected session, write into the prompt box:'),
      el('p', { class: 'step-code' }, el('code', {}, `/mod-lab prompt.fill ${DRAFT}`)),
      after,
    ]
  }
  return [
    el(
      'figure',
      { class: 'pane-preview', 'aria-label': 'the stopwatch pane: 0:05, running, with +1 s and Stop buttons' },
      el('figcaption', {}, 'tick'),
      el('pre', { 'aria-hidden': 'true' }, STOPWATCH),
    ),
    el('p', {}, 'Start the first lesson, ', firstLesson(), ': a basic mod with just a few lines.'),
  ]
}

function areaCard(ctx, area) {
  return el(
    'section',
    { class: 'card' },
    el('h2', {}, el('a', { href: area.home }, area.label)),
    el('p', {}, ABOUT[area.id]),
    el(
      'ul',
      {},
      (area.id === 'api' ? API_PAGES : area.pages).map(([page, label]) =>
        el('li', {}, el('a', { href: `#/${page}` }, label)),
      ),
    ),
    el('div', { class: 'try' }, el('p', { class: 'try-label' }, 'Try it'), tryIt(ctx, area.id)),
  )
}

export function homePage(ctx) {
  const { state } = ctx
  const session = state.session
  return el(
    'div',
    { class: 'page home' },
    pageHead('claude-mod-lab explorer'),
    el(
      'p',
      { class: 'lede' },
      'Inspect your Claude Code session, try the mod ',
      el('code', {}, '$'),
      ' API, and build mods with optional guided lessons.',
    ),
    session?.isConnected
      ? el(
          'p',
          { class: 'muted' },
          `Connected to session ${String(session.facts.id ?? '').slice(0, 8)} in ${session.facts.cwd}.`,
        )
      : el(
          'section',
          {},
          el('h2', {}, 'Connect a session'),
          el('p', {}, 'In your project directory, run:'),
          el('pre', {}, 'npx claude-mod-lab@alpha run'),
          el(
            'p',
            {},
            'This starts Claude Code with the lab and connects it to the explorer. It creates no lesson files in your project.',
          ),
          el(
            'p',
            { class: 'muted' },
            'If the lab is already installed from its marketplace, a plain claude session can connect too. You can browse lessons before connecting.',
          ),
        ),
    el(
      'div',
      { class: 'areas-grid' },
      AREAS.map(area => areaCard(ctx, area)),
    ),
    notice(),
  )
}

/** Who makes the explorer, where its declarations come from, and where the project lives. */
function notice() {
  return el(
    'footer',
    { class: 'notice muted' },
    el(
      'p',
      {},
      'This is an independent project and has no affiliation with Anthropic. The mod API type declarations that appear on this site are generated from files produced locally by the Claude Code application, and are not distributed with this software.',
    ),
    el(
      'p',
      {},
      'If you wish to view the source code or license information, leave any feedback, support the author, or make any other contributions to this project, you are encouraged to visit the GitHub repository at ',
      el(
        'a',
        { href: 'https://github.com/hesreallyhim/claude-mod-lab', target: '_blank', rel: 'noopener' },
        'hesreallyhim/claude-mod-lab',
      ),
      '.',
    ),
  )
}
