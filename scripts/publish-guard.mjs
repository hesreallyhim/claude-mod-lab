// The package's prepublishOnly script: it refuses every publish it runs for.
// npm runs prepublishOnly when it publishes a folder (`npm publish`, with or
// without --dry-run) and never when it publishes a tarball, so the one route
// left open is the tarball `npm run pack-check` checked and printed
// (`npm publish <tarball>`). A folder publish would pack the working
// tree, ignored files included, such as the tsconfig.json files the engine
// writes beside the mods, which pack-check keeps out by packing a clean
// checkout. `npm publish --ignore-scripts` skips this guard; it is not for that.

console.error(`claude-mod-lab: npm publish from a folder is refused.
Publish the tarball pack-check checked instead:

  npm run pack-check
  npm publish <the tarball it printed>`)
process.exitCode = 1
