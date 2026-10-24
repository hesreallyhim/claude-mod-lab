# Note and notice: who sees what?

**Use `/mod-lab note` to add context for Claude. Use `/mod-lab notice` to display a notice for the person. Neither command asks Claude to start answering.** Both use `$.session.append`; the difference is the kind of row they ask it to add.

For a hands-on experiment, the [Session lens tutorial](../learn/tutorials/7-session-lens) builds an inspection pane, compares both session-message views, observes the first model step, and follows the saved rows through exit and resume.

The confusing word is **transcript**. Keep three things separate: the **conversation display** you read on screen, the **saved JSONL file** on disk, and the **input assembled for a model request**. They contain different selections and representations of the session's activity.

## The two rows

This table describes the row created by a successful append, separately from the command invocation and its acknowledgment. Saved-file entries assume session persistence is enabled.

| | `/mod-lab note <text>` | `/mod-lab notice <text>` |
| --- | --- | --- |
| Purpose | Give Claude additional context | Tell the person something |
| Ordinary conversation display | Hidden as a conversation message | Shown as a notice |
| Saved JSONL file | Stored as a hidden user-side record | Stored as a system/notice record |
| Model input | Available as user-role conversation content | The notice row is excluded |
| Starts a model turn? | No | No |
| X-ray | Can show the captured row | Can show the captured row |

For example, a note saying “The measurements in this project are centimetres” makes that information available when Claude next works with the conversation. A notice saying “Background refresh finished” gives you a status update without adding that notice to Claude's context. Appending alone does not make Claude acknowledge either one; `$.prompt.submit` is the separate operation for starting a turn.

**Hidden from the conversation display does not mean absent from the saved file.** X-ray and a raw transcript reader can expose a note that the ordinary chat display omits.

## Does everything Claude receives appear in JSONL?

**No. The saved JSONL is a session record, not a guaranteed recording of the exact model requests.** Request assembly combines conversation messages with a system prompt, tool definitions, and context. Even `$.session.messages({ as: 'api' })` supplies only the normalized conversation messages used to build a request: it excludes the system prompt, tool list, and some additions made when sending.

There is a concrete distinction between two hooks:

| Hook | What changes for the model? | What is saved? |
| --- | --- | --- |
| `session.append` | If the row is included in model input, the rewritten content is used | The rewritten content is stored too; the chat display may already have shown the original |
| `prompt.attachment` | The hook can replace or omit text when an engine attachment is rendered for Claude | The transcript keeps the engine's attachment record, which need not contain the replacement text |

So a mod can affect what Claude receives without that exact text becoming a saved conversation row. That does **not** mean `/mod-lab note` conceals its text from JSONL: the note uses the append route above. Nor does a `system` record in JSONL necessarily represent the model's system prompt.

## Why the API's names feel odd

The lab makes these calls, with text blocks in `content`:

```ts
// note
$.session.append({ message: { type: 'user', content: [{ type: 'text', text }] } })
// notice
$.session.append({ message: { type: 'system', content: [{ type: 'text', text }] } })
```

Here, `type: 'user'` means a user-side row, even though a plugin supplied it. The engine marks the note `isMeta: true`, hiding it as a typed message, and gives it the request role `user`.

Here, `type: 'system'` means a **system notice record**, not the model's system prompt. The notice has no model-request role. Also, both calls enter through the API's `note` door: `door` identifies the plugin-append route; it does not distinguish the lab's two command names.

## The command and its row are separate

Typing `/mod-lab notice Background refresh finished` can also put those words into a separate command record. Returned command text is another record Claude can read; the lab's acknowledgment contains a status and row ID. The notice row's audience says nothing about other records containing the same words.

The Explorer buttons invoke the lab through its bridge instead of typing the slash command. Treat the audience as a property of **the appended row**, rather than a promise about every occurrence of its text.

## When should a note take effect?

The lab waits for `session.append` to accept the row before acknowledging it. The API says it is listed immediately; there is **no documented requirement for an extra whole turn to elapse**. The append starts no turn and cannot change a request already underway. A subsequent request can include the note, subject to request construction and compaction.

For a clearer experiment, add a note through Explorer while Claude is idle, wait for the acknowledgment, then submit a normal prompt. This avoids mixing the note with a typed command containing the same text. Claude saying “I cannot see it” is not proof of absence: inspect the row's UUID in JSONL and the normalized messages at the first subsequent `turn.step` to investigate delivery. Those messages still are not an exact wire capture. We have not yet measured the first-request timing in a live experiment, so the reported recall failure remains unexplained.

## What X-ray establishes

X-ray keeps the latest 200 successful append observations captured while the lab is loaded. Its audience labels are inferred from row metadata; they do not prove that a particular model request contained the row or that Claude used it. Opening a row separately looks for its saved JSONL record.

An append adds to the conversation; request construction and later compaction determine what is carried forward. X-ray is therefore an observation history, not a complete view of Claude's current context. Other append events can lack matching saved records; that does not contradict the persistence of these successful note/notice appends.

---

Checked against the lab's [implementation](../mods/mod-lab/hooks/rows.ts), [tests](../mods/mod-lab/tests/rows.test.ts), and Claude Code **2.1.310** declarations (`SessionAppendArgs`, `SessionAppendMessage`, `SessionAppendResult`, `ApiMessage`, and the `session.append` / `prompt.attachment` event contracts). Saved-file behavior is also corroborated by the [2.1.303 observations](append-stream.md); no new live persistence experiment was run for this guide. See the official [command-output behavior](https://code.claude.com/docs/en/plugins/mods/api#add-a-command), [prompt hooks](https://code.claude.com/docs/en/plugins/mods/reference#prompts-and-what-claude-reads), and [guidance on version-specific declarations](https://code.claude.com/docs/en/plugins/mods/reference).
