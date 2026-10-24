# web

The explorer: `server.mjs` serves the page in `public/`, builds the `$` reference from the engine's local declarations, and connects to the session through mod-lab-bridge. `npx claude-mod-lab@alpha` opens or starts a standalone explorer. `npx claude-mod-lab@alpha run [project]` starts Claude Code with the lab and connects it automatically; if no shared explorer is available, the bridge's MCP server hosts one for that session.

The package root is read-only. The explorer's runtime files are per-user; its startup directory is not a write destination. Explicit project actions such as Add to session target the connected session's project. Lessons, Sandbox and Workshop require an initialized lesson workspace selected by `run <lesson-directory>`. Browsing lesson material creates no files. Each mutation carries the destination shown by its page, and a changed session or workspace makes an old request fail before writing.

| Variable | Default | What it sets |
| --- | --- | --- |
| `MOD_LAB_PORT` | `4977` | the local HTTP port; the session-owned server can use the next available port |
| `MOD_LAB_BRIDGE_FILE` | `~/.claude-mod-lab/bridge.json` | the connection file for an explicitly selected standalone explorer; prefer the CLI's `--port` option for separate instances |
| `MOD_LAB_TYPES` | discovered locally | the declaration file used for the reference |
| `MOD_LAB_LESSONS` | unset | the initialized lesson workspace; the launcher sets it only for a lesson session |
| `MOD_LAB_WORKSPACE` | working directory | the workspace for the `learn` and `add` CLI tools; the explorer does not read it to select lessons |

The bridge greeting names the selected lesson workspace independently of the session's project. `/api/context` reports both paths and the bridge protocol. The server keeps lesson checkers separate from project component destinations, and closes obsolete lesson watches when the context changes.

Without `MOD_LAB_TYPES` the server looks for the declarations in this order (`lib/types-path.mjs`):

1. `.claude-plugin/types/claude-code/index.d.ts` beside the plugins the session loaded: mod-lab's folder, which the bridge's hello reports from `$.lab.root()`, then the bridge's own. Before a session connects, beside the package's `mods/mod-lab` and `mods/mod-lab-bridge`, which `npx claude-mod-lab@alpha run` loads.
2. The same file in each folder of `<project>/.claude/skills/`, by name.
3. The plugin-authoring skill's copy under the temp folder (`/tmp/claude-<uid>/bundled-skills/<version>/`) for the session's Claude Code version, or, before a session connects, for the version `claude --version` answers.

It looks again whenever a session connects, and builds the reference again when it finds another file; when it finds none, it keeps the one it has. The session lamp's tooltip shows the session's version and, when the file was written by another, that one too. An interactive session writes the file only beside the plugins it loads from a folder, never into an installed copy, so a session whose plugins all came from the marketplace has none. With nothing found the page says so and how to get one; the probes still run.

The bridge's hello carries the bridge protocol's number (`BRIDGE_PROTOCOL` in `lib/hub.mjs`, `PROTOCOL` in the bridge's `hooks/bridge.ts`, which a test holds equal). A bridge with another number is refused, and the page's header says which side to update.

| File | What it holds |
| --- | --- |
| `server.mjs` | routes, token and host checks, the bridge file |
| `lib/hub.mjs` | the connected session, queued jobs, runs and trace rows, the bridge protocol's number |
| `lib/roots.mjs` | the package root and the workspace |
| `lib/catalog.mjs` | the reference, parsed from the declaration file |
| `lib/types-path.mjs` | where to look for the declaration file, in order |
| `public/app.js`, `view.js`, `style.css` | the page |
| `e2e.mjs`, `e2e-page.mjs` | end-to-end checks against a headless session |
| `test/` | unit tests: `npm run test:web` |

The protocol is described in [docs/design.md](../docs/design.md#bridge-protocol).
