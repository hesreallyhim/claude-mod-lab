import { expect, test } from 'claude-code/testing'

import { disk, readAsPlugin, reader } from './kit'

test('a read of an .env file is refused, and never reaches the file system', { plugins: [reader] }, async ($, on) => {
  const reached = disk(on, { '/work/.env': 'API_KEY=k1-not-real' })

  const answer = await readAsPlugin($, '/work/.env')

  expect(answer).toMatch(/^refused: .*fence/)
  expect(reached).toEqual([])
})

test('.env.local and prod.env are refused as well', { plugins: [reader] }, async ($, on) => {
  disk(on, { '/work/.env.local': 'TOKEN=t1', '/work/deploy/prod.env': 'TOKEN=t2' })

  expect(await readAsPlugin($, '/work/.env.local')).toMatch(/^refused: .*fence/)
  expect(await readAsPlugin($, '/work/deploy/prod.env')).toMatch(/^refused: .*fence/)
})

test('a file whose name merely mentions env is read as before', { plugins: [reader] }, async ($, on) => {
  disk(on, { '/work/environment.md': 'how to set up the environment' })

  expect(await readAsPlugin($, '/work/environment.md')).toBe('how to set up the environment')
})
