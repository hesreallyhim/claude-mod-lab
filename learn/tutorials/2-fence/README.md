# fence: standing between plugins and the engine

In [stopwatch](../1-stopwatch) you hooked `tool.call`, an event the engine raises when the model calls a tool. Every call a mod makes on `$` is an event too. `$.fs.read(path)` raises `fs.read`, which runs through the hooks of every other plugin before the engine reads the file at the bottom of the chain. A mod can watch those calls, refuse them, or change what comes back.

You will build fence, a mod that keeps `.env` files away from other plugins and from the model. It starts by counting which plugins read files. Then it refuses `.env` files, and you watch it do so in the lab, until a symbolic link with an ordinary name gets through. You fix that by following links, make the guard refuse when it cannot decide, extend it to the model's Read tool, and finally have it redact secret-looking lines from what other plugins read.

## Before you start

This tutorial assumes you have done stopwatch, or know what it covers. In a terminal of its own:

```sh
npx claude-mod-lab learn fence
```

You build the mod in `workshop/fence/`. The checks need a plugin that reads files, so they load a second one beside yours, called reader. Its `/read <path>` command calls `$.fs.read` and answers with the text, or with why the read was refused. It is in [checks/kit.ts](checks/kit.ts) with the rest of what the checks stand on.

## 1. Who reads what

Make the folder as in stopwatch, under the name fence.

`workshop/fence/.claude-plugin/plugin.json`

```json
{
  "name": "fence",
  "version": "0.1.0",
  "description": "Keeps .env files from plugins' reads and the model's Read tool"
}
```

`workshop/fence/hooks/hooks.json`

```json
{ "modules": ["./register.ts"] }
```

`workshop/fence/hooks/register.ts`

```ts
import type { Register } from 'claude-code'

const reads: { [plugin: string]: number } = {}

function describe(): string {
  const rows = Object.entries(reads).sort(([, a], [, b]) => b - a)
  if (rows.length === 0) return 'No plugin has read a file through $ yet.'
  return `Reads through $ by plugin: ${rows.map(([plugin, n]) => `${plugin} ${n}`).join(', ')}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'fence', description: 'Which plugins read files through $' })
    return next(e)
  })

  on('command.run', { command: 'fence' }, async () => ({ text: describe() }))

  on('fs.read', async ($, e, next) => {
    const who = next.origin.plugin
    reads[who] = (reads[who] ?? 0) + 1
    return next(e)
  })
}
```

`fs.read` is an op event: one that a call on `$` raises, which the engine itself answers at the bottom of the chain. Most methods on `$` work this way, from `$.session.cwd()` to `$.http.fetch()`; `$.tool.call` raises the engine's own `tool.call` instead. The model's Read tool does not raise `fs.read`. It goes through `tool.call`, which step 5 takes up.

Three things about the hook:

- `e` arrives normalized. Whatever the caller wrote, the hooks see `{ path, as }` with the path made absolute against the session's directory and `as` filled in as `'text'`. Judge `e`, not what you imagine the caller passed.
- `next.origin.plugin` names the plugin that made the call.
- An op event's result is `{ value }` or `{ deny }`, and `next(e)` resolves to one of them. The caller's `await $.fs.read(...)` gets the value, or rejects with the refusal.

The counts live in a module variable, so a reload empties them, as you saw in stopwatch. That is fine for a look around.

## 2. Refuse a read

Add a function that knows a secret's name, at the top of the module:

```ts
/** Whether a file's name marks it as secret: .env, .env.local, prod.env. */
function isSecret(path: string): boolean {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return name === '.env' || name.startsWith('.env.') || name.endsWith('.env')
}
```

and have the hook refuse those reads:

```ts
  on('fs.read', async ($, e, next) => {
    const who = next.origin.plugin
    reads[who] = (reads[who] ?? 0) + 1
    if (isSecret(e.path)) return { deny: `fence: ${who} may not read ${e.path}` }
    return next(e)
  })
