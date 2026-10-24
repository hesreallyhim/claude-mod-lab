# remind: reminders Claude can set

You will finish a mod that gives Claude a new tool. Ask Claude to remind you of something, and Claude calls your mod; when the time comes, your mod hands the reminder back to Claude, who reminds you in the conversation:

```text
❯ Please remind me in 1 minute to stretch.
⏺ remind - remind_me (MCP)(minutes: 1, about: "stretch")
  ⎿  Reminder set: stretch, in 1 minute.
⏺ I've set a reminder to stretch in a minute.

  … a minute later …

› Prompt from the remind plugin
⏺ Time to stretch.
```

chime listened to Claude. This mod talks with Claude, both ways: Claude calls it, and it calls Claude.

You start from a mod Claude can already call, but the mod only answers that reminders do not work yet. Each step adds one line:

1. Ask Claude: load the mod, ask for a reminder, and watch Claude call your tool.
2. Answer Claude: what a tool gives back is what Claude reads.
3. Make it go off: a timer that runs once, from `$.clock.after`.
4. Have Claude remind you: a prompt of the mod's own, from `$.prompt.submit`.

## Before you start

This tutorial follows [chime](../0c-chime). In your workspace folder, start the checker:

```sh
npx claude-mod-lab@alpha learn remind
```

and, in a second terminal, Claude Code with your mod:

```sh
npx claude-mod-lab@alpha run
```

Everything you will change is in `workshop/remind/hooks/register.ts`. Saving reloads your mod, and a reload stops the reminders still waiting: set them again after each save.

Steps 1, 2 and 4 have Claude answer you, so they use your Claude Code plan like any prompt you type. `/remind 0.5 stretch` sets a reminder without asking Claude, for trying step 3 on its own.

## 1. Ask Claude

In the session, ask: "Please remind me in 1 minute to stretch." Claude calls the tool, `remind - remind_me (MCP)`, with the minutes and what the reminder is about, and reads back "Reminders do not work yet." Claude Code may ask you first whether Claude can use a tool it has not used before: allow it.

How Claude knew about the tool: the `session.start` hook registers it with `$.tool.register`:

- `name` is what the tool is called. Claude sees it as `mcp__remind__remind_me`: `mcp__`, the plugin's name, two underscores, then the name. `TOOL`, at the top, is that full name.
- `description` is what Claude reads to decide when to use the tool. It is written for Claude, so it says plainly what the tool does and when to reach for it.
- `inputSchema` says what Claude must send with each call, as a JSON Schema: here a number of `minutes` and a few words of what it is `about`.

When Claude calls the tool, the engine raises `tool.call`, and the hook `on('tool.call', { tool: TOOL }, ...)` answers it. That hook does not call `next(e)`: the tool is the mod's own, so the mod is the one that answers.

## 2. Answer Claude

The idea: what a tool gives back is what Claude reads.

A `tool.call` hook gives back one of two things. `{ result: text }` is the tool's answer, which Claude reads and tells you about in its own words. `{ deny: reason }` refuses the call, and Claude reads the reason too: the hook already uses it when the minutes are missing or not a number, so Claude can see what to put right and call again.

The hook's last line answers that reminders do not work yet. Make it say that the reminder is set, what it is about, and in how long. `reminder.about` is what it is about, and `inWords(reminder.minutes)` says the time in words.

<details>
<summary>A hint</summary>

Text between backticks can hold values: each `${...}` in it is replaced by the value inside the braces. The `/remind` command's hook, a little further down, already answers you this way.

</details>

<details>
<summary>The answer</summary>

```ts
return { result: `Reminder set: ${reminder.about}, in ${inWords(reminder.minutes)}.` }
```

</details>

Save and ask for a reminder again. Claude now says it is set. But wait the minute: nothing happens. The mod told Claude it set a reminder it never set, which step 3 puts right.

## 3. Make it go off

The idea: a timer that runs once.

Before you write it, see a one-shot timer fire from the lab: `/mod-lab clock.after 1000` answers at once, and the lab's callback runs a second later.

tick's timer, from `$.clock.every`, ran again and again. `$.clock.after(ms, fn)` runs `fn` once, after `ms` milliseconds.

`set` is called with the reminder each time one is asked for, and does nothing yet. Make it call `remind($, reminder.about)` once `reminder.minutes` minutes have passed. A minute is 60,000 milliseconds, which TypeScript lets you write as `60_000`.

<details>
<summary>A hint</summary>

The milliseconds are `reminder.minutes * 60_000`, and the function to run is written `() => remind($, reminder.about)`, as tick's timer ran `() => tick($)`.

</details>

<details>
<summary>The answer</summary>

```ts
$.clock.after(reminder.minutes * 60_000, () => remind($, reminder.about))
```

</details>

Save, then type `/remind 0.1 stretch`. Six seconds later, on a Mac, a voice says "Reminder: stretch": `remind` already speaks, as chime did. The checker marks step 3 done.

## 4. Have Claude remind you

The idea: a prompt of the mod's own.

`$.prompt.submit({ text })` hands Claude a prompt, as if one had been typed. It waits until Claude is not busy, then starts a turn of its own: Claude reads the text and answers in the conversation. The transcript shows that the prompt came from the remind plugin, and Claude is told so too, so it knows the words are the mod's and not yours.

In `remind`, after the voice, replace the `// Step 4` line with a prompt that tells Claude the reminder has gone off and what it is about, and asks Claude to remind you. Write it in your own words; the answer below is one way.

<details>
<summary>A hint</summary>

`$.prompt.submit` takes `{ text: ... }`. Put `about` in the text with backticks and `${about}`, and put `await` in front, so the reminder is passed on before `remind` ends.

</details>

<details>
<summary>The answer</summary>

```ts
await $.prompt.submit({ text: `The reminder the person asked you to set has gone off: ${about}. Remind them of it now, in one short line.` })
```

</details>

Save, and ask Claude for a reminder in half a minute. When it goes off you hear it, and Claude reminds you in the conversation. Each reminder that goes off is one more turn of Claude's. The checker marks every step done.

## What you made

A mod Claude works with, and these ideas:

- a tool for Claude: registered at `session.start` with a name, a description written for Claude, and a schema of what to send;
- a `tool.call` hook that answers the tool: `{ result }` for Claude to read, `{ deny }` with a reason;
- `$.clock.after`, a timer that runs once;
- `$.prompt.submit`, a prompt of the mod's own that starts a turn of Claude's.

[solution/](solution) holds the finished mod.

## Keep going

The checker does not look at these; try any that sound fun.

- Can you play the chime from the chime tutorial when a reminder goes off? Copy `sounds/chime.wav` into `workshop/remind/sounds/`, and `$.audio.play({ asset: 'sounds/chime.wav' })`.
- Can you let Claude ask which reminders are still to come? Keep each reminder in a list when it is set, and register a second tool, `reminders`, whose hook answers with the list.
- Can you let Claude cancel one? `$.clock.after` gives back a timer with `cancel()`, as tick's did: keep it beside the reminder.
- Can you show the next reminder above the prompt, the way egg drew its timer?
- Can you tell Claude more quietly? `$.session.append({ message: { type: 'user', content: [{ type: 'text', text }] } })` adds a line Claude reads with your next prompt, without starting a turn of its own.

This is the last of the first four tutorials. The next, [stopwatch](../1-stopwatch), builds a mod from an empty folder: a timer of Claude's own tool calls, with a hook on both sides of each one.
