// snake: a game of snake in a pane. The finished mod of the tutorial in
// ../README.md: the board is a surface module (board.tsx) run in a Client;
// this hooks module opens the pane, draws the Client, and keeps the best score.

import type { Register } from 'claude-code'

const PANE = 'snake'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'snake', description: 'A game of snake in a pane: click it, then the arrows' })
    return next(e)
  })

  on('command.run', { command: 'snake' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: 'snake' })
    return { text: opened.isPlaced ? 'Click the board to start; the arrows steer, and Escape gives the keys back.' : `The pane is waiting for room: ${opened.reason}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const best = Number((await $.store.get('best')) ?? 0)
    if (e.surface === 'terminal' || e.surface === 'desktop') {
      const { Client } = $.ui.resolve(e)
      return <Client key="board" module="./board.tsx" props={{ best }} />
    }
    const { Text } = $.ui.resolve(e)
    return <Text>The board is a Client, which only the terminal and the desktop app draw.</Text>
  })

  // A game ended: the board posts its score. The best is kept in $.store, which
  // outlasts the session, and handed back to the board as props, with no redraw.
  on('ui.message', { element: 'board' }, async ($, e) => {
    const { score } = e.data as { score?: unknown }
    const best = Math.max(Number((await $.store.get('best')) ?? 0), typeof score === 'number' ? score : 0)
    await $.store.set('best', best)
    return { props: { best } }
  })
}
