# examples

Complete, runnable mods demonstrating the Gallery’s rendering techniques and Prompt box behaviors. **Add to lab** copies one into `~/.claude-mod-lab/examples/<name>/`, shared across sessions started with `claude-mod-lab run`. The copy is yours to edit. Editing or removing it affects every session using it; Remove asks for confirmation if you have changed it.

Loading an example makes its command available. Run that command to activate it in the current session. The prompt-box examples, `band-mod`, and `sites-mod` begin inactive: `/<name>` or `/<name> on` enables them, and `/<name> off` disables them. The pane examples open with their slash commands, such as `/raster-mod`.

The adjacent **Add to project** button copies an example into `.claude/mod-lab/<name>/`. That destination loads in sessions started with `claude-mod-lab run --local`; if the current session uses shared examples, restart with `--local` to load the project copy. Existing project copies are preserved, including older copies in `.claude/skills/`, and load in local mode. The Gallery also offers shell snippets that write a mod to `workshop/<name>/`.

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

From a session, `/mod-lab add gallery` copies the complete Gallery mod to your shared lab; then use `/mod-gallery` to open it. Individual examples work too, such as `/mod-lab add raster-mod`. Add `--local` for a project copy; the command explains when a restart is needed.

From the terminal:

```sh
npx claude-mod-lab examples list
npx claude-mod-lab examples add raster-mod
npx claude-mod-lab run
# In the session: /raster-mod
```

For a project copy instead:

```sh
npx claude-mod-lab examples add raster-mod --local
npx claude-mod-lab run --local
```

If the matching session is already running, use `/reload-plugins` after adding the copy. `--to <folder>` chooses an arbitrary destination; load that copy explicitly with `claude --plugin-dir <folder>`.

Each has a test (`claude plugin test examples/<mod>`); `npm run check` validates, type-checks and tests them all. The gallery mod, [mods/gallery-mod](../mods/gallery-mod), shows them together, each drawn as well as the surface allows.
