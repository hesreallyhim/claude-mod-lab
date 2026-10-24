import { expect, test } from 'claude-code/testing'

import { disk, readAsPlugin, reader } from './kit'

test('a link to an .env file is refused: the fence judges where a path leads', { plugins: [reader] }, async ($, on) => {
  const reached = disk(on, { '/work/.env': 'API_KEY=k2-not-real' }, { '/work/notes.txt': '/work/.env' })

  const answer = await readAsPlugin($, '/work/notes.txt')

  expect(answer).toMatch(/^refused: .*fence/)
  expect(reached).toEqual([])
})

test('when the fence cannot check a path, the read is refused', { plugins: [reader] }, async ($, on) => {
  const reached: string[] = []
  on('fs.stat', () => ({ deny: 'this check refuses every stat' }))
  on('fs.read', ($, e) => {
    reached.push(e.path)
    return { value: 'the text' }
  })

  const answer = await readAsPlugin($, '/work/report.md')

  expect(answer).toMatch(/^refused: .*fence/)
  expect(reached).toEqual([])
})
