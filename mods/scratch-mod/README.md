# scratch-mod

Six small hook patterns to edit and test. Each pattern is in `hooks/register.ts`, with a test in `tests/patterns.test.ts` that shows what it does. Paths in this README refer to your copy of scratch-mod unless stated otherwise.

From your project directory, add a copy:

```sh
npx claude-mod-lab examples add scratch-mod --local
```

This creates `.claude/mod-lab/scratch-mod/`, including the hooks and tests. Edit those files, then run the tests from your project directory:

```sh
claude plugin test .claude/mod-lab/scratch-mod
```

If your terminal is already inside the scratch-mod directory, use `claude plugin test .` instead. No repository clone is needed.

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

To try your copy in a lab session, run this from your project directory:

```sh
npx claude-mod-lab run --local
```

Then try `/scratch-count`, `/scratch-home`, and `/scratch-frames`. In a session already started with `run --local`, use `/reload-plugins` after adding or editing the mod. A session started in shared mode needs to be restarted with `--local` to load this project copy.

Unlike the prepared Gallery examples, scratch-mod’s sample hooks take effect as soon as it loads: the prompt rewrite trims submitted text and adds a context line, and the guard refuses Write calls whose path contains `/secrets/`. They apply throughout that session, without an activation command.

To load just scratch-mod without the lab, run `claude --plugin-dir .claude/mod-lab/scratch-mod` from your project directory. If you used `examples add scratch-mod --to <folder>`, use that destination for both `claude plugin test` and `--plugin-dir`.

scratch-mod is distributed as an editable starter rather than a marketplace plugin. Keeping a project copy lets you experiment with its hooks without sharing those changes across your other lab sessions.
