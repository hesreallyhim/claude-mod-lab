# Contributing to claude-mod-lab

This covers working on the lab itself: setting up a clone, the checks, how the repository is laid out, how the lab handles Claude Code versions, and releases. [README.md](README.md) is for people using the lab.

## Setting up a clone

You need Claude Code and Node 22 or newer. Run `npm ci` to install TypeScript and the development tools (among them playwright-core, which `npm run e2e-page` uses to drive Google Chrome) and set up the git hooks.

## Local development

Run the launcher from the checkout you are editing, and give it a separate project to work in. Use Node 24 for development:

```sh
cd /path/to/claude-mod-lab
nvm use 24
npm ci
mkdir -p ../mod-lab-dev
npx claude-mod-lab run ../mod-lab-dev --new
```

Run `npm ci` when first setting up the checkout or after its dependencies change. Subsequent sessions need only the last command. The launcher uses this checkout's lab plugins and package files; no npm publication, version bump, global installation, or `npm link` is needed. A Git worktree works the same way: run the command from that worktree to test its files.

`--new` starts an Explorer for this session from the same checkout. Without it, the launcher may reuse a compatible, idle Explorer that was started earlier from another checkout or the published package. That can make local changes appear to be missing even when the launcher itself is local.

### Which copy does npx run?

From this repository's root, unversioned `npx claude-mod-lab` resolves the executable declared in the local `package.json`. A published package or an npm cache entry with the same version does not replace the checkout. This was verified with Node 24 and npm 11 using an empty cache in offline mode.

For an explicit path that bypasses npm command resolution entirely, the equivalent is:

```sh
node bin/claude-mod-lab.mjs run ../mod-lab-dev --new
```

From another directory, use an absolute path to that file:

```sh
node /path/to/claude-mod-lab/bin/claude-mod-lab.mjs run . --new
```

