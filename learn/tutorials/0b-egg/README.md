# egg: an egg timer above the prompt

You will finish an egg timer that lives in the band just above the prompt, where it stays in view while you work. `/egg 5` sets it for five minutes; the bar empties as the time runs out, going from green to yellow to red, and when the time is up it says so:

```text
egg ███████████░░░░░░░░░ 1:42 left
```

This is a different place to draw from tick's pane. A pane is a window you open; the band is one line that is simply there, under the conversation, for as long as the mod draws it.

You start from a mod where `/egg` already puts the timer above the prompt, but the bar never moves, every timer is three minutes, and it is always green. Each step fixes one of those and teaches one idea:

1. Set one: load the mod and type `/egg`.
2. Count down: the time now, from `$.clock.now()`.
3. Any number of minutes: what a command was given, in `e`.
4. Green, then red: the colours a drawing can use.

## Before you start

This tutorial follows [tick](../0a-tick). In your workspace folder, start the checker in one terminal:

```sh
npx claude-mod-lab@alpha learn egg
```

and Claude Code with your mod in a second, in the same folder:

```sh
npx claude-mod-lab@alpha run
```

Everything you will change is in `workshop/egg/hooks/register.tsx`.

## 1. Set one

Type `/egg` in the session. A line appears above the prompt: `egg`, a full green bar, and `3:00 left`. Wait a few seconds: nothing changes. Try `/egg 5`: still three minutes.

In `register.tsx`, three hooks do the work, as in tick:

- the `command.run` hook runs when you type `/egg`. It calls `start`, which keeps the timer in `$.state` (how long it was set for, and when it ends) and starts a timer of its own that asks for the band to be drawn again every second;
- the `ui.render` hook on `AbovePrompt` draws the band. While no egg timer is set it calls `next(e)`, which hands the band on to whatever would be there without this mod;
- `session.start` adds the `/egg` command.

Saving reloads your mod, and a reload stops the mod's timers. The timer's end is kept in `$.state`, which a reload keeps, but the band stops being redrawn: type `/egg` again after each save to start fresh.

## 2. Count down

The idea: the time now, from `$.clock.now()`.

tick counted seconds by adding one each time its timer fired. This mod does it another way: `start` writes down when the timer ends, and the band works out what is left each time it is drawn. That way the time stays right however often the band is drawn, and even across a reload.

Before you write anything with it, see what the clock answers: `/mod-lab clock.now`.

`$.clock.now()` gives the time now, as a number of milliseconds. `start` already uses it, to work out when the timer ends:

```ts
const now = await $.clock.now()
```

In the `ui.render` hook, the line marked `Step 2` says the time left is the whole time, so the bar is always full. Make it the time the timer ends, `timer.endsAt`, minus the time now.

<details>
<summary>A hint</summary>

`timer.endsAt` is when it ends, in milliseconds. Subtract the time now from it: `$.clock.now()`, with `await` in front, inside brackets so the subtraction waits for it.

</details>

<details>
<summary>The answer</summary>

```ts
const left = timer.endsAt - (await $.clock.now())
```

</details>

Save, type `/egg` again, and watch the bar empty and the time count down. The checker marks step 2 done.

## 3. Any number of minutes

The idea: what a command was given, in `e`.

Every hook is handed `e`, the event's input: what happened. For `command.run`, `e.command` is the command's name and `e.args` is everything typed after it. When you type `/egg 5`, `e.args` is `"5"`.

The command hook reads the minutes with `minutesOf('')`, which always gives 3 because it is handed nothing. Hand it what was typed after `/egg` instead. (`minutesOf` turns the text into a number of minutes, and gives 3 when there is no number.)

<details>
<summary>The answer</summary>

```ts
const minutes = minutesOf(e.args)
```

</details>

Save, then try `/egg 1` and `/egg 0.5`. The checker marks step 3 done.

## 4. Green, then red

The idea: the colours a drawing can use.

`Text` takes a `color`. It can be one of the theme's names, which each theme draws in its own shade, or a colour of your own such as `"#ff8800"`. The names that suit a timer are `'success'` (green), `'warning'` (yellow) and `'error'` (red), and `'claude'` is the orange the band uses for `ready`.

The bar's colour comes from `colorFor`, which is handed the share of the time still left: 1 when the timer is set, 0.5 halfway, 0 at the end. It always answers `'success'`. Make it answer `'warning'` when less than half is left and `'error'` when less than a fifth is.

<details>
<summary>A hint</summary>

Check the smallest share first: `if (share < 0.2) return 'error'`. Then the next, then the green that is left over.

</details>

<details>
<summary>The answer</summary>

```ts
if (share < 0.2) return 'error'
if (share < 0.5) return 'warning'
return 'success'
```

</details>

Save, type `/egg 0.5`, and watch it go from green through yellow to red. The checker marks every step done.

## What you made

A mod that draws in a second place, and three more ideas:

- the band above the prompt, drawn by a `ui.render` hook on `AbovePrompt`, and handed on with `next(e)` when there is nothing to show;
- time from `$.clock.now()`: work out what is left from when something ends, rather than counting;
- `e`, the event's input: here what was typed after the command;
- colours: the theme's names, or your own.

[solution/](solution) holds the finished mod.

## Keep going

The checker does not look at these; try any that sound fun.

- Can you make it say "Your egg is ready" out loud when the time is up? `done`, in `start`, is a timer that runs once at the end, and `$.audio.speak('Your egg is ready')` speaks. The next tutorial is all about sound.
- Can you add `/egg off`, which takes the timer away? `e.args` is `"off"`; set the timer back to `null` with `update`, and the band hands itself on.
- Can you make the minutes left change colour with the bar? The `color` goes on the other `Text` too.
- Can you show `ready` blinking? Keep `redraw` running after the end, and draw `ready` bold on even seconds only.

The next tutorial, [chime](../0c-chime), makes a sound when Claude finishes a long answer.
