# The append stream and the transcript file

For the distinction between `/mod-lab note` and `/mod-lab notice`, start with [Note and notice: who sees what?](note-and-notice.md).

What the Conversation X-ray shows, what the transcript file holds, and how the two differ. The X-ray's rows come from the lab's hook on `session.append` (`mods/mod-lab/hooks/rows.ts`). The transcript file is `~/.claude/projects/<folder>/<session id>.jsonl`, written by Claude Code.

## What a `session.append` hook receives

One event per row the engine appends to the conversation. On `e`:

- `message`: the row as it will be kept, with `type` (`user`, `assistant`, `attachment`, `system`), an optional `name` (an attachment's type or a notice's subtype), and `content`, the row's exposed blocks. For an attachment, `content` is the engine's recorded rendering; a later `prompt.attachment` hook can change what the model receives. A notice can carry a text block without being included in model input.
- `door`: how the row came in (`prompt`, `response`, `tool-result`, `hook-context`, `attachment`, `notice`, `note`, `compaction`, `queue`, and others).
- `origin`: who caused it.
- `uuid`: the row's id, the same in the transcript file.
- `agentId`: on a subagent's row.

Not on `e`: an attachment's payload, the row's timestamps and parent links. A `hook_success` attachment's `hookName` and `stdout` are payload, so a hook never sees them. The declarations say so under `SessionAppendInput`.

## Two ways the stream and the file differ

**Rows the stream has and the file does not.** The engine appends a `hook-context` row for every settings or plugin hook that runs. The file keeps a `hook_success` record only for a hook that produced output, and a `hook_additional_context` record only when something was added for the model. A hook that ran and produced nothing has a row in the stream with empty `content` and no record in the file.

**Records the file has that pass no hook.** The file also keeps bookkeeping records that are not rows of the conversation: `last-prompt`, `mode`, `permission-mode`, `file-history-snapshot`, `api-request`, `api-request-shape`, `api-request-blob`, `ai-title`, `atis-latch`. None of these passes `session.append`. (`queue` is raised as a virtual append, not kept as a conversation row; queue operations can still have JSONL bookkeeping records.)

So neither is a subset of the other. The stream is the conversation as the engine builds it in memory; the file is the kept rows of that conversation plus the engine's own records.

Neither is a guaranteed capture of the full request sent to Claude. In the 2.1.310 declarations, `prompt.attachment` can replace or omit attachment text for the model while the transcript keeps the engine's record. By contrast, a `session.append` content rewrite changes what is stored and, if that row is sent to the model, the content sent. See [Note and notice](note-and-notice.md) for this distinction and the limits of `session.messages({ as: 'api' })`.

## Measured

Two sessions on Claude Code 2.1.303, read on 2026-10-23.

A session of 154 transcript records: 79 conversation rows (18 `user`, 32 `assistant`, 20 `attachment`, 9 `system`) and 75 bookkeeping records. The X-ray in the same session listed 90 rows: the 79, plus 11 `hook-context` rows the file did not keep. The row counts match by door: 4 prompts, 13 tool results and 1 note are the 18 `user` records; 32 responses the 32 `assistant`; 7 notices and 2 command rows the 9 `system`; 18 attachment rows plus 13 hook-context rows against 20 attachment records, of which 2 were hook records.

A session with four session starts (a startup and three compactions) kept, per start, one `hook_success` record for the single SessionStart hook with output, and one `hook_additional_context` record, while several SessionStart hooks ran each time.

## What the X-ray can and cannot show

- An empty `hook-context` row is a hook that ran and added nothing for the model. The lab cannot name the hook: the name is payload.
- An empty `system` row by the `notice` door is a notice whose record carried no text block.
- For a row the file kept, the record can be read by `uuid`, which the hook does receive. That is where a hook's name and output, a notice's subtype, or a tool result's full text would come from. For a row the file did not keep, there is nothing to read.
- A view of every record in the file, bookkeeping included, is a transcript reader, not the X-ray.
