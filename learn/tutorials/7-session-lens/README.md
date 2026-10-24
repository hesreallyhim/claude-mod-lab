# Session lens: what is saved, shown, and sent?

Add a fact to a conversation without typing it into the prompt. Then inspect where it appears: in the chat, in the saved JSONL, and in the messages used to build a model request. Finally, close the session and resume it. What comes back?

You will build a small inspection pane with four controls: **Add note**, **Add notice**, **Inspect views**, and **Ask Claude**. The starter already draws the pane; you fill in the API calls. It uses two harmless, fixed experiment markers:

- Note: `SESSION-LENS NOTE: the museum locker is cobalt.`
- Notice: `SESSION-LENS NOTICE: the desk lamp is amber.`

The pane reports whether those exact markers occur in each message view. It does not display your other conversation content or return the inspected messages as command output.

Excerpts captured from the finished pane in a live 2.1.310 session; counts vary with the conversation:

```text
[ Add note ] [ Add notice ]

[ Inspect views ] [ Ask Claude (model turn) ]

Latest inspection

Summaries: 0 messages; note not found; notice not found

API messages: 1 messages; note found; notice not found

First model step of latest turn

Step API messages: 1 messages; note found; notice not
found
```

This is a longer tutorial. The useful result is an instrument you can keep using, and a way to distinguish an observation from an inference. Claude's answer to a recall question is interesting, but is not the test of whether a message was stored or supplied as context.

## Before you start

Use a dedicated lesson workspace and Claude Code **2.1.310 or later**. This lesson was checked against 2.1.310; that is its declared minimum, not a change to the lab's overall support floor. The [tick tutorial](../0a-tick) introduces panes and buttons if these are new to you.

From your lesson workspace, run:

```sh
npx claude-mod-lab@alpha learn session-lens
```

Or choose **Start from the lesson's starter** on this lesson's Explorer page. Both routes create `workshop/session-lens/` and a source-only reference in `solutions/session-lens/`. The reference is not registered as a second plugin. In another terminal, start the workspace session:

```sh
npx claude-mod-lab@alpha run
```

Edit `workshop/session-lens/hooks/register.tsx`. Saving reloads the mod; its temporary pane readings reset. Appended conversation rows are separate from those readings. Most exercises make no model request. **Ask Claude** deliberately starts one and uses your session's selected model and quota.

## 1. Open the lens

Type `/session-lens`. The pane opens and takes keyboard focus. Its buttons have keys: `n` for note, `v` for notice, `i` for inspect, and `a` for Ask Claude. Escape returns focus to the prompt; Ctrl+X then Tab gives it back to the pane.

The starter can already identify its session. These helpers are supplied:

| Method | What it tells you | What it does not tell you |
| --- | --- | --- |
| `$.session.id()` | The session ID, used in its JSONL filename | The entire path to that file |
| `$.session.cwd()` | The session's current working directory | Where Claude stores its configuration or transcripts |
| `$.session.version()` | The running engine's build | The version of some other terminal's `claude` executable |

The first checker step passes once the mod validates. The remaining buttons are wired to functions with blanks marked `Step`.

Before filling them, distinguish these three things:

| View | What it represents |
| --- | --- |
| Chat display | What the interface draws for the person; some rows are hidden or shown only in an expanded view |
| Saved JSONL | Records on disk used to restore conversation history, plus bookkeeping |
| Model input | A request assembled from conversation messages, system instructions, tools, and context processing |

The pane is another UI surface. Reading text there does not by itself insert that text into the conversation.

## 2. Add a model note

The idea: **append a conversation row without starting a turn**. A turn is the work Claude begins for a submitted prompt; it can contain several model requests and tool calls.

In `addNote`, replace the Step 2 placeholder's `null` with a call that appends `NOTE` as a `user` row. `await` waits for the append result before the helper reports success or refusal. The text block is an object describing one piece of message content.

<details>
<summary>Hint</summary>

