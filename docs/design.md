# Design

The playground is for learning the Claude Code mod API by running it. It starts with `$`, the engine interface every hook receives, because most of the API is reached through it. This document is how the pieces fit.

| Part | Where | What it is for |
| --- | --- | --- |
| mod-lab | `mods/mod-lab/` | A mod that runs curated calls on `$` ("probes") inside a live session and records what each call dispatched and returned. |
| mod-lab-bridge | `mods/mod-lab-bridge/` | A mod that connects the explorer page to the session: it runs the probes the page asks for and forwards the lab's runs and traces. |
| mod-lab-target | `mods/mod-lab-target/` | A companion loaded beneath the lab whose hooks fail on request at paths under `/dev/null/mod-lab-target/`, for `/mod-lab verify`. |
| Explorer | `web/` | A local web page: the `$` reference generated from the engine's own declarations, forms to run probes in the connected session, and a live feed. |
| Scratch | `mods/scratch-mod/` | A small mod of hook patterns, each with a test, meant to be edited and re-run. |
| Lessons | `learn/` | Tutorials and challenges whose steps are checked by test files, and the checker that runs them. |

The lab works on its own, in the terminal; the bridge and the explorer add the web page.

## Constraints that shaped it

Each was checked with `claude plugin validate`, `claude plugin test` or a headless session on Claude Code 2.1.302.

- A hooks module has no `eval` or `new Function`, so the lab cannot evaluate typed-in code. It runs a fixed catalog of probes instead.
- `$` is spelled `$.noun.method(...)` at each call site and may be passed only to a top-level function called by its name. The lab therefore dispatches probes through an explicit `switch`, and `claude plugin validate` lists every call the lab can make.
- State atoms must be declared in the file that reads or updates them, so each of the lab's modules keeps its own state and hands the others functions that read it (the pane's drawing reads through `readRecords` and `readInterception`).
- Every call on `$` is itself an event, and a hook on that event in the same plugin sees the call, with `next.origin` naming the caller and `next.trace` the chain beneath. The lab's inspector is built on this.
- A plugin's own hooks see its calls only while the hook that made them is running: not calls from press handlers, nor from timers that fire after the hook that set them returned. So every probe run starts inside a hook, and the bridge, which polls on a timer, is a separate plugin that asks the lab to run probes through a noun the lab adds to `$`.
- `Function.prototype.toString()` works in the module environment and returns the compiled source, so each probe's source is shown next to its result without a second copy.

## mod-lab

A probe is a top-level function `($, args) => value` with metadata: an id (`session.cwd`), its noun, a one-line description, typed parameters with defaults, and an effect label (`read`, `ui`, `write`, `network`, `spend`, `dialog`, `tool`) so side effects are visible before running. Probes with risky inputs take a choice from a fixed set: `process.run` offers three argv vectors, `env.get` a few literal names (which the validator requires anyway), and `fs.write` writes only under `~/.claude-mod-lab/scratch/`.

Running a probe (`runAndRecord` in `hooks/runs.ts`, `execute` in `hooks/runner.ts`):

1. The run waits its turn in a queue that also carries the lab's own state writes, so nothing else the lab does lands in the capture.
2. Capture starts and the probe runs through the `switch` in `hooks/probes.ts`.
3. The inspector hooks on the op events the probes raise record each dispatch whose `next.origin.plugin` is the lab, as it starts: the event, `e`, the answer, and the chain. The pane's own `state` reads and writes are left out, and `prompt.compose` is not inspected because its hooks run for every system prompt the engine renders.
4. The run (value or error, duration, dispatches) is stored in `$.state`, newest 100 kept.

Every way of starting a run is a hook:

| Started from | Hook |
| --- | --- |
| `/mod-lab <probe> [args]` | `command.run` |
| the pane's Run button, Enter in an argument field | `ui.press`, `ui.input` |
| the model, through `mcp__mod-lab__probe` | `tool.call` |
| another plugin, through `$.lab.run(...)` | `lab.run` |

