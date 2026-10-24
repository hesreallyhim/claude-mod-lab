import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { waveCells } from '../hooks/register'

/** The engine beneath the mod: a pane with room, and blits kept, or refused with `deny`. */
function engine(on: On, deny?: string) {
  const blits: { key: string }[] = []
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.blit', ($, e) => {
    blits.push(e as never)
    return { value: deny === undefined ? {} : { deny } }
  })
  return blits
}

const command = (args: string) => ({ command: 'raster-mod', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 100 } }) as const

test('the pane draws one Raster, its cells three words each', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ plugin: 'raster-mod', surface: 'terminal', component: 'Pane', requestId: 'raster-mod', props: { title: 'raster-mod', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} } })

  const raster = await ui.find({ type: 'Raster', key: 'wave' })
  const { columns, rows } = raster?.props as { columns: number; rows: number }

  expect(waveCells(0).length).toBe(Math.ceil((columns * rows * 12) / 3) * 4)
})

test('the timer repaints the Raster by blit until /raster-mod stop', async ($, on) => {
  const clock = mock.clock(on)
  const blits = engine(on)

  await $.command.run(command(''))
  await clock.advance(350)
  await $.command.run(command('stop'))
  const painted = blits.length
  await clock.advance(350)

  expect(painted).toBe(3)
  expect(blits.every(blit => blit.key === 'wave')).toBe(true)
  expect(blits.length).toBe(painted)
})

test('a refused blit stops the timer', async ($, on) => {
  const clock = mock.clock(on)
  const blits = engine(on, 'the element is not mounted')

  await $.command.run(command(''))
  await clock.advance(700)

  expect(blits.length).toBe(1)
})
