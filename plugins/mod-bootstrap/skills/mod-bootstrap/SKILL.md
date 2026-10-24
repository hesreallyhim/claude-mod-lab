---
name: mod-bootstrap
description: Scaffold a new Claude Code mod, a plugin of function hooks, in a folder of the person's own. Writes .claude-plugin/plugin.json, hooks/hooks.json, hooks/register.ts, types/index.d.ts, a test and a README, then validates and tests the result. Use when asked to create, start, scaffold or bootstrap a mod.
argument-hint: "[name]"
---

# mod-bootstrap

Writes the files a mod needs to load, validate and pass a test, and a few it may not need yet, since a file is easier to delete than to get right from nothing. The mod starts as one slash command named after it, with a test that runs the command; the person's own hooks go in from there.

## 1. Ask

Take what the request already says (the name, the folder, what the mod is for), then ask the rest in one AskUserQuestion call, leaving out any question the request answered:

- **Name** (header `Name`): two or three names that fit what the person described, or `hello` and `sketch` where they described nothing. They can type another through Other. A name is lowercase words joined by single hyphens (`word-count`, `tool-guard`). It names the plugin, its slash command and its key in `$.state`. Avoid a built-in command's name (`help`, `config`, `sandbox`, and the rest `/help` lists): the session refuses a plugin command a built-in holds, and the validator does not say so.
- **Author** (header `Author`): the output of `git config user.name`, where it has one, and `Leave it out`.

The mod goes in a new folder named after it in the current directory, unless the request names another folder. If that folder exists and holds files, stop and ask before writing anything into it.

## 2. Write

Write every file below, replacing `<name>`, `<description>` and `<author>`. The description is one line about what the person said the mod is for, or `The <name> mod` where they said nothing; escape a `'` in it where it goes into the module. Without an author, leave the `author` line out of the manifest.

### .claude-plugin/plugin.json

```json
{
  "name": "<name>",
  "version": "0.1.0",
  "description": "<description>",
  "author": { "name": "<author>" },
  "types": "./types/index.d.ts"
}
```

### hooks/hooks.json

```json
{ "modules": ["./register.ts"] }
```

### hooks/register.ts

```ts
import type { Register } from 'claude-code'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: '<name>', description: '<description>' })
    return next(e)
  })

  on('command.run', { command: '<name>' }, async () => ({ text: '<name> is loaded.' }))
}
```

### types/index.d.ts

```ts
// The values this mod keeps in $.state, declared under its name. The module makes
// each one with atom({ plugin: '<name>', key: 'count' } as const, 0), reads it with
// read($, count) and changes it with update($, count, n => n + 1); the validator
// holds every key the module names to this declaration.
declare module 'claude-code' {
  interface PluginState {
    '<name>': {
      // count: number
    }
  }
}
```

### tests/<name>.test.ts

```ts
import { expect, test } from 'claude-code/testing'

const run = { command: '<name>', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 100 } } as const

test('/<name> answers', async $ => {
  const answer = await $.command.run(run)

  expect(answer.text).toBe('<name> is loaded.')
})
```

### README.md

````markdown
# <name>

<description>

## Run

From this folder:

```sh
claude --plugin-dir .         # then /<name>; the session reloads the mod when a file is saved
claude plugin validate .      # what the module hooks and calls, and what the engine would refuse
claude plugin test .          # runs tests/*.test.ts against the engine
```

## Files

- `.claude-plugin/plugin.json`: the manifest.
- `hooks/hooks.json`: names the hooks module.
- `hooks/register.ts`: the hooks. To draw with JSX (a pane, a line above the prompt), rename it `register.tsx` and change its path in `hooks.json`: TypeScript compiles JSX only in a `.tsx` file.
- `types/index.d.ts`: the values the mod keeps in `$.state`. Delete it, and the manifest's `types` line, if the mod keeps none.
- `tests/<name>.test.ts`: the tests.
````

## 3. Check

```sh
claude plugin validate <folder>   # reads the manifest and module as the engine will: what it hooks and calls, and what it would refuse
claude plugin test <folder>       # runs tests/*.test.ts against the engine
```

Fix what either reports before going on. Where the request described what the mod should do, build that on the checked scaffold next, and run both checks again.

## 4. Hand it over

Tell the person where the mod is and how to run it: `claude --plugin-dir <folder>`, then `/<name>`. An interactive session started that way watches the folder and reloads the mod when a file is saved. It also lays the engine's declarations in `<folder>/.claude-plugin/types/`, with a `tsconfig.json` in the folder that extends them, so an editor types the module and `npx tsc -p <folder>` type-checks it.

The validator holds a hooks module to a few rules that trip up a first edit:

- `$` is spelled `$.noun.method(...)` at each call, and is passed only to functions declared at the module's top level and called by name.
- `atom`, `read` and `update` take an atom made in the same file, with `plugin` and `key` written as literals, and each key is declared in the contract.
- The contract exports types and nothing else, and imports nothing.

The plugin-authoring skill that ships with Claude Code maps the rest of the API: the events, the nouns on `$`, drawing, and where this build's declaration file is.

The mod-authoring-notes skill, from the same marketplace as this one, holds what that skill does not say: more of the validator's rules, how the test kit behaves, and engine constraints. Read it before building on the scaffold, where it is installed.
