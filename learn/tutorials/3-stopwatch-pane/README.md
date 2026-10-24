# stopwatch, drawn: a pane

This tutorial takes the stopwatch you built in [stopwatch](../1-stopwatch) and gives it a pane: the time in each tool as bars, redrawn as the model works, with a button that resets the totals and a line naming the latest call and how long it took.

```text
┌ stopwatch ─────────────────────────────────────┐
│ 9 tool calls, 14.2 s in tools  [ Reset ]       │
│ Bash ██████████████████████████████████ 8.6 s  │
│ Read ████████████████████ 5.1 s                │
│ Edit ██ 540 ms                                 │
│ latest: Bash 3.4 s  make test                  │
└────────────────────────────────────────────────┘
```

It covers what drawing takes: a `.tsx` module, `$.ui.open` and the `ui.render` hook that answers it, the elements `$.ui.resolve` hands you, drawing from `$.state` so the pane redraws itself, sizing to the pane, a button and its handler, and text the engine will draw. The checks draw the pane with `$.ui.mount`, as a surface would.

## Before you start

You work in `workshop/stopwatch`, the mod from the stopwatch tutorial, so finish that first. If the folder is not there, the first check copies the stopwatch tutorial's finished mod into it. Then:

```sh
npx claude-mod-lab@alpha learn stopwatch-pane
```

## 1. A pane to draw in

A drawing is written in JSX, so the module becomes a `.tsx` file. Rename `hooks/register.ts` to `hooks/register.tsx`, and name it in `hooks/hooks.json`:

`workshop/stopwatch/hooks/hooks.json`

```json
{ "modules": ["./register.tsx"] }
```

Give `/stopwatch` a way to open the pane by replacing its `command.run` hook:

```tsx
  on('command.run', { command: 'stopwatch' }, async ($, e) => {
    if (e.args.trim() === 'pane') {
      const opened = await $.ui.open({ id: 'stopwatch', title: 'stopwatch' })
      return { text: opened.isPlaced ? 'Opened the stopwatch pane.' : `The pane is waiting for room: ${opened.reason}` }
    }
    return { text: describe(await read($, totals)) }
  })
```

and draw it, with a hook added at the end of `register`:

```tsx
  on('ui.render', { component: 'Pane', requestId: 'stopwatch' }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Text bold>stopwatch</Text>
      </Box>
    )
  })
```

`$.ui.open` asks the surfaces for a pane with the id `stopwatch`, and answers whether one is drawing it (`isPlaced`). A surface draws a pane by raising `ui.render` with `component: 'Pane'` and the pane's id as `requestId`. The hook above answers with a tree of elements, and does not call `next`.

The elements are not imports or globals. `$.ui.resolve(e)` hands you the table of the surface doing the drawing: the terminal, the desktop app, VS Code or mobile. The tables differ (mobile has no `Input` or `Select`), and `e.surface` says which one you have. JSX compiles against the global `h`, which the engine provides.

## 2. Totals that redraw themselves

Draw the totals. The pane's heading is the first half of what `/stopwatch` prints, so split `describe` in two, with a function that sorts the tools beside them:

```tsx
/** The tools, most time first. */
function byTime(all: StopwatchTotals): [string, { calls: number; ms: number }][] {
  return Object.entries(all).sort(([, a], [, b]) => b.ms - a.ms)
}

/** `3 tool calls, 5.1 s in tools`, or that there are none yet. */
function headline(all: StopwatchTotals): string {
  const rows = Object.values(all)
  if (rows.length === 0) return 'No tool calls yet.'
  const n = rows.reduce((sum, row) => sum + row.calls, 0)
  const ms = rows.reduce((sum, row) => sum + row.ms, 0)
  return `${calls(n)}, ${duration(ms)} in tools`
}

function describe(all: StopwatchTotals): string {
  const rows = byTime(all)
  if (rows.length === 0) return headline(all)
  return `${headline(all)}: ${rows.map(([tool, row]) => `${tool} ${duration(row.ms)}`).join(', ')}`
}
```

Then replace the render hook with:

```tsx
  on('ui.render', { component: 'Pane', requestId: 'stopwatch' }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const all = await read($, totals)
    return (
      <Box flexDirection="column">
        <Text bold>{headline(all)}</Text>
        {byTime(all).map(([tool, row]) => (
          <Text>
            {tool} {duration(row.ms)}
          </Text>
        ))}
      </Box>
    )
  })
```

