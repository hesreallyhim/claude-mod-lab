# stopwatch, with options

This tutorial gives the stopwatch of tutorials [1](../1-stopwatch) and [3](../3-stopwatch-pane) two settings the person chooses in `/config`: tools to leave out, and how long a call may take before it counts as slow. A mod declares its options in its manifest, as `userConfig`. Each becomes a `/config` row, and the values arrive in `register(on, options)`. Then the mod guards a value on its way into the settings, cutting it to size or refusing it with a reason, and makes a row say what its option has done.

## Before you start

You work in `workshop/stopwatch`, the mod of stopwatch-pane. If the folder is not there, the first check copies stopwatch-pane's finished mod into it. Then:

```sh
npx claude-mod-lab learn stopwatch-options
```

The checks pass your mod its options the way a session does, from the test's `test(name, { options }, body)`, and stand in for the `/config` menu with hooks of their own.

## 1. Tools to leave out

Declare the option in the manifest:

`workshop/stopwatch/.claude-plugin/plugin.json`

```json
{
  "name": "stopwatch",
  "version": "0.1.0",
  "description": "Times the model's tool calls in a session",
  "types": "./types/index.d.ts",
  "userConfig": {
    "ignore": {
      "title": "Tools to leave out",
      "type": "string",
      "description": "Tool names stopwatch does not time, separated by commas",
      "default": ""
    }
  }
}
```

`claude plugin validate` refuses a field without a `title`, a `type` (`string`, `number`, `boolean`, `directory` or `file`) or a `description`. It takes one without a `default`; give one anyway, so the mod has a value before the person sets one. The value arrives in `register`'s second argument, which the module has ignored so far:

```tsx
/** The tool names in the ignore option's text. */
function toolNames(text: string): Set<string> {
  return new Set(text.split(',').map(name => name.trim()).filter(name => name !== ''))
}

export const register: Register = (on, options) => {
  // Fixed while the plugin is loaded: a change in /config reloads it with the new values.
  const ignored = toolNames(typeof options.ignore === 'string' ? options.ignore : '')
```

and the `tool.call` hook passes a call to an ignored tool straight on, before it reads the clock:

```tsx
  on('tool.call', async ($, e, next) => {
    if (ignored.has(e.tool)) return next(e)
    const started = await $.clock.now()
```

`options` holds the values as stored in the person's settings, under `pluginConfigs`, with the manifest's defaults for the rest. They do not change while the module is loaded: when the person changes one in `/config`, the engine loads the module again with the new values. That is why the option is read once, at the top of `register`, rather than in each hook. The totals survive the reload because they are in `$.state`.

## 2. A slow call

A second field, a number:

```json
    "slowAfter": {
      "title": "Slow after, in seconds",
      "type": "number",
      "description": "A call that takes longer than this is marked slow on the status line and in the pane",
      "default": 5
    }
```

In `register`, beside `ignored`, turn it into milliseconds, the unit the mod keeps its times in:

```tsx
  const slowMs = 1000 * (typeof options.slowAfter === 'number' ? options.slowAfter : 5)
```

`callLine`, which writes a call for the status line and the pane's latest line, takes it as a second argument and adds `slow` to the marks:

```tsx
/** A call as the status line and the pane show it: `Bash 1.2 s`, marked when it failed or took longer than `slowMs`. */
function callLine(call: StopwatchCall, slowMs: number): string {
  const marks = [...(call.failed ? ['failed'] : []), ...(call.ms > slowMs ? ['slow'] : [])]
  return `${call.tool} ${duration(call.ms)}${marks.length > 0 ? ` (${marks.join(', ')})` : ''}`
}
```

Pass it in both places: `$.ui.status(callLine(call, slowMs))` in the `tool.call` hook, and `callLine(last, slowMs)` in the render hook. The status line now reads `Bash 6.2 s (slow)`, or `Bash 6.2 s (failed, slow)`.

The render hook is a closure inside `register`, so it sees `slowMs` as the `tool.call` hook does. The latest call is stored with its time, not with its marks, so the pane works the marks out each time it draws, from the option as it stands.

## 3. Guard the value

The `/config` menu holds a number row to numbers, but not to sense: nothing stops the person typing 0, or -3, or 5000. Every change to a row passes `config.set` on its way to the settings, whether it comes from the menu or from a plugin's `$.config.set`. A hook there can refuse it, with a reason the menu shows, or pass on another value:

```tsx
// The slowest the slowAfter option may be set to, in seconds: the Bash tool stops a command at ten minutes.
const MAX_SLOW_AFTER = 600
```

```tsx
/** Whether a /config row is this plugin's field `field`: its key is `<plugin>.<field>`. */
function isField(key: string, plugin: string, field: string): boolean {
  return key === `${plugin}.${field}` || key.startsWith(`${plugin}@`) && key.endsWith(`.${field}`)
}
```

```tsx
  // Slow after: more than 0 seconds, cut to MAX_SLOW_AFTER.
  on('config.set', ($, e, next) => {
    if (!isField(e.key, $.plugin.name, 'slowAfter')) return next(e)
    const seconds = typeof e.value === 'number' ? e.value : Number.NaN
    if (!Number.isFinite(seconds) || seconds <= 0) return { deny: 'slow after takes a number of seconds above 0' }
    return next({ ...e, value: Math.min(seconds, MAX_SLOW_AFTER) })
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'stopwatch could not check the value' }))
```