The tracer hooks `session.start`, `prompt.submit`, `turn.start`, `turn.step`, `turn.complete`, `tool.call` and `command.run`, and records a one-line summary, `e`, the result and the chain of each, newest 300 kept. `turn.step` streams, so its hook is a generator that passes the stream on with `yield*`; its row's time is the request's wall time, which the explorer's Turn timeline draws beside the tool calls. `/mod-lab trace off` pauses it. A link whose `received` (from `next.trace`) differs from the `e` the lab passed on keeps it, which is how a rewrite by a plugin beneath shows.

The ledger (`hooks/ledger.ts`) hooks `prompt.context`, `prompt.attachment` and `tool.describe`, and reads the `prompt.submit` trace hook's chain, all passing `e` on unchanged. From a chain's links it attributes each context line or block to the plugin that added it: an item first received by one link was added by the link above it on the way down, and an item in one link's result that the link beneath did not return was added by that link after `next`. It keeps the latest prompt's additions, the injected messages by source, and each tool as described, in `$.state`; `/mod-lab ledger` joins them with `$.session.usage`'s breakdown, `$.prompt.compose()` and `$.tool.list()`.

Intercepts (`hooks/intercept.ts`) reuse the inspector's hooks. The intercepts in force are kept in `$.state` and mirrored in a module variable, set at `session.start` and after each change, because `inspect` runs for every plugin's calls on those events and must decide at once. When one covers a call (by event, and by whether the caller is the lab), `inspect` hands the call to `interpose`, which passes it on, refuses it, answers it, rewrites `e`, or sleeps first, and records it as a tap. Taps collect in a module array; the wrapper hook `inspected` in `interception.ts`, where the taps' state lives, writes them through the same queue as the traces, without awaiting, since a run in progress may be waiting on the very call. A dispatch abandoned mid-delay (its budget spent) is marked when `next.signal` aborts, since the hook itself settles only after the run has been kept. The behaviours are a fixed list for the same reason the probes are: a hooks module cannot evaluate typed-in code, so `answer` and `rewrite` take JSON data.

Two events stream, `process.spawn` and `turn.step`, and their hooks are generators. The `process.spawn` probe (`hooks/streams.ts`) starts one of a fixed set of commands and keeps each piece of the child's output with when it arrived. The lab hooks `process.spawn` with `inspectStream`, which passes each piece on as it comes, records the lab's own dispatch with how the stream ended and how many pieces passed, and takes a watch or a refusal as intercepts. The `turn.step` hook passes each chunk on and keeps, per model request, when each kind of chunk first and last arrived and how many arrived in each of 32 slices of the request's time, in the request's trace row.

The keystroke log (`hooks/keys.ts`) hooks `prompt.edit` and `prompt.change`, passes every edit and change on, and keeps each in brief in the `keys` state value: the key by name, a character typed plain only as `text`, the splice, the lengths before and after, the decorations the hooks beneath painted, and whether one of them changed the box. It keeps no draft text.

The settings (`hooks/config.ts`): `/mod-lab config` reads `$.config.list()` into the `config` state value and lists the rows by owner, and `/mod-lab config set` writes one through `$.config.set`, which every plugin's `config.set` hook sees but the lab's own; the lab's `config.set` hook, watching the menu and other plugins, reads the rows again after each change it passes.

The compactor (`hooks/compactor.ts`) hooks `session.compact`. While `/mod-lab compactor keep <n>` is in force it answers the main conversation's compactions itself, without `next`: the first message, a `user` message it writes from counts of what it drops, and the last n messages, moved so the tail neither starts at a tool result whose call was dropped nor inside a response the engine split into messages. It skips a `precompute`, whose result the engine would install later, and passes a subagent's compaction on. Every compaction, its own or the engine's, is kept in the `compactor` state value with who answered it (the first link beneath that returned), each message before and after in brief, the sizes and the summarizer's usage. The engine's result carries its own counts; for the lab's answer the sizes are the last request's input before (`$.session.usage()`) and the next request's after, which the `turn.step` hook fills in. The setting is in `$.state`, so it ends with the session.

