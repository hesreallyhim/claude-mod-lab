// links-mod: a Markdown in a pane whose links the mod answers itself: a plain
// click raises its onLinkPress, which turns the page, and the surface never
// opens the link. One of the gallery's techniques as a mod of its own;
// templates/README.md says where the rest are.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

type Dollar = EngineInterface

const PANE = 'links-mod'
// A link outside https, http and file is drawn as text, so the pages use the reserved .invalid domain.
const BASE = 'https://links-mod.invalid/'

const PAGES: { [page: string]: string } = {
  home: 'Two pages, as links this mod answers: [about](https://links-mod.invalid/about), and back [home](https://links-mod.invalid/home).\n\nOne link it leaves to the surface: [the Ink renderer](https://github.com/vadimdemedes/ink).',
  about: 'A plain click on a link in `pressableLinks` calls `onLinkPress` with its href, where the surface reports clicks; ctrl- or alt-click still opens it.\n\n[Back home](https://links-mod.invalid/home).',
}

const page = atom({ plugin: 'links-mod', key: 'page' } as const, 'home')

async function turn($: Dollar, href: string): Promise<void> {
  const name = href.slice(BASE.length)
  if (href.startsWith(BASE) && name in PAGES) await update($, page, () => name)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'links-mod', description: 'A Markdown whose links the mod answers: /links-mod' })
    return next(e)
  })

  on('command.run', { command: 'links-mod' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: 'links-mod' })
    return { text: opened.isPlaced ? 'Opened the pages.' : `The pane is waiting for room: ${opened.reason}` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Markdown, Text } = $.ui.resolve(e)
    const shown = await read($, page)
    const hrefs = Object.keys(PAGES).map(name => `${BASE}${name}`)
    return (
      <Box flexDirection="column" rowGap={1}>
        <Text bold>{shown}</Text>
        <Markdown key="page" text={PAGES[shown] ?? ''} pressableLinks={hrefs} onLinkPress={link => void turn($, link.href)} />
      </Box>
    )
  })
}
