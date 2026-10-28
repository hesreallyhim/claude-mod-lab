import { el } from './view.js'

const README = 'https://github.com/hesreallyhim/claude-mod-lab#readme'

function command(text) {
  return el('pre', { class: 'help-command' }, el('code', {}, text))
}

function helpContent() {
  return el(
    'div',
    { class: 'detail-body' },
    el(
      'p',
      { class: 'detail-summary' },
      'The explorer can open without a Claude Code session. Connect one to run probes and inspect live data.',
    ),
    el(
      'section',
      {},
      el('h3', {}, 'Connect a project'),
      el('p', {}, 'In another terminal, run this from your project directory:'),
      command('npx claude-mod-lab run'),
      el('p', {}, 'This starts Claude Code with the lab loaded and connects it to an available explorer.'),
    ),
    el(
      'section',
      {},
      el('h3', {}, 'Already in a session?'),
      el('p', {}, 'If the mod-lab-bridge plugin is loaded, enter:'),
      command('/mod-lab explorer'),
      el('p', {}, 'This shows the connected explorer’s address or starts one for the session.'),
    ),
    el(
      'p',
      { class: 'help-docs' },
      el('a', { href: README, target: '_blank', rel: 'noopener noreferrer' }, 'Setup and troubleshooting on GitHub'),
    ),
  )
}

/** Opens connection guidance without changing the connected session. */
export function openConnectionHelp(opener) {
  const title = el('h2', { class: 'detail-title', id: 'connection-help-title', tabindex: '-1' }, 'Connection help')
  const dialog = el(
    'dialog',
    { class: 'detail connection-help', 'aria-labelledby': title.id },
    el(
      'header',
      {},
      title,
      el(
        'button',
        { type: 'button', class: 'quiet close', 'aria-label': 'Close help', onclick: () => dialog.close() },
        'Close ×',
      ),
    ),
    helpContent(),
  )
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return
    const box = dialog.getBoundingClientRect()
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)
      dialog.close()
  })
  dialog.addEventListener('close', () => {
    dialog.remove()
    // Native dialogs restore focus immediately. The later close event must not
    // steal it back if the person has already moved to another control.
    if (document.activeElement === document.body && opener instanceof HTMLElement && opener.isConnected)
      opener.focus({ preventScroll: true })
  })
  document.body.append(dialog)
  dialog.showModal()
  title.focus({ preventScroll: true })
}
