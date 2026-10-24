import { describe, expect, test } from 'claude-code/testing'

import type { LabParam as Param } from '../types'
import { parseArgText, resolveArgs, splitCommand } from '../hooks/args'
import { oneLine, printable, summarize } from '../hooks/json'

const PARAMS: Param[] = [
  { name: 'path', type: 'string', default: 'a.md', description: '' },
  { name: 'count', type: 'number', default: 3, description: '' },
  { name: 'mode', type: 'choice', default: 'up', options: ['up', 'down'], description: '' },
]

describe('arguments', () => {
  test('a command splits at the first whitespace', () => {
    expect(splitCommand('  fs.read   docs/x y  ')).toEqual({ head: 'fs.read', rest: 'docs/x y' })
    expect(splitCommand('list')).toEqual({ head: 'list', rest: '' })
  })

  test('plain text fills the first parameter and JSON names them', () => {
    expect(parseArgText('q/r.txt', PARAMS)).toEqual({ ok: true, value: { path: 'q/r.txt' } })
    expect(parseArgText('{"count": 9}', PARAMS)).toEqual({ ok: true, value: { count: 9 } })
    expect(parseArgText('{"count":', PARAMS).ok).toBe(false)
    expect(parseArgText('[1]', PARAMS)).toEqual({ ok: true, value: { path: '[1]' } })
    expect(parseArgText('x', []).ok).toBe(false)
  })

  test('defaults fill what is missing and values take their parameter type', () => {
    expect(resolveArgs({ count: '7' }, PARAMS)).toEqual({ ok: true, value: { path: 'a.md', count: 7, mode: 'up' } })
    expect(resolveArgs({ path: '' }, PARAMS)).toEqual({ ok: true, value: { path: '', count: 3, mode: 'up' } })
    expect(resolveArgs({ count: '' }, PARAMS)).toEqual({ ok: true, value: { path: 'a.md', count: 3, mode: 'up' } })
  })

  test('a wrong value or an unknown name is refused with the reason', () => {
    const refusals = [resolveArgs({ count: 'many' }, PARAMS), resolveArgs({ mode: 'sideways' }, PARAMS), resolveArgs({ depth: 1 }, PARAMS)]
    expect(refusals.map(one => one.ok)).toEqual([false, false, false])
    expect(JSON.stringify(refusals[1])).toContain('up, down')
    expect(JSON.stringify(refusals[2])).toContain('depth')
  })
})

describe('summarize', () => {
  test('values become JSON data', () => {
    const value = { when: undefined, big: 12n, fn: () => 1, nested: [1, 'two', null], bad: Number.NaN }
    expect(summarize(value)).toEqual({ big: '12n', fn: '[function]', nested: [1, 'two', null], bad: 'NaN' })
    expect(summarize(new TypeError('boom'))).toEqual({ error: 'TypeError', message: 'boom' })
  })

  test('long strings, wide lists and deep objects are cut where the limits say', () => {
    const limits = { depth: 2, items: 3, chars: 5 }
    expect(summarize('abcdefgh', limits)).toBe('abcde... (3 more characters)')
    expect(summarize([1, 2, 3, 4, 5], limits)).toEqual([1, 2, 3, '... 2 more'])
    expect(summarize({ a: { b: { c: 1 } } }, limits)).toEqual({ a: { b: '{...}' } })
  })

  test('drawn text loses escape sequences and controls', () => {
    const raw = '\x1b[31mred\x1b[0m\tcell\nnext\x07'
    expect(printable(raw)).toBe('red\tcell\nnext')
    expect(oneLine(raw)).toBe('red cell next')
  })
})