Reading a value of `$.state` while drawing subscribes the drawing to it. Each time the `tool.call` hook writes `stopwatch.totals`, the engine draws the pane again, and nothing has to ask it to. That is why the totals live in `$.state` and not in a module variable: a variable can change without anyone knowing.

The checks draw the pane on the terminal, the desktop and mobile. `Box` and `Text` are on every surface, so the same tree serves all three.

## 3. Bars that fit the pane

Add a function that turns the totals into rows of bars, sized to the room there is:

```tsx
/** One row per tool, most time first, each bar sized so the longest fills the room the pane has. */
function bars(all: StopwatchTotals, columns: number): string[] {
  const rows = byTime(all)
  const most = Math.max(1, rows[0]?.[1].ms ?? 0)
  const name = Math.max(0, ...rows.map(([tool]) => tool.length))
  const time = Math.max(0, ...rows.map(([, row]) => duration(row.ms).length))
  const room = Math.max(1, columns - name - time - 2)
  return rows.map(([tool, row]) => `${tool.padEnd(name)} ${'█'.repeat(Math.max(1, Math.round((row.ms / most) * room)))} ${duration(row.ms)}`)
}
```

and draw them in place of the plain rows:

```tsx
        {bars(all, e.props.bodyColumns).map(row => (
          <Text wrap="truncate-end">{row}</Text>
        ))}
```

The bars are sized by the milliseconds, not by the text `duration` makes of them, and the room left for them is what the widest name and the widest time leave over. `most` is at least 1 so that a tool whose calls all took no time at all still draws a bar of one cell instead of dividing by nothing.

`e.props.bodyColumns` is the width of the box the pane draws into. It is narrower than the terminal while the pane is docked beside the transcript, and when the width changes the engine runs the hook again. `wrap="truncate-end"` cuts a line that would not fit rather than wrapping it.

## 4. A button

Add a function that empties the totals, at the top level of the module, with the type of `$` it takes:

```tsx
import type { EngineInterface, Register, ToolCallResult } from 'claude-code'

type Dollar = EngineInterface
```

```tsx
async function reset($: Dollar): Promise<void> {
  await update($, totals, () => ({}))
  $.ui.status(undefined)
}
```

and a button that calls it, in a row with the heading:

```tsx
        <Box flexDirection="row" columnGap={2}>
          <Text bold>{headline(all)}</Text>
          <Button key="reset" label="Reset" hotkey="r" onPress={() => void reset($)} />
        </Box>
```

`Button` comes from the same table: `const { Box, Button, Text } = $.ui.resolve(e)`.

A render hook never writes state; the engine refuses a write while drawing. The button's `onPress` handler runs later, in the mod, when the button is pressed, and it is the handler that writes. `update` reads the value as it stands then, rather than one captured when the pane was drawn. The write redraws the pane, as any write to `stopwatch.totals` does. The `key` names the button for the checks (`ui.press({ key: 'reset' })`), and `hotkey` presses it from the keyboard while the pane holds the keys.

## 5. The latest call, safe to draw

Show the latest call: its tool, its time, and what it was about, the command, path or pattern it was given. It is a second value in `$.state`, so declare it in the contract:

`workshop/stopwatch/types/index.d.ts`

```ts
/** Time spent in tool calls this session, by tool name: how many calls, and their milliseconds summed. */
export type StopwatchTotals = { [tool: string]: { calls: number; ms: number } }

/** The latest tool call: the tool, its command, path or pattern, how long it took, and whether the model got an error back. */
export type StopwatchCall = { tool: string; detail: string; ms: number; failed: boolean }

declare module 'claude-code' {
  interface PluginState {
    stopwatch: { totals: StopwatchTotals; latest: StopwatchCall | null }
  }
}
```

Name it beside `totals`, and import its type beside `StopwatchTotals`:

```tsx
import type { StopwatchCall, StopwatchTotals } from '../types'
```

```tsx
const latest = atom({ plugin: 'stopwatch', key: 'latest' } as const, null)
```

and add three functions. The first writes a call the way the status line has shown it since the stopwatch tutorial, so the pane and the status line say the same:

