// Lessons: the READMEs of learn/, drawn here so their /mod-lab commands can run
// in the connected session, and the checker's report on the learner's folder,
// which the server sends again each time the folder is saved while the page is
// open. A lesson whose folder is not there yet is started from its page.

import { api, pageToken } from './api.js'
import { pageHead } from './areas.js'
import { markdown } from './markdown.js'
import { lessonCatalog, lessonProgress, lessonsGuide } from './lesson-catalog.js'
import { lessonLocation, lessonSetup } from './lesson-setup.js'
import { helpButton } from './page.js'
import { probesHint, queueInline } from './runs.js'
import { needsNewer, sessionVersion } from './versions.js'
import { clockTime, el, textPreview } from './view.js'
import { perCall } from './workbench.js'

let lessonsList = []

/** The server's checks of the open lesson's folder; closed when another page opens. */
let watching = null
let watchGeneration = 0

export function stopWatching() {
  watchGeneration++
  watching?.close()
  watching = null
}

function lessonForPath(path) {
  return lessonsList.find(lesson => lesson.path === path.replace(/\/$/, ''))
}

/** A README's href as a route of this page, or null where the page has nothing to show for it. */
function lessonLink(base) {
  return href => {
    if (/^https?:/.test(href)) return href
    if (href.startsWith('#')) return null
    const parts = `${base}/${href.split('#')[0]}`.split('/')
    const path = []
    for (const part of parts) {
      if (part === '..') path.pop()
      else if (part !== '.' && part !== '') path.push(part)
    }
    const joined = path.join('/')
    const lesson = lessonForPath(joined)
    if (lesson !== undefined) return `#/learn/${lesson.id}`
    if (joined === 'learn' || joined === 'learn/challenges' || joined === 'learn/tutorials') return '#/learn'
    return null
  }
}

/**
 * A button beside a `/mod-lab ...` command in a lesson, which does it in the
 * session: a probe as a run, kept with the others, and anything else as the
 * command, its answer shown beside the button.
 */
function liveCommand(state, text) {
  const match = /^\/mod-lab (\S+)\s*(.*)$/.exec(text.trim())
  if (match === null || !state.session?.isConnected) return null
  const [, head, rest] = match
  const marker = el('span', { class: 'inline-result' })
  const button = (label, path, body) =>
    el(
      'span',
      { 'data-lesson-command': text.trim() },
      ' ',
      el(
        'button',
        { type: 'button', class: 'inline', onclick: () => void queueInline(state, path, body, marker) },
        label,
      ),
      marker,
    )
  const probe = (state.session.probes ?? []).find(one => one.id === head)
  if (probe === undefined)
    return button(head === 'intercept' ? 'set' : 'run', '/api/command', { text: `${head} ${rest}` })
  const args = rest === '' || probe.params.length === 0 ? {} : { [probe.params[0].name]: rest }
  return button('run', '/api/run', { probe: probe.id, args })
}

export async function lessonsPage(ctx) {
  const { state } = ctx
  const { lessons, index, lessonWorkspace } = await api('/api/lessons')
  lessonsList = lessons
  const guide = helpButton(
    'How lessons work',
    ...markdown(lessonsGuide(index), { link: lessonLink('learn'), code: text => liveCommand(state, text) }),
  )
  return el(
    'div',
    { class: 'page' },
    pageHead('Lessons', guide),
    el(
      'p',
      { class: 'lede' },
      'Build mods step by step in the tutorials, then try a challenge on its own. Checks update as you save.',
    ),
    el('p', { class: 'muted' }, 'Take the tutorials in order; the challenges assume them.'),
    el(
      'p',
      {},
      'Starting a lesson creates its mod in your lesson workspace. It appears in ',
      el('a', { href: '#/workshop' }, 'Workshop'),
      ' from the start, where you can turn it on or off as you work.',
    ),
    lessonWorkspace ? lessonLocation(lessonWorkspace) : lessonSetup(),
    lessonProgress(lessons, sessionVersion(state.session)),
    lessonCatalog(lessons, sessionVersion(state.session)),
  )
}

/** The checker's report, and a line saying when it ran or that it is running. */
function reportView(check, note) {
  return [
    note === null ? null : el('p', { class: 'muted' }, note),
    check?.progress
      ? el(
          'p',
          { 'data-lesson-passed': check.progress.passed, 'data-lesson-total': check.progress.total },
          `${check.progress.passed} of ${check.progress.total} checked steps pass.`,
        )
      : null,
    check === null ? null : el('div', { class: 'answer' }, textPreview('Lesson check report', check.report)),
  ]
}

/**
 * Starts the working mod and copies its reference solution, or adds just the
 * missing reference for a mod that was already started.
 */
