// ESLint for web/ and the bridge plugin's explorer.mjs: the recommended rules,
// browser globals for the page's code, Node globals for the server, its
// library, the tests, the e2e scripts and explorer.mjs.
// eslint-config-prettier comes last and turns off the rules Prettier settles.

import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import globals from 'globals'

export default [
  { ignores: ['**/*', '!web/', '!web/**', '!mods/', '!mods/mod-lab-bridge/', '!mods/mod-lab-bridge/explorer.mjs'] },
  js.configs.recommended,
  { files: ['web/**/*.mjs', 'mods/mod-lab-bridge/explorer.mjs'], languageOptions: { globals: globals.node } },
  { files: ['web/public/**/*.js'], languageOptions: { globals: globals.browser } },
  // The callbacks e2e-page.mjs hands to page.evaluate and page.waitForFunction run in the page.
  { files: ['web/e2e-page.mjs'], languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  prettier,
]
