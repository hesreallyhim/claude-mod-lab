# mod-lab-keys

Keeps each change to the prompt box that was not an edit: going back to an earlier prompt, the box being cleared (sending a prompt empties it), an undo, text a plugin put there, or a change from the app or the engine. `/mod-lab keys` and the explorer's Prompt box page show them beside the edits mod-lab keeps. Like the lab's log, it keeps the box's length and the cursor, never the draft.

It is a plugin of its own because its one hook, on `prompt.change`, needs Claude Code 2.1.300, and a build refuses the whole hooks module of a plugin that hooks an event the build lacks. Kept apart, only this plugin is refused on an older build, and mod-lab loads without it; `/mod-lab keys` then says that change rows need 2.1.300. mod-lab lists it as a dependency, so it installs with the lab, and it has to be loaded or installed beside the lab for the lab to load at all.

It hooks only `prompt.change`, passes each change on unchanged, and keeps the newest 100 in its state, `{ plugin: 'mod-lab-keys', key: 'changes' }`, declared in `types/index.d.ts`. Any plugin can read them. mod-lab adds each one to its own log as it is written, through its hook on this plugin's `state.set`, and `/mod-lab keys` reads the state for any it missed.

```sh
npx claude-mod-lab run    # loads it with the lab; recall a prompt with the up arrow, then /mod-lab keys
claude plugin test mods/mod-lab-keys
```

## Install

From a terminal:

```
claude plugin marketplace add hesreallyhim/claude-mod-lab
claude plugin install mod-lab-keys@claude-mod-lab
```

Installing mod-lab installs it too, as one of mod-lab's dependencies.
