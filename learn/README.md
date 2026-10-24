# Lessons

Tutorials that build mods step by step, and challenges that each turn on one idea. The checker runs each step's test file as you save, so you know when a step is done and, when it is not, what the mod did instead; a step done in a live session is marked as such.

Start a lesson from its page in the Explorer or with the CLI. Both copy its finished source to `solutions/<lesson-id>/` in your lesson workspace for comparison, alongside your working mod in `workshop/`. Reference copies omit the plugin manifest and are not loaded by the session. Existing working mods and reference copies are left untouched. For an already-started lesson without a reference copy, use **Copy reference solution** on its page.

| Lesson | Kind | What it builds, and what it teaches |
| --- | --- | --- |
| [tick](tutorials/0a-tick) | tutorial | A stopwatch in a pane that starts out drawn, with three lines left to fill in. `$.state` and a drawing that redraws itself, a button's `onPress`, a timer from `$.clock.every`, and `cancel()`. |
| [egg](tutorials/0b-egg) | tutorial | An egg timer in the band above the prompt, which `/egg` already sets. `$.clock.now()` and time worked out rather than counted, a command's `e.args`, and the colours a drawing can use. |
| [chime](tutorials/0c-chime) | tutorial | A chime when Claude finishes a long answer, then its first sentence said aloud. A hook on the engine's own `turn.complete` and `next(e)`, what `e` tells you, `$.audio.play` and `$.audio.speak`, and a call you do not wait for. |
| [remind](tutorials/0d-remind) | tutorial | Reminders Claude can set: a tool Claude already calls, answered, made to go off with `$.clock.after`, and handed back to Claude with `$.prompt.submit`, who reminds you in the conversation. |
| [stopwatch](tutorials/1-stopwatch) | tutorial | Times the model's tool calls. The folder and manifest, `register`, hooks and `($, e, next)`, a command, a hook on both sides of `tool.call` with `$.clock.now()`, the status line, and `$.state`. |
| [fence](tutorials/2-fence) | tutorial | Keeps `.env` files from other plugins and the model. Calls on `$` as events, `next.origin`, refusing with `{ deny }`, following links, failing closed with `.catch`, and changing a result after `next`. |
| [stopwatch-pane](tutorials/3-stopwatch-pane) | tutorial | Draws stopwatch in a pane. `$.ui.open` and `ui.render`, the elements of a surface, drawing from `$.state`, bars sized to the pane, a button and its handler, and text the engine will draw. |
| [stopwatch-options](tutorials/4-stopwatch-options) | tutorial | Stopwatch with settings. `userConfig` fields and `register`'s options, a reload on change, a `config.set` guard that cuts a value or refuses it with a reason, and `config.describe` with `$.ui.invalidate`. |
| [typeahead](tutorials/5-typeahead) | tutorial | A companion to the lab in the prompt box. `prompt.edit` and decorations, ghost text, `prompt.autocomplete` rows, a dependency on another mod's noun, and context for the model at `prompt.submit`. |
| [snake](tutorials/6-snake) | tutorial | A game in a `Client`. A surface module's own state, frame clock, pointer and keys on the drawing thread, and `post` to the hooks module, which keeps the best score in `$.store` and hands it back as props. |
| [session-lens](tutorials/7-session-lens) | tutorial | An observation pane for notes, notices, and message views. `$.session.append`, both forms of `$.session.messages`, explicit `$.prompt.submit`, the first `turn.step`, and a manual JSONL/resume experiment that separates saved history from assembled model input. |
| [only-mine](challenges/1-only-mine) | challenge | Answer the mod's own `$.session.cwd()` and no one else's. |
| [quiet](challenges/2-quiet) | challenge | A reminder that a timer raises gets past the mod's own hook. Why, and the fix. |
| [receipt](challenges/3-receipt) | challenge | A tool the model can call, which in the starter does not work. |
| [steady](challenges/4-steady) | challenge | Tell the model the git branch without changing the system prompt on every request. |
| [triage](challenges/5-triage) | challenge | Label every prompt with a model call that reads its guide from the prompt cache, scored in a session by the lab's spend meter. |
| [redact](challenges/6-redact) | challenge | Keep API keys out of every row the conversation stores, not only what the person types. |
| [scrub](challenges/7-scrub) | challenge | Redact a child process's output as it streams, when a key can arrive in two pieces. |
| [errand](challenges/8-errand) | challenge | An agent type only the mod starts, and only its own agents' answers brought back. |

Take the tutorials in order; the challenges assume them and stand alone after that.

## How a lesson runs

Initialize a dedicated lesson workspace once, then start a session there:

```sh
npx claude-mod-lab init-lessons ~/mod-lessons
npx claude-mod-lab run ~/mod-lessons
```

Run the checker commands below from that workspace. Browsing lessons in the explorer does not create files.

```sh
npx claude-mod-lab learn             # the lessons, and how far you got in each
npx claude-mod-lab learn tick        # check workshop/tick on every save
```

You build in `workshop/<mod>/`; stopwatch-pane and stopwatch-options grow the stopwatch tutorial's mod, in the same folder. A lesson's first check copies its starter there, where it has one, and when the folder is missing, stopwatch-pane's copies the stopwatch tutorial's finished mod and stopwatch-options' copies stopwatch-pane's. On every save the checker:

1. runs `claude plugin validate` on your folder, whose errors fail the first step, and shows what the validator reads in your module: its hooks, its calls on `$`, its gating hooks and its state;
2. runs the lesson's checks with `claude plugin test` on a copy of your folder (your own tests are left out of the copy);
3. type-checks your module against the engine's declarations;
4. lists the steps that pass, why the current one does not, and where its section in the README is.

The explorer (`npx claude-mod-lab`) has the lessons too, under Lessons: each README drawn with a button beside every `/mod-lab` command in it, which runs that command in the connected session, and a button that runs the checker on your folder.

`node learn/check.mjs <lesson> --dir <folder>` checks any folder, and `node learn/check.mjs --help` lists the options.

The checks stand in for the engine with hooks of their own, so they cannot catch everything a session would. The live steps of a tutorial are done in a session, with your mod loaded beneath the lab so its traces and intercepts show your hooks:

```sh
npx claude-mod-lab run
```

## Tests of your own

A lesson's checks are tests like any other, and reading them in `checks/` shows how a test stands in for the engine: its own hooks sit beneath the mod and answer what the mod asks for. To give such hooks real answers, run the lab's probes for the calls your mod makes and `/mod-lab eject` the run: it writes an `on('<event>', ...)` for each event the run raised, answering each call with the value the session gave, ready to paste into a test.

## Each lesson's folder

| Part | What it is |
| --- | --- |
| `README.md` | the steps to follow, or the task |
| `lesson.json` | the steps, which test file checks each, the hooks whose `.catch` a step asks for, the calls on `$` it needs the module to make, and `minVersion`, the oldest Claude Code its solution passes on |
| `checks/` | the test files, and a `kit.ts` of what they stand on; worth reading when a check fails |
| `starter/` | a lesson's mod as it starts, where it starts from one; `lesson.json` can name another lesson's solution instead |
| `solution/` | the finished mod |

`npm run check` runs each lesson's checks against its solution and type-checks both, so a Claude Code update that changes what a lesson relies on shows up there.
