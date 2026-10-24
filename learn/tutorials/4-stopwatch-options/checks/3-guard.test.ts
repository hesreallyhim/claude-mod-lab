import { expect, test } from 'claude-code/testing'

import { menu, setting } from './kit'

test('a threshold past 600 seconds is cut to 600 on its way to the settings', async ($, on) => {
  menu(on)

  const result = await setting($, 'stopwatch.slowAfter', 900, 5)

  expect(result).toEqual({ value: 600 })
})

test('zero, a negative and a value that is no number are refused with the reason', async ($, on) => {
  menu(on)

  for (const value of [0, -3, 'soon']) {
    const result = await setting($, 'stopwatch.slowAfter', value, 5)
    expect(result.deny ?? '', `setting ${value}`).not.toBe('')
  }
})

test("a good value, part of a second included, another field and another plugin's row pass as they came", async ($, on) => {
  menu(on)

  expect(await setting($, 'stopwatch.slowAfter', 30, 5)).toEqual({ value: 30 })
  expect(await setting($, 'stopwatch.slowAfter', 2.5, 5)).toEqual({ value: 2.5 })
  expect(await setting($, 'stopwatch.ignore', 'Bash', '')).toEqual({ value: 'Bash' })
  expect(await setting($, 'other.slowAfter', 900, 5, 'other')).toEqual({ value: 900 })
})