## mod-lab-bridge

Depends on mod-lab. On a 400 ms timer it looks for the explorer (every eighth tick while unconnected): the session's own, through the endpoint tool of the plugin's MCP server (`mods/mod-lab-bridge/explorer.mjs`), which holds its answer until the explorer serves; or, when the `bridgeFile` option or `MOD_LAB_BRIDGE_FILE` names a bridge file, the server that wrote it. Once it has one it greets the server with the bridge protocol's number, the session's facts, the engine's version and the surfaces it draws on, its own copy of `compat.json` (the supported range, the templates' minimums and the capability table), its own folder and mod-lab's from `$.lab.root()`, the probe catalog from `$.lab.probes()` and the events from `$.lab.interceptable()`, then on each tick asks for a job and hands it to the lab: a probe to `$.lab.run(...)`, and anything else `/mod-lab` does (an intercept, the ledger, eject, verify) as the text after `/mod-lab` to `$.lab.command(...)`, which answers the text the command shows. It forwards the lab's runs, trace rows and taps it has not sent yet, read from the lab's state, and mirrors values of the lab's state whole whenever they change: the intercepts in force and the spend meter, the lab's agents, the rows it saw stored, its compactions, its keystroke log and the settings rows, each a key in `MIRRORED`. After a refused or failed request it waits a full idle interval before greeting again.

`/mod-lab explorer`, which mod-lab answers by calling the bridge's MCP server, gives the explorer's URL. `/mod-lab explorer serve <seconds>` keeps a session open for the page, which is what lets a headless session (`npm run headless`) serve it with no model requests; it waits on a child `sleep` through `$.process.run`, because a hook's budget keeps running while it waits on a timer of its own.

## Bridge protocol

The explorer server (`web/server.mjs`) listens on 127.0.0.1 and makes a random token. In a session, the bridge's MCP server starts it and gives the bridge its URL and token; started on its own (`npx claude-mod-lab`), it writes them to `~/.claude-mod-lab/bridge.json` (mode 0600), or the file `MOD_LAB_BRIDGE_FILE` names, which a session's bridge reads when its override names that file. Nothing connects unless the server is running.

| Direction | Request | Purpose |
| --- | --- | --- |
| bridge → server | `POST /bridge/hello` | the protocol number, session facts, the engine (`{ version, surfaces }`), the bridge's `compat.json`, the bridge's and mod-lab's folders, and the probe catalog; answers a client id, or 409 with the reason: another protocol number, or another session the server serves that still polls |
| bridge → server | `GET /bridge/next?client=` | the next queued job (a probe, `kind: 'command'` with what follows `/mod-lab`, or `kind: 'reload'`, which runs `/reload-plugins`), or 204; 410 for a client the server no longer knows |
| bridge → server | `POST /bridge/runs` | runs, and which job the first one answers |
| bridge → server | `POST /bridge/answer` | the text that answers a command or reload job |
| bridge → server | `POST /bridge/traces` | trace rows |
| bridge → server | `POST /bridge/taps` | the calls intercepts acted on |
| bridge → server | `POST /bridge/mirror` | a value of the lab's state, whole, when it changes: `{ key, value }`, a plain key, sixteen at most (`intercepts`, `spend`, `agents`, `rows`, `compactor`, `keys`, `config`) |
| page → server | `GET /api/catalog`, `GET /api/type?name=`, `GET /api/state` | page data |
| page → server | `POST /api/run` | queue a probe run; 409 while no session is connected |
| page → server | `POST /api/command` | queue what follows `/mod-lab` (at most 2,000 characters); 409 while no session is connected |
| page → server | `GET /api/lessons`, `GET /api/lesson?id=` | the lessons with their progress, and one lesson's README, folder and last check |
| page → server | `POST /api/lesson/start?id=` | the lesson's folder in `workshop/` made where there is none: its starter copied, or the folder with its manifest; the folder is then checked |
| page → server | `GET /api/lesson/watch?id=` | server-sent events while the lesson's page is open, which makes it the current lesson: checking, then checked (the report) or failed, for each check of its folder, which a save starts |
| page → server | `POST /api/check?id=` | the checker's report on the lesson's workshop folder, checked now |
| page → server | `GET /api/workshop`, `POST /api/workshop/switch` | the mods in `workshop/`, each with its lessons and whether it is on; one turned off or on for the workspace in `.claude/settings.local.json`, then a reload job queued as for the components |
| page → server | `GET /api/anatomy` | what the validator reads in every mod on the machine; `?fresh=1` reads again |
| page → server | `GET /api/gallery` | each surface's elements, and the gallery mod's tabs with their source |
| page → server | `GET /api/sample?name=` | lorem ipsum by size (`short`, `long`), generated in `web/lib/filler.mjs`, for the workbench's cached prefix |
| page → server | `GET /api/sandbox`, `GET /api/sandbox/template?name=`, `POST /api/sandbox/save`, `POST /api/sandbox/test` | the sandbox, `workshop/sandbox-mod`: its files and the templates; a template under the sandbox's name; the three files written, then validated and type-checked; its tests run |
| page → server | `GET /api/components`, `POST /api/components/add`, `POST /api/components/remove` | the templates as components: each copied into the selected component directory, or deleted (one with changes only with `force`), then a reload job queued, its answer awaited for five seconds |
| page → server | `GET /api/stream` | server-sent events: snapshot, session, mismatch, run, traces, taps, mirror, job |