```

Returning `{ deny }` without calling `next` answers the event: nothing beneath the fence runs, and the engine never opens the file. The calling plugin's `$.fs.read` rejects with an error that carries your reason, `reader: $.fs.read: fence: reader may not read /work/.env`, and the plugin decides what to do with it. A reason that names the mod tells whoever reads it which mod refused, and the checks look for `fence` in it.

## 3. Try it in the lab

Make a stand-in secret, in the workshop where git ignores it:

```sh
echo 'API_KEY=not-a-real-key' > workshop/demo.env
```

Then start a session with the lab and your mod:

```sh
npx claude-mod-lab run
```

1. `/mod-lab fs.read workshop/demo.env`. The probe fails with your reason, and its dispatch reads `chain: fence (user) returned`: one link, and no `engine`. The file was never read. Compare `/mod-lab fs.read README.md`, whose chain is `fence (user) returned > engine (core) returned`.
2. `/fence` lists the lab's reads, and probably those of other plugins you have installed. Several plugins read files as they work, and this is one way to see which.
3. Ask Claude to read `workshop/demo.env`. It does. The fence guards calls on `$`, and the model's Read tool is not one. Step 5 deals with that.
4. Make a link with an ordinary name:

   ```sh
   ln -s demo.env workshop/notes.txt
   ```

   `/mod-lab fs.read workshop/notes.txt` reads the key. The path in `e` is the link's own, `notes.txt`, and the fence judged a name. `/mod-lab fs.stat workshop/notes.txt` shows what it missed: `isLink: true`, and a `realPath` that ends in `demo.env`.

## 4. Follow the link, and fail closed

Judge where a path leads, not what it is called. Import the type of `$` alongside `Register`:

```ts
import type { EngineInterface, Register } from 'claude-code'

type Dollar = EngineInterface
```

add a function that follows links, after `isSecret`:

```ts
/** Whether the path, or the file its links lead to, is fenced. A path that resolves nowhere is. */
async function isFenced($: Dollar, path: string): Promise<boolean> {
  if (isSecret(path)) return true
  const { realPath } = await $.fs.stat(path, { resolve: true })
  return realPath === undefined || isSecret(realPath)
}
```

and use it in the hook, which now carries a `.catch`:

```ts
  on('fs.read', async ($, e, next) => {
    const who = next.origin.plugin
    reads[who] = (reads[who] ?? 0) + 1
    if (await isFenced($, e.path)) return { deny: `fence: ${who} may not read ${e.path}` }
    return next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { deny: `fence: could not check ${e.path}, so it stays closed` }))
```

`$.fs.stat(path, { resolve: true })` answers `realPath`: the file the path lands on, with every link followed and every `..` folded. When the path is a link whose target is gone, `realPath` is absent, and the fence counts that as fenced.

`isFenced` takes `$` as an argument. A function that does must be declared at the top of the module and called by its name: the validator follows `$` into it so it can list every call the module can make. The checker's validator section now reads `calls: $.command.register, $.fs.stat (via isFenced)`. A closure inside `register` that is handed `$` is refused.

Then there is failure. `$.fs.stat` rejects for a missing file, and a hook can fail in other ways: a bug, or running out of its ten seconds. A hook that throws before calling `next` is skipped, and the chain goes on without it. For a guard that means the read happens unchecked, which is failing open. `.catch(handler)` runs in place of a hook that threw, with the same `e` and `next`. `next.called` says whether the hook got as far as calling `next`:

- If it did, `next(e)` hands back what that call settled to, and nothing runs twice.
- If not, the handler refuses.

The validator section now says `gating fs.read with .catch`, and this step's check asks for it. One cost of keeping it simple: a read of a missing file is refused as unchecked instead of failing as missing.

In the session, `/mod-lab fs.read workshop/notes.txt` is refused now. To see the `.catch` work, add `throw new Error('broken')` as the first line of `isFenced`, save, and run `/mod-lab fs.read README.md`. It is refused with "could not check", and the chain reads `fence (user) caught`. Take the `.catch` off and save again: the chain reads `fence (user) skipped > engine (core) returned`, and the file is read. Put both back as they were.

A list of names to refuse (a deny-list) stays best effort even with links followed. A hard link to `.env` has a name of its own and no link to follow. The robust form is the other way round: an allow-list of what may be read, such as everything under the project root, matched on `realPath`. The explorer's page for `$.fs.stat` has an example.

## 5. The model's reads

Add a hook on the model's Read tool, guarded by the same function:

```ts
  on('tool.call', { tool: 'Read' }, async ($, e, next) =>
    (await isFenced($, e.file_path)) ? { deny: `fence: ${e.file_path} is fenced; ask the person for what you need from it` } : next(e),
  ).catch(($, e, next) => (next.called ? next(e) : { deny: `fence: could not check ${e.file_path}, so it stays closed` }))