Use `$.session.append({ message: { type, content } })`. `content` is an array of text blocks. The helper already handles the result's `uuid` or `deny`.

</details>

<details>
<summary>Answer</summary>

```ts
await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: NOTE }] } })
```

</details>

Save and press **Add note**. The pane reports acceptance and a UUID, the identifier you can use to find that specific row in JSONL. Claude should not start answering merely because you appended it.

Here `user` means a user-side conversation row, not a claim that a person typed it. The engine marks this plugin note as hidden from the ordinary chat display. With session persistence enabled, its text is saved. **Hidden in the UI does not mean secret or absent from JSONL.** Acceptance confirms that the append succeeded; it does not certify a disk flush or a particular model request.

## 3. Add a chat notice

The idea: **a saved row can be excluded from model input**.

In `addNotice`, replace the Step 3 placeholder's `null` with the same kind of call, using `type: 'system'` and `NOTICE`.

<details>
<summary>Hint</summary>

Change the row type and text; keep the same text-block shape.

</details>

<details>
<summary>Answer</summary>

```ts
await $.session.append({ message: { type: 'system', content: [{ type: 'text', text: NOTICE }] } })
```

</details>

Save, then add one note and one notice. Both have identifiers. The notice is intended for the person's conversation display, and its row is excluded from model input. If your terminal does not show it in the ordinary view, check the expanded transcript with Ctrl+O; presentation depends on the surface. Neither button submits a prompt.

`system` here means a **system notice record**, not the model's system prompt. This is why filtering JSONL by `type` alone cannot tell you everything the model received.

## 4. Inspect two message views

The idea: **reading session messages is not the same as reading the raw file**.

In `inspect`, replace the two Step 4 empty arrays with the session's readable-message and API-message views. The prewritten helper counts messages and searches their text for our two markers.

<details>
<summary>Hint</summary>

The ordinary call takes no arguments. The normalized form takes `{ as: 'api' }`.

</details>

<details>
<summary>Answer</summary>

```ts
const plain: SessionMessage[] = await $.session.messages()
const api: ApiMessage[] = await $.session.messages({ as: 'api' })
```

</details>

Save, add the note and notice if needed, then press **Inspect views**. Compare the readings rather than expecting equal counts or membership. In the verified 2.1.310 trial, the note appeared in **API messages**, but not in **Summaries**; the notice appeared in neither. Absence from the summaries did not mean absence from model context. A notice's text could still appear through some other row if you typed or quoted it; these readings search text, not provenance.

| Read | What it provides |
| --- | --- |
| `session.messages()` | Convenient transcript-message summaries: role, text, and tool information. Notices and UI log lines are excluded. This is a different projection from the API view, not a complete list of model context. |
| `session.messages({ as: 'api' })` | Normalized conversation messages with content blocks, used to build the next request; compaction and reminder rendering can change their representation. |
| The JSONL file | Saved conversation records and bookkeeping, including records that neither method returns. |

Both methods are bounded to the latest 4096 entries. The API view excludes the system prompt, tool definitions, and some additions made when sending. **It is not a full request capture.** The pane reports a snapshot from when you pressed the button, not a continuously authoritative account of Claude's context.

Why use buttons? A typed `/mod-lab note ...` command can create command records, and returned command text can itself be model-readable. This lesson's command only opens the pane. The inspected content stays in the pane, so inspection does not add a second copy through a command reply.

## 5. Start a model turn

The idea: **append and submit are different operations**.

In `ask`, replace the Step 5 placeholder's `null` with a call to `$.prompt.submit({ text: QUESTION })`. `QUESTION` is supplied in the starter. It asks for the museum locker color without including the answer.

<details>
<summary>Hint</summary>

The method takes an object with a `text` field. The helper already reports whether submission was accepted or dropped.

</details>

<details>
<summary>Answer</summary>

```ts
await $.prompt.submit({ text: QUESTION })
```

</details>

Save, add a note, and press **Ask Claude** while the session is idle. This button intentionally starts a model turn. You can also wait until the next step is implemented and do both experiments with one request.