Every request must carry the token (`Authorization: Bearer` from the bridge, `X-Lab-Token` or `?token=` from the page), and the server refuses a `Host` header other than its own address, which blocks DNS rebinding. The page gets the token in its own HTML; the server sends no CORS headers, so other origins can neither read it nor post jobs. The server serves one session at a time: another is refused until the one it serves stops polling for five seconds, then takes its place. It keeps runs and traces in memory, dropping them when a different session takes its place, and marks a job lost if the session took it and did not answer within a minute.

The hello's `protocol` is the bridge protocol's number: `PROTOCOL` in `mods/mod-lab-bridge/hooks/bridge.ts` and `BRIDGE_PROTOCOL` in `web/lib/hub.mjs`, which a web test holds equal. The explorer (the npm package) and the bridge (a marketplace plugin) release separately, so the server refuses a hello with another number, or none, with a message naming the side to update: for an older bridge, the lab's plugins, each through its own `claude plugin update` as the README lists them (an update does not follow dependencies); for an older explorer, `npx claude-mod-lab@latest`. The `engine` and `compat` fields are ones the server can do without: from them the page's header shows the version and surfaces, and outside the supported range what that means; without them, the session facts' version alone. The bridge greets again every few seconds; the server keeps the refusal as `mismatch` in the state and the stream until the greetings stop, and the page's header shows it while no session is connected. A change to the requests or their bodies that would break the other side raises the number on both sides in one commit; a field the other side can do without needs none.

## Two roots

The package root (`PACKAGE_ROOT` in `web/lib/roots.mjs`) supplies the explorer, lessons and templates and is read-only. The explorer starts without a project or lesson workspace. Once a session connects, explicit project actions such as Add to project target that session's project. An initialized lesson workspace is selected separately by `run <lesson-directory>` and reported in the bridge greeting as `lab.lessons`; it holds `workshop/`, the Sandbox, local workshop settings and `.claude-mod-lab/progress.json`. Browsing lessons creates no files. `/api/context` reports the selected destinations, and mutations must carry the destination displayed by the page. The server runs lesson checks with `MOD_LAB_WORKSPACE` set to the selected lesson workspace. The standalone `learn` and `add` commands take their workspace from `MOD_LAB_WORKSPACE` or the current directory. The launcher creates `.claude/mod-lab/` and passes it with `--plugin-dir`, along with recognized legacy component copies in `.claude/skills/`. The bridge reports those explicit paths as `lab.componentDirs`; this identifies the loading route, not proof that a plugin loaded successfully.