```tsx
/** A call as the status line and the pane show it: `Bash 1.2 s`, marked when it failed. */
function callLine(call: StopwatchCall): string {
  return `${call.tool} ${duration(call.ms)}${call.failed ? ' (failed)' : ''}`
}

/** What a call was about: its command, path or pattern. */
function detailOf(input: unknown): string {
  const fields = input as { command?: unknown; file_path?: unknown; pattern?: unknown }
  const detail = [fields.command, fields.file_path, fields.pattern].find(value => typeof value === 'string')
  return typeof detail === 'string' ? detail : ''
}

// The engine refuses a whole drawing whose text holds an escape sequence or a
// control character, and a command can hold both.
function printable(text: string): string {
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x1f\x7f]/g, ' ')
}
```

Keep the latest call in the `tool.call` hook, after adding its time, and set the status line from it in place of the line that was there:

```tsx
    const call = { tool: e.tool, detail: detailOf(e), ms, failed: failed(result) }
    await update($, latest, () => call)
    $.ui.status(callLine(call))
```

clear it in `reset`:

```tsx
  await update($, latest, () => null)
```

and draw it under the bars, reading it beside the totals (`const last = await read($, latest)`):

```tsx
        {last !== null && (
          <Text dimColor wrap="truncate-end">
            {`latest: ${callLine(last)}  ${printable(last.detail)}`}
          </Text>
        )}
```

The time comes before the detail so that a long command is the part `truncate-end` cuts.

A command can carry escape sequences, the bytes a terminal reads as colors or a window title. Drawn as it is, the engine refuses the whole tree: the pane goes blank on the terminal, and the transcript says why. In a session it refused an escape character and a bell, and drew a tab, a line break (as a second line) and a carriage return; `printable` turns all of them into spaces or takes them out, so the latest line stays one line. The last check runs a command holding escapes and a bell; with `printable` taken out, it fails with the engine's own words. Anything drawn from a tool's input or result, a transcript or a command's output needs the same treatment.

## 6. Watch it live

```sh
npx claude-mod-lab@alpha run
```

1. `/stopwatch pane`. It answers "Opened the stopwatch pane.", and in the fullscreen terminal the pane docks at the right of the transcript, with a ✕ to close it.
2. Ask Claude for something that takes a few tools. The bars change as each call ends, and the latest line follows the calls. Calls the model makes at once can end in any order; the latest line names the one that ended last.
3. Make the terminal narrower. The pane keeps its width and the transcript narrows, until there is no room for the pane: it is hidden, and drawn again, totals and all, once the terminal is wide enough. With a pane about 58 columns wide, it was gone at 90 columns and back at 110. The bars follow the pane's own width, `bodyColumns`, which the checks vary.
4. Press ctrl+x, then Tab, so the pane holds the keys (clicking the pane does the same), and press `r`. The pane reads "No tool calls yet." and the status line is cleared. Esc gives the keys back to the prompt.
5. Save a small change to `register.tsx`. The mod reloads and the pane is drawn again from `$.state`, its totals intact.
6. Take `printable` out of the render hook and save. Asking Claude to run `printf '\033[31mred\033[0m'` does not show the refusal: the model writes `\033` as four plain characters, so the command holds no escape, and the pane draws it as it is. The lab's probe can put a real one in, since its arguments are JSON, where `\u001b` is the escape character: run `/mod-lab tool.call {"file_path":"\u001b[31mred\u001b[0m"}`. The Read fails, as no such file exists, and stopwatch keeps the path as the latest call's detail. The pane goes blank, and the transcript says `hooks: ui.render (Pane) refused: a text child holds a control character (an escape sequence); the engine drew its own`. Put `printable` back and save: the pane is drawn again, its latest line reading `latest: Read 10 ms (failed)  red`.

## Where next

Some ways to take the pane further, without checks:

- Draw a band above the prompt instead of a pane: a `ui.render` hook on `{ component: 'AbovePrompt' }`.
- Let a click on a tool's row narrow the pane to that tool's calls, with the slowest first. A `Button` with `plain` and children draws a row that presses; its handler writes which tool is chosen to `$.state`.
- Show the call that is running now, and how long it has run so far, redrawn once a second with `$.clock.every` and `$.ui.invalidate('ui.render')`.
- Draw the bars as one `Raster` of colored cells on the terminal, where `e.surface` is `terminal`.