Claude may answer “cobalt,” but recall is not our pass condition. Even an answer claiming “I cannot see a note” does not establish which messages were supplied. The next step observes the message view at the point a request is about to run.

## 6. Observe the next model step

The idea: **observe at a defined moment, and label what you observed**.

A model step is one request within a turn. The starter's `turn.step` hook only records step zero of the main conversation. It ignores subagent steps and later tool-loop steps so they cannot overwrite that first observation.

Replace the Step 6 empty array with `await $.session.messages({ as: 'api' })`. The helper stores the marker readings with the turn ID and step index. The supplied `yield* next(e)` then forwards the engine's response stream; leave it in place. An async generator passes a stream of pieces rather than returning one answer.

<details>
<summary>Hint</summary>

This is the same API-message read as Step 4, performed inside a hook instead of a button handler. The hook's `e` has a message count, not a message array.

</details>

<details>
<summary>Answer</summary>

```ts
const messages: ApiMessage[] = await $.session.messages({ as: 'api' })
```

</details>

Finish editing, then exit the practice session with `/exit`. Start a **new** disposable session with the completed mod, without `--resume` or `--continue`:

```sh
claude --plugin-dir ./workshop/session-lens
```

Open `/session-lens` and press **Inspect views** first. Both markers should be absent. If either is already present, do not use that session to test first delivery: an older copy could make the experiment pass. While Claude is idle, add the note and notice exactly once, wait for their acknowledgments, and press **Ask Claude**. Compare the pane's **first model step** observation with its manually refreshed message views. The first-step reading remains the snapshot from that hook invocation, even after Claude answers. Use this same session for Step 7.

If the note marker is present there, you have evidence that it was in the normalized conversation view at the first step. That is stronger than asking Claude to describe its history. It still does not capture the exact outgoing request: system instructions and tools are outside this view, and other hooks may run later. There is no documented rule requiring an extra whole turn before a successful append can be used. A note cannot alter a request that was already in progress.

## 7. Read JSONL and resume

This step is **live/manual**. Green checker results establish how your mod handles the test fixtures; they do not certify disk persistence, real request contents, or resume behavior.

1. Use a disposable lesson session with persistence enabled. Record the session ID, engine version, and the note and notice UUIDs shown in the pane. Let any active turn finish.
2. Find `<session-id>.jsonl` under Claude's configuration directory, normally `~/.claude/projects/`. Use the session ID rather than deriving an encoded folder name from the working directory. A custom `CLAUDE_CONFIG_DIR` changes the location. Open the file read-only in your editor.
3. Find the exact note UUID. Inspect its `type`, `isMeta`, and `message.content`. Find the notice UUID separately. Search by UUID first: the same text can also occur in a request snapshot, command output, or later answer. The existence of `api-request-*` bookkeeping in one build is not a portable guarantee that every file contains full request captures.
4. Exit normally with `/exit`. From the same workspace, resume that ID with the same plugin loaded:

```sh
claude --resume <session-id> --plugin-dir ./workshop/session-lens
```

5. Open `/session-lens` and press **Inspect views before adding anything**. The pane's temporary readings and saved UUID labels reset with the process; that does not mean the conversation records disappeared. Search the same JSONL UUIDs and compare the restored message views. Look for the note specifically in **API messages** in this small uncompacted experiment; the notice should remain a saved notice, not become a user message for the model. Record any difference rather than explaining it away.
6. Optionally press **Ask Claude** again and compare the new first-step observation. This uses another model request. Resume the same session, rather than starting a fresh one that happens to load the same plugin.

**Resume restores conversation history from the saved transcript.** It does not make every JSONL record into model input. After compaction, the restored conversation uses the latest summary, the unsummarized remainder, and later messages. The runtime then builds requests using that conversation and the current configuration. Launch flags such as `--plugin-dir` are not all restored automatically; preserve the relevant flags when comparing runs.

