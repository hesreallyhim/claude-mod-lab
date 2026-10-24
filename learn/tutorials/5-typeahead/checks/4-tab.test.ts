import { expect, test } from 'claude-code/testing'

import { autocomplete, lab, typeahead } from './kit'

test('the word after /mod-lab gets a row per probe id it starts, with the probe described', { plugins: [lab] }, async ($, on) => {
  typeahead(on)

  const { suggestions } = await autocomplete($, '/mod-lab session.')

  expect(suggestions.map(row => row.text)).toEqual(['session.cwd', 'session.id', 'session.model'])
  expect(suggestions.every(row => (row.description ?? '') !== '')).toBe(true)
})

test("the engine's rows come first, and a word anywhere else gets none of the mod's", { plugins: [lab] }, async ($, on) => {
  typeahead(on, ['engine-row-e1'])

  const after = await autocomplete($, '/mod-lab fs.')
  const elsewhere = await autocomplete($, 'look at fs.')

  expect(after.suggestions.map(row => row.text)).toEqual(['engine-row-e1', 'fs.read', 'fs.write'])
  expect(elsewhere.suggestions.map(row => row.text)).toEqual(['engine-row-e1'])
})
