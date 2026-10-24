# typeahead: shaping the prompt box

Each change the person makes to the prompt box goes through `prompt.edit`, and what the box then shows is whatever that event resolves to. A hook can paint runs over it, put ghost text after the caret, change what goes in, or swallow a key. The typeahead under the box asks `prompt.autocomplete` for rows, and a submitted prompt passes `prompt.submit` on its way to the model.

You will build typeahead, a companion to the lab. It paints `/mod-lab` as you type it, underlines a word that cannot become a probe id, shows the rest of a probe id as ghost text, and offers the ids as rows that Tab takes. Then it lets a prompt name a probe with `#`, as in `where am I? #session.cwd`, and attaches the probe's answer for the model to read.

## Before you start

This tutorial assumes you have done [stopwatch](../1-stopwatch) and [fence](../2-fence), or know what they cover. In a terminal of its own:

```sh
npx claude-mod-lab learn typeahead
```

You build the mod in `workshop/typeahead/`. It asks the lab for its probes and runs them through `$.lab`, a noun the lab adds to `$`. The test kit does not load a mod's dependencies, so the checks load a stand-in for the lab beside your mod: six probes, each run answering `value-of-<id>`. It is in [checks/kit.ts](checks/kit.ts), with the editor, the engine's typeahead and the model the checks stand in for.

## 1. Paint the command

Make the folder as in stopwatch, under the name typeahead.

`workshop/typeahead/.claude-plugin/plugin.json`

```json
{
  "name": "typeahead",
  "version": "0.1.0",
  "description": "Paints /mod-lab commands as they are typed, completes probe ids, and attaches #probe answers for the model"
}
```

`workshop/typeahead/hooks/hooks.json`

```json
{ "modules": ["./register.ts"] }
```

`workshop/typeahead/hooks/register.ts`

```ts
import type { PromptDecoration, Register } from 'claude-code'

export const register: Register = on => {
  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    if (!/^\/mod-lab(?=\s|$)/.test(box.text)) return box
    const marks: PromptDecoration[] = [{ start: 0, end: 8, bold: true, color: 'claude' }]
    return { ...box, decorations: [...(box.decorations ?? []), ...marks] }
  })
}
```

`e` carries the draft as it stood before the key, plus the change the editor wants to make: the stretch of the draft it replaces (its start and end) and `inputText`, the new text for that stretch. `next(e)` resolves to the box the editor will show, `{ text, cursor }`, with the runs the plugins beneath painted. The hook paints that answer, never `e.text`, which is the draft before the key.

A decoration is paint: it changes how characters look, never what the draft holds. `start` and `end` are offsets into the answer's `text`, and the style keys are those of a `Text` element. `claude` is one of the theme's colors, so it follows the person's theme. Other plugins may paint the same box, so the hook keeps the runs it got and adds its own.

A paste arrives as one edit, and so does a burst of keys typed faster than the editor reads them. Paint from the box as it is after the edit, never by counting keys.

## 2. Mark what is no probe

The lab's probes are its to list. Name the lab as a dependency in `plugin.json`:

```json
  "dependencies": ["mod-lab"]
```

With it the engine lays the lab's contract beside your mod's types, so `$.lab` type-checks. Then ask for the probes once, and keep them:

```ts
import type { EngineInterface, PromptDecoration, Register } from 'claude-code'

type Dollar = EngineInterface
type Probe = { id: string; description: string; effect: string }

// The lab's probes, asked for once, by the first hook that needs them.
let probes: readonly Probe[] | null = null

async function probeList($: Dollar): Promise<readonly Probe[]> {
  probes ??= await $.lab.probes()
  return probes
}

/** The word after `/mod-lab` at the start of the box, and where it starts; null when the box is no /mod-lab command. */
function labWord(text: string): { word: string; start: number } | null {
  const match = /^\/mod-lab(?=\s|$)\s*(\S*)/.exec(text)
  if (match === null) return null
  const word = match[1] ?? ''
  return { word, start: match[0].length - word.length }
}
```

`probeList` takes `$`, so it is a function at the top of the module, called by its name, as the validator requires. In the hook, underline the word when no probe id starts with it:

```ts
  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    const command = labWord(box.text)
    if (command === null) return box
    const marks: PromptDecoration[] = [{ start: 0, end: 8, bold: true, color: 'claude' }]
    const { word, start } = command
    const end = start + word.length
    const matches = (await probeList($)).filter(probe => probe.id.startsWith(word))
    if (word.includes('.') && matches.length === 0) marks.push({ start, end, underline: true, color: 'error' })
    return { ...box, decorations: [...(box.decorations ?? []), ...marks] }
  })
```

Two choices keep the underline accurate. A word on its way to a probe id, `session.c`, is not marked: the person is still typing it. And a word with no dot is left alone, since `/mod-lab list` and `/mod-lab keys` are the lab's own commands, not probes.

## 3. Ghost text

A decoration with `virtualText` draws text before the character at `start` without putting it in the draft. Show the rest of the first probe id the word starts, after the caret:

```ts
    const first = matches[0]
    if (word !== '' && first !== undefined && first.id !== word && box.cursor === end && end === box.text.length) {
      marks.push({ start: end, end, virtualText: first.id.slice(word.length), dimColor: true })
    }
```

It shows only while the caret stands at the end of the word and of the box. Ghost text in the middle of a draft would sit between characters the person can see, and move as they type.

Ghost text is paint, so nothing takes it by itself. Tab and the right arrow at the end of the box are not edits (the caret does not move), so they never reach `prompt.edit` either: the next step gives Tab something to take.

## 4. A row for Tab

