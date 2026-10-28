// hover-mod: three words in a pane, each naming a part of the technique, with
// a card that appears over the rows above the word while the pointer is on
// it, and no hook running: the card is drawn display: none, and the hover
// group it shares with its word shows it. One of the gallery's techniques as
// a mod of its own; examples/README.md says where the rest are.

import type { Register } from 'claude-code'

const PANE = 'hover-mod'
const CARD_ROWS = 4
const CARD_WIDTH = 36

// Each word and what its card says about that part of the technique.
const PARTS: readonly [string, string][] = [
  ['display', 'drawn with display: none, so the card takes up no room'],
  ['scope', 'shares a hover group with its word, so pointing lights both'],
  ['position', 'placed absolutely over the rows above, so nothing moves'],
]

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'hover-mod', description: 'Cards that appear over words you point at: /hover-mod' })
    return next(e)
  })

  on('command.run', { command: 'hover-mod' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: 'hover-mod' })
    return { text: opened.isPlaced ? 'Point at a word in the pane with the mouse.' : `The pane is waiting for room: ${opened.reason}` }
  })

  // The word lights by inverse, which swaps the terminal's own colors, and the
  // card sets none: both read in any theme. A background on the word's Box
  // would also paint the card inside it.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Text dimColor>Point at a word. Its card appears over the empty rows above it, and nothing below moves. No hook runs: the card was drawn hidden.</Text>
        <Box flexDirection="row" columnGap={3} marginTop={CARD_ROWS + 1}>
          {PARTS.map(([word, about]) => (
            <Box key={`word:${word}`} hover={{ scope: `hover-mod:${word}` }}>
              <Text bold hover={{ scope: `hover-mod:${word}`, inverse: true }}>{word}</Text>
              <Box key={`card:${word}`} position="absolute" top={-CARD_ROWS} left={0} width={CARD_WIDTH} display="none" hover={{ scope: `hover-mod:${word}`, display: 'flex' }} borderStyle="round" paddingX={1}>
                <Text wrap="wrap">{about}</Text>
              </Box>
            </Box>
          ))}
        </Box>
      </Box>
    )
  })
}
