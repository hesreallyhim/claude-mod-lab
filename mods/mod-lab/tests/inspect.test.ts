import type { EngineInterface } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { inspect, startCapture, stopCapture } from '../hooks/inspect'

test('composition from the engine or another plugin is not recorded during a lab probe', async () => {
  const $ = { plugin: { name: 'mod-lab' } } as EngineInterface
  const result = { sections: [{ id: 'ordinary', scope: 'session', text: 'normal prompt' }] }
  startCapture()
  try {
    for (const plugin of ['engine', 'another-plugin']) {
      const next = Object.assign(async (_input: never) => result, {
        event: 'prompt.compose',
        origin: { plugin },
        trace: [],
      })
      expect(await inspect($, {}, next)).toBe(result)
    }
    expect(stopCapture()).toEqual([])
  } finally {
    stopCapture()
  }
})