`prompt.autocomplete` asks for rows for the token at the caret, the run of characters that are not spaces and end there. The engine draws its own rows first and yours beneath them, and Tab takes the first, writing its `text` over the token.

```ts
  on('prompt.autocomplete', async ($, e, next) => {
    const { suggestions } = await next(e)
    if (!/^\/mod-lab\s+$/.test(e.text.slice(0, e.start))) return { suggestions }
    const rows = (await probeList($))
      .filter(probe => probe.id.startsWith(e.token))
      .slice(0, 8)
      .map(probe => ({ text: probe.id, description: probe.description }))
    return { suggestions: [...suggestions, ...rows] }
  })
```

`e.start` is where the token begins, so `e.text.slice(0, e.start)` is everything before it: `/mod-lab ` and nothing else means the token is the probe's word. The rows come in the same order as the ghost text's ids, so when the engine has no rows of its own for the token, the row Tab takes is the id the ghost text showed. Nothing waits on this event: the engine has drawn its own rows already, and yours join them when the hook answers.

A row taken is not an edit. It reaches hooks as `prompt.change`, with the origin `engine`, which a hook can only observe.

## 5. A probe's answer for the model

Let a prompt name a probe with `#`: `where am I? #session.cwd`. First, rows for the `#` token, for the probes that only read; a probe that writes, draws or spends should not run because a prompt mentioned it. Change the autocomplete hook to take both kinds of token:

```ts
  on('prompt.autocomplete', async ($, e, next) => {
    const { suggestions } = await next(e)
    const isHash = e.token.startsWith('#')
    if (!isHash && !/^\/mod-lab\s+$/.test(e.text.slice(0, e.start))) return { suggestions }
    const typed = isHash ? e.token.slice(1) : e.token
    const rows = (await probeList($))
      .filter(probe => probe.id.startsWith(typed) && (!isHash || probe.effect === 'read'))
      .slice(0, 8)
      .map(probe => ({ text: isHash ? `#${probe.id}` : probe.id, description: probe.description }))
    return { suggestions: [...suggestions, ...rows] }
  })
```

Then, when the prompt is submitted, run each probe it names and attach the answers:

```ts
// `#` and a probe id, as a prompt names one.
const HASHED = /#([a-z]+\.[A-Za-z]+)/g
```

```ts
  on('prompt.submit', async ($, e, next) => {
    if (e.command !== undefined) return next(e)
    const all = await probeList($)
    const named = [...new Set([...e.text.matchAll(HASHED)].map(match => match[1] ?? ''))]
    const runnable = named.filter(id => all.some(probe => probe.id === id && probe.effect === 'read'))
    if (runnable.length === 0) return next(e)
    const answers: string[] = []
    for (const id of runnable) {
      const run = await $.lab.run({ probe: id, from: 'plugin' })
      answers.push(`#${id}: the mod-lab probe ${id} ${run.ok ? `answered ${JSON.stringify(run.value)}` : `failed: ${run.error}`}`)
    }
    return next({ ...e, context: [...(e.context ?? []), ...answers] })
  }).catch(($, e, next) => next(e))
```

`context` is a list of extra text for the model that the person never sees on screen; each entry is sent to the model as a separate block following the typed prompt. The prompt itself goes on unchanged. A slash command's line also passes `prompt.submit`, marked with `e.command`; `/mod-lab` would run its own probe, so the hook passes it on.

The hook makes calls before `next`, so it can fail before the prompt has passed it. Without a `.catch`, a hook that throws is skipped and the prompt goes on all the same; the `.catch` says what a failure means in the mod's own code, where a reader sees it. In fence and in stopwatch's `config.set` guard a failure meant a refusal. Here it means the prompt as typed: a mod that adds to a prompt must never stand in its way.

## 6. Type it live

```sh
npx claude-mod-lab run --model haiku
```

Type `/mod-lab ses` a key at a time. `/mod-lab` is bold, the rest of `session.cwd` stands dim after the caret, and the rows beneath the box list the session probes with their descriptions; Tab takes the first. Type `/mod-lab fs.raed` and the word is underlined. `/mod-lab keys` lists each edit you made, and shows the row Tab took as a change by the engine.

Then ask:

```
Which directory is the session in? Answer in one line, from what you were given. #session.cwd
```

The model answers with the session's directory without a tool call: the lab ran `session.cwd` for typeahead, and the answer went beside the prompt. `/mod-lab ledger` lists it among the messages injected for the model, as a plugin's `prompt.submit` context. The ledger also says that no plugin beneath the lab added context. typeahead depends on the lab, and a plugin's dependencies sit beneath it in every chain, so typeahead runs above the lab even though the launcher loads it after the lab. For the same reason, the lab's keystroke log counts no decorations from typeahead: the lab's hook answers before typeahead paints.

<details>
<summary>Once it works: what it shows</summary>

The prompt box is the engine's, but what it draws is an event's answer. Each edit runs the chain with the draft before and the splice, and the editor shows what comes back. Painting is the gentlest thing a hook can do there: the draft stays the person's, and the runs last until the next edit's answer replaces them. A hook can do more, such as change `inputText` on the way down or return a different box, and it can swallow a key by answering `{ text: e.text, cursor: e.cursor }` without calling `next`.

Some changes to the box are not edits: stepping back to an earlier prompt, clearing the box, accepting a typeahead row, or a plugin calling `$.prompt.fill`. Those pass `prompt.change`, after the fact. Rows for the typeahead come from `prompt.autocomplete`, which nothing waits on, so a slow hook never holds up typing; its rows just arrive later.

What the model reads comes from elsewhere: from `prompt.submit`, the last place a prompt can be changed or added to before the model reads it. A context block is invisible to the person but not to the model, which is why typeahead runs only the probes that read, and only those a prompt names.

</details>
