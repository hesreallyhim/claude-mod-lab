# templates

Small mods to read in one sitting and start from: each of the gallery's techniques as a mod of its own, and six that work in the prompt box. On the explorer's Gallery and Prompt box pages, Add to session copies one into `.claude/skills/<name>/`, a folder Claude Code loads plugins from, and has the session run `/reload-plugins`: the mod is live a second later, and the copy is yours to edit. Remove deletes it. Without the explorer, the same by hand:

```sh
cp -R templates/brackets-mod .claude/skills/     # then /reload-plugins in the session
```

A session started in the repository loads what is in `.claude/skills/` until it is removed. The Gallery page also copies a shell snippet that writes a technique's mod to `workshop/<technique>-mod/`.

The gallery's techniques:

| Mod | Technique | Where it draws |
| --- | --- | --- |
| [raster-mod](raster-mod) | A `Raster` in a pane, repainted by `$.ui.blit` on a timer with no render pass | the terminal |
| [image-mod](image-mod) | An `Image` whose RGBA pixels are made in the module and swapped by `$.ui.blit` | the terminal, where it shows pictures (kitty, Ghostty) |
| [svg-mod](svg-mod) | The session's tool calls as an `Svg` bar chart, block glyphs where there is no `Svg` | desktop, VS Code, mobile |
| [links-mod](links-mod) | A `Markdown` whose links the mod answers itself, turning the pane's page | every surface |
| [hover-mod](hover-mod) | Three words, each with a card that appears over the rows above while the pointer is on it: drawn `display: none`, shown by a `hover.scope` shared with the word, no hook running | every surface, with a pointer |
| [band-mod](band-mod) | A line above the prompt, the `AbovePrompt` site, handed on with `next(e)` when off | the terminal, desktop |
| [sites-mod](sites-mod) | A line under each finished tool call's row, the engine's row wrapped, never replaced | every surface; on the terminal, in the detailed transcript (ctrl+o), where each call has its own row |

The prompt box's, each on the Prompt box page beside the idea it is:

| Mod | What it does | Events |
| --- | --- | --- |
| [brackets-mod](brackets-mod) | Closes a bracket as it is typed, steps over a closer, and paints the bracket beside the cursor with its partner | `prompt.edit`, changing what goes in, consuming a key, and painting |
| [keycast-mod](keycast-mod) | Draws the keys you press above the prompt, for screen recordings; they fade two seconds after the last | `prompt.edit`, `ui.render` on `AbovePrompt` |
| [shortcodes-mod](shortcodes-mod) | Your own shortcodes: `:tests:` writes the prompt it stands for on the closing colon, and a half-typed one shows the rest as ghost text | `prompt.edit` |
| [paint-mod](paint-mod) | Paints a slash command as it is typed: bold when the session has it, underlined when no command starts so, the rest as ghost text; tints `@` mentions | `prompt.edit`, `$.command.list` |
| [paste-guard-mod](paste-guard-mod) | Paints anything shaped like an API key red as it goes in, and holds back a prompt holding one until Enter is pressed again | `prompt.edit`, `prompt.submit` |
| [draft-keeper-mod](draft-keeper-mod) | Offers the draft Ctrl+C cleared back as a suggestion that Tab takes | `prompt.edit`, `prompt.change`, `prompt.submit`, `$.clock.after`, `$.prompt.suggest` |

```sh
npx claude-mod-lab add raster-mod     # a copy in .claude/skills/, loaded by a session started here; then /raster-mod
```

Each has a test (`claude plugin test templates/<mod>`); `npm run check` validates, type-checks and tests them all. The gallery mod, [mods/gallery-mod](../mods/gallery-mod), shows them together, each drawn as well as the surface allows.
