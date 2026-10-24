// Pixels for Image: an RGBA plasma made here, frame by frame, so a picture
// needs no file and no PNG encoder.

import { base64 } from './cells'

export const PLASMA_WIDTH = 96
export const PLASMA_HEIGHT = 48

/** A hue in [0, 1) at full saturation, as 0..255 channels. */
function hue(turn: number): [number, number, number] {
  const sixth = (((turn % 1) + 1) % 1) * 6
  const rise = Math.round((sixth % 1) * 255)
  const fall = 255 - rise
  const table: [number, number, number][] = [
    [255, rise, 0],
    [fall, 255, 0],
    [0, 255, rise],
    [0, fall, 255],
    [rise, 0, 255],
    [255, 0, fall],
  ]
  return table[Math.floor(sixth) % 6] ?? [255, 0, 0]
}

/** Frame `t` of the plasma: `width * height` RGBA pixels. */
export function plasma(t: number, width = PLASMA_WIDTH, height = PLASMA_HEIGHT): Uint8Array {
  const pixels = new Uint8Array(width * height * 4)
  const phase = t / 10
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value =
        Math.sin(x / 9 + phase) +
        Math.sin(y / 6 - phase * 1.3) +
        Math.sin((x + y) / 13 + phase * 0.7) +
        Math.sin(Math.hypot(x - width / 2, y - height / 2) / 7 - phase)
      const [red, green, blue] = hue(value / 8 + phase / 6)
      const index = (y * width + x) * 4
      pixels[index] = red
      pixels[index + 1] = green
      pixels[index + 2] = blue
      pixels[index + 3] = 255
    }
  }
  return pixels
}

/** Frame `t` as an Image source. */
export function plasmaSource(t: number) {
  return { rgba: base64(plasma(t)), width: PLASMA_WIDTH, height: PLASMA_HEIGHT }
}
