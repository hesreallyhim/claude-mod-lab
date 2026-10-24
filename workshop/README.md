# workshop

This folder is available for local mod experiments while developing the lab. Git ignores everything here except this file. The repository is not initialized as a lesson workspace, and running the lab here does not automatically load this folder.

A mod of your own can start here. With the mod-bootstrap plugin installed (the root README's "Have Claude help you write mods" says how), ask Claude Code in this folder to bootstrap one. Load it explicitly with `claude --plugin-dir workshop/<mod>`; `node scripts/typecheck.mjs workshop/<mod>` type-checks it against the engine's declarations.

For lessons, create a dedicated workspace with `npx claude-mod-lab init-lessons <directory>` and start it with `npx claude-mod-lab run <directory>`. That session loads the workspace's workshop mods and reloads them when you save; the explorer's Workshop page turns individual mods off. Lesson progress stays in that workspace's `.claude-mod-lab/progress.json`. An ordinary project session does not automatically load a folder named `workshop`.
