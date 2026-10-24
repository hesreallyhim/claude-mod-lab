import { expect, test } from 'claude-code/testing'

import type { LabRun, LabTraceRow } from '../types'
import { runCells, traceCells } from '../hooks/pane'

/** Where a piece of text starts on a line. */
const at = (line: string | undefined, text: string) => (line ?? '').indexOf(text)

/** A row's cells as the pane draws them, a space apart. */
const line = (cells: readonly string[]) => cells.join(' ')

test("the pane's runs line up as a table, whatever the widths of their numbers and names", () => {
  const run = (seq: number, probe: string, ms: number, ok: boolean) =>
    ({ seq, at: 0, probe, ms, ok, from: 'explorer', error: ok ? undefined : 'boom' }) as unknown as LabRun
  const [ten, nine] = runCells([run(10, 'session.cwd', 12, true), run(9, 'fs.read', 3, false)]).map(line)
  expect(at(ten, 'session.cwd')).toBe(at(nine, 'fs.read'))
  expect(at(ten, 'ok')).toBe(at(nine, 'failed'))
  // Numbers to the right: #9 under the 10 of #10, and the durations end together.
  expect(at(ten, '#10') + 1).toBe(at(nine, '#9'))
  expect(at(ten, ' ms')).toBe(at(nine, ' ms'))
})

test("the pane's session events line up the same way", () => {
  const row = (event: string, ms: number, summary: string) =>
    ({ event, at: 0, ms, summary, chain: [] }) as unknown as LabTraceRow
  const [start, complete] = traceCells([row('session.start', 120, '/repo'), row('turn.complete', 4, 'answer')]).map(line)
  expect(at(start, 'session.start')).toBe(at(complete, 'turn.complete'))
  expect(at(start, ' ms')).toBe(at(complete, ' ms'))
})
