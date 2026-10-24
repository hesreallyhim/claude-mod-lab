import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildCatalog } from '../lib/catalog.mjs'

// An invented declaration file shaped like the engine's: the builder reads
// structure (CoreEngineInterface, OpEventOf, EngineEventOf), not wording.
const FIXTURE = `// Written by Claude Code 0.0.7.
declare module 'claude-code' {
  /** A thing the fixture declares. */
  export type Gadget = { size: number }

  export interface CoreEngineInterface {
    /** The fixture's noun. */
    widget: {
      /**
       * Measures a gadget.
       *
       * A second paragraph.
       * @param gadget what to measure
       * @returns its size
       * @example
       * const n = await $.widget.measure(g)
       * @example
       * $.widget.measure({ size: 2 })
       */
      measure: (gadget: Gadget) => Promise<number>;
      /** Plain data. */
      label: string;
      /** Raises the engine event. */
      spin: EventCalls['widget']['spin'];
    };
  }

  export type EventCalls = { widget: { spin: (input: Gadget) => Promise<Gadget> } }
  export type OpEventOf = { 'widget.measure': Gadget }
  export type EngineEventOf = {
    /**
     * Fires when a widget spins.
     * @remarks Fixture remark.
     */
    'widget.spin': Gadget;
  }
  export type EngineResultOf = { 'widget.spin': Gadget }
  export interface Elements {
    /** The fixture's first surface. */
    screen: {
      Box: ElementConstructor<BoxProps>;
      Grid: ElementConstructor<GridProps>;
    };
    paper: {
      Box: ElementConstructor<BoxProps>;
    };
  }
}
`

test('nouns and their members come from CoreEngineInterface, with their doc tags', () => {
  const catalog = buildCatalog(FIXTURE)
  assert.equal(catalog.version, '0.0.7')
  assert.deepEqual(
    catalog.nouns.map(noun => noun.name),
    ['widget'],
  )
  const [measure, label, spin] = catalog.nouns[0].members
  assert.equal(measure.kind, 'method')
  assert.equal(measure.event, 'widget.measure')
  assert.equal(measure.eventKind, 'op')
  assert.match(measure.text, /^Measures a gadget\.\n\nA second paragraph\.$/)
  assert.deepEqual(measure.params, [{ name: 'gadget', text: 'what to measure' }])
  assert.equal(measure.returns, 'its size')
  assert.equal(measure.examples.length, 2)
  assert.deepEqual(measure.types, ['Gadget'])

  assert.equal(label.kind, 'property')
  assert.equal(label.event, null)

  assert.equal(spin.eventKind, 'engine')
  assert.equal(spin.resolved, '(input: Gadget) => Promise<Gadget>')
})

test('engine events carry their input, result and remarks; types are indexed by name', () => {
  const catalog = buildCatalog(FIXTURE)
  assert.deepEqual(
    catalog.events.map(event => [event.name, event.input, event.result, event.remarks]),
    [['widget.spin', 'Gadget', 'Gadget', 'Fixture remark.']],
  )
  assert.deepEqual(catalog.opEvents, ['widget.measure'])
  assert.ok(catalog.typeNames.includes('Gadget'))
  assert.match(catalog.type('Gadget').source, /size: number/)
  assert.equal(catalog.type('Missing'), null)
})

test("each surface's element table comes from Elements, with the props type each element takes", () => {
  const catalog = buildCatalog(FIXTURE)
  assert.deepEqual(
    catalog.elements.map(surface => [surface.surface, surface.members.map(member => `${member.name}:${member.props}`)]),
    [
      ['screen', ['Box:BoxProps', 'Grid:GridProps']],
      ['paper', ['Box:BoxProps']],
    ],
  )
  assert.equal(catalog.elements[0].doc, "The fixture's first surface.")
})
