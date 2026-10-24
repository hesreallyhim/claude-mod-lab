// The lesson catalog uses metadata for one readable listing. Its guide keeps
// the README's instructions without repeating the hand-written catalog.

import { needsNewer } from './versions.js'
import { el } from './view.js'

function progressText(progress) {
  return progress === null ? 'not started' : `${progress.passed} of ${progress.total} checked steps pass`
}

function completionState(progress) {
  if (progress == null) return 'not started'
  return progress.total > 0 && progress.passed === progress.total ? 'complete' : 'in progress'
}

/** A compact record of completed lessons, using the same saved checks as the catalog. */
export function lessonProgress(lessons, version) {
  const visible = lessons.filter(lesson => !needsNewer(lesson.minVersion, version))
  if (visible.length === 0) return null
  const completed = visible.filter(lesson => completionState(lesson.progress) === 'complete').length
  const summary = `${completed} of ${visible.length} lessons complete`
  const marks = { complete: '✓', 'in progress': '◐', 'not started': '○' }
  return el(
    'section',
    { class: 'lesson-completion', 'aria-label': 'Your progress' },
    el('div', { class: 'completion-head' }, el('h2', {}, 'Your progress'), el('p', {}, summary)),
    el('progress', {
      value: completed,
      max: visible.length,
      'aria-label': 'Completed lessons',
      'aria-valuetext': summary,
    }),
    el(
      'ul',
      { class: 'completion-lessons' },
      visible.map(lesson => {
        const status = completionState(lesson.progress)
        return el(
          'li',
          {},
          el(
            'a',
            {
              href: `#/learn/${lesson.id}`,
              'data-state': status,
              'aria-label': `${lesson.title}: ${status}`,
              title: `${lesson.title}: ${status}`,
            },
            el('span', { 'aria-hidden': 'true' }, marks[status]),
            lesson.id,
          ),
        )
      }),
    ),
    el('p', { class: 'completion-key muted' }, '✓ Complete · ◐ In progress · ○ Not started'),
  )
}

/** The catalog is drawn from lesson metadata; the README still supplies the surrounding guide. */
export function lessonsGuide(index) {
  return index.replace(/^# .*\n/, '').replace(/^\| Lesson \| Kind \|[^\n]*\n(?:\|[^\n]*(?:\n|$))+/m, '')
}

function lessonRow(lesson) {
  return el(
    'li',
    { class: lesson.kind === 'tutorial' ? 'tutorial' : 'challenge' },
    el('a', { href: `#/learn/${lesson.id}` }, lesson.id),
    el('span', { class: 'lesson-kind' }, lesson.kind === 'tutorial' ? 'tutorial' : 'challenge'),
    el(
      'div',
      { class: 'lesson-description' },
      el('span', { class: 'lesson-title' }, lesson.title),
      el('p', { class: 'lesson-summary' }, lesson.summary),
    ),
    el('span', { class: 'lesson-progress muted' }, progressText(lesson.progress)),
  )
}

/** A lesson requiring a newer engine is omitted, just as on its own page. */
export function lessonCatalog(lessons, version) {
  return el(
    'ul',
    { class: 'lessons' },
    lessons.filter(lesson => !needsNewer(lesson.minVersion, version)).map(lessonRow),
  )
}
