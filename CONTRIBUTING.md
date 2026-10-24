# Contributing to claude-mod-lab

This covers working on the lab itself: setting up a clone, the checks, how the repository is laid out, how the lab handles Claude Code versions, and releases. [README.md](README.md) is for people using the lab.

## Setting up a clone

You need Claude Code and Node 22 or newer. Run `npm ci` to install TypeScript and the development tools (among them playwright-core, which `npm run e2e-page` uses to drive Google Chrome) and set up the git hooks.

In the clone, `npx claude-mod-lab run <folder>` runs the clone's own launcher, which loads the lab from `mods/` instead of copies, so an edit reaches a running session through `/reload-plugins`. `npm run explorer` runs the explorer's server on its own. `claude plugin marketplace add .` adds the marketplace from the clone; plugins installed from it are read from their folders here.

For lessons, create a separate workspace with `npx claude-mod-lab init-lessons <folder>`, then start it with `npx claude-mod-lab run <folder>`. The clone itself is not a lesson workspace. Lesson mods, reference solutions, and progress belong to the initialized folder.

## Commands

What a person runs, in a clone or from the package. In a clone, the unversioned `npx claude-mod-lab` command uses the local package. Outside a clone, use `npx claude-mod-lab@alpha` for the alpha release.

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
| `claude plugin test mods/scratch-mod` | in a clone, the scratch mod's tests |
| `claude --plugin-dir mods/scratch-mod` | in a clone, Claude Code with the scratch mod |

What a contributor runs, as npm scripts:

| Script | What it does |
| --- | --- |
| `npm run check` | validate and type-check every mod and lesson, run all tests, check every lesson's solution, and check the web app's formatting, lint, types, coverage and line limit |
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
docs/media/          the README's screenshots and recordings
mods/mod-lab         the lab mod
mods/mod-lab-bridge  the bridge mod, and the explorer's MCP server
mods/mod-lab-target  hooks that fail on request, for /mod-lab verify
mods/mod-lab-keys    the prompt box's other changes, for /mod-lab keys
mods/scratch-mod     pattern exercises
mods/gallery-mod     rendering techniques
templates/           small mods to add to a session or start from
learn/               tutorials, challenges and the checker
workshop/            optional local mod experiments (ignored by git)
web/                 the explorer server, page and tests
bin/                 the claude-mod-lab command
scripts/             the npm scripts' code: validation, type-checks, compatibility, packing, releases
plugins/             plugins that are not mods: mod-bootstrap and mod-authoring-notes, skills
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

## The README's media

The GIFs and screenshots in `docs/media/` come from two scripts kept for retaking them when the explorer's look changes: `scripts/readme-terminal.temp.tape` records the terminal clip with [vhs](https://github.com/charmbracelet/vhs), and `scripts/readme-media.temp.mjs` records the explorer's clips and screenshots from a running lab session. Each file's header says how to run it.

## Releasing

Releases are cut from `main`, whose head is what the marketplace serves; work happens on `develop`. A plugin's version lives in its `plugin.json` only, never also in its entry in `marketplace.json`. The npm package, mod-lab, mod-lab-bridge, mod-lab-target and mod-lab-keys share one version and move together, since the bridge protocol couples them. The templates, gallery-mod, scratch-mod, mod-bootstrap and mod-authoring-notes bump only when they change. A plugin that changed without a higher version is not offered by `claude plugin update`.

For the initial alpha, use `--all-plugins` to give every shipped plugin manifest a fresh version, including lesson starters and solutions. This is an optional exception for replacing previously cached development versions; ordinary releases keep the default policy above. Preview the changes first:

```sh
npm run release -- 0.2.0 --all-plugins --dry-run
npm run release -- 0.2.0 --all-plugins
```

The flag does not add lessons to the marketplace. Plugin tags still cover the marketplace plugins and scratch-mod; mod-lab-bridge waits for its published dependency lockfile.

`claude plugin tag <folder>` tags each plugin that changed, as `<name>--v<version>`, after checking that its `plugin.json` and its marketplace entry agree; `--dry-run` shows the tag and the commands without making it.

An installed mod-lab-bridge gets the explorer from the npm package: its own `package.json` names `claude-mod-lab` at the bridge's version, and Claude Code installs it from the bridge's lockfile when it installs the plugin. So a release goes in this order:

1. `npm run release -- <version>` bumps the versions (the bridge's dependency included, dropping its old lockfile), commits, runs `pack-check`, and tags every changed plugin but the bridge.
2. `npm publish <tarball> --tag alpha --access public`, using the tarball `pack-check` printed. The initial 0.2.0 release uses the `alpha` channel; do not publish it under `latest`. A plain `npm publish` from the repository folder is refused.
3. `npm run bridge-lock` writes the bridge's lockfile against the registry, checks it pins the published version with npm's integrity, commits it and tags the bridge.
4. Once the npm package and bridge lockfile are ready, push `main`, which the marketplace serves, and the release tags to the release repository.

`node scripts/install-check.temp.mjs` checks the installed route before any of this is published: it serves a pack of HEAD from a local npm registry and a clone over a local git server, runs `bridge-lock` there, installs the bridge into a throwaway Claude Code config, and checks that its session serves the explorer from the installed package.
