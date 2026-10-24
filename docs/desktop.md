# Mods in the desktop app

The desktop app starts its sessions itself, so there is no `--plugin-dir` to give it. A published mod is installed from the marketplace, and a mod under development reaches the app's sessions through the environment.

## Installing from the marketplace

`/plugin` does not run in the desktop app. Plugins are added there with the + beside the prompt box, then Plugins: add the marketplace `hesreallyhim/claude-mod-lab`, then install mod-lab-bridge, which brings mod-lab, mod-lab-target and mod-lab-keys with it as dependencies. The templates and gallery-mod install the same way, each by its own name. The app installs at user scope, so the lab then loads in every session the app starts, and in every terminal session that uses the same config. `/status` in a session shows which Claude Code build the app runs. The README's "Other ways to run it" has the same install from a terminal, with `--scope local` to keep the lab to one folder.

## Developing a mod from its folder

While a mod is being written, name its folder in `CLAUDE_CODE_PLUGIN_DIRS`, in the `env` block of `~/.claude/settings.json` (a project's settings are not read for it): absolute paths, separated by `:` on macOS and Linux, each loaded as a `--plugin-dir` would be. The desktop app's sessions are long-lived headless ones, which reload a mod when it is saved only with `CLAUDE_CODE_PLUGIN_DIR_WATCH=1` set beside it.

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/claude-mod-lab/mods/gallery-mod:/path/to/claude-mod-lab/mods/mod-lab",
    "CLAUDE_CODE_PLUGIN_DIR_WATCH": "1"
  }
}
```

A folder loaded this way wins over an installed plugin of the same name, as a `--plugin-dir` one does, so a clone's copy of a mod can be worked on while the marketplace copy stays installed. mod-lab's folder loads only with its dependencies present, installed or named here as well: `mods/mod-lab-target` and `mods/mod-lab-keys`.

The `env` block applies to every session started with that settings file, terminal sessions included, so the mods load there too until the lines are removed. A session started with `CLAUDE_CONFIG_DIR` pointing elsewhere reads that directory's `settings.json` instead.

## Which surface drew it

A hook sees the surface as `e.surface` (`desktop` here), and `$.ui.resolve(e)` answers that surface's elements: desktop has `Svg` and `Client`, and neither `Raster` nor `Image`. The explorer's Gallery page lists each surface's elements as this build's declarations give them. The gallery mod says on each tab what it stands in for where its element is missing.

Desktop draws `Text` in a proportional face unless the Text has `mono`. A grid made of characters, such as a game board, glyph bars or columns padded with spaces, needs `mono` on each row there: otherwise a space is narrower than a `█` and the cells stop lining up. The terminal is always monospaced and ignores the prop.

## The snake tutorial in the desktop app

With `workshop/snake` (or `learn/tutorials/6-snake/solution`) loaded from its folder as above, `/snake` should draw the board in a pane, played as in the terminal: a click starts it and gives it the keys, the arrows steer. The board is a `Client`, which desktop draws and VS Code and mobile do not; there the pane says so.

## The gallery in the desktop app

With gallery-mod installed, or `mods/gallery-mod` loaded from its folder as above:

- `/mod-gallery svg`: the tool-call counts as vector bars, once as an image and once interactive, where a bar under the pointer changes color and shows a tooltip.
- `/mod-gallery raster` and `/mod-gallery image`: the stand-ins, a heat map shaded by glyph and an `Svg` gradient.
- `/mod-gallery hover`: the cards over the glyphs, with a real pointer.
- `/mod-gallery band on`, then `/mod-gallery hover`: the band above the prompt, and a glyph's entry revealed in it from the pane.
- `/mod-gallery sites on`, then a prompt that makes a tool call: the badge under the call's row. `/mod-gallery chart` draws its row as an `Svg`.

These are checked by the kit on every surface, but only the app shows how they look; what differs from the terminal is worth noting in the gallery's README.
