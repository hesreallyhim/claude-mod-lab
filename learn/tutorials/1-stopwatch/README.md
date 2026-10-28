# stopwatch: a mod from an empty folder

You will build a mod that times the tool calls Claude makes in a session. It shows the latest call and how long it took on the status line, and `/stopwatch` lists the time spent in each tool:

```text
> /stopwatch
  14 tool calls, 38.2 s in tools: Bash 21.5 s, Read 9.1 s, Edit 6.0 s, Write 1.6 s
```

On the way you meet what every mod is made of: the folder and its manifest, the `register` function, hooks and their `($, e, next)` arguments, a slash command, a hook that works on both sides of each tool call, the clock, the status line, and `$.state`. Every step but the live one is checked.

## Before you start

This tutorial follows [remind](../0d-remind). The first four tutorials each began from a mod already drawn; this one begins from an empty folder.

You need Claude Code 2.1.299 or later. In a terminal of its own, open the lesson workspace initialized in [tick](../0a-tick):

```sh
npx claude-mod-lab learn stopwatch
```

That watches `workshop/stopwatch/`, the folder you build the mod in, and checks it every time you save. Each check runs `claude plugin validate` on your folder, then this lesson's checks (the test files in [checks/](checks)) with `claude plugin test` against a copy of it, and type-checks it. It then lists the steps that pass, why the current one does not, and what the validator reads in your module. Your folder is never written to. Git ignores `workshop/`.

[solution/](solution) holds the finished mod, if you get stuck.

## 1. The folder

A mod is a plugin folder whose hooks are TypeScript functions in a module. Make three files.

`workshop/stopwatch/.claude-plugin/plugin.json` is the manifest:

```json
{
  "name": "stopwatch",
  "version": "0.1.0",
  "description": "Times the model's tool calls in a session"
}
```

`workshop/stopwatch/hooks/hooks.json` names the hooks module:

```json
{ "modules": ["./register.ts"] }
```

`workshop/stopwatch/hooks/register.ts` is the module:

```ts
import type { Register } from 'claude-code'

export const register: Register = on => {}
```

The engine imports the module and calls `register` when it loads the mod, and again each time it reloads it. `on` adds hooks; there are none yet.

The engine runs the module in a sandbox that is neither a browser nor Node, so there is no DOM, and it cannot import `fs` or call `fetch`. Everything outside it is reached through `$`, which every hook is handed. `'claude-code'` is the engine's module; its types come from a declaration file the engine writes beside a mod it loads, which the checker finds for you.

The checker passes step 1 once `claude plugin validate` accepts the folder. When it does not, the validator's message stands under the step, naming the file and line.

## 2. A command

Give the mod a `/stopwatch` command. Replace `register.ts` with:

`workshop/stopwatch/hooks/register.ts`

```ts
import type { Register } from 'claude-code'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'stopwatch', description: 'Time spent in tool calls this session, by tool' })
    return next(e)
  })

  on('command.run', { command: 'stopwatch' }, async () => ({ text: 'No tool calls yet.' }))
}
```

`on(event, hook)` adds a hook to an event, and every hook takes the same three arguments:

- `$` is the engine interface: `$.command`, `$.ui`, `$.clock`, `$.session` and the rest. A call on it is always written noun, then method.
- `e` is the event's input: for `session.start` the session's directory and surface, for `command.run` the command and its arguments.
- `next` is the rest of the chain: the hooks of the plugins beneath this one, then the engine's own behaviour. `next(e)` runs it and resolves to the event's result.

`session.start` fires once, when the session is ready, and the engine waits for its hooks before the first prompt, so it is where a mod registers its commands and tools. This hook registers `/stopwatch` and returns `next(e)`: it adds something and lets the start go on.

The second hook has a matcher, `{ command: 'stopwatch' }`, so it runs for `/stopwatch` alone. It answers without calling `next`. A hook that returns its own result answers the event, and nothing beneath it runs. A command's result is `{ text }`: the transcript shows it, and the model reads it as the command's output.

The check starts a session, looks for the registration, and runs `/stopwatch`.

## 3. Timing tool calls

Each time the model calls a tool, the engine raises `tool.call`, with the tool's name and its input as `e`. A hook on it runs before the tool does, and the tool runs inside the hook's `next(e)`. So the hook can read the time, call `next`, and read the time again. Replace `register.ts` with:

`workshop/stopwatch/hooks/register.ts`