Outside the checkout, bare `npx claude-mod-lab` can resolve a dependency installed in that project or use npm's cached/downloaded package. Do not use it there to select your development checkout. An explicit package tag or version, such as `@latest`, requests npm package resolution rather than this checkout's root executable. See [npm exec's resolution rules](https://docs.npmjs.com/cli/v11/commands/npm-exec/#description).

The printed package version alone does not identify the source: unpublished edits usually retain the last release's version. Use the checkout directory or explicit launcher path to select what you are testing.

### Applying edits

| What changed | How to apply it |
| --- | --- |
| Loaded mod hooks | Interactive sessions watch the plugin files. If an edit has not appeared, run `/reload-plugins`. |
| Explorer HTML, CSS, or browser JavaScript under `web/public/` | Refresh the Explorer page. |
| Explorer server code or its Node modules | Restart the Explorer process. For the session-owned Explorer above, end and rerun the development session. |
| Launcher code or launch options | Start a new session with the local launcher. |
| Lesson starters, solutions, or Gallery templates | Existing workspace copies are preserved. Use a fresh disposable workspace to test the new source. |

`npm run explorer` starts a standalone Explorer from the checkout. For a deliberately separate server/session workflow, run `node bin/claude-mod-lab.mjs serve --port 4980` in one terminal and `node bin/claude-mod-lab.mjs run ../mod-lab-dev --port 4980` in another. Stop the server with Ctrl-C and restart it after server edits; the session can reconnect. Use a port that is free so you do not reuse an older server.

Installing a marketplace copy is a separate installation test. The local development launcher does not require `claude plugin marketplace add .` or a marketplace install. If it reports an already-installed copy of a lab plugin, check the paths it reports before assuming the installed and local copies are interchangeable.

### Developing lessons

In the development session above, run `/init-lessons` to enable lessons in the test project. Alternatively, from the checkout, run `npx claude-mod-lab init-lessons ../mod-lab-dev` before starting the session; the CLI initializer requires a new, empty, or already initialized folder. The clone itself is not a lesson workspace. Lesson mods, reference solutions, and progress belong to the test project.

In an existing project started with `run`, `/init-lessons` enables lessons without restarting the session. Lesson sources stay in `workshop/`; Start adds links in the already watched `.claude/mod-lab/` directory. Later launches reuse that collection to avoid loading each plugin twice. If you manually add a plugin under `workshop/` in such a project, the next launch adds its link; the Lessons page handles this immediately when you use Start.

## Commands

What a person runs, in a clone or from the package. From the clone root, `npx claude-mod-lab` uses the local package. Elsewhere, it may use a project dependency or npm’s cached/downloaded package; use an explicit launcher path when developing from another directory.

| Command | What it does |
| --- | --- |
| `npx claude-mod-lab` | open or start the explorer without creating project files |
| `npx claude-mod-lab run [folder]` | start Claude Code in an existing project with the lab; reuse an available explorer or start one for the session |
| `npx claude-mod-lab init-lessons <folder>` | explicitly initialize a new or empty lesson workspace; `--pin` installs the current version there |
| `npx claude-mod-lab learn [lesson]` | list the lessons and your progress; `learn <lesson> --once` checks a lesson's mod from the terminal, as for scripts |
| `npx claude-mod-lab add <template>` | copy a template, or scratch-mod, to `.claude/skills/<name>/`, where a session started there loads it |
| `npx claude-mod-lab --help` | the commands and their options |
| `/mod-lab` | in the session: the lab's pane; `/mod-lab help` lists the subcommands |
| `/mod-lab explorer` | in the session: the explorer's address, starting it if it waits |
| `/init-lessons` | in a session started by `run`: enable lessons in the current project, preserving existing files |
| `claude plugin test mods/scratch-mod` | in a clone, the scratch mod's tests |
| `claude --plugin-dir mods/scratch-mod` | in a clone, Claude Code with the scratch mod |

What a contributor runs, as npm scripts:

| Script | What it does |
| --- | --- |
| `npm run check` | validate and type-check every mod and lesson, run all tests, check every lesson's solution, and check the web app's formatting, lint, types, coverage and line limit |
| `npm run validate` | strictly validate the marketplace and every plugin manifest, including lesson starters and solutions |
| `npm run e2e` | the server and a headless session, checked end to end |
| `npm run e2e-page` | the same through the page, in the installed Google Chrome |
| `npm run explorer` | the explorer's server on its own, for development |
| `npm run headless` | a headless session serving the explorer, no model requests |
| `npm run sync-compat` | copy the root `compat.json` into each plugin that reads it; `-- --check` only checks the copies |
| `npm run pack-check` | pack the npm package and check what it holds |
| `npm run release -- <version> [--all-plugins]` | on the maintainer's machine: bump the versions, commit them, run `pack-check`, and tag the changed plugins; `--dry-run` writes nothing |
| `npm run bridge-lock` | after `npm publish`: write, check and commit mod-lab-bridge's lockfile for the published version, and tag the bridge |

## Layout

```
mods/mod-lab         the lab mod
mods/mod-lab-bridge  the bridge mod, and the explorer's MCP server
mods/mod-lab-target  hooks that fail on request, for /mod-lab verify
mods/mod-lab-keys    the prompt box's other changes, for /mod-lab keys
mods/scratch-mod     pattern exercises
mods/gallery-mod     rendering techniques
templates/           small mods to add to a session or start from
learn/               tutorials, challenges and the checker
web/                 the explorer server, page and tests
bin/                 the claude-mod-lab command
scripts/             the npm scripts' code: validation, type-checks, compatibility, packing, releases
plugins/             the mod-bootstrap authoring skill plugin
.claude-plugin/      marketplace.json, which lists the mods and plugins
```

## Claude Code versions

`compat.json` at the repository's root holds the oldest Claude Code build the lab supports (`floor`) and the last one it was tested on (`testedThrough`), and lists the plugins and lab features that need a newer build than the floor. `npm run sync-compat` copies it into each plugin that reads it, since an installed plugin can read only its own folder. The version that counts is the build the session runs: `/status` shows it, in the terminal and the desktop app alike, and the desktop app runs a build of its own, often older than the terminal's.

What the person sees is kept to a minimum:

- Below the floor, the lab says once per version to update Claude Code. Whatever loads keeps running.
- Past `testedThrough`, nothing is said. `/mod-lab verify` checks what the lab relies on about the engine's behaviour against the running build; run it on a new build, then raise `testedThrough`.
- A feature or template that needs a newer build than the session runs is left out of the lab and the explorer, and says it needs a newer version of Claude Code only when asked for by name.
- The version number appears in the explorer's header and in `/mod-lab verify`'s report.

A hook on an event the build does not have stops the plugin's whole module from loading, so mod-lab hooks only events the floor has. A hook that needs a newer event goes in an add-on plugin, as mod-lab-keys does for `prompt.change`. Calls to a method the build lacks fail only the hook that makes them.

The terminal and the desktop app are tested by hand. VS Code and mobile are checked by the test kit against each surface's rules.

## Releasing

Releases are cut from `main`, whose head is what the marketplace serves; work happens on `develop`. A plugin's version lives in its `plugin.json` only, never also in its entry in `marketplace.json`. The npm package, mod-lab, mod-lab-bridge, mod-lab-target and mod-lab-keys share one version and move together, since the bridge protocol couples them. The templates, gallery-mod, scratch-mod and mod-bootstrap bump only when they change. A plugin that changed without a higher version is not offered by `claude plugin update`.

For the initial beta, use `--all-plugins` to give every shipped plugin manifest a fresh version, including lesson starters and solutions. This is an optional exception for replacing previously cached development versions; ordinary releases keep the default policy above. Preview the changes first:

```sh
npm run release -- 0.2.0-beta.1 --all-plugins --dry-run
npm run release -- 0.2.0-beta.1 --all-plugins
```

The flag does not add lessons to the marketplace. Plugin tags still cover the marketplace plugins and scratch-mod; mod-lab-bridge waits for its published dependency lockfile.

Prerelease versions are supported, including an initial npm release. Advance `0.2.0-beta.1` to `0.2.0-beta.2` for another beta, then to `0.2.0` when ready for a stable release. The package's `publishConfig.tag` is `latest` so the documented `npx claude-mod-lab` command works. The version suffix marks this release as a beta; the distribution tag chooses the default install. A beta on the public npm registry remains publicly downloadable.

`claude plugin tag <folder>` tags each plugin that changed, as `<name>--v<version>`, after checking that its `plugin.json` and its marketplace entry agree; `--dry-run` shows the tag and the commands without making it.

An installed mod-lab-bridge gets the explorer from the npm package: its own `package.json` names `claude-mod-lab` at the bridge's version, and Claude Code installs it from the bridge's lockfile when it installs the plugin. So a release goes in this order:

1. `npm run release -- <version>` bumps the versions (the bridge's dependency included, dropping its old lockfile), commits, runs `pack-check`, and tags every changed plugin but the bridge.
2. `npm publish <tarball> --tag latest --access public`, using the tarball `pack-check` printed. Specify the tag explicitly for the initial `0.2.0-beta.1` prerelease; `latest` makes the unqualified install command resolve. A plain `npm publish` from the repository folder is refused.
3. `npm run bridge-lock` writes the bridge's lockfile against the registry, checks it pins the published version with npm's integrity, commits it and tags the bridge.
4. Once the npm package and bridge lockfile are ready, push `main`, which the marketplace serves, and the release tags to the release repository.

`node scripts/install-check.mjs` checks the installed route before any of this is published: it serves a pack of HEAD from a local npm registry and a clone over a local git server, runs `bridge-lock` there, installs the bridge into a throwaway Claude Code config, and checks that its session serves the explorer from the installed package.

Generated Claude Code declarations are not distributed. Git and npm exclude `.claude-plugin/types/` and the `claude-code`, `claude-code-tools` and `claude-code-mcp` directories. `pack-check` also rejects copied `.d.ts` files carrying the core generator's version header. The lab's authored `types/index.d.ts` contracts remain included. `scripts/test/distribution.test.mjs` verifies the exclusions with a real npm pack of synthetic fixtures.
