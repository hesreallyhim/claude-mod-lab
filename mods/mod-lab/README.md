# mod-lab

Runs calls on `$` from inside a Claude Code session and shows, for each, the value it returned and every event it dispatched: the event's name, the input hooks saw, what came back, and each link of the chain that answered.

## Install

From a terminal:

```
claude plugin marketplace add hesreallyhim/claude-mod-lab
claude plugin install mod-lab@claude-mod-lab
```

## Use

`npx claude-mod-lab run` loads it (Claude Code with this mod, mod-lab-bridge, mod-lab-target and mod-lab-keys), or `claude --plugin-dir mods/mod-lab --plugin-dir mods/mod-lab-target --plugin-dir mods/mod-lab-keys`. mod-lab depends on those two and does not load without them.

- `/mod-lab` opens the pane, and says where the session draws ("mod-lab is running in the desktop app."), with a sentence more when its Claude Code is older than the lab supports. In the pane, choose a noun and a probe, edit its arguments, press Run (or `r`). The run's value, its dispatches and the probe's source are drawn below. `t` shows the session events the lab traced (prompts, turns and each model request in them with when its chunks arrived, tool calls, commands), each with the chain that answered it, `h` the runs so far and every model call a plugin made, and `i` the intercepts.
- `/mod-lab help` lists every subcommand by kind, each with a line on what it does.
- `/mod-lab <probe> [value]` runs a probe and prints the result in the transcript; the value fills the probe's first parameter. `/mod-lab <probe> {"name": value}` names the arguments. `/mod-lab list` lists the probes, `/mod-lab trace on|off` starts and pauses the trace.
- `/mod-lab explorer` gives the URL of this session's explorer, which mod-lab-bridge's MCP server serves, starting it if it waits; `/mod-lab explorer serve <seconds>` keeps a `-p` session open for it. mod-lab allows its own and mod-lab-bridge's calls on that server's tools (`mcp__plugin_mod-lab-bridge_explorer__*`) without a permission prompt; other callers, the model included, keep the session's permission rules.
- `/mod-lab intercept <event> <behavior> [lab|others|all] [value | ms]` puts the lab's own hook on an op event. Intercepts are described below.
- `/mod-lab ledger` says what the model reads in the session and where each part comes from. It is described below.
- `/mod-lab verify` checks what the lab relies on about the engine's behaviour against the build the session runs: what a call on `$` dispatches, how `e` arrives, which of a plugin's own hooks see its calls, what a failed hook leaves standing, what `$.store` and `$.state` do, and the name the probe tool gets. Each check runs the probes that show it. The failed hooks and the timer that fires after its hook returned are mod-lab-target's ([mods/mod-lab-target](../mod-lab-target)). mod-lab lists it as a dependency, which puts it beneath the lab in every chain; where it is beneath something else, those claims are marked not checked.
- `/mod-lab eject [run]` writes the calls a run made as bottom hooks for a test, each answering as the session did, and copies them to the clipboard. The explorer's run cards have a "Copy as test hooks" button that does the same. In a test of your own mod, they stand where the engine would.
- `/mod-lab spend` lists every model call a plugin made in the session: which plugin, the tokens in, out, written to the cache and read from it, and whether the call reached the model at all. `/mod-lab free on` sets two intercepts that answer the lab's own `model.complete` and `model.fork` calls with no request sent, and `/mod-lab free off` lifts them. The explorer's Model workbench uses both.
- `/mod-lab agent` lists the session's agents: the types the lab registered, every spawn its hook saw (the model's own included) and each one's answer. `/mod-lab agent register {json}` registers a type, `/mod-lab agent spawn <type> <prompt>` starts one, `/mod-lab agent hide|show <type>` keeps a type from the model or offers it again, `/mod-lab agent route <model>|off` sends every new spawn to one model, and `/mod-lab agent transcript <agentId>` shows an agent's conversation. The explorer's Agents page uses them.
- `/mod-lab rows` lists append events captured since the lab loaded, with an audience inferred from row metadata. `/mod-lab note <text>` adds model context hidden from the chat display; `/mod-lab notice <text>` adds a chat notice whose row is excluded from model input. Both are saved in JSONL when session persistence is enabled, and neither starts a model turn. The explorer's Conversation X-ray shows these events and can look up their JSONL records; it is not a full model-request capture. The [Session Lens lesson](../../learn/tutorials/7-session-lens/README.md) explores these distinctions through a mod you can build and inspect.
- `/mod-lab compactor keep <n>` makes the lab answer compactions itself: the first message, a summary it writes from counts (no model call), and the last n messages; `/mod-lab compactor off` leaves them to the engine, and `/mod-lab compactor` lists the session's compactions with who answered each, the messages before and after, the sizes and what the summarizer cost. `/compact` compacts; `/mod-lab compact` does the same from the explorer, since the engine refuses a compaction from a typed command, which holds the turn. A compaction is not undone. Where an organization manages Claude Code, the lab's hook on compactions does not run in a copy the person installed, as the section on versions below says.
- `/mod-lab keys` lists the prompt box's newest edits as the lab's `prompt.edit` hook saw them pass, and the changes that came another way (`prompt.change`), which mod-lab-keys ([mods/mod-lab-keys](../mod-lab-keys)) keeps: each key by name, the splice, the lengths before and after, and the decorations the plugins beneath painted. A character typed plain is kept as `text`, and the draft itself is not kept. The explorer's Prompt box page draws them. On a build older than 2.1.300, mod-lab-keys does not load, and the command says change rows need that build.
- `/mod-lab config [filter]` lists the session's `/config` rows by owner, the engine's and each plugin's `userConfig` fields, with kind, value, options and lock. `/mod-lab config set <key> <value>` writes one as `/config` does, through every plugin's `config.set` hook but the lab's, and says when a hook changed the value or refused it. It changes your settings file. The explorer's Settings page draws the rows.
- The model can run probes through the tool `mcp__mod-lab__probe`, so you can ask Claude to run one and explain what it shows. Three more tools read what the lab recorded and run nothing: `mcp__mod-lab__runs` (the probes run so far, from anywhere, with their dispatches and chains), `mcp__mod-lab__trace` (the session events traced, with their chains) and `mcp__mod-lab__intercepts` (the intercepts in force and the calls they acted on), so you can ask Claude what happened. Each answers the newest records that fit in about two thousand tokens. A fourth, `mcp__mod-lab__lesson`, reads the lesson state in the session's folder (`.claude-mod-lab/progress.json`): the lesson you are on and the report of its last check, which the explorer runs each time you save.
- Other plugins can run probes with `$.lab.run({ probe, args })` and list them with `$.lab.probes()`, do anything else `/mod-lab` does with `$.lab.command({ text })` (`text` being what follows `/mod-lab`, the answer the text the command shows), list the events it can intercept with `$.lab.interceptable()`, and ask for the lab's folder with `$.lab.root()`; the contract is in `types/index.d.ts`. The explorer page uses these through mod-lab-bridge.

