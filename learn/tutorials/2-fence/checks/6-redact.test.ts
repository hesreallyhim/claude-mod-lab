import { expect, test } from 'claude-code/testing'

import { disk, readAsPlugin, reader } from './kit'

test('secret-looking lines in what a plugin reads are redacted', { plugins: [reader] }, async ($, on) => {
  disk(on, { '/work/settings.toml': 'name = "demo"\napi_key = "abc123-not-real"\nDB_PASSWORD: hunter2\n' })

  const text = await readAsPlugin($, '/work/settings.toml')

  expect(text).toContain('name = "demo"')
  expect(text).not.toContain('abc123-not-real')
  expect(text).not.toContain('hunter2')
  expect(text).toMatch(/^api_key\s*=/m)
})
