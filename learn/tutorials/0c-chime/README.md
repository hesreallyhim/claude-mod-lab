# chime: a chime when Claude is done

You will finish a mod that listens to Claude: when Claude finishes a long answer, it plays a chime and reads out the first sentence of what Claude said. Ask for something that takes a while, look away, and you will hear when it is done:

```text
❯ run the tests and fix whatever fails
  …
● All 41 tests pass. I also fixed the import in parser.ts.

  ♪ ding, then a voice: "All 41 tests pass."
```

tick and egg drew things of their own. This mod draws nothing; it reacts to something Claude does. That is the step from a mod with its own buttons to a mod that takes part in the session.

You start from a mod where `/chime` already plays the sound, and a hook that runs at the end of each of Claude's turns but does nothing there yet. Each step adds one line to that hook:

1. Hear it: load the mod and type `/chime`.
2. Ring when Claude is done: a hook on the engine's own event, and `$.audio.play`.
3. Only after a long turn: what `e` tells you about the turn.
4. Say what Claude said: `$.audio.speak`, and a call you do not wait for.

Sound needs a Mac for now: the sound plays with `afplay` and the voice is macOS's `say`. Elsewhere the steps still work and the checker still passes them, but you will hear nothing.

## Before you start

This tutorial follows [egg](../0b-egg). In your workspace folder, start the checker:

```sh
npx claude-mod-lab@alpha learn chime
```

and, in a second terminal, Claude Code with your mod:

```sh
npx claude-mod-lab@alpha run
```

Everything you will change is in `workshop/chime/hooks/register.ts`. The sound is `workshop/chime/sounds/chime.wav`; a mod's own files go beside its code like this.

## 1. Hear it

Type `/chime`. You hear a two-note bell. `/chime`'s hook plays it with one line:

```ts
await $.audio.play(CHIME)
```

`CHIME` names the file, `sounds/chime.wav`, as a path inside the mod's folder. `$.audio.play` can also play a sound from a web address.

Now look at the `turn.complete` hook at the bottom. It runs at the end of each of Claude's turns: a turn is everything Claude does in answer to one prompt, its replies and its tool calls, and when it ends the answer is already on the screen.

The hook starts with `await next(e)`. Every hook is handed `next`, the rest of the chain: the other mods' hooks on the same event, and at the bottom the engine itself. Calling `next(e)` passes the event on so Claude Code finishes the turn as it always would, and gives back what came out, which the hook returns at the end. A hook that never calls `next(e)` takes the event over; this one only listens.

Then it leaves Claude's agents alone: when Claude hands work to an agent, the agent's turns end too, and those should stay quiet.

## 2. Ring when Claude is done

The idea: a hook on the engine's own event.

In tick and egg your hooks ran when you typed a command or pressed a button. This one runs when Claude finishes, whatever you were doing. Inside `if (isLong)`, replace the `// Step 2` line with the line `/chime` uses to play the sound.

<details>
<summary>The answer</summary>

```ts
await $.audio.play(CHIME)
```

</details>

Save, then ask Claude anything ("what's 2 + 2?" will do). The chime plays when it has answered. The checker marks step 2 done.

## 3. Only after a long turn

The idea: what `e` tells you about the turn.

A chime after every answer soon gets tiresome. For `turn.complete`, `e` tells you about the turn that ended:

- `e.durationMs`: how long it took, in milliseconds;
- `e.answer`: what Claude said last;
- `e.isAborted`: whether you interrupted it;
- `e.agentId`: which agent's turn it was, when it was an agent's.

The line marked `Step 3` says every turn is long. Make `isLong` true only when the turn took `LONG_MS` (20 seconds) or longer.

<details>
<summary>A hint</summary>

`>=` compares two numbers: `a >= b` is true when `a` is `b` or more.

</details>

<details>
<summary>The answer</summary>

```ts
const isLong = e.durationMs >= LONG_MS
```

</details>

Save. A quick answer now ends without a sound; ask for something longer ("read the README and summarize it") to hear it. The checker marks step 3 done.

## 4. Say what Claude said

The idea: `$.audio.speak`, and a call you do not wait for.

Before you write it, hear the call from the lab: `/mod-lab audio.speak Hello from chime`.

`$.audio.speak(text)` says `text` aloud in the computer's own voice. `firstSentence(e.answer)`, a helper at the top of the file, gives the first sentence of Claude's answer without Markdown's stars and backticks.

This time, do not wait for it. A sentence takes a few seconds to say, and there is no need to hold up the hook while it plays: leave out `await`, and the hook carries on while the voice speaks. Without `await`, though, a failure has nowhere to go, and a computer with no voice installed does fail. Add `.catch(() => {})` to the end of the call: it catches the failure and does nothing with it.

Replace the `// Step 4` line with a line that says the first sentence of `e.answer`.

<details>
<summary>The answer</summary>

```ts
$.audio.speak(firstSentence(e.answer)).catch(() => {})
```

</details>

Save, and ask for something long. When it is done you hear the chime, then the first thing Claude said. The checker marks every step done.

## What you made

A mod that takes part in the session, and these ideas:

- a hook on the engine's own event, `turn.complete`, that runs whenever Claude finishes, and `next(e)`, which passes it on;
- `e`, the event's input: here how long the turn took and what Claude said;
- `$.audio.play` for a sound file of the mod's own, and `$.audio.speak` for a voice;
- `await` to wait for a call, and leaving it out (with `.catch`) to let it run on its own.

[solution/](solution) holds the finished mod.

## Keep going

The checker does not look at these; try any that sound fun.

- Can you pick another voice? `$.audio.speak(text, { voice: 'Samantha' })`; `say -v '?'` in a terminal lists the voices your Mac has.
- Can you say how long it took instead, as "Done after 42 seconds"? `e.durationMs / 1000` is the seconds, and `Math.round` rounds them.
- Can you stay quiet when you interrupted Claude yourself? `e.isAborted` is true then.
- Can you add `/chime off` and `/chime on`? Keep a `let isOn = true` at the top, set it in the command hook, and check it in the turn hook.
- Can you play a sound of your own? Put a `.wav` or `.mp3` in `sounds/` and name it in `CHIME`.

The next tutorial, [remind](../0d-remind), gives Claude a tool of yours to call: you ask Claude to remind you of something, and your mod does it.
