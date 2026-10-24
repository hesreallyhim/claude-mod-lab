# only-mine: answer your own calls

`/where` answers with whatever `$.session.cwd()` gives it. Make it answer `/sandbox` by adding a hook to the mod, without changing what any other plugin's `$.session.cwd()` gets, and without the engine being asked for the mod's own.

```sh
npx claude-mod-lab@alpha learn only-mine
```

The first run copies the [starter](starter) to `workshop/only-mine/`; edit it there. Leave the `command.run` hook as it is: `/where` keeps asking `$.session.cwd()`.

## 1. Answer your own call

`/where` says `/sandbox`, and the engine is not asked.

## 2. Leave everyone else's alone

Another plugin, loaded beside yours in the checks, still gets the real directory, including when both ask at the same moment.

<details>
<summary>Hints</summary>

- A call on `$` is an event. `$.session.cwd()` raises `session.cwd`, and a hook on it sees every plugin's call.
- A hook that returns `{ value }` without calling `next` answers the call itself.
- Inside a hook, `next.origin.plugin` names the plugin that made the call, and `$.plugin.name` is the mod's own name.

</details>

<details>
<summary>Once it passes: why it works</summary>

The command hook makes its call while it runs, and a call made from inside a hook passes through the plugin's own hooks, all but the one making it. So the mod's `session.cwd` hook sees `/where`'s call and can answer it. Without the check on `next.origin.plugin` the same hook would answer every plugin in the session: a hook on a `$` event answers every plugin's call unless it checks `next.origin.plugin`. The scratch mod's `env.get` pattern is written the same way.

To see it in a session, `npx claude-mod-lab@alpha run`, then `/mod-lab intercept session.cwd watch others` and `/where`. The lab records only-mine's call with no engine in its chain. `/mod-lab session.cwd` then shows the lab's own call passing through only-mine to the engine.

</details>
