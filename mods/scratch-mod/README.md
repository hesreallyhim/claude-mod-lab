# scratch-mod

Six small hook patterns in `hooks/register.ts`, each with a test in `tests/patterns.test.ts` that shows what it does. Change a pattern or its test and run `claude plugin test mods/scratch-mod` to see what holds.

| Pattern | Hook | What the test shows |
| --- | --- | --- |
| rewrite | `prompt.submit` | the chain beneath receives the trimmed text and an added context line |
| guard | `tool.call` on Write | a write under `secrets/` is refused before the tool runs; the `.catch` refuses too if the guard itself fails |
| after next | `tool.call` on Bash | the hook waits for the command and sets the status line when it failed |
| answer a `$` call | `env.get` | the plugin's own hook answers its `$.env.get('HOME')`, and the engine is never asked |
| state | `command.run` for `/scratch-count` | `update` counts up from the last value written |
| frames | `session.cwd` | a call from a timer that fires after `session.start` returned skips the plugin's own hooks |

Things to try:

- In the guard, throw an error before deciding and see the `.catch` answer. Then delete the `.catch` and see the write go through.
- In "after next", return a different result from the hook and see what the caller gets.
- In "answer a `$` call", drop the `next.origin` check and think about what that would do to every other plugin in a session.
- In "frames", set a timer inside the `/scratch-frames` command hook and wait for it there before answering, and see that timer's call reach the plugin's own hook.

`claude --plugin-dir mods/scratch-mod` loads the mod into Claude Code to try `/scratch-count`, `/scratch-home` and `/scratch-frames` by hand. The guard and the prompt rewrite apply to that whole session.

## Install

scratch-mod is not in the marketplace. Its patterns are meant to be edited, which an installed copy cannot usefully be, and installed, its hooks would run in every session: the rewrite adds a context line to each prompt, and the guard refuses writes under `secrets/`. Take a copy to edit instead:

```
npx claude-mod-lab add scratch-mod
```

which copies it into `.claude/skills/scratch-mod/`, or clone this repository and use `claude plugin test mods/scratch-mod`.
