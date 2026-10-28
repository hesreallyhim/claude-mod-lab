// The home page head's cell matrix responding to the pointer: the unlit cells
// near it take a little of a colour, fading with distance. In the dark scheme
// that is the prompt's green, a glow; in the light one the ink, offset a cell
// down and right, a soft shadow. The head's CSS sets the colour, strength and
// offset. It is drawn on a canvas under the head's content, one inset square
// per cell, so the matrix's gaps keep the page's colour.

/** How far the glow reaches from the pointer, in cells. */
const REACH = 9
/** Seconds for the glow to come up or die away as the pointer enters or leaves. */
const FADE = 0.15

/**
 * The glow's strength in a cell `d` cells from the pointer, from 1 under it to 0 at REACH.
 * @param {number} d
 */
export function falloff(d) {
  const x = d / REACH
  return x >= 1 ? 0 : (1 - x * x) ** 2
}

/**
 * Lights the cells of `hero`'s matrix under the pointer. Mouse and pen only:
 * a touch has no pointer to follow. Draws only while the pointer moves or the
 * glow fades.
 * @param {HTMLElement} hero
 */
export function cellGlow(hero) {
  const canvas = document.createElement('canvas')
  canvas.className = 'hero-glow'
  canvas.setAttribute('aria-hidden', 'true')
  hero.prepend(canvas)
  const g = canvas.getContext('2d')

  /** @type {{ x: number, y: number } | null} */
  let at = null
  let shown = 0
  let target = 0
  let last = 0
  let isDrawing = false

  const draw = (/** @type {number} */ now) => {
    shown += (target - shown) * (1 - Math.exp(-(now - last) / 1000 / FADE))
    last = now
    if (Math.abs(target - shown) < 0.01) shown = target

    const style = getComputedStyle(hero)
    const cell = parseFloat(style.getPropertyValue('--cell'))
    const strength = parseFloat(style.getPropertyValue('--glow-strength'))
    const offset = parseFloat(style.getPropertyValue('--glow-offset')) || 0
    const ratio = window.devicePixelRatio || 1
    const width = hero.clientWidth
    const height = hero.clientHeight
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
    }
    g.setTransform(ratio, 0, 0, ratio, 0, 0)
    g.clearRect(0, 0, width, height)
    if (at !== null && shown > 0) {
      g.fillStyle = style.getPropertyValue('--glow-cell').trim()
      const cx = at.x / cell + offset
      const cy = at.y / cell + offset
      for (let y = Math.floor(cy - REACH); y <= Math.ceil(cy + REACH); y++) {
        for (let x = Math.floor(cx - REACH); x <= Math.ceil(cx + REACH); x++) {
          const alpha = strength * shown * falloff(Math.hypot(x + 0.5 - cx, y + 0.5 - cy))
          if (alpha < 0.004) continue
          g.globalAlpha = alpha
          // The matrix's gap is each cell's first pixel column and row.
          g.fillRect(x * cell + 1, y * cell + 1, cell - 1, cell - 1)
        }
      }
    }
    isDrawing = shown !== target
    if (isDrawing) requestAnimationFrame(draw)
  }

  const redraw = () => {
    if (isDrawing) return
    isDrawing = true
    last = performance.now()
    requestAnimationFrame(draw)
  }

  hero.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') return
    const box = hero.getBoundingClientRect()
    at = { x: e.clientX - box.left, y: e.clientY - box.top }
    target = 1
    redraw()
  })
  hero.addEventListener('pointerleave', () => {
    target = 0
    redraw()
  })
}