The hook runs for every row in `/config`, the engine's own and other plugins', so it first checks the key. A plugin's field is keyed `<plugin>.<field>`, as `stopwatch.slowAfter`. Part of a second is fine: 2.5 passes as it came. A value over 600 is cut rather than refused, since what the person meant is clear enough: no call the Bash tool runs takes longer.

This hook is a guard, so its `.catch` refuses, as fence's did. A guard that throws before deciding is skipped, and the row is written as the person typed it; with the `.catch` it is refused instead, unless `next` had already been called, in which case the decision stands.

A number field can also declare `min` and `max` in the manifest, and `claude plugin validate` accepts them. With `"min": 1, "max": 300` on slowAfter, a session showed what they do:

- In `/config` the editor checks the range as you type, "It takes a number between 1 and 300.", and Save does not go through. 0 gets that message too, not the guard's, so a value outside the bounds never reaches `config.set`. Without them the editor checks only that the text is a number ("It takes a number.").
- A plugin's `$.config.set` goes through the `config.set` hooks first, and the engine checks the bounds on the value they pass on. The guard cut 900 to 600, and the engine refused the 600: "Slow after, in seconds doesn't accept "600". It takes a number between 1 and 300." It refused 0.5, which the guard lets through, the same way.
- A stored value outside them stops the plugin loading. Adding the bounds while 600 was stored, the reload failed and the previous version stayed loaded: "options do not fit plugin.json userConfig: Slow after, in seconds must be at most 300". In the test kit the load fails the same way.

So the bounds refuse, in the engine's words, and cannot cut a value to size. The guard gives its own reason, cuts what is clearly meant, and keeps a value out of the settings whichever way it comes. This mod declares no bounds and leaves the range to its guard.

## 4. A row that says what it did

`config.describe` asks each plugin how to draw a row of `/config`: its label, its description, whether to hide it. Make the slowAfter row say how many calls have gone over it this session. Keep the count in `$.state`, so it survives the reload a changed option causes:

`workshop/stopwatch/types/index.d.ts`

```ts
declare module 'claude-code' {
  interface PluginState {
    stopwatch: { totals: StopwatchTotals; latest: StopwatchCall | null; slowCalls: number }
  }
}
```

```tsx
const slowCalls = atom({ plugin: 'stopwatch', key: 'slowCalls' } as const, 0)
```

Count each slow call, in the `tool.call` hook, after setting the status line:

```tsx
    if (ms > slowMs) {
      await update($, slowCalls, n => n + 1)
      // The /config row's label counts the slow calls; the engine keeps the old one until told.
      $.ui.invalidate('config.describe')
    }
```

and relabel the row:

```tsx
  // The slowAfter row says how many calls have gone over it this session.
  on('config.describe', async ($, e, next) => {
    const described = await next(e)
    if (!isField(e.key, $.plugin.name, 'slowAfter')) return described
    const n = await read($, slowCalls)
    return n === 0 ? described : { ...described, label: `${described.label} (${n} call${n === 1 ? '' : 's'} over)` }
  })
```

The row now reads "Slow after, in seconds (3 calls over)". The engine keeps each row's description once asked, for the session, so a label that changes needs `$.ui.invalidate('config.describe')` each time its count does. Without it the label would show the first count it was drawn with. A quick call changes nothing, so it asks for nothing; the checks look for that too.

The count belongs to the option rather than to the pane: Reset empties the totals and leaves it.

## 5. Set it in /config

```sh
npx claude-mod-lab run --model haiku
```

1. `/config`, and type `stopwatch` to find its two rows, the manifest's titles followed by the plugin's name: "Tools to leave out · stopwatch" and "Slow after, in seconds · stopwatch  5". Enter on a row opens it: type the value, move down to Save and press Enter. Set Slow after to 900: the row reads 600 afterwards. Set it to 0: the guard's reason, "slow after takes a number of seconds above 0", shows in yellow on the panel's top edge, and the row keeps 600.
2. The transcript notes each change: `stopwatch: options changed — reloaded (6 hooks: session.start, command.run, tool.call, config.set, config.describe, ui.render)`. `/stopwatch` still has its totals.
3. Set Slow after to 1, and ask Claude to run `sleep 2`. The status line marks the call, `Bash 2.0 s (slow)`, and so does the pane's latest line (`/stopwatch pane`): `latest: Bash 2.0 s (slow)  sleep 2`. Open `/config` again: the row reads "Slow after, in seconds (1 call over) · stopwatch".
4. Set Tools to leave out to `Read`, and ask Claude to read two files. `/stopwatch` does not count them, and the status line still shows the call before them.
5. `/mod-lab config stopwatch` lists the same rows, by the plugin that owns them, `stopwatch@inline` for a mod loaded from a folder:

   ```text
   mod-lab: 2 of the session's 42 /config rows, matching stopwatch, by owner:

   stopwatch@inline (user):
     stopwatch.ignore = "Read"  (text)  Tools to leave out
     stopwatch.slowAfter = 1  (number)  Slow after, in seconds (1 call over)
   ```

   The explorer's Settings page has every row of the session. `/mod-lab config set stopwatch.slowAfter 900` goes through stopwatch's hook too: "Set stopwatch.slowAfter to 600, not 900: a hook changed it on its way." With 0, or with the text `"5"`, it answers "Not set: slow after takes a number of seconds above 0".

The values land in your settings file, under `pluginConfigs["stopwatch@inline"].options`. Set them back, or remove the `stopwatch@inline` entry, when you are done.
