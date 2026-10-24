import { expect, test } from 'claude-code/testing'

import { kitchen } from './kit'

test('/egg 5 sets five minutes', async ($, on) => {
  const { egg, shown } = kitchen($, on)

  await egg('5')

  expect(await shown()).toContain('5:00 left')
})

test('/egg 0.5 sets thirty seconds', async ($, on) => {
  const { egg, shown } = kitchen($, on)

  await egg('0.5')

  expect(await shown()).toContain('0:30 left')
})

test('/egg on its own still sets three minutes', async ($, on) => {
  const { egg, shown } = kitchen($, on)

  await egg()

  expect(await shown()).toContain('3:00 left')
})
