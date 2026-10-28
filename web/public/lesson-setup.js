import { el } from './view.js'

export function lessonSetup() {
  return el(
    'section',
    { class: 'controls framed lesson-setup', 'aria-label': 'Set up a lesson workspace' },
    el('h2', { class: 'frame-title' }, 'Set up a lesson workspace'),
    el(
      'p',
      {},
      'In a session started with npx claude-mod-lab run, type /init-lessons to work through lessons here without leaving the session. Existing project files are preserved.',
    ),
    el('p', {}, 'Or create a dedicated lesson folder from your terminal:'),
    el('pre', {}, 'npx claude-mod-lab init-lessons ~/mod-lessons\nnpx claude-mod-lab run ~/mod-lessons'),
    el(
      'p',
      { class: 'muted' },
      'Choose another folder name if you prefer. Lesson files and progress stay in that folder.',
    ),
  )
}

export function lessonLocation(workspace) {
  return el('p', { class: 'muted' }, 'Lesson workspace: ', el('code', {}, workspace))
}
