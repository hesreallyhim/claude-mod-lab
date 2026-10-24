// What the pointer can do with no hook running: links a Markdown hands to the
// plugin, cards that appear over a hovered glyph, and a hover group that
// reaches from the pane into the band above the prompt.

import type { Elements, RenderElement } from 'claude-code'

import type { GalleryCall, GalleryTab } from '../types'

type Common = Pick<Elements['mobile'], 'Box' | 'Text' | 'Button' | 'Markdown'>

/** Links under this address switch the pane's tab; the surface never opens them. */
export const LINK_BASE = 'https://gallery.invalid/tab/'
const CARD_WIDTH = 36
const CARD_ROWS = 5
const MAX_GLYPHS = 18
const PALETTE = ['#d97757', '#7aa2f7', '#9ece6a', '#e0af68', '#bb9af7', '#7dcfff', '#f7768e']

/** The tab a gallery link names, or null for any other link. */
export function tabOfLink(href: string, tabs: readonly GalleryTab[]): GalleryTab | null {
  if (!href.startsWith(LINK_BASE)) return null
  const word = href.slice(LINK_BASE.length)
  return tabs.find(tab => tab === word) ?? null
}

/** The hover group a call's glyph, card and band entry share; at most 64 characters. */
export function scopeOf(call: GalleryCall, index: number): string {
  return `gallery:${call.id ?? `call-${index}`}`.slice(0, 64)
}

export function formatMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`
}

function colorOf(tool: string): string {
  let hash = 0
  for (const char of tool) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return PALETTE[hash % PALETTE.length] ?? '#d97757'
}

export function linksTab(ui: Common, tabs: readonly { id: GalleryTab; label: string }[], onLink: (href: string) => void): RenderElement {
  const { Box, Markdown, Text } = ui
  const hrefs = tabs.map(tab => `${LINK_BASE}${tab.id}`)
  const text = [
    'The tabs of this pane, as links the gallery answers itself:',
    '',
    ...tabs.map((tab, index) => `- [${tab.label}](${hrefs[index]})`),
    '',
    'And one it leaves to the surface, which opens it as any link: [Ink, the renderer the terminal draws with](https://github.com/vadimdemedes/ink).',
  ].join('\n')
  return (
    <Box flexDirection="column" rowGap={1}>
      <Text bold>Markdown whose links the plugin answers</Text>
      <Markdown key="links" text={text} pressableLinks={hrefs} onLinkPress={link => onLink(link.href)} />
      <Text dimColor>
        A plain click on a link in pressableLinks raises ui.press with the link's href instead of opening it, on a surface that passes clicks to the mod (the terminal in fullscreen mode);
        ctrl- or alt-click still opens it. A link outside https, http and file draws as text, so these use the reserved .invalid domain.
      </Text>
    </Box>
  )
}

/** Keep the glyphs near the top of a short pane; hover cards use the space below them. */
export function hoverTab(ui: Common, calls: readonly GalleryCall[], columns: number, isBandShown: boolean): RenderElement {
  const { Box, Text } = ui
  const recent = calls.slice(-MAX_GLYPHS)
  const offset = calls.length - recent.length
  return (
    <Box flexDirection="column">
      <Text bold>Hover a dot to inspect a recent tool call.</Text>
      {recent.length === 0 ? (
        <Text dimColor>No tool call has finished in this session yet.</Text>
      ) : (
        <Box flexDirection="row" columnGap={1} marginBottom={CARD_ROWS}>
          {recent.map((call, index) => {
            const scope = scopeOf(call, offset + index)
            const left = Math.min(0, columns - CARD_WIDTH - index * 2)
            return (
              // The glyph lights by inverse, the theme's own colors swapped; a background on this Box would paint the card too.
              <Box key={`glyph:${offset + index}`} hover={{ scope }}>
                <Text color={colorOf(call.tool)} hover={{ scope, inverse: true }}>●</Text>
                <Box position="absolute" top={1} left={left} width={CARD_WIDTH} display="none" hover={{ scope, display: 'flex' }} borderStyle="round" flexDirection="column">
                  <Text bold color={colorOf(call.tool)}>
                    {call.tool}
                  </Text>
                  <Text dimColor>{formatMs(call.ms)}</Text>
                  <Text wrap="truncate-end">{call.summary === '' ? ' ' : call.summary}</Text>
                </Box>
              </Box>
            )
          })}
        </Box>
      )}
      <Text dimColor>
        Each dot is a recent tool call. Its card is a Box drawn display: none with hover: {'{'} display: "flex" {'}'}, placed absolutely in the space below: showing it moves nothing,
        and no hook runs. The dot, its card and its entry in the band share one hover.scope, so the pointer on the dot lights all three.
      </Text>
      <Text dimColor>{isBandShown ? 'The band above the prompt is shown: hover a glyph to see its entry there too.' : 'Show the band (the Band tab) to see a hover reach across sites.'}</Text>
    </Box>
  )
}

export function bandTab(ui: Common, isBandShown: boolean, toggle: () => void): RenderElement {
  const { Box, Button, Text } = ui
  return (
    <Box flexDirection="column" rowGap={1}>
      <Text bold>A line above the prompt</Text>
      <Button key="band" label={isBandShown ? 'Hide the band' : 'Show the band'} hotkey="b" onPress={toggle} />
      <Text dimColor>
        The band is the AbovePrompt site, drawn on the terminal and desktop. The gallery's line counts the session's tool calls and names the last; it yields to a survey, and while hidden
        the gallery hands the site on with next(e). A hover group reaches it from anywhere: an entry drawn display: none appears while its glyph on the Hover tab is under the pointer.
        /mod-gallery band on and /mod-gallery band off do the same from the prompt.
      </Text>
    </Box>
  )
}

/** The band: a count and the last call, and a hidden entry for each recent call, revealed by its hover group. */
export function drawBand(ui: Common, calls: readonly GalleryCall[]): RenderElement {
  const { Box, Text } = ui
  const last = calls.at(-1)
  const recent = calls.slice(-MAX_GLYPHS)
  const offset = calls.length - recent.length
  // The count keeps its width; a revealed entry takes what is left, cut at its end.
  return (
    <Box flexDirection="row" columnGap={1}>
      <Box flexDirection="row" columnGap={1} flexShrink={0}>
        <Text dimColor>gallery</Text>
        <Text>
          {calls.length} tool call{calls.length === 1 ? '' : 's'}
        </Text>
        {last !== undefined && <Text dimColor>{`last: ${last.tool} ${formatMs(last.ms)}`}</Text>}
      </Box>
      {recent.map((call, index) => (
        <Box key={`entry:${offset + index}`} display="none" flexShrink={1} hover={{ scope: scopeOf(call, offset + index), display: 'flex' }}>
          <Text color="suggestion" wrap="truncate-end">{`▸ ${call.tool} ${formatMs(call.ms)} ${call.summary}`}</Text>
        </Box>
      ))}
    </Box>
  )
}
