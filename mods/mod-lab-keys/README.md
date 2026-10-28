# mod-lab-keys

Keeps each change to the prompt box that was not an edit: going back to an earlier prompt, the box being cleared (sending a prompt empties it), an undo, text a plugin put there, or a change from the app or the engine. `/mod-lab keys` and the explorer's Prompt box page show them beside the edits mod-lab keeps. Like the lab's log, it keeps the box's length and the cursor, never the draft.

It is a separate plugin whose hook requires the `prompt.change` event. Keeping that hook separate isolates it from the lab's other hooks if the engine cannot load it. mod-lab lists it as a dependency, so it installs with the lab. When no change rows are available, the Prompt box page still shows edits recorded by mod-lab.

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
