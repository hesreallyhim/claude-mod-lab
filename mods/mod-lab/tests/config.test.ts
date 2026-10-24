import { expect, test } from 'claude-code/testing'
import type { ConfigRow } from 'claude-code'

import { valueOf } from '../hooks/config'
import { lab } from './kit'

const rows: ConfigRow[] = [
  { key: 'theme', label: 'Theme', kind: 'choice', value: 'dark', options: ['dark', 'light'], provider: { plugin: 'engine', tier: 'core' }, isLocked: false },
  { key: 'verbose', label: 'Verbose output', kind: 'boolean', value: false, provider: { plugin: 'engine', tier: 'core' }, isLocked: true },
  { key: 'stopwatch.slowAfter', label: 'Slow after, in seconds', description: 'seconds', kind: 'number', value: 5, provider: { plugin: 'stopwatch', tier: 'user' }, isLocked: false },
]

test('/mod-lab config lists the rows by owner, each with its kind, value, options and lock', async ($, on) => {
  on('config.list', () => ({ value: rows }))

  const report = await $.command.run(lab('config'))

  expect(report.text).toContain(`${rows.length} of the session's ${rows.length} /config rows`)
  expect(report.text).toContain('engine (core):\n  theme = dark  (choice: dark | light)  Theme')
  expect(report.text).toContain('verbose = false  (boolean), locked')
  expect(report.text).toContain('stopwatch (user):\n  stopwatch.slowAfter = 5  (number)')
})

test('a filter keeps the rows whose key, label or owner holds it', async ($, on) => {
  on('config.list', () => ({ value: rows }))

  const report = await $.command.run(lab('config stopwatch'))

  expect(report.text).toContain(`1 of the session's ${rows.length} /config rows, matching stopwatch`)
  expect(report.text).not.toContain('theme =')
})

test('/mod-lab config set passes the value through the hooks, and says when one changed it or refused it', async ($, on) => {
  on('config.list', () => ({ value: rows }))
  on('config.set', ($, e) => (e.value === 0 ? { deny: 'refused-r1: a call takes some time' } : { value: Math.min(Number(e.value), 600) }))

  const clamped = await $.command.run(lab('config set stopwatch.slowAfter 900'))
  const refused = await $.command.run(lab('config set stopwatch.slowAfter 0'))
  const kept = await $.command.run(lab('config set stopwatch.slowAfter 12'))

  expect(clamped.text).toBe('Set stopwatch.slowAfter to 600, not 900: a hook changed it on its way.')
  expect(refused.text).toBe('Not set: refused-r1: a call takes some time')
  expect(kept.text).toBe('Set stopwatch.slowAfter to 12.')
})

test('typed text sets a row to a boolean, a number, or the text', () => {
  expect(valueOf('true')).toBe(true)
  expect(valueOf('false')).toBe(false)
  expect(valueOf('42')).toBe(42)
  expect(valueOf('dark')).toBe('dark')
  expect(valueOf('')).toBe('')
})
