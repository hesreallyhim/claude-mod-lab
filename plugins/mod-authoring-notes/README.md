# mod-authoring-notes

A skill of notes for writing Claude Code mods, plugins of function hooks. It sits beside the plugin-authoring skill that ships with Claude Code: that skill maps the API, and these notes hold what it does not say, each otherwise found only through a failed `claude plugin validate` or `claude plugin test` run. They cover:

- what the validator refuses, and how to write a helper, an atom or a contract it accepts;
- how the test kit behaves: what its `$` has and lacks, what a bottom hook must answer, how to test rendering, streams and calls between plugins;
- engine constraints: what reaches the model, the hook budget, which hooks see a plugin's own calls, rendering and the prompt box, model calls, agents, the transcript;
- packaging: a plugin's `bin/` and npm dependencies, install scopes, the order installed plugins stand in, and where an installed mod's failures show;
- working habits: running a mod in tmux or headless, hot reload, and moving a mod into a larger plugin.

Each note was checked on Claude Code 2.1.303 unless it names another version. The API is in early access and changes between releases, so a note may stop holding on a later build.

## Install

From a terminal:

```
claude plugin marketplace add hesreallyhim/claude-mod-lab
claude plugin install mod-authoring-notes@claude-mod-lab
```

Claude then reads the notes when it makes, changes, tests or debugs a mod. To load them by hand, type `/mod-authoring-notes:mod-authoring-notes`.

The notes are in [skills/mod-authoring-notes/SKILL.md](skills/mod-authoring-notes/SKILL.md).
