# gallery-mod

Rendering techniques for mods beyond `Box` and `Text`, one tab each in a pane. Each tab draws the technique as well as the surface it is on allows: the terminal has `Raster` and `Image` and no `Svg`; desktop, VS Code and mobile have `Svg` and neither of the others, so there a tab draws the nearest stand-in and says what it stands in for.

| Tab | Terminal | Desktop, VS Code, mobile |
| --- | --- | --- |
| Raster | A Game of Life repainted by `$.ui.blit` with no render pass, two cells of the grid to each half block (`▀`); a heat map of the session's tool calls by minute, one `Raster` redrawn when its state changes | The heat map as text, a count shaded by glyph |
| Image | A plasma made here as RGBA bytes and swapped by `$.ui.blit` on each frame; its `alt` where the terminal shows no pictures | The plasma's hues as an `Svg` gradient |
| Svg | The tool-call counts as bars of block glyphs | The same counts as vector bars, once as an image and once `isInteractive`, with `:hover` and `<title>` tooltips |
| Links | A `Markdown` whose links to the tabs are the plugin's: a plain click raises `ui.press` with the href, which switches the tab; one other link is left to the surface | The same |
| Hover | A glyph for each recent tool call; under the pointer, a card drawn `display: none` and placed absolutely appears in the space below it, with no hook running. The dots precede the explanation so they stay visible in short panes | The same |
| Sites | `/mod-gallery sites on` puts a line under each finished tool call's row saying how long it ran: the hook takes the engine's own drawing from `next(e)` (`{ type: 'engine', ref }`) and returns it inside a Box of its own, so the row is wrapped, never replaced. Each row reads its call's duration from a state family keyed by `tool_use_id`, so a new call redraws its own row alone. `/mod-gallery chart` answers a table, which the model reads, and its output row is drawn as a `Raster` bar chart from that text | The badge the same; the chart as an `Svg` |
| Band | `/mod-gallery band on` draws a line above the prompt: the session's tool calls and the last one. Each recent call has an entry there, hidden, in the same `hover.scope` as its glyph on the Hover tab, so the pointer on the glyph reveals it in the band | Desktop the same; VS Code and mobile have no band |

## Install

From a terminal:

```
claude plugin marketplace add hesreallyhim/claude-mod-lab
claude plugin install gallery-mod@claude-mod-lab
```

## Use

```sh
claude --plugin-dir mods/gallery-mod         # from a clone; or Add to session on the explorer's Gallery page
```

- `/mod-gallery` opens the pane; `/mod-gallery <tab>` opens it at a tab (`raster`, `image`, `svg`, `links`, `hover`, `band`, `sites`).
- `/mod-gallery band on` and `/mod-gallery band off` show and hide the gallery's line above the prompt; the Band tab's button does the same.
- `/mod-gallery sites on` and `/mod-gallery sites off` add and remove the badges under tool rows; they are off in each new session, since they change what the transcript shows.
- `/mod-gallery chart` answers the session's tool calls as a table and draws its row as a chart.
- In the pane, the digits pick a tab, `p` plays or pauses the tab's animation, and `s` steps the grid once. In fullscreen, ctrl+x then Tab gives the pane the keys.
- `/mod-gallery play` and `/mod-gallery pause` do the same from the prompt.

An animation stops on its own when three of its frames in a row are refused, and the tab says why. On the Image tab inside tmux or screen that happens at once: the terminal draws no placeholder images there, so the `Image` draws its `alt` and a blit to it is refused. kitty and Ghostty, outside tmux, show the pixels.

## Layout

| File | What it holds |
| --- | --- |
| `hooks/register.tsx` | the command, the pane's render hook, the animation timer, and the record of tool calls |
| `hooks/tabs.tsx` | the tab bar and the Raster, Image and Svg tabs, once for the terminal and once for the surfaces with `Svg` |
| `hooks/pointer.tsx` | the Links, Hover and Band tabs, and the band itself |
| `hooks/sites.tsx` | the Sites tab, the badge on tool rows and the chart's output row |
| `hooks/cells.ts` | `Raster` cells: the packing, the Game of Life, the heat map |
| `hooks/pixels.ts` | the plasma's RGBA pixels |
| `hooks/svg.ts` | the bar chart's markup |
| `types/index.d.ts` | the state contract |

## Tests

`claude plugin test mods/gallery-mod` mounts the pane on every surface and checks which elements each tab draws there, that a gallery link switches the tab, that a glyph, its card and its band entry share one hover group, that the band is drawn only while shown and never over a survey, that a tool row is wrapped with its duration only once sites are on and the call has finished, that the chart row is drawn from its own text, that Play repaints by blit on the frame clock and Pause stops it, that refused frames stop the animation and say why, and the grid and heat map's arithmetic. The kit runs the hooks but paints nothing, so how a tab looks is checked in a terminal: tmux shows text and colors (`capture-pane -e`), and only kitty or Ghostty outside tmux shows an `Image`. A hover and a click can be played into a tmux session as SGR mouse reports, sent with `tmux send-keys -l` in the window's 1-based cells: `$'\e[<35;<col>;<row>M'` moves the pointer there with no button (a hover), and `$'\e[<0;<col>;<row>M'` then `$'\e[<0;<col>;<row>m'` is a left click.
