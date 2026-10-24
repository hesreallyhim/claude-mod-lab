import { el } from './view.js'

/** Lesson files are created only after the user chooses a dedicated workspace. */
export function lessonSetup() {
  return el(
    'section',
    { class: 'controls framed lesson-setup', 'aria-label': 'Set up a lesson workspace' },
    el('h2', { class: 'frame-title' }, 'Set up a lesson workspace'),
    el(
      'p',
      {},
      'You can read the lessons here. To work through them or use the Sandbox, create a dedicated folder and start a session in it:',
    ),
    el('pre', {}, 'npx claude-mod-lab@alpha init-lessons ~/mod-lessons\nnpx claude-mod-lab@alpha run ~/mod-lessons'),
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
