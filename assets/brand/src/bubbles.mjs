// The animated banners' bubbles, baked into SMIL so they play in an <img>.
// What a bubble does comes from web/public/bubbles.js, which the explorer runs
// live; this file lays a loop of them on one timeline.
//
// Every SMIL track shares the loop's duration and starts at 0s, so the loop
// repeats without a seam: departures are spaced by random gaps scaled to fill
// the loop exactly, and a bubble whose life crosses the end of the loop
// continues at its start. The schedule comes from a seeded generator, so a
// build reproduces the same file.

import { between, fizzing, mulberry32, PACE, rising, stepAt, touching } from '../../../web/public/bubbles.js'

const LOOP = 18 // seconds
const SEED = 7

/** One loop's bubbles of one kind, each a list of steps in flask cells. */
function schedule(make, gap, rand) {
  const gaps = []
  for (let sum = 0; sum < LOOP; ) sum += gaps[gaps.push(between(rand, ...gap)) - 1]
  const total = gaps.reduce((a, b) => a + b, 0)
  const departures = []
  for (let i = 0, t = 0; i < gaps.length; t += (gaps[i++] * LOOP) / total) departures.push(t)
  return departures.map(start => make(rand, start))
}

/** A bubble's step at loop time `tau`, its life wrapped around the loop. */
function wrappedAt(steps, tau) {
  return stepAt(steps, tau) ?? stepAt(steps, tau + LOOP)
}

/** True when no two bubbles are ever lit in touching cells, so each reads as its own bubble. */
function separated(bubbles) {
  for (let tau = 0; tau < LOOP; tau += 0.02) {
    const lit = bubbles.map(b => wrappedAt(b, tau)).filter(s => s !== null && s.o > 0)
    for (let i = 0; i < lit.length; i++) for (let j = i + 1; j < lit.length; j++) if (touching(lit[i], lit[j])) return false
  }
  return true
}

/** The loop's bubbles of one kind, from the first seed at or after SEED that keeps them apart. */
function apart(make, gap) {
  for (let seed = SEED; seed < SEED + 1000; seed++) {
    const bubbles = schedule(make, gap, mulberry32(seed))
    if (separated(bubbles)) return bubbles
  }
  throw new Error('no bubble schedule keeps the bubbles apart')
}

const keyTime = t => Number((t / LOOP).toFixed(5))

/** The discrete SMIL tracks for one bubble: where it is, how bright, and in which colour. */
function tracks(steps, fills) {
  const changes = steps.map(s => ({ ...s, t: s.t % LOOP })).sort((a, b) => a.t - b.t)
  const keys = [{ ...(wrappedAt(steps, 0) ?? { ...steps[0], o: 0 }), t: 0 }]
  for (const c of changes) {
    if (keyTime(c.t) === keyTime(keys.at(-1).t)) keys[keys.length - 1] = c // last write wins
    else keys.push(c)
  }
  const common = `calcMode="discrete" keyTimes="${keys.map(k => keyTime(k.t)).join(';')}" dur="${LOOP}s" begin="0s" repeatCount="indefinite"`
  const roles = new Set(keys.map(k => k.role))
  return (
    `<animateTransform attributeName="transform" type="translate" values="${keys.map(k => `${k.x} ${k.y}`).join(';')}" ${common}/>` +
    `<animate attributeName="opacity" values="${keys.map(k => k.o).join(';')}" ${common}/>` +
    (roles.size > 1 ? `<animate attributeName="fill" values="${keys.map(k => fills[k.role]).join(';')}" ${common}/>` : '')
  )
}

/**
 * The flask's bubbles as SVG in cell units, for a flask whose top-left cell is
 * at `flask`: one inset cell per bubble, moved, dimmed and coloured by
 * discrete tracks. `fills` gives the colour of each role, `bubble` and `fizz`.
 */
export function animatedBubbles(flask, fills, gap) {
  const s = 1 - 2 * gap
  const cell = (steps, fill) =>
    `<rect x="${gap}" y="${gap}" width="${s}" height="${s}" fill="${fill}" opacity="0">${tracks(steps, fills)}</rect>`
  const neck = apart(rising, PACE.rise.gap).map(steps => cell(steps, fills.bubble))
  const liquid = apart(fizzing, PACE.fizz.gap).map(steps => cell(steps, fills.fizz))
  return `<g transform="translate(${flask.x} ${flask.y})">${[...liquid, ...neck].join('')}</g>`
}