For a second experiment in a disposable session, you can use `/compact`, then repeat inspection and resume. Compaction may spend tokens and replace detailed context with a summary. Do not treat a missing literal marker after compaction as proof that its original row was never saved. `$.session.compact()` is the API operation for requesting compaction between turns; this lesson does not call it automatically.

## Two ways a hook can change text

These are explanations and extension ideas, not additional checker steps:

| Hook | What changes | Persistence implication |
| --- | --- | --- |
| `session.append` | Content before a row is kept | The rewritten content is stored and, for a row included in model input, sent. A UI may already have shown the earlier text. |
| `prompt.attachment` | An engine attachment's rendering for the model | The engine's attachment record remains in the transcript. Replacement text need not be recorded there verbatim. Rendering is evaluated again on resume. |

So JSONL is a durable basis for restoring a conversation, but does not guarantee exact reproduction of every past model input. A changed attachment hook can change how a restored record is rendered. Mods are trusted executable code; these hooks affect more than presentation.

If you try an append-rewrite extension, scope it to synthetic lesson markers. A plugin's own API calls skip its own matching hook, so do not assume its Note button will pass through a `session.append` hook in the same plugin. The [redact challenge](../../challenges/6-redact) covers append rewrites with a separate caller.

## What you made

An observation pane that separates **accepted**, **saved**, **available in a message view**, and **observed at a model step**. These are different claims, each with its own evidence.

| API or event | Coverage in this lesson |
| --- | --- |
| `$.session.append`, user and system rows, `uuid`, `deny` | Written in Steps 2–3; acceptance and refusal checked |
| `$.session.messages()`, `{ as: 'api' }` | Written in Step 4; shapes and marker summaries checked; live observations required for engine semantics |
| `$.prompt.submit` | Written in Step 5; only the explicit action submits a prompt |
| `turn.step`, `turnId`, `index`, `agentId`, `yield* next(e)` | Read in Step 6; message-read blank written; main first-step filtering and stream forwarding checked |
| `$.session.id`, `cwd`, `version` | Supplied and explained; identify the observed session |
| `session.start`, `$.command.register`, `command.run` | Supplied command plumbing |
| `$.ui.open`, `ui.render`, `$.ui.resolve`, `$.ui.invalidate`, `Box`, `Text`, `Button` | Supplied observation UI; buttons exercised by checks |
| `$.session.compact`, `session.append` interception, `prompt.attachment` | Explained only; not implemented or claimed as exercised |
| JSONL persistence and resume | Manual exercise; not simulated by the checker |

## Keep going

- Can you show the kinds of content blocks in the API view without printing their contents? Start with each block's `type`.
- Can you keep a small list of first-step observations instead of only the latest one? Keep the turn ID with each snapshot.
- Can you compare a snapshot before and after `/compact` while preserving the distinction between exact marker text and a summary?
- Can you inspect a subagent explicitly with `$.session.messages({ agentId })`, and show a refusal instead of falling back to the main conversation?

Contract references: Claude Code 2.1.310 generated `SessionAppendArgs`, `ApiMessage`, `TurnStepInput`, and `prompt.attachment` declarations; official [session resume behavior](https://code.claude.com/docs/en/sessions#what-a-resumed-session-restores), [mod API](https://code.claude.com/docs/en/plugins/mods/api), and [version-specific reference guidance](https://code.claude.com/docs/en/plugins/mods/reference). The declarations written by your installed build take precedence over an older published copy.

Live validation on 2026-10-24: Claude Code 2.1.310, terminal pane, one Haiku turn, then normal exit and resume with the same plugin. Both markers were absent initially. The note appeared in API messages before the turn and at its first step; the notice did not. JSONL contained the accepted note UUID as a hidden user record and the notice UUID as a system record. After resume, the API view still contained the exact note marker and excluded the notice marker, while the pane's temporary observations reset. The ordinary message summaries omitted the note marker both before and after resume. These are observations of that build and experiment, not guarantees about all versions or all session configurations.
