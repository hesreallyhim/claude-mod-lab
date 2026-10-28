// The flask's bubbles: single cells that rise from the flask's neck, drifting
// a cell to either side and dimming out, and smaller ones that rise through
// the liquid as unlit cells and pop at its surface. Every bubble stays on the
// cell grid; only which cell is lit changes.
//
// Coordinates are the flask's own cells (assets/brand/src/cells.mjs draws it
// 9 wide and 12 tall, its lip on row 0), so the README banner, which bakes a
// loop of these bubbles into SMIL, and the explorer's home page, which runs
// them live, draw the same ones.

/** The column the neck's bubbles leave from. */
export const NECK = 4
/** The liquid's cells, inclusive. */
export const LIQUID = { top: 7, bottom: 10, left: 1, right: 7 }

/** A neck bubble's brightness by height above the lip: emerging, full, then dimming out. */
const RISE = [0.5, 1, 1, 1, 1, 0.7, 0.45, 0.2]

/** Seconds between departures, and per row, before jitter. */
export const PACE = {
  rise: { gap: [1.5, 2.7], step: 0.6 },
  fizz: { gap: [0.9, 2.2], step: 0.4 },
}

/**
 * One cell of a bubble's life, from `t` until the next step's `t`. A `bubble`
 * is lit in the liquid's colour; a `fizz` is an unlit cell inside the liquid.
 * @typedef {{ t: number, x: number, y: number, o: number, role: 'bubble' | 'fizz' }} Step
 */

/**
 * A seeded generator of numbers in [0, 1), so a build reproduces the same bubbles.
 * @param {number} seed
 */
export function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * @param {() => number} rand
 * @param {number} lo
 * @param {number} hi
 */
export const between = (rand, lo, hi) => lo + rand() * (hi - lo)

/**
 * @param {number} n
 * @param {number} lo
 * @param {number} hi
 */
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n))

/**
 * Ends a bubble's steps with a step of brightness 0 at `t`, where it goes out.
 * @param {Step[]} steps
 * @param {number} t
 */
function goOut(steps, t) {
  const last = steps[steps.length - 1]
  steps.push({ ...last, t, o: 0 })
  return steps
}

/**
 * A bubble leaving the neck at `start`, one row at a time, a little slower as it thins out.
 * @param {() => number} rand
 * @param {number} start
 * @param {number} [speed] above 1, it rises faster
 * @returns {Step[]}
 */
export function rising(rand, start, speed = 1) {
  const pace = (PACE.rise.step * between(rand, 0.85, 1.15)) / speed
  /** @type {Step[]} */
  const steps = []
  let t = start
  let dx = 0
  RISE.forEach((o, rise) => {
    // Now and then a cell to one side, never more than one from the neck.
    if (rise > 1 && rand() < 0.35) dx = clamp(dx + (rand() < 0.5 ? -1 : 1), -1, 1)
    steps.push({ t, x: NECK + dx, y: -1 - rise, o, role: 'bubble' })
    t += pace * between(rand, 0.8, 1.2) * (1 + 0.04 * rise)
  })
  return goOut(steps, t)
}

/**
 * A bubble forming on the liquid's floor at `start`, rising through it as an
 * unlit cell, and popping as a dim lit cell just above the surface.
 * @param {() => number} rand
 * @param {number} start
 * @param {number} [speed] above 1, it rises faster
 * @returns {Step[]}
 */
export function fizzing(rand, start, speed = 1) {
  const pace = (PACE.fizz.step * between(rand, 0.85, 1.15)) / speed
  // Off the glass on the floor; it may drift next to it on the way up.
  let x = LIQUID.left + 1 + Math.floor(rand() * (LIQUID.right - LIQUID.left - 1))
  /** @type {Step[]} */
  const steps = []
  let t = start
  for (let y = LIQUID.bottom; y >= LIQUID.top; y--) {
    if (y < LIQUID.bottom && rand() < 0.25) x = clamp(x + (rand() < 0.5 ? -1 : 1), LIQUID.left, LIQUID.right)
    steps.push({ t, x, y, o: y === LIQUID.bottom ? 0.6 : 1, role: 'fizz' })
    t += pace * between(rand, 0.8, 1.2)
  }
  steps.push({ t, x, y: LIQUID.top - 1, o: 0.5, role: 'bubble' })
  return goOut(steps, t + pace * 0.6)
}

/**
 * The step a bubble shows at time `t`, or null before it starts and once it has gone out.
 * @param {Step[]} steps
 * @param {number} t
 * @returns {Step | null}
 */
export function stepAt(steps, t) {
  if (t < steps[0].t || t >= steps[steps.length - 1].t) return null
  return steps.findLast(step => step.t <= t) ?? null
}

/**
 * True when two cells are the same or touch, so two bubbles there would read as one.
 * @param {{ x: number, y: number }} a
 * @param {{ x: number, y: number }} b
 */
