# tick: a stopwatch you can click

You will finish a stopwatch that sits in a pane beside the conversation. It ticks once a second, and one button starts and stops it:

```text
███   ███ ███
█ █ █ █ █ █
█ █   █ █ ███
█ █ █ █ █   █
███   ███ ███

0:05  running

[ +1 s ]  [ Stop ]
```

You start from a mod that already draws all of this. Its buttons do nothing yet, and three lines in it are left for you. Each step fills in one of them and teaches one idea of the mod API:

1. Open it: load the mod and see the stopwatch.
2. Count a click: `$.state`, and a pane that draws itself again.
3. Tick by itself: a timer from `$.clock`.
4. Stop it: what a timer gives back, and `cancel()`.

## Before you start

You need Claude Code 2.1.299 or later and Node 22 or later. Initialize a dedicated lesson workspace once, then open a terminal in it. The lesson files and progress stay in this folder.

```sh
npx claude-mod-lab@alpha init-lessons my-mods
cd my-mods
```

In that folder, start the checker:

```sh
npx claude-mod-lab@alpha learn tick
```

It copies the starter into `workshop/tick/`, then checks the folder every time you save a file in it: it lists the steps that pass, and says why the next one does not pass yet. Leave it running.

The lesson page’s “Start from the lesson’s starter” button copies the same unfinished starter. Both methods also copy the finished source to `solutions/tick/` for reference, without a plugin manifest, so the session does not load it. Your working mod stays in `workshop/tick/`. If you use the page instead, its checks update as you save while the lesson is open, so you do not need a separate terminal checker.

In a second terminal, in the same folder, start Claude Code with your mod loaded:

```sh
npx claude-mod-lab@alpha run
```

The session loads your mod again each time you save, so you see each change as soon as you make it. Everything you will change is in `workshop/tick/hooks/register.tsx`; open it in your editor.

## 1. Open it

In the session, type `/tick`. A pane opens with the stopwatch at `0:00` and two buttons. The pane has the keyboard: `t` presses +1 s and `s` presses Start. Escape gives the keyboard back to the prompt, and ctrl+x then Tab hands it to the pane again.

Press the buttons. Nothing happens yet: that is what the next three steps fix.

Now look at `register.tsx`. You do not need to follow all of it yet:

- `register`, at the bottom, is what Claude Code calls when it loads the mod. Inside it, `on(event, hook)` adds a hook: a function the engine runs when the event happens. This mod has three. The `session.start` hook adds the `/tick` command, the `command.run` hook opens the pane when you type it, and the `ui.render` hook draws the pane.
- Every hook is handed `$` first. `$` is the engine: anything a mod does beyond its own code, such as opening a pane, reading the time or keeping a value, it does through `$`.
- Above `register` are the three functions the buttons call: `tick`, `start` and `stop`. Each has a line marked `Step`. Those lines are yours.

The checker marks this step done already: it passes once `claude plugin validate` accepts the folder.

## 2. Count a click

The idea: `$.state`, and a pane that draws itself again.

The time on the stopwatch is kept in `$.state`, where the engine holds values for the session. This line near the top makes one:

```ts
const seconds = atom({ plugin: 'tick', key: 'seconds' } as const, 0)
```

`seconds` is a handle on one value, which starts at 0. Two functions take the handle: `read($, seconds)` gets the value, and `update($, seconds, change)` writes a new one, where `change` is a function from the old value to the new one.

The `ui.render` hook reads `seconds` to draw the time. When a drawing reads a value from `$.state`, the engine remembers that, and draws it again whenever the value changes. So to move the stopwatch you never touch the drawing: you change the value.

Before you write it, see a value as the engine holds it in `$.state`, with the version it stands at: `/mod-lab state.get` reads the lab's own counter.

In `tick`, replace the `// Step 2` line with one that adds 1 to `seconds`.

<details>
<summary>A hint</summary>

`update` takes `$`, then `seconds`, then the change. The change `n => n + 1` takes the old value, `n`, and gives back one more. Start the line with `await`: writing to `$.state` takes a moment, and `await` waits for it.

</details>

<details>
<summary>The answer</summary>

```ts
await update($, seconds, n => n + 1)
```

</details>

Save, then press `t` in the pane: the stopwatch counts up. The checker marks step 2 done.

## 3. Tick by itself

The idea: a timer.

A mod can ask the engine to run one of its functions later. `$.clock.every(ms, fn)` runs `fn` every `ms` milliseconds until it is stopped, and gives back a timer: the thing you stop it with.

In `start`, the line marked `Step 3` sets `timer` to `null`, which means no timer. Replace `null` with a timer that calls `tick($)` every 1000 milliseconds.

<details>
<summary>A hint</summary>

The function the timer runs is written `() => tick($)`: a function that takes nothing and calls `tick($)`. It goes second, after the 1000.

</details>

<details>
<summary>The answer</summary>

```ts
timer = $.clock.every(1000, () => tick($))
```

</details>

Save, then press `s`. The stopwatch ticks once a second, and the button says Stop: the drawing shows Stop whenever `timer` holds a timer. (`timer` is a plain variable, not `$.state`, so the engine cannot tell the drawing depends on it. That is why `start` and `stop` call `$.ui.invalidate('ui.render')`: it asks for the pane to be drawn again.)

Now press `s` again to stop it. The button goes back to Start and the line says `stopped`, but the seconds keep going. Step 4 is why.

## 4. Stop it

The idea: a timer you keep, and `cancel()`.

`stop` sets `timer` back to `null`. That only makes the mod forget the timer. The engine still has it, and goes on calling `tick` every second. To stop it, call the timer's `cancel()` before letting go of it.

Replace the `// Step 4` line with one that cancels the timer. Keep the existing `timer = null` line after it: cancelling stops the ticks, while clearing the variable makes the pane show `stopped` and lets the button start a new timer.

<details>
<summary>A hint</summary>

The timer is in `timer`, and the method is `cancel`. TypeScript knows `timer` can be `null`, so write `timer?.cancel()`: the `?.` calls `cancel` only when there is a timer to cancel.

</details>

<details>
<summary>The answer</summary>

```ts
function stop($: Dollar): void {
  timer?.cancel()
  timer = null
  $.ui.invalidate('ui.render')
}
```

</details>

Save, and try it: start, stop, start again. It stops where you stop it and carries on from there. The checker marks every step done.

## What you made

A mod of three hooks, and four ideas most mods are made of:

- hooks: functions the engine runs at events, each handed `$`;
- `$.state`, and a drawing that is drawn again whenever a value it read changes;
- a button's `onPress`: your function, run when the button is pressed;
- a timer from `$.clock.every`, and `cancel()` to stop it.

`solutions/tick/` in your lesson workspace holds the finished source for comparison. If you started before reference solutions were included, use **Copy reference solution** on the lesson page. The packaged [solution/](solution) also holds the finished mod.

## Keep going

The checker does not look at these; try any that sound fun.

- Can you add a Reset button that puts the stopwatch back to `0:00`? One more `Button`, and an `update` whose change gives back 0.
- Can you make `+1 s` add ten seconds instead, and label it to match?
- Can you put the time on the status line under the prompt as well? `$.ui.status(text)` puts a line of text there; `tick` is the place, since it runs every second.
- Can you count down instead of up, from a minute to `0:00`, and stop the timer there?

The next tutorial, [egg](../0b-egg), draws in another place, just above the prompt, and gives a timer as many minutes as you type.
