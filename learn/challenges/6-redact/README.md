# redact: redact before it is stored

The starter takes API keys out of what the person types, at `prompt.submit`. Keys still reach the conversation: a file the model reads, a command's output, a hook's context, the model's own reply. Each of those is a row the conversation keeps, which the model reads on every later request and the transcript keeps on disk. Redact keys in every row, on its way to being stored, and leave everything else as it came.

```sh
npx claude-mod-lab@alpha learn redact
```

The first run copies the [starter](starter) to `workshop/redact/`; edit it there. A key is any of:

- `sk-` and at least 20 letters, digits, `-` or `_` (Anthropic's keys, and others');
- `ghp_` and 36 letters or digits (a GitHub token);
- `AKIA` and 16 capital letters or digits (an AWS access key id).

## 1. Keys in a prompt are never stored

A key the person typed is stored as `[redacted]`, the words around it kept, each key in the row however many there are.

## 2. Nor anywhere else a row carries one

A key in a tool's result, whether its content is text or blocks of text, is redacted there, and the result still answers its call. So is a key in a hook's context and in the model's own reply.

## 3. Everything else as it came

A row without a key is stored exactly as it came, things that only look like a key's start included. No row is refused or emptied.

## 4. See it in a session

```sh
printf 'API_KEY=sk-ant-api03-k9Qw2Xc7Vb1Nm4Lp8Rt5Yz3Hj6Gf0Dd\n' > /tmp/creds.txt
npx claude-mod-lab@alpha run --model haiku
```

Ask the model to read `/tmp/creds.txt` and say what `API_KEY` is set to. It answers that the value shows as `[redacted]`: the row holding the file's text was redacted before the model read it. The explorer's Conversation X-ray shows that row, marked as rewritten beneath the lab.

The session's transcript file under `~/.claude/projects` still holds the key once, though, and not in a row: beside a tool's row the transcript keeps the tool's own structured result (`toolUseResult`, here `file.content`), which `session.append` does not reach and the model does not read. Keeping it off the disk too takes a second hook, on `tool.call`: one that answers the tool's result as its own, the key replaced (`{ result }`, without the `ref` and `text` the engine's answer carried), is recorded in place of the tool's, in the row and in `toolUseResult` alike. The checks here do not ask for it.

<details>
<summary>Hints</summary>

- `prompt.submit` sees what the person types. The event every stored row passes is `session.append`, whatever its door: `prompt`, `tool-result`, `hook-context`, `response`.
- `e.message.content` is a list of blocks. A text block has `text`; a `tool_result` block has `content`, a string or a list of blocks, and a `tool_use_id` that must stay as it is.
- A hook rewrites a row by handing `next` a changed copy of `e`. Only text and a tool result's content may change; other blocks are put back as they were, and a pinned field changed fails the hook.

</details>

<details>
<summary>Once it passes: why it works</summary>

The conversation is the list of rows the session stores, and every request the model gets is built from it, so a row's text is what the model reads, on this request and every one after. `session.append` runs for each row before it is stored, whichever way it came in, so a hook there sees what `prompt.submit` never does: tool results, attachments, a hook's context, the model's replies. The screen may show a row a moment before the hook rewrites it, but the model only ever reads the stored form. The transcript file keeps the stored rows and, beside a tool's row, the tool's structured result as it answered, which the `session.append` hook does not reach. An engine's row cannot be refused, only rewritten, which is why the mod redacts rather than drops.

</details>