function startBox(lesson, id) {
  const box = el('div', { class: 'component-actions' })
  const start = async () => {
    box.replaceChildren(el('p', { class: 'muted' }, 'Preparing lesson files…'))
    try {
      const { made, solutionFolder } = await api(`/api/lesson/start?id=${encodeURIComponent(id)}`, {
        method: 'POST',
        body: JSON.stringify({ lessonWorkspace: lesson.lessonWorkspace }),
      })
      box.replaceChildren(
        el(
          'p',
          { class: 'muted' },
          made === null
            ? `${lesson.folder} is already there.`
            : `${made === 'starter' ? "Copied the lesson's starter to" : 'Made'} ${lesson.folder}; the session loads it.`,
        ),
        ...(solutionFolder ? [solutionLocation(solutionFolder)] : []),
      )
    } catch (error) {
      box.replaceChildren(el('p', { class: 'error' }, error.message))
    }
  }
  box.append(
    el(
      'button',
      { type: 'button', 'data-action': 'start-lesson', onclick: () => void start() },
      lesson.isStarted
        ? 'Copy reference solution'
        : lesson.hasStarter
          ? `Start from the lesson's starter in ${lesson.folder}`
          : `Start: make ${lesson.folder} with its manifest`,
    ),
  )
  return box
}

function solutionLocation(folder) {
  return el(
    'p',
    { class: 'muted' },
    'Reference solution: ',
    el('code', {}, folder),
    '. Open these files to compare with your work; the session does not load them.',
  )
}

/** Setup or the actions available for the lesson workspace shown on the page. */
function lessonActions(lesson, id, check) {
  if (!lesson.lessonWorkspace) return lessonSetup()
  return [
    lessonLocation(lesson.lessonWorkspace),
    el('button', { type: 'button', class: 'quiet', onclick: () => void check() }, 'Check now'),
    lesson.hasSolution ? solutionLocation(lesson.solutionFolder) : null,
    lesson.isStarted && lesson.hasSolution ? null : startBox(lesson, id),
  ]
}

export async function lessonPage(ctx, id) {
  const { state } = ctx
  stopWatching()
  const generation = watchGeneration
  if (lessonsList.length === 0) lessonsList = (await api('/api/lessons')).lessons
  const lesson = await api(`/api/lesson?id=${encodeURIComponent(id)}`)
  if (generation !== watchGeneration) return el('div')
  const lastNote = check => (check?.progress ? `Last checked at ${clockTime(check.progress.at)}.` : null)
  const report = el('div', { class: 'result' }, reportView(lesson.check, lastNote(lesson.check)))
  const show = (check, note) => report.replaceChildren(...reportView(check, note).filter(part => part !== null))
  const check = async () => {
    show(null, `checking ${lesson.folder}`)
    try {
      const checked = await api(`/api/check?id=${encodeURIComponent(id)}`, {
        method: 'POST',
        body: JSON.stringify({ lessonWorkspace: lesson.lessonWorkspace }),
      })
      show(checked, lastNote(checked))
    } catch (error) {
      report.replaceChildren(el('p', { class: 'error' }, error.message))
    }
  }
  // The server checks the folder on each save while this page is open; another page closes it.
  if (lesson.lessonWorkspace) {
    watching = new EventSource(
      `/api/lesson/watch?id=${encodeURIComponent(id)}&lessonWorkspace=${encodeURIComponent(lesson.lessonWorkspace)}&token=${encodeURIComponent(pageToken())}`,
    )
    watching.addEventListener('checking', () => show(null, `checking ${lesson.folder}`))
    watching.addEventListener('checked', message => {
      const checked = JSON.parse(message.data)
      show(checked, lastNote(checked))
    })
    watching.addEventListener('failed', message =>
      report.replaceChildren(el('p', { class: 'error' }, JSON.parse(message.data).error)),
    )
  }
  const content = markdown(lesson.readme, { link: lessonLink(lesson.path), code: text => liveCommand(state, text) })
  const title = content[0]?.nodeName === 'H1' ? content.shift() : el('h1', {}, lesson.title)
  return el(
    'div',
    { class: 'page lesson', 'data-lesson': id },
    el(
      'p',
      { class: 'kicker' },
      el('a', { href: '#/learn' }, 'Lessons'),
      lesson.lessonWorkspace ? ` · ${lesson.folder}` : null,
    ),
    title,
    lessonActions(lesson, id, check),
    needsNewer(lesson.minVersion, sessionVersion(state.session))
      ? el('p', { class: 'muted' }, 'This lesson needs a newer version of Claude Code.')
      : null,
    report,
    lesson.lessonWorkspace ? probesHint(state) : null,
    perCall(state.mirror.spend, lesson.mod) === null
      ? null
      : el(
          'p',
          { class: 'answer' },
          perCall(state.mirror.spend, lesson.mod),
          ' ',
          el('a', { href: '#/workbench' }, 'each call'),
        ),
    content,
  )
}