```

The matcher `{ tool: 'Read' }` narrows `e` to the Read tool's input, so `e.file_path` is typed. A `{ deny }` here goes back to the model as the tool's error, with your reason as its text. The reason is worth writing for the model: it is all it learns about why.

In the session, ask Claude to read `workshop/demo.env`, then `workshop/notes.txt`. Both are refused, and Claude says why. Now ask it to show the file with `cat` in Bash. That goes through: the fence knows nothing of Bash, Grep or any other way to open a file. A mod like this is a guard rail against accidental reads, not a security boundary. For a file that must stay unread, use Claude Code's permission rules and its sandbox, which cover every tool.

## 6. Change the answer

Last, change what other plugins get back. Add a redactor after `isFenced`:

```ts
const SECRET_LINE = /^(\s*[\w.-]*(?:key|token|secret|password)[\w.-]*\s*[:=]\s*)\S.*$/gim

function redact(text: string): string {
  return text.replace(SECRET_LINE, '$1[redacted by fence]')
}
```

and have the `fs.read` hook pass what it reads through it:

```ts
  on('fs.read', async ($, e, next) => {
    const who = next.origin.plugin
    reads[who] = (reads[who] ?? 0) + 1
    if (await isFenced($, e.path)) return { deny: `fence: ${who} may not read ${e.path}` }
    const result = await next(e)
    return 'value' in result && typeof result.value === 'string' ? { value: redact(result.value) } : result
  }).catch(($, e) => ({ deny: `fence: could not check ${e.path}, so it stays closed` }))
```

`'value' in result` lets a refusal from beneath pass on as it came. The `typeof` check leaves byte reads alone: a read made with `{ as: 'bytes' }` answers `{ base64 }`, not text.

Look at the `.catch`: it no longer replays `next`. The hook now does work after `next`, and that work is the point of it. If `redact` threw and the handler replayed `next(e)`, the plugin would get the text unredacted. With no `.catch` at all, the outcome would be `kept`, as you saw in stopwatch, with the same result. So whatever fails, this hook refuses.

To see it in the session:

```sh
printf 'name = demo\napi_key = abc123-not-real\n' > workshop/settings.toml
```

and `/mod-lab fs.read workshop/settings.toml`.

## Where next

[stopwatch-pane](../3-stopwatch-pane) draws the stopwatch tutorial's mod in a pane: `npx claude-mod-lab learn stopwatch-pane`. The [challenges](../../challenges) each turn on one idea from the tutorials, starting with [only-mine](../../challenges/1-only-mine).

Some ways to take fence further, without checks:

- Let the fence's own reads through unredacted: `next.origin.plugin === $.plugin.name` is true for calls the mod makes itself.
- Turn the deny-list into an allow-list: files under `await $.session.root()` may be read, matched on `realPath`.
- Redact the model's Read results too. In the `tool.call` hook, `await next(e)` and change the result; look up `ToolCallResult` in the explorer for its shape.
- Keep the read counts in `$.state`, as stopwatch does, so a reload keeps them.