## Explorer

`web/lib/catalog.mjs` parses the engine's `claude-code.d.ts` with the TypeScript compiler API (TypeScript 6.0.3) and builds the reference: each noun on `CoreEngineInterface`, each method's signature, doc text, `@param`, `@returns`, `@example` and `@remarks`, whether it raises an op event or an engine event, and the engine events hooks can register on. Type names in signatures link to their declarations. The declarations are not copied into the repository or the package. `web/lib/types-path.mjs` finds them in this order: `MOD_LAB_TYPES`; laid beside the plugins the session loaded, mod-lab's folder first (before a session connects, the package's mod-lab and mod-lab-bridge); laid in each folder of `<workspace>/.claude/skills/`; then the plugin-authoring skill's copy under the temp folder for the session's Claude Code version, or for the version `claude --version` answers. The server looks again at each hello and builds the reference again when it finds another file. An interactive session lays the file only beside plugins it loads from a folder, never in an installed copy, so with nothing found the page says how to get one. The lesson checker and `npm run typecheck` use the same lookup.

The page has three areas, each a tab in its header (`web/public/areas.js`): Mod API, the reference and the probes, with the filter over the reference in the left column; Session, the live views of the connected session, with the feed of runs, session events and intercepted calls on the right; and Build, the lessons, the Sandbox, the Gallery and Installed mods. The home page, `#/`, describes them. Each Session page links to the methods and events it shows, and their reference pages link back to it.

The page is static HTML, CSS and JavaScript with no build step. `style.css` holds the colour, radius and spacing tokens; `patterns.css` the patterns pages share (the lede, panels, cards and their list form, the side-by-side `dl.pairs`, a link-styled button); a page's own stylesheet (`keys.css`, `gallery.css`) only what is the page's alone. Text from the session is always inserted as text, never parsed as HTML.

The Lessons pages draw each lesson's README with `web/public/markdown.js`, a renderer of the Markdown the READMEs use, which builds DOM nodes and never parses HTML. A `/mod-lab <probe> <value>` in the text gets a button that queues that probe in the session, its first parameter taking the value, and any other `/mod-lab ...` one that runs the command there, its answer shown beside the button; a link to another lesson becomes a route of the page. The server reads only the files of lessons `learn/lib/lessons.mjs` finds, and runs the checker (`/api/check`) only on a lesson id it knows.

The Installed mods page asks the server for `/api/anatomy`: `web/lib/anatomy.mjs` lists the installed plugins (`claude plugin list --json`) and the repository's and workshop's mod folders, runs `claude plugin validate --json` on each that has a hooks module, and reads the report as the lesson checker does; the server keeps a reading for a minute. Beside each mod the Installed mods page puts what the session showed it doing: the traced events whose chain it was a link of, and its calls that an intercept recorded.

The Conversation X-ray (`web/public/xray.js`) lists the rows the lab's `session.append` hook saw stored, from the `rows` value the bridge mirrors, marked by who reads each and filtered by it; it adds a note or a notice through `/mod-lab note` and `/mod-lab notice`. Its compaction section (`web/public/compaction.js`) turns the lab's compactor on and off through `/mod-lab compactor`, asks for a compaction through `/mod-lab compact` on a second press, and draws each compaction its `session.compact` hook saw, from the `compactor` value the bridge mirrors: a strip of the messages before, each as wide as its characters and faded when dropped, and a strip of the messages after on the same scale, with the ones written for the compaction marked.

The Agents page (`web/public/agents.js`) registers types and spawns agents through `/mod-lab agent`, hides a type from the model, sets the lab's route, and lists every agent the lab's `agent.spawn` hook saw, with its answer and transcript, from the `agents` value the bridge mirrors; the Turn timeline draws each agent's turns beside the main loop's.

The Model workbench (`web/public/workbench.js`) queues `model.complete` and `model.fork` probe runs with a prefix the cache can keep, turns free mode on and off through `/mod-lab free`, and draws every model call of the session from the spend meter the bridge forwards, with a clock to the cached prefix's lapse; the header shows the meter's totals on every page.