export const touching = (a, b) => Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1

/**
 * Bubbles run live: the returned `tick(t, excitement)` advances them to time
 * `t` in seconds and answers the cells lit then. Excitement, from 0 to 1,
 * multiplies how often bubbles leave (up to 4 times from the neck, 6 times in
 * the liquid) and makes them rise up to half again as fast. A bubble waits to
 * leave while the cell it starts in touches another bubble.
 * @param {() => number} [rand]
 */
export function bubbler(rand = Math.random) {
  const kinds = [
    { make: rising, gap: PACE.rise.gap, boost: 3, live: [], owed: 0, due: 0 },
    { make: fizzing, gap: PACE.fizz.gap, boost: 5, live: [], owed: 0, due: 0 },
  ]
  let last = null
  /**
   * @param {number} t
   * @param {number} [excitement]
   * @returns {Step[]}
   */
  return function tick(t, excitement = 0) {
    // A long pause (a hidden tab) resumes where it left off, without a burst of bubbles.
    const dt = last === null ? 0 : clamp(t - last, 0, 0.25)
    last = t
    const lit = []
    for (const kind of kinds) {
      kind.live = kind.live.filter(steps => t < steps[steps.length - 1].t)
      kind.owed += dt * (1 + kind.boost * excitement)
      if (kind.owed >= kind.due) {
        const steps = kind.make(rand, t, 1 + 0.5 * excitement)
        const now = kind.live.map(other => stepAt(other, t)).filter(step => step !== null)
        if (!now.some(step => touching(step, steps[0]))) {
          kind.live.push(steps)
          kind.owed -= kind.due
          kind.due = between(rand, kind.gap[0], kind.gap[1])
        }
      }
      for (const steps of kind.live) {
        const step = stepAt(steps, t)
        if (step !== null && step.o > 0) lit.push(step)
      }
    }
    return lit
  }
}

/** How far from the flask's middle, in CSS pixels, the pointer's pull falls to half. */
const REACH = 120

/**
 * Runs the bubbles live in the explorer's flask: `svg` is drawn in flask cells
 * with the bubbles' room above it, and its `.flask-still` cells, the bubbles
 * drawn for a still page, are replaced. The nearer the pointer to the flask,
 * the more it bubbles. Nothing moves for a person who asks for reduced motion.
 * Stops once the svg has left the page.
 * @param {SVGSVGElement} svg
 */
export function bubbleUp(svg) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  for (const still of svg.querySelectorAll('.flask-still')) still.remove()
  const NS = 'http://www.w3.org/2000/svg'
  const clock = () => performance.now() / 1000
  const tick = bubbler()
  const started = clock()
  // Bubbles already on their way, as if the flask had been bubbling all along.
  for (let t = started - 8; t < started; t += 0.05) tick(t)

  /** @type {{ x: number, y: number } | null} */
  let pointer = null
  const onMove = (/** @type {PointerEvent} */ e) => (pointer = { x: e.clientX, y: e.clientY })
  const onLeave = () => (pointer = null)
  window.addEventListener('pointermove', onMove, { passive: true })
  document.documentElement.addEventListener('pointerleave', onLeave)

  const pull = () => {
    if (pointer === null) return 0
    // The middle of the flask's body, 7 rows under its lip.
    const box = svg.getBoundingClientRect()
    const view = svg.viewBox.baseVal
    const x = box.left + (4.5 / view.width) * box.width
    const y = box.top + ((7 - view.y) / view.height) * box.height
    return 1 / (1 + (Math.hypot(pointer.x - x, pointer.y - y) / REACH) ** 2)
  }

  /** @type {SVGRectElement[]} */
  const cells = []
  let excitement = 0
  let last = started
  const frame = () => {
    const t = clock()
    if (!svg.isConnected && t - started > 2) {
      window.removeEventListener('pointermove', onMove)
      document.documentElement.removeEventListener('pointerleave', onLeave)
      return
    }
    // Excitement follows the pointer's pull over about half a second, so it swells and settles.
    excitement += (pull() - excitement) * (1 - Math.exp(-(t - last) / 0.4))
    last = t
    const lit = tick(t, excitement)
    while (cells.length < lit.length) {
      const cell = document.createElementNS(NS, 'rect')
      cell.setAttribute('width', '1')
      cell.setAttribute('height', '1')
      svg.append(cell)
      cells.push(cell)
    }
    cells.forEach((cell, i) => {
      const step = lit[i]
      if (step === undefined) return cell.setAttribute('visibility', 'hidden')
      cell.removeAttribute('visibility')
      cell.setAttribute('x', String(step.x))
      cell.setAttribute('y', String(step.y))
      cell.setAttribute('opacity', String(step.o))
      cell.setAttribute('class', step.role === 'fizz' ? 'flask-fizz' : 'flask-liquid')
    })
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}
