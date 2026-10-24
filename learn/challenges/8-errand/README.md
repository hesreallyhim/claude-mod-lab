# errand: an agent only the mod starts

A mod can define an agent type with `$.agent.register` and start an agent of it with `$.agent.spawn`. The agent runs in the background, and its answer arrives when its turn ends, as a `turn.complete` that carries its `agentId`. The starter does this: `/errand <what to find out>` sends a small read-only errand to an agent of its own type, and each answer comes back as a line in the transcript.

It has two faults. The model is offered the type too, so it can send errands of its own, and every agent's answer comes back as an errand's, whatever type the agent was. Keep the type to the mod, and bring back its own agents' answers alone.

```sh
npx claude-mod-lab learn errand
```

The first run copies the [starter](starter) to `workshop/errand/`; edit it there.

## 1. Only the mod starts it

The model is not offered the errand type when the Agent tool lists the types it can dispatch. Every other type is offered as it came. The mod still spawns its own.

## 2. Only its own answers come back

When an errand's agent ends its turn, its answer comes back as a line in the transcript. When another agent's turn ends, or the main loop's, nothing does.

## 3. Sent as asked

The type is registered to read and report, on Haiku, with no tool that changes anything. `/errand` sends what follows it as the agent's prompt, and with nothing after it says how to use it and sends nothing. The starter passes this step already; keep it passing.

## 4. Run an errand

```sh
npx claude-mod-lab run --model haiku
```

```
/errand What is the version field in workshop/errand/.claude-plugin/plugin.json? The number alone.
```

The command answers at once, and a few seconds later a dim line reads `errand: came back: 0.1.0` (the starter's version, unless you changed it), the engine naming the plugin that logged it. `/mod-lab agent` lists the spawn: the errand type, started by errand, done in a few seconds, with its answer. Ask the model which subagent types it can dispatch: the errand type is not among them.

The main model reads the errand's answer too: the engine hands a background agent's answer to the main loop as a message, which starts a turn of its own. Expect the model to say something about an answer it never asked for, and perhaps check it with a tool.

<details>
<summary>Hints</summary>

- `agent.offer` asks each plugin, for each type, whether to offer it to the model. A hook can answer `{ isOffered: false }` without `next`; a matcher (`{ agent: 'errand:errand' }`) keeps it to one type.
- `turn.complete` carries the ending agent's `agentId` and nothing of its type. `$.agent.list()` lists the session's agents, each with its `id` and `type`, and an agent whose turn is ending is still there.

</details>

<details>
<summary>Once it passes: why it works</summary>

A registered type is the plugin's, named `<plugin>:<name>`, and any plugin can spawn it. Hiding it with `agent.offer` takes it out of the model's list alone: the model cannot dispatch what it is not offered, and the mod's own `$.agent.spawn` is not asked. That suits a type whose prompt only makes sense the way the mod uses it, or one that costs what the mod should decide to spend.

A background agent's answer arrives at every plugin's `turn.complete`, for every agent, so a mod that starts agents has to tell its own apart. In a session the spawn answers the new agent's `agentId`, and a mod could keep those. Asking the agent list for the type at the end serves as well, keeps nothing in the module, and works in the test kit too, where a spawn starts no agent and so answers no id.

The line goes to the transcript through `$.ui.log`: a dim line the person reads and the model does not, since the model has the agent's answer already. A `system` row appended from the same hook is stored but not drawn in the terminal's transcript.

</details>