The Gallery page asks for `/api/gallery` and draws the techniques first, as a list of cards, each with its template's description (from the template's manifest), where it draws (from the templates README's table) and Add to project; then the elements each surface draws; then a panel per technique with what it draws on each surface, its source and its snippet. The data: the element tables of each surface, which `web/lib/catalog.mjs` reads off the declarations' `Elements`, and the gallery mod's tabs, which `web/lib/gallery.mjs` reads from the mod's README table and, for each technique, the function or hook that draws it from the mod's own files (a TypeScript parse, so a renamed function is reported rather than shown stale). Beside each technique, and on the Prompt box page's ideas, Add to project (`web/public/components.js`) copies the technique's mod from `templates/` into `.claude/mod-lab/<name>/` when that launcher collection exists, or `.claude/skills/<name>/` otherwise (`web/lib/components.mjs`). The manifest is copied last so collection watching cannot discover an incomplete mod. Recognized legacy copies are shown and edited in place until removed; each card carries its actual directory, and a mutation naming a stale destination is rejected. When the connected session reports an explicit path covering the copy, the bridge runs `/reload-plugins` without consulting a separate CLI's project-scope discovery. For automatic skills-directory discovery, the explorer reports the CLI's loading blockers, both after copying and when revisiting the page. A collection without matching session metadata instead asks the user to relaunch through `run`. The UI confirms the copy and reports the reload result separately. The bridge mirrors a read-only `$.command.list()` snapshot about every 3.2 seconds and immediately before answering a reload job; lookup failures send `null`, not an empty list. Component cards with known commands show availability only when both command name and providing plugin match. Changes update the status text without redrawing Add/Remove controls. This confirms command registration, not which on-disk copy of a same-named plugin supplied it. Remove deletes the copy, asking first when it holds changes. Copy as a mod puts on the clipboard a shell snippet the server builds from that technique's mod in `templates/`: here-documents that write its manifest, `hooks.json`, module and contract to `workshop/<technique>-mod/`.

The Turn timeline page reads the main loop's turns off the trace (a `turn.start`, the `turn.step` and `tool.call` rows after it, its `turn.complete`) and draws each request and call as a bar from its start to its end, a request's bar holding its chunks' arrivals.

The Sandbox page (`web/public/sandbox.js`) edits one mod, the workspace's `workshop/sandbox-mod`: its hooks module, its contract and a test, each in a textarea with line numbers. `web/lib/sandbox.mjs` writes those three files and a fixed manifest naming the plugin `sandbox-mod` (`/sandbox` is a built-in command), and nothing else: no path comes from a request, and each file is capped at 256 KiB. A save is followed by `claude plugin validate`, read as the lesson checker reads it, and a type check, its errors at their file and line; Run tests runs `claude plugin test` on the folder. Any template in `templates/` can be loaded into the editors, its name changed to the sandbox's. The lab's session loads it from `workshop/` and reloads it after each save.

While a lesson's page is open, the server watches the lesson's folder in `workshop/` (`web/lib/lesson-checks.mjs`) and runs the checker on each save once the folder is quiet, sending the page the report; a lock in `.claude-mod-lab/` keeps two sessions' explorers in one workspace from checking at once.

The Workshop page (`web/public/workshop.js`) lists the mods in `workshop/` with a switch each, which writes `"<name>@inline": false` in the workspace's `.claude/settings.local.json`, or removes it, and has the bridge run `/reload-plugins` (`web/lib/workshop.mjs`).

The Settings page (`web/public/config.js`) draws the `config` rows by owner, filtered as typed, reads them through `/mod-lab config` and sets one through `/mod-lab config set`.

The Prompt box page (`web/public/keys.js`, with `keys-rows.js` putting each row in words) draws the keystroke log from the `keys` value the bridge mirrors: a ribbon of the newest keys, a walkthrough each of whose steps is ticked by the row it asks for, the log with the picked row explained (its splice drawn to scale without the text, and the hook that would have seen it), and mods to build from it. It runs the `prompt.fill` and `prompt.suggest` probes from the walkthrough's forms.

The Streams page (`web/public/streams.js`) runs the `process.spawn` probe and draws each run's pieces on a time axis, stdout and stderr apart, with each piece's text, and each traced model request's arrivals and chunk kinds.

A method whose event the lab can intercept has an "Intercept it" section on its page: a form that sends the intercept to the session, the one in force with a Clear button, and the calls it acted on; the feed's Intercepted tab lists them all, under a census of them per event that the page adds up the same way the lab's `hooks/census.ts` does.

## Lessons

`learn/` holds the tutorials and the challenges, each a folder with `lesson.json` (its steps, which test file checks each, and `minVersion`, the oldest Claude Code build its solution passes on, which the checker and the Lessons page show), a README to follow, `checks/` and `solution/`; a lesson that starts from existing code has a starter, its own `starter/` or another lesson's solution named in `lesson.json`, which the first check copies into the workshop when the mod's folder is not there yet. The learner builds in the workspace's `workshop/<mod>`, which git ignores in a clone.

`learn/check.mjs` checks a folder against a lesson: `claude plugin validate --json` on the folder itself (its errors fail the first step, and its notes are shown as what the validator reads in the module), then the lesson's checks with `claude plugin test` on a temp copy holding the learner's files and the `checks/` folder (the learner's own tests are left out), and the TypeScript check from `scripts/tsc.mjs`. A step passes when every test in its file passes, and, where `lesson.json` asks, when the validator lists a `.catch` on the hooks it names. `--watch` checks again on each save, ignoring what the engine itself writes into a loaded mod. A check that needs another plugin's call on `$` loads an inline plugin whose command makes it, as the fence checks' `reader` does: a test's own `$` raises engine events only, and has no op-event methods such as `$.fs.read`.

`npm run check` runs every lesson's checks against its solution and against each starter, which must still fail, and `npm run typecheck` compiles each solution with its checks and each starter, with the contract of any repository mod its manifest names as a dependency (typeahead names mod-lab). An engine update that breaks a lesson fails there, and so does one that changes a behaviour a challenge rests on: quiet's starter fails only because a plugin's own hooks skip the calls its timers make.

## Tests

- `claude plugin test mods/<mod>`: for mod-lab, argument parsing and summarizing, the command, tool and pane paths with their dispatch records, and the tracer; for mod-lab-bridge, the protocol against a pretend server built from bottom hooks on `fs` and `http.fetch`; for scratch, one test per pattern.
- `node --test 'web/test/*.test.mjs'`: the catalog builder against an invented fixture, the hub's queueing and bookkeeping and its protocol check, the declarations lookup's order, the two roots, and the server's token and host checks, job round trip and lookup at each hello.
- `node --test 'learn/test/*.test.mjs'`: the checker's reading of test output and validator reports, and its judgment of steps; and the server and the checker with a temporary workspace apart from the repository, where everything they write lands.
- `npm run learn:solutions`: every lesson's solution against its checks.
- `npm run e2e`: the server and a headless session with both mods, probes queued as the page would queue them, and their dispatches checked; then an intercept set, acted on, forwarded as a tap, and cleared.
- `npm run e2e-page`: the same through the page in Google Chrome, driven by playwright-core: a probe run from its form, the feed, the filter, the tabs, an intercept set and cleared from a method's page, the X-ray's rows and compaction section, a spawn run on the Streams page, a fill from the Prompt box page, the rows on the Settings page (read, never set), a save and a test run on the Sandbox page (in a folder of the run's own), and the console.
- `npm run check` runs validation, type-checking, the mod, web and learn test suites, and `npm run learn:solutions`; the templates in `templates/` are validated, type-checked and tested with the mods.

## Not covered yet

Probes that start a model turn (`prompt.submit`, `agent.spawn`), and the `Client` element. Each would be a new probe or a new scratch pattern.