A command's output and a tool's result are read by the model; the pane and the trace are not. The probe tool is registered with its schema in the model's tool list from the start (`isDeferred: false`), so while the lab is loaded each request carries a few hundred tokens more. The reading tools wait behind tool search (`isDeferred: true`): the model sees their names, and loads a schema when it needs one. The lab's own hooks answer all five, so none asks for permission.

## What the probes do

55 probes cover the nouns of `$`. Most only read. The rest say so with an effect label: `ui` draws (a toast, the status line, the prompt box), `write` changes something (the lab's store and state, the clipboard, a file under `~/.claude-mod-lab/scratch/`), `network` fetches an https URL, `spend` makes a model request, `dialog` opens the question dialog, and `tool` runs the Read tool. `/mod-lab list` marks each.

## Intercepts

An intercept makes the lab one of the hooks on an op event, with behaviour chosen from a fixed list. It is a way to see what a hook can do to a call before writing one.

| Behavior | What the lab's hook does | What the chain shows |
| --- | --- | --- |
| `watch` | records the call and passes it on | the links beneath, as usual |
| `refuse` | answers `{ deny }` without calling `next` | only the lab; the caller's call rejects |
| `answer <json>` | answers `{ value }` without calling `next` | only the lab; the engine is never asked |
| `rewrite <json fields>` | calls `next` with those fields of `e` changed | each link beneath with the `received` it saw |
| `delay <ms>` | sleeps, then calls `next` | past 10 s, the dispatch is abandoned and the lab's `.catch` passes the call on |

`process.spawn` streams, so on it the lab takes `watch` and `refuse` alone: a watch passes each piece of the child's output on and records how many passed, and a refusal rejects the caller's stream before a child starts.

The scope says whose calls it acts on: `lab` (the probes; the default for all but watch), `others` (every other plugin's), or `all` (the default for watch). With `others` or `all` it acts on other plugins' calls too: `/mod-lab intercept fs.read watch others` lists every plugin's file reads, with the chain that served each. An intercept that changes other plugins' calls lapses after a minute.

Intercepts are kept in `$.state`, so they survive a reload. The calls they acted on are listed by `/mod-lab intercept` and in the pane's Intercept view, and `/mod-lab intercept census [event]` adds them up per event: who made the calls, which plugin answered them, and each link beneath the lab with its outcomes and median time. With a watch on `others`, that shows which plugins hook an event, in what order, and how long each takes. A chain entry with `received` marks a link that saw a different `e` from the one the lab's hook passed on: a hook between them rewrote it. This applies to the trace's session events as well, so another mod's rewrite of a prompt or a tool call shows there too.

## The ledger

`/mod-lab ledger`, and the explorer's Context ledger page, put together what the model reads and who put each part there:

- the engine's own measure of each category, as `/context` counts it (`$.session.usage({ breakdown: 'summary' })`);
- the system prompt's sections by owner (`$.prompt.compose()`; a plugin's section id is `<plugin>:<name>`);
- the tools sent with every request and those waiting behind ToolSearch, by provider, as the lab's `tool.describe` hook saw the engine describe them;
- the lines each plugin added to the latest prompt's context, read off the `prompt.submit` chain: a line first received by one link was added by the link above it;
- the blocks plugins added to the first message's context (`prompt.context`), read off that chain the same way;
- every message the engine injected for the model (`prompt.attachment`), by source: the engine's own (skill and agent listings, instruction files, reminders), a settings hook's output, or a plugin's context.

Estimates are in tokens at the system prompt's measured rate of characters per token. Only plugins beneath the lab are in the chains it reads, which `npx claude-mod-lab run` arranges by loading it first. Where an organization manages Claude Code, `prompt.context` and `prompt.attachment` hooks do not run for plugins the person installed.

## Claude Code versions

mod-lab supports Claude Code 2.1.299 and newer, and was last tested on 2.1.308. The two numbers are in `compat.json` at the repository root, the one place they are edited. `npm run sync-compat` copies it into this folder, since an installed plugin reads only its own, and `npm run check` fails when the copy differs.

- At session start the lab reads its copy and the version (`$.session.version()`). Below the floor, a line in the transcript says to update Claude Code, once per version: the store remembers which versions were told. Nothing is switched off. `testedThrough` is a record of the last version checked; nothing is said about a version past it.
- The version number shows in `/mod-lab verify` and in the explorer's header, and nowhere else.
- The lab hooks only events the floor has. Its one hook on a newer event, `prompt.change`, is mod-lab-keys': on an older version that plugin alone is refused, and `/mod-lab keys` says change rows need a newer version of Claude Code.
- The capability table names each feature that calls a noun or method newer than the floor, by what follows `/mod-lab` (a probe id or a command), with the version it arrived in. Where the session runs an older version, the feature is left out of `/mod-lab list`, the pane, the probe tool and the explorer; asked for by name, it answers "needs a newer version of Claude Code" and does not run. A call that fails anyway is caught and reported as the run's error.
- Each step of `session.start` (the command, the tools, the version check, tracing, the intercepts) runs on its own: one that fails is logged in the transcript, and the others run.

The file's shape, where `plugins` holds each plugin of this repository that needs more than the floor (mod-lab-keys, and templates above it) and `capabilities` each lab feature that does:

```json
{
  "floor": "2.1.299",
  "testedThrough": "2.1.308",
  "plugins": { "mod-lab-keys": { "since": "2.1.300", "uses": ["prompt.change"] } },
  "capabilities": { "<probe id or command>": { "since": "<the build it arrived in>", "uses": ["<noun.method>"] } }
}
```

Where an organization manages Claude Code, hooks on `session.compact`, `prompt.context`, `prompt.attachment` and `settings.read` do not run in plugins the person installed. There the compactor neither lists compactions nor answers them, the ledger misses what plugins and the engine add, and the `settings.read` probe records no dispatch; each says so in its text.

## Layout

| File | What it holds |
| --- | --- |
| `hooks/register.tsx` | every hook, and the pane's own state: the probe chosen, the arguments typed, the view |
| `hooks/tools.ts` | the tools the model calls: the probe tool, and the tools that read the runs, the trace, the intercepts and the lesson state |
| `hooks/commands.ts` | what `/mod-lab` and what follows it do, and the list of its subcommands that `/mod-lab help` and the argument hint read |
| `hooks/runs.ts` | the runs and the trace, kept in `$.state`; `/mod-lab eject` and `/mod-lab trace` |
| `hooks/interception.ts` | the intercepts in force, the pane's draft of one and the calls they acted on, kept in `$.state`; `/mod-lab intercept` and `/mod-lab free` |
| `hooks/probes.ts` | the probe functions, the `switch` that calls them, and their metadata |
| `hooks/runner.ts` | the queue runs wait in, and one run from arguments to a record |
| `hooks/inspect.ts` | the hooks' bodies that record the lab's own dispatches while a probe runs, a stream's too, and hand intercepted calls to `interpose` |
| `hooks/intercept.ts` | the events the lab can intercept, the behaviours, and the intercepts in force |
| `hooks/census.ts` | what the calls intercepts recorded add up to, per event |
| `hooks/ledger.ts` | who added what to the model's input, read off chains and kept in `$.state`, and the ledger's text |
| `hooks/spend.ts` | the spend meter, and free mode's intercepts |
| `hooks/agents.ts` | `/mod-lab agent`: the types the lab registers, every spawn and its answer |
| `hooks/rows.ts` | the rows the conversation keeps; `/mod-lab note` and `/mod-lab notice` |
| `hooks/compactor.ts` | the lab's compactor and the session's compactions |
| `hooks/streams.ts` | the `process.spawn` probe, and a stream's arrivals in brief |
| `hooks/keys.ts` | the prompt box's edits, and the changes mod-lab-keys keeps, in brief |
| `hooks/compat.ts` | the versions the lab supports, from `compat.json`: the check at session start, `/mod-lab`'s line, the capability table |
| `hooks/config.ts` | the `/config` rows and `/mod-lab config` |
| `hooks/eject.ts` | a run's calls as bottom hooks for a test |
| `hooks/verify.ts` | what the lab relies on about the engine, as the claims `/mod-lab verify` checks |
| `hooks/pane.tsx` | the pane's drawing, from data the render hook reads; `pane-parts.tsx` holds what every view is built from, `pane-intercept.tsx` the Intercept tab |
| `hooks/trace.ts`, `format.ts`, `args.ts`, `json.ts` | the trace summary, transcript text, argument parsing, and safe JSON |
| `types/index.d.ts` | the state contract and the `$.lab` noun |
| `compat.json` | a copy of the repository root's, written by `npm run sync-compat` |

To add a probe: write a top-level function in `probes.ts`, add a `case` for it in `runProbe`, and an entry in `PROBES`. If it calls a method no other probe calls, register `inspect` on that event in `register.tsx` so its dispatches are recorded. The test "every probe in the catalog is reachable by its id" fails if the `case` is missing.

## Tests

`claude plugin test mods/mod-lab`. The tests answer `$` calls with made-up values from bottom hooks and check what the lab recorded through its state.
