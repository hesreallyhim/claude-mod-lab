// The home page: the explorer's three areas, each with what it is
// for and one thing to try there; and how to connect a session when
// none is.

import { AREAS } from './areas.js'
import { bubbleUp } from './bubbles.js'
import { cellGlow } from './cell-glow.js'
import { el } from './view.js'

/** What each area is for, in a sentence or two. */
const ABOUT = {
  api: "Every noun, method, event and type on $, read from your Claude Code's declarations. Run a method's probe in the session, or put an intercept on its event.",
  session:
    'Live views of the connected session: its turns, streams, stored rows, model input, model calls, agents, prompt box and settings, and what you can change for each one.',
  build:
    'Browse mod examples and lessons. Create a dedicated lesson workspace when you want to work through an exercise or use the Sandbox.',
}

const TOAST = 'Hello from the mod-lab!'
const DRAFT = 'A mod wrote this.'
const EDITED_DRAFT = 'A mod EDITED this.'
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

/** A numbered action with its own result, shared by the API and Session cards. */
function tryStep({ title, description, descriptionClass = '', label, disabled, run }) {
  const result = el('div', { class: 'result', 'aria-live': 'polite' })
  return el(
    'li',
    {},
    el('h3', {}, title),
    el('p', { class: descriptionClass }, description),
    el('button', { type: 'button', class: 'try-action', disabled, onclick: () => void run(result) }, label),
    result,
  )
}

/** Send, intercept, then repeat the same call: each action stays beside its explanation. */
function toastWalkthrough({ state, queueRun, sendCommand }) {
  const probe = (state.session?.probes ?? []).find(one => one.id === 'ui.toast')
  const ready = Boolean(state.session?.isConnected && probe !== undefined)
  const runToast = result => queueRun(probe.id, { [probe.params[0]?.name ?? 'text']: TOAST }, result)
  const steps = [
    {
      title: 'Send a toast',
      description: `Show “${TOAST}” in your session.`,
      label: 'Send toast',
      run: runToast,
    },
    {
      title: 'Intercept the message',
      description: `Rewrite the lab’s toast messages to say “${REWRITTEN}”.`,
      label: 'Enable intercept',
      run: result => sendCommand(INTERCEPT, result),
    },
    {
      title: 'See the change',
      description: 'Send the same toast again. This time, look for the rewritten message.',
      label: 'Send toast again',
      run: runToast,
    },
  ]
  return [
    ready
      ? null
      : el(
          'p',
          { class: 'try-hint' },
          state.session?.isConnected
            ? 'This session does not offer the toast probe. Reload the mod-lab plugin to try these steps.'
            : 'Connect a session to try these steps.',
        ),
    el(
      'ol',
      { class: 'try-steps' },
      steps.map(step => tryStep({ ...step, disabled: !ready })),
    ),
    el(
      'p',
      { class: 'try-footnote' },
      'The intercept stays active until cleared. ',
      el('a', { href: '#/$/ui.toast' }, 'View or clear it on $.ui.toast'),
      '.',
    ),
  ]
}

/** Keep each prompt action beside its code and result. */
function promptStep(ctx, probe, { title, text, mode, label }) {
  const ready = Boolean(ctx.state.session?.isConnected && probe !== undefined)
  const args = { text, mode }
  return tryStep({
    title,
    descriptionClass: 'step-code',
    description: el(
      'code',
      {},
      ready
        ? `$.prompt.fill({ text: ${JSON.stringify(text)}, mode: "${mode}" })`
        : `/mod-lab prompt.fill ${JSON.stringify(args)}`,
    ),
    label,
    disabled: !ready,
    run: result => ctx.queueRun(probe.id, args, result),
  })
}

/**
 * One thing to try in an area. Live actions are available when a session
 * supplies their probes; otherwise the page explains how to get started.
 */
function tryIt(ctx, area) {
  const { state } = ctx
  if (area === 'api') return toastWalkthrough(ctx)
  if (area === 'session') {
    const probe = (state.session?.probes ?? []).find(one => one.id === 'prompt.fill')
    const page = el('a', { href: '#/keys' }, 'Prompt box')
    const after = el(
      'p',
      { class: 'try-footnote' },
      "The text lands in the session's prompt box as a draft. The ",
      page,
      ' page shows each key you press there as the event a mod sees.',
    )
    return [
      state.session?.isConnected ? null : el('p', { class: 'try-hint' }, 'Connect a session to try these steps.'),
      el(
        'ol',
        { class: 'try-steps' },
        promptStep(ctx, probe, {
          title: 'Write into the prompt box',
          text: DRAFT,
          mode: 'append',
          label: 'Fill prompt box',
        }),
        promptStep(ctx, probe, {
          title: 'Edit the prompt box',
          text: EDITED_DRAFT,
          mode: 'replace',
          label: 'Edit prompt box',
        }),
      ),
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
    el('div', { class: 'try' }, el('p', { class: 'try-label' }, 'Try it'), tryIt(ctx, area.id)),
  )
}

const SVG = 'http://www.w3.org/2000/svg'

/**
 * The brand's flask (assets/brand/src/cells.mjs) with bubbles in its liquid and rising from its neck,
 * one unit per cell: 9 cells wide, the flask 12 tall and the bubbles 8 above it. The bubbles drawn
 * here are the still ones; bubbleUp sets them moving.
 */
function flask() {
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('viewBox', '0 -8 9 20')
  svg.setAttribute('aria-hidden', 'true')
  const parts = [
    ['flask-glass', 'M2 0h5v1H2zM2 1h1v3H2zM6 1h1v3H6zM1 4h1v1H1zM7 4h1v1H7zM0 5h1v6H0zM8 5h1v6H8zM1 11h7v1H1z'],
    ['flask-liquid', 'M1 7h7v4H1z'],
    ['flask-liquid flask-still', 'M4 -2h1v1H4zM5 -4h1v1H5zM3 -6h1v1H3zM5 -8h1v1H5z'],
    ['flask-fizz flask-still', 'M3 9h1v1H3zM5 8h1v1H5z'],
  ]
  for (const [name, d] of parts) {
    const path = document.createElementNS(SVG, 'path')
    path.setAttribute('class', name)
    path.setAttribute('d', d)
    svg.append(path)
  }
  bubbleUp(svg)
  return svg
}

/** The page's head: the flask and title on the cell matrix, which lights up under the pointer, and the lede. */
function hero() {
  const head = el(
    'header',
    { class: 'hero' },
    el(
      'div',
      { class: 'hero-title' },
      el('span', { class: 'hero-flask' }, flask()),
      el('h1', {}, 'claude-mod-lab explorer'),
    ),
    el(
      'p',
      { class: 'lede' },
      'A complete workbench for exploring the mod API, observing how mods work in a live session, and learning how to build mods of your own.',
    ),
  )
  cellGlow(head)
  return head
}

export function homePage(ctx) {
  const { state } = ctx
  const session = state.session
  return el(
    'div',
    { class: 'page home' },
    hero(),
    session?.isConnected
      ? el(
          'dl',
          { class: 'home-connection', 'aria-label': 'Connected session' },
          el(
            'div',
            {},
            el('dt', { class: 'connection-state' }, 'Connected to session'),
            el('dd', {}, String(session.facts.id ?? '').slice(0, 8)),
          ),
          el('div', {}, el('dt', {}, 'Project'), el('dd', {}, session.facts.cwd)),
        )
      : el(
          'section',
          { class: 'home-connect' },
          el('h2', {}, 'Connect a session'),
          el('p', {}, 'In your project directory, run:'),
          el('pre', {}, 'npx claude-mod-lab run'),
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