```ts
import type { Register } from 'claude-code'

type Totals = { [tool: string]: { calls: number; ms: number } }

const totals: Totals = {}

/** `40 ms` under a second, `1.2 s` from one on. */
function duration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`
}

function calls(n: number): string {
  return `${n} tool call${n === 1 ? '' : 's'}`
}

function describe(all: Totals): string {
  const rows = Object.entries(all).sort(([, a], [, b]) => b.ms - a.ms)
  if (rows.length === 0) return 'No tool calls yet.'
  const n = rows.reduce((sum, [, row]) => sum + row.calls, 0)
  const ms = rows.reduce((sum, [, row]) => sum + row.ms, 0)
  return `${calls(n)}, ${duration(ms)} in tools: ${rows.map(([tool, row]) => `${tool} ${duration(row.ms)}`).join(', ')}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'stopwatch', description: 'Time spent in tool calls this session, by tool' })
    return next(e)
  })

  on('command.run', { command: 'stopwatch' }, async () => ({ text: describe(totals) }))

  on('tool.call', async ($, e, next) => {
    const started = await $.clock.now()
    const result = await next(e)
    const ms = (await $.clock.now()) - started
    const row = totals[e.tool] ?? { calls: 0, ms: 0 }
    totals[e.tool] = { calls: row.calls + 1, ms: row.ms + ms }
    return result
  })
}
```

`await next(e)` is the tool running. The call goes on through the plugins beneath and the engine, permission check and tool included, and `result` is what the model is about to receive. Whatever happens in there, `next` resolves: a tool that failed comes back as a result with `isError: true`, and a call that was refused comes back as `{ deny }`. So the second time read covers every call, and the hook hands the result back as it came. A hook on `tool.call` can do far more: return `{ deny }` without calling `next` to refuse the call, or call `next` with a changed `e` to change the input. The next tutorial, fence, refuses calls, and changes what comes back after `next`.

`$.clock.now()` is the time in milliseconds, as `Date.now()` is, but it is a call on `$` like any other: it goes through the hooks and the engine, so whatever stands beneath the mod can answer it. The checks put a clock of their own there, which moves only when they move it: a call that "takes" 1240 ms takes no time at all in real time. A mod that reads `Date.now()` gets the real time instead, and the check's first failure says so.

The durations are kept in milliseconds and turned into text only when `/stopwatch` prints them. Three Read calls of 1240 ms are 3.7 s; rounded one at a time and then added, they would read 3.6 s.

`/stopwatch` says "in tools" rather than giving an elapsed time. The model often runs several tools at once, and their times overlap, so their sum can be longer than the session has been working. A subagent's tool calls raise `tool.call` too and are counted under their own tools, while the Agent call that started them is timed whole, from start to finish: the same seconds appear twice, once under Agent and once under the tools the subagent used.

What if your code throws after `next`? The tool has already run, so the engine keeps the result `next` resolved to and the model gets it. In the chain the hook's outcome reads `kept`; you will see it in step 5. Before `next` it is different: a hook that throws there is skipped and the call goes on without it. For a stopwatch that is right, a call goes untimed rather than stopped; for a hook meant to refuse something it is not, and fence handles that with `.catch`.

The validator section of the checker's report now reads `gating tool.call without .catch`. A gating hook is one at a place where an answer can refuse what was asked: a tool call, a prompt, a command, a call on `$`. The validator lists each such hook as a fact about the module, not as a warning. Its `calls` line lists `$.clock.now` beside `$.command.register`.

## 4. The status line

Put the latest call on the status line, with its time, and mark it when the model got an error back. Add a function beside `describe`:

```ts
/** Whether the model got an error back: the tool failed, or the call was refused. */
function failed(result: ToolCallResult): boolean {
  return result.isError === true || result.deny !== undefined
}
```

with its type in the import (`import type { Register, ToolCallResult } from 'claude-code'`), and in the `tool.call` hook set the status line after adding the time:

```ts
  on('tool.call', async ($, e, next) => {
    const started = await $.clock.now()
    const result = await next(e)
    const ms = (await $.clock.now()) - started
    const row = totals[e.tool] ?? { calls: 0, ms: 0 }
    totals[e.tool] = { calls: row.calls + 1, ms: row.ms + ms }
    $.ui.status(`${e.tool} ${duration(ms)}${failed(result) ? ' (failed)' : ''}`)
    return result
  })
```

The status line reads `Read 40 ms`, or `Bash 2.3 s (failed)` for a command that exited with an error. A refused call is marked the same way, because the model reads a refusal as an error result too.

`$.ui.status` returns nothing and needs no `await`. The text stays under the prompt until the mod sets another or passes `undefined` to clear it; each plugin has one status line of its own. The status line, toasts and panes are for the person; the model never sees them. What the model does read from a mod is narrower: a command's `text`, a tool result, and context a mod adds to a prompt or the system prompt.

## 5. Watch it run

Load the mod in a session, beneath the lab. In a second terminal, in the same folder:

```sh
npx claude-mod-lab run
```

That starts Claude Code with the lab (mod-lab), its bridge (mod-lab-bridge), the plugin its checks run against (mod-lab-target), the one that keeps the prompt box's changes (mod-lab-keys), and your mod. Things to try:

1. Ask for something that takes a few tools: "Read workshop/stopwatch/hooks/register.ts and list the files in workshop/". The status line under the prompt shows each call as it ends, after the plugin's name: `⚠ stopwatch: Bash 783 ms`. `/stopwatch` lists the time by tool: `mod-lab+stopwatch: 2 tool calls, 803 ms in tools: Bash 783 ms, Read 20 ms`. The names before the colon are the plugins whose `command.run` hooks took part; the lab traces every command, so it is always one of them.
2. Ask Claude to read a file that does not exist. The status line marks the Read, as `Read 15 ms (failed)`, and `/stopwatch` counts it with the rest.
3. `/mod-lab tool.call workshop/stopwatch/hooks/register.ts` runs the lab's probe that calls the Read tool through `$.tool.call`. Its output lists each event the lab's call raised, with the chain that answered: `tool.call(...)` with `chain: stopwatch (user) returned 1.26ms > engine (core) returned 8.09ms`, and `tool.check(...)`, the permission check the engine made on the way. Your hook is a link in the first chain. A plugin's `$.tool.call` raises the same `tool.call` event as the model's calls, so the status line shows this Read too. (Run the probe on the same file again and the Read answers `file_unchanged`, Claude Code's way of saying it has not changed since the last read; the call is timed all the same.)
4. The probe lists only the calls the lab itself makes, so your hook's two `$.clock.now` calls are not in it. To see them, have the lab watch everyone's: `/mod-lab intercept clock.now watch others`, then the probe again, then `/mod-lab intercept`. It lists two lines like `stopwatch clock.now({}) -> {"value":1792429951235}`, one before `next` and one after, each answered by the engine, and the difference between the two values is the time on the status line. `/mod-lab intercept clear` stops the watching.
5. Ask Claude to run a command that needs your permission, such as `mkdir -p /tmp/stopwatch-test`, and wait a few seconds before you answer Yes. The status line counts the wait (`Bash 18.1 s` for a `mkdir` answered after about fifteen seconds): `next` covers the permission check as well as the tool, so the time is from the model's request to its answer, not the tool's own running time. The prompt only appears in manual mode, which the footer names (`⏸ manual mode on`). If your settings default to auto mode, which answers such prompts itself, start this session with the mode given: `npx claude-mod-lab run --permission-mode default`.
6. Ask Claude to run `sleep 20`, and press Esc after a few seconds. The call ends there, `next` resolves, and the status line reads `Bash 3.8 s (failed)`: the time up to the interruption. `/stopwatch` counts it.
7. Add `throw new Error('after next')` in the `tool.call` hook, right before `return result`, and save. The transcript says `stopwatch: reloaded (3 hooks: session.start, command.run, tool.call)`. Run `/mod-lab tool.call workshop/stopwatch/hooks/register.ts` again: the chain reads `stopwatch (user) kept`, the transcript has a grey line, `stopwatch: tool.call hook skipped: threw Error: after next`, and the Read ran once and answered. The line says "skipped" for any hook that throws; the chain is where kept and skipped are told apart. Take the line out again.
8. Run `/stopwatch`. It says "No tool calls yet." The reload threw away the totals. Each reload imports the module afresh, so its variables start over. Step 6 fixes that. The status line still shows the last call: the engine keeps it, not the module.

Every save in `workshop/stopwatch` reloads the mod in this session, so keep it open while you go on. A save while Claude is working takes effect once the turn has ended: the calls of that turn are timed in full by the module that was loaded when they started. The explorer that opened with the session has a Session events tab, which shows each tool call with the chain that answered it.

## 6. Keep the totals across a reload

`$.state` holds named values for the session on the engine's side, outside the module, so they survive a reload. Each value is declared in a contract, a type file the manifest names, so the validator knows what the mod keeps and checks every use of it. Add the contract:

`workshop/stopwatch/types/index.d.ts`

```ts
/** Time spent in tool calls this session, by tool name: how many calls, and their milliseconds summed. */
export type StopwatchTotals = { [tool: string]: { calls: number; ms: number } }

declare module 'claude-code' {
  interface PluginState {
    stopwatch: { totals: StopwatchTotals }
  }
}
```

and name it in the manifest:

`workshop/stopwatch/.claude-plugin/plugin.json`

```json
{
  "name": "stopwatch",
  "version": "0.1.0",
  "description": "Times the model's tool calls in a session",
  "types": "./types/index.d.ts"
}
```

Then keep the totals there instead of in a module variable:

`workshop/stopwatch/hooks/register.ts`

```ts
import { atom, read, update } from 'claude-code'
import type { Register, ToolCallResult } from 'claude-code'

import type { StopwatchTotals } from '../types'

const totals = atom({ plugin: 'stopwatch', key: 'totals' } as const, {})

/** `40 ms` under a second, `1.2 s` from one on. */
function duration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`
}

function calls(n: number): string {
  return `${n} tool call${n === 1 ? '' : 's'}`
}

/** Whether the model got an error back: the tool failed, or the call was refused. */
function failed(result: ToolCallResult): boolean {
  return result.isError === true || result.deny !== undefined
}

function describe(all: StopwatchTotals): string {
  const rows = Object.entries(all).sort(([, a], [, b]) => b.ms - a.ms)
  if (rows.length === 0) return 'No tool calls yet.'
  const n = rows.reduce((sum, [, row]) => sum + row.calls, 0)
  const ms = rows.reduce((sum, [, row]) => sum + row.ms, 0)
  return `${calls(n)}, ${duration(ms)} in tools: ${rows.map(([tool, row]) => `${tool} ${duration(row.ms)}`).join(', ')}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'stopwatch', description: 'Time spent in tool calls this session, by tool' })
    return next(e)
  })

  on('command.run', { command: 'stopwatch' }, async $ => ({ text: describe(await read($, totals)) }))

  on('tool.call', async ($, e, next) => {
    const started = await $.clock.now()
    const result = await next(e)
    const ms = (await $.clock.now()) - started
    await update($, totals, all => {
      const row = all[e.tool] ?? { calls: 0, ms: 0 }
      return { ...all, [e.tool]: { calls: row.calls + 1, ms: row.ms + ms } }
    })
    $.ui.status(`${e.tool} ${duration(ms)}${failed(result) ? ' (failed)' : ''}`)
    return result
  })
}
```

`atom` names a value: the plugin and the key, both written as literals so the validator can read them, and its value before anything is written. `read($, totals)` reads it. `update($, totals, fn)` reads the value, applies `fn`, and writes the result only if nothing else wrote in between, trying again if something did. It answers the value it wrote.

That last part matters here, because the model often runs several tools at once and their hooks overlap. If each hook read the totals with `$.state.get` and wrote them back with `$.state.set`, hooks that read the same value would each write their own sum, and only the last write would stand. The third check runs six overlapping calls of different lengths, three of them ending at the same moment and three more at another, to catch this; try a get-then-set version and see it report fewer, such as `2 tool calls`.

With the session from step 5 still open, save these files and use a few tools, then make any small change to `register.ts` and save it again. `/stopwatch` keeps its totals through the reload now. The value lasts as long as the session. `$.store`, with the same idea of keys and values, keeps values across sessions.

## Where next

The next tutorial, [fence](../2-fence), puts a mod between other plugins and the engine: it watches, refuses and changes their calls on `$`, and keeps the model away from files it should not read. [stopwatch-pane](../3-stopwatch-pane) comes back to stopwatch and draws it in a pane.

[sites-mod](../../../examples/sites-mod) times tool calls the same way and draws each one's time under its row in the transcript, by wrapping the row the engine draws.

Some ways to take stopwatch further, without checks:

- Time only the model's calls, not ones a plugin makes with `$.tool.call`. `next.origin` names who raised an event.
- Add `/stopwatch reset`. `e.args` holds what follows the command name.
- Show minutes past sixty seconds, as `2 min 05 s`.
- Keep the slowest call of each tool beside its total. `e` holds the input that made it slow.
