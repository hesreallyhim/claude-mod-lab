# mod-bootstrap

A skill that scaffolds a new mod, a plugin of function hooks, in a folder of your own. It asks for the mod's name and author, then writes every file below, in a new folder named after the mod (or one you name). Some may be more than the mod needs; delete what it doesn't use.

```
<name>/
  .claude-plugin/plugin.json   name, version, description, author, "types"
  hooks/hooks.json             { "modules": ["./register.ts"] }
  hooks/register.ts            one slash command, /<name>, registered at session.start
  types/index.d.ts             the contract for the values the mod keeps in $.state
  tests/<name>.test.ts         runs /<name> through the test kit
  README.md                    how to run and check the mod, and what each file is for
```

It then runs `claude plugin validate` and `claude plugin test` on the folder. The mod loads with `claude --plugin-dir <name>`.

## Install

From a terminal:

```
claude plugin marketplace add hesreallyhim/claude-mod-lab
claude plugin install mod-bootstrap@claude-mod-lab
```

Then ask Claude to bootstrap a mod, or type `/mod-bootstrap:mod-bootstrap [name]`.

The files it writes are in [skills/mod-bootstrap/SKILL.md](skills/mod-bootstrap/SKILL.md). `npm run test:plugins` in this repository writes them as the skill would, then validates, type-checks and tests the result.
