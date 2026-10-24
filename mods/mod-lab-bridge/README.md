# mod-lab-bridge

Serves the explorer page from a Claude Code session that has mod-lab loaded, and connects the page to that session. It runs the probes the page asks for, through `$.lab.run`, and the other `/mod-lab` commands it asks for (intercepts, the ledger), through `$.lab.command`, and forwards the lab's runs, session events, intercepts, the calls they acted on, and its spend meter to the page.

It is a separate plugin because a plugin's own hooks do not see calls it makes from a timer once the hook that set the timer has returned, and the bridge works from a timer. Calling the lab's `$.lab.run` puts each run inside the lab's own `lab.run` hook, where the lab records its dispatches.

## Install

From a terminal:

```
claude plugin marketplace add hesreallyhim/claude-mod-lab
claude plugin install mod-lab-bridge@claude-mod-lab
```

Installing it installs mod-lab, which it depends on. Its MCP server (`explorer.mjs`) serves the page from the `claude-mod-lab` package: the folder `MOD_LAB_PACKAGE_ROOT` names, else `node_modules/claude-mod-lab` in the plugin's folder, else the clone the plugin is in. An installed copy has the package in its `node_modules`: the plugin's `package.json` names `claude-mod-lab` at the plugin's version, and Claude Code installs it from the lockfile when it installs the plugin. A copy loaded with `--plugin-dir` installs nothing; the launcher names the package with `MOD_LAB_PACKAGE_ROOT`.

## Use

- `/mod-lab explorer` gives the URL of this session's explorer, starting it if it waits. The bridge connects to it within a few seconds; the page's header then names the session. The explorer stops with the session.
- `npx claude-mod-lab` opens a standalone explorer. `npx claude-mod-lab run [project]` starts a session and joins an available explorer, or starts one for that session. `run --new` uses a session-owned explorer even if a standalone one is running. The launcher reports which explorer the session uses and whether it ends with the session. `attach` is an alias for `run`.
- With the bridge installed, a plain `claude` can join the shared explorer when its own explorer is not already serving. An explicit `bridgeFile` option or `MOD_LAB_BRIDGE_FILE` selects one explorer exclusively. The hub serves one session at a time; the launcher checks whether it is occupied before choosing it.
- Lesson sessions pass `MOD_LAB_LESSONS` and report that path in the greeting. Ordinary project sessions send no lesson workspace. The MCP server adds no startup instructions to the model.
- The hello carries the bridge protocol's number, the session's Claude Code version and the surfaces it draws on, and the bridge's own copy of `compat.json`, from which the page's header places the version against the supported range. An explorer with another number refuses the bridge, and the page's header says which side to update: for an older bridge, the lab's plugins, each updated on its own as the [README](../../README.md#updating-and-removing) lists them; for an older explorer, `npx claude-mod-lab@latest`.
- `/mod-lab explorer serve <seconds>` keeps the session open for the page, up to 590 seconds. In an interactive session there is no need; it is for a headless one, `npm run headless`, which serves the page without a terminal and makes no model requests.

## Options

`bridgeFile`: the bridge file of an explorer started on its own, to connect to instead of this session's explorer; empty by default. `MOD_LAB_BRIDGE_FILE` does the same when the option is empty. For a session started with `--plugin-dir`, set it in settings under `pluginConfigs`:

```json
{ "pluginConfigs": { "mod-lab-bridge": { "options": { "bridgeFile": "/path/to/bridge.json" } } } }
```

## Tests

`claude plugin test mods/mod-lab-bridge` runs the protocol against a pretend server built from bottom hooks on `mcp.connect`, `mcp.call`, `fs.exists`, `fs.read` and `http.fetch`. The test kit loads no dependencies, so `$.lab` is absent there and a job is answered as not run, except in the tests that add a stand-in `$.lab` as an inline plugin, whose methods answer from their input; `web/test/explorer-mcp.test.mjs` runs `explorer.mjs` with an MCP client on its stdio, and `npm run e2e` checks the full path with both mods in headless sessions.
