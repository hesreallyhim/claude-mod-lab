// What the pre-commit hook runs on the files staged under web/, and on the
// bridge plugin's explorer.mjs: Prettier and ESLint fix what they can, then the
// type-check and the tests run over web/.
// The tasks run in order; lint-staged adds the fixes to the commit.

const quoted = files => files.map(file => `'${file}'`).join(' ')

export default {
  '{web/**/*.{js,mjs,css,html,json},mods/mod-lab-bridge/explorer.mjs}': files => {
    const scripts = files.filter(file => /\.m?js$/.test(file))
    return [
      `prettier --write ${quoted(files)}`,
      ...(scripts.length > 0 ? [`eslint --fix ${quoted(scripts)}`] : []),
      'npm run typecheck:web',
      'npm run test:web',
    ]
  },
}
