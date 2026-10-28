// Builds every file in assets/brand/ from the cell drawings in cells.mjs:
//
//   logo.svg, logo-dark.svg   the lockup `$ claude-mod-lab` with the flask cursor, ink on paper / phosphor
//   icon.svg                  the prompt and the flask alone on a 16×16 terminal tile, for every background
//   banner-light.png          the README banner on console paper, 1704×432 (852×216 shown at 2×)
//   banner-dark.png           the same on the terminal, phosphor on black
//   banner-light.svg,         the banners as SVG for the README, with the bubbles rising
//   banner-dark.svg             in and from the flask on a loop (SMIL, so they play in an <img>)
//   social-preview.png        GitHub's social preview, 1280×640
//
// icon.svg is also written to web/public/, where the explorer serves it as its
// favicon; assets/ is not in the published package.
//
//   node assets/brand/src/build.mjs
//
// The SVGs are written directly; the banner SVGs carry VT323 inline, since an
// SVG shown as an image cannot load anything else. The PNGs are drawn as HTML pages (the cell
// matrix as SVG, the lines of output in VT323 and IBM Plex Mono from ./fonts)
// and rasterized with the installed Google Chrome through playwright-core.

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright-core'
import { animatedBubbles } from './bubbles.mjs'
import { bubbles, fizz, icon, lockup, runs } from './cells.mjs'

const SRC = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(SRC, '..')
const PUBLIC = resolve(SRC, '../../../web/public')

// The two schemes, after the explorer's: console paper and ink in light, phosphor on black in dark.
// Every text colour clears WCAG AA (4.5:1) against both the ground and the unlit cells under it.
const PAPER = {
  ground: '#eef0e8',
  unlit: '#e3e7dc',
  name: '#111a13', // 15.5:1 on the ground
  prompt: '#16692f', // 5.9:1
  glass: '#111a13',
  liquid: '#16692f',
  bubble: '#16692f',
  fizz: '#e3e7dc', // a bubble in the liquid is an unlit cell
  output: '#4a5a4e', // 6.4:1; 5.8:1 on an unlit cell
  glow: 'none',
}
const PHOSPHOR = {
  ground: '#0a0f0c',
  unlit: '#121a15',
  name: '#d0f2d7', // 16:1 on the ground
  prompt: '#63f294', // 13.5:1
  glass: '#d0f2d7',
  liquid: '#63f294',
  bubble: '#63f294',
  fizz: '#121a15',
  output: '#8aa891', // 7.5:1; 6.8:1 on an unlit cell
  bar: '#1a2620', // the social preview's status line: name 12.9:1, prompt 10.9:1 on it
  glow: 'drop-shadow(0 0 0.6px #63f29488)',
}

/** One path per role, each row's run of same-role cells a single rectangle. */
function paths(cells, palette) {
  const byRole = new Map()
  for (const r of runs(cells)) {
    const d = `M${r.x} ${r.y}h${r.w}v1h${-r.w}z`
    byRole.set(r.role, (byRole.get(r.role) ?? '') + d)
  }
  return [...byRole].map(([role, d]) => `<path fill="${palette[role]}" d="${d}"/>`).join('')
}

/** One path per role with every cell drawn on its own, inset by `gap`, so the gaps between cells show. */
function insetPaths(cells, palette, gap) {
  const byRole = new Map()
  for (const c of cells) {
    const s = 1 - 2 * gap
    byRole.set(c.role, (byRole.get(c.role) ?? '') + `M${c.x + gap} ${c.y + gap}h${s}v${s}h${-s}z`)
  }
  return [...byRole].map(([role, d]) => `<path fill="${palette[role]}" d="${d}"/>`).join('')
}

// ---------------------------------------------------------------------------
// The SVGs: self-contained, every shape on the cell grid, no type.
// ---------------------------------------------------------------------------

function logoSvg(palette) {
  const { cells, width, height } = lockup(0, 0)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 ${width + 2} ${height + 2}" width="${(width + 2) * 8}" height="${(height + 2) * 8}" shape-rendering="crispEdges" role="img" aria-label="claude-mod-lab"><title>claude-mod-lab</title>${paths(cells, palette)}</svg>\n`
}

function iconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="256" height="256" shape-rendering="crispEdges" role="img" aria-label="claude-mod-lab"><title>claude-mod-lab</title><rect width="16" height="16" fill="${PHOSPHOR.ground}"/>${paths(icon(), PHOSPHOR)}</svg>\n`
}

// ---------------------------------------------------------------------------
// The PNGs: a matrix of unlit cells with the lit ones drawn into it, and the
// lines of output set below the command, as a terminal would print them.
// ---------------------------------------------------------------------------

const font = file => pathToFileURL(join(SRC, 'fonts', file)).href
const FACES = `
  @font-face { font-family: 'VT323'; src: url('${font('vt323-latin-400-normal.woff2')}') format('woff2'); }
  @font-face { font-family: 'Plex'; font-weight: 500; src: url('${font('ibm-plex-mono-latin-500-normal.woff2')}') format('woff2'); }`

/** The cell matrix, `cols`×`rows` cells of `size` px, with `lit` cells drawn in their roles' colours. */
function matrix({ cols, rows, size, lit, palette, gap = 0.08 }) {
  const s = 1 - 2 * gap
  return `<svg class="matrix" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cols} ${rows}" width="${cols * size}" height="${rows * size}">
  <defs><pattern id="cell" width="1" height="1" patternUnits="userSpaceOnUse"><rect x="${gap}" y="${gap}" width="${s}" height="${s}" fill="${palette.unlit}"/></pattern></defs>
  <rect width="${cols}" height="${rows}" fill="${palette.ground}"/><rect width="${cols}" height="${rows}" fill="url(#cell)"/>
  <g style="filter:${palette.glow}">${insetPaths(lit, palette, gap)}</g></svg>`
}

function page({ width, height, body, css }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${FACES}
  html, body { margin: 0; width: ${width}px; height: ${height}px; overflow: hidden; }
  .frame { position: relative; width: ${width}px; height: ${height}px; }
  .matrix { position: absolute; inset: 0; display: block; }
  .line { position: absolute; margin: 0; white-space: nowrap; }
  ${css}</style></head><body><div class="frame">${body}</div></body></html>`
}

// The banner: 142×36 cells of 6px, shown at 852×216 and drawn at 2×. The lockup
// is centred; under it, starting under the prompt as a terminal's output does,
// is a short tagline. The lede that follows the banner says the rest.
const BANNER = { cols: 142, rows: 36, size: 6 }
const TAGLINE = 'developer tools for claude code mods'

function bannerPage(palette) {
  const { cols, rows, size } = BANNER
  const mark = lockup(Math.floor((cols - 100) / 2), 10)
  const left = Math.floor((cols - 100) / 2) * size
  const lit = [...mark.cells, ...bubbles(mark.neck), ...fizz(mark.flask)]
  return page({
    width: cols * size,
    height: rows * size,
    css: `.tagline { left: ${left}px; top: ${25 * size}px; font: 40px/1 'VT323', monospace; color: ${palette.output}; }`,
    body: `${matrix({ cols, rows, size, lit, palette })}<p class="line tagline">${TAGLINE}</p>`,
  })
}

// The banner as SVG: the same matrix, lockup and tagline, with the still
// bubbles replaced by moving ones. Viewers that ask for reduced motion get the
// still bubbles. The tagline's baseline (182px) is where Chrome sets it in the
// PNG's page: 150px down, in a 40px line box.
function bannerSvg(palette) {
  const { cols, rows, size } = BANNER
  const gap = 0.08
  const s = 1 - 2 * gap
  const mark = lockup(Math.floor((cols - 100) / 2), 10)
  const left = Math.floor((cols - 100) / 2) * size
  const vt323 = readFileSync(join(SRC, 'fonts', 'vt323-latin-400-normal.woff2')).toString('base64')
  // The PNGs' CSS glow as an SVG filter. Chrome draws the CSS blur length as
  // the shadow's standard deviation here; this matches the PNG pixel for pixel.
  const [, blur, color] = palette.glow.match(/drop-shadow\(0 0 ([\d.]+)px (#\w+)\)/) ?? []
  const glow = color
    ? `<filter id="glow" x="-1" y="-1" width="3" height="3"><feDropShadow dx="0" dy="0" stdDeviation="${blur}" flood-color="${color.slice(0, 7)}" flood-opacity="${(parseInt(color.slice(7), 16) / 255).toFixed(3)}"/></filter>`
    : ''
  const lit = glow ? ' filter="url(#glow)"' : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cols * size} ${rows * size}" width="${cols * size}" height="${rows * size}" role="img" aria-label="claude-mod-lab: ${TAGLINE}">
<title>claude-mod-lab: ${TAGLINE}</title>
<style>
  @font-face { font-family: 'VT323'; src: url(data:font/woff2;base64,${vt323}) format('woff2'); }
  .still { display: none; }
  @media (prefers-reduced-motion: reduce) { .rising { display: none; } .still { display: inline; } }
</style>
<defs><pattern id="cell" width="1" height="1" patternUnits="userSpaceOnUse"><rect x="${gap}" y="${gap}" width="${s}" height="${s}" fill="${palette.unlit}"/></pattern>${glow}</defs>
<g transform="scale(${size})">
  <rect width="${cols}" height="${rows}" fill="${palette.ground}"/><rect width="${cols}" height="${rows}" fill="url(#cell)"/>
  <g${lit}>${insetPaths(mark.cells, palette, gap)}</g>
  <g class="rising"${lit}>${animatedBubbles(mark.flask, palette, gap)}</g>
  <g class="still"${lit}>${insetPaths([...bubbles(mark.neck), ...fizz(mark.flask)], palette, gap)}</g>
</g>
<text x="${left}" y="182" font-family="VT323, monospace" font-size="40" fill="${palette.output}">${TAGLINE}</text>
</svg>
`
}

// The social preview: 128×64 cells of 10px. Everything that matters stays 40px
// (4 cells) inside every edge, and the lockup spans the middle 1000px, so a
// 1.91:1 crop (1222px wide) loses only the margin.
const SOCIAL = { cols: 128, rows: 64, size: 10 }

function socialPage() {
  const palette = PHOSPHOR
  const { cols, rows, size } = SOCIAL
  const x0 = Math.floor((cols - 100) / 2)
  const mark = lockup(x0, 15)
  const lit = [...mark.cells, ...bubbles(mark.neck, [[0, -2], [1, -4], [-1, -6], [1, -8], [0, -10]])]
  const left = x0 * size
  return page({
    width: cols * size,
    height: rows * size,
    css: `
  .tagline { left: ${left}px; top: ${30 * size}px; font: 72px/1 'VT323', monospace; color: ${palette.name}; }
  .what { left: ${left}px; top: ${39 * size}px; font: 600 32px 'Plex', monospace; color: ${palette.liquid}; }
  .what b, .status b { font-weight: 500; color: ${palette.prompt}; }
  .status { left: ${left}px; right: ${left}px; top: ${52 * size}px; height: ${6 * size}px; display: flex; align-items: center;
            justify-content: space-between; padding: 0 ${size * 2}px; background: ${palette.bar}; color: ${palette.name};
            font: 500 26px/1 'Plex', monospace; }`,
    body: `${matrix({ cols, rows, size, lit, palette })}
  <p class="line tagline">Developer tools for Claude Code mods.</p>
  <br>
  <p class="line what">Explore the complete mod API.<br>Trace mods in a live session.<br>Learn how to build your own mods from the ground up.</p>`,
  })
}

async function rasterize(browser, html, { width, height, scale, file }) {
  const scratch = mkdtempSync(join(tmpdir(), 'brand-build-'))
  const path = join(scratch, 'page.html')
  writeFileSync(path, html)
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale })
  const tab = await context.newPage()
  await tab.goto(pathToFileURL(path).href, { waitUntil: 'load' })
  await tab.evaluate(() => document.fonts.ready)
  await tab.screenshot({ path: join(OUT, file) })
  await context.close()
  console.log(join(OUT, file))
}

writeFileSync(join(OUT, 'logo.svg'), logoSvg(PAPER))
writeFileSync(join(OUT, 'logo-dark.svg'), logoSvg(PHOSPHOR))
writeFileSync(join(OUT, 'icon.svg'), iconSvg())
writeFileSync(join(PUBLIC, 'icon.svg'), iconSvg())
writeFileSync(join(OUT, 'banner-light.svg'), bannerSvg(PAPER))
writeFileSync(join(OUT, 'banner-dark.svg'), bannerSvg(PHOSPHOR))
for (const name of ['logo.svg', 'logo-dark.svg', 'icon.svg', 'banner-light.svg', 'banner-dark.svg']) console.log(join(OUT, name))
console.log(join(PUBLIC, 'icon.svg'))

const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const banner = { width: BANNER.cols * BANNER.size, height: BANNER.rows * BANNER.size, scale: 2 }
  await rasterize(browser, bannerPage(PAPER), { ...banner, file: 'banner-light.png' })
  await rasterize(browser, bannerPage(PHOSPHOR), { ...banner, file: 'banner-dark.png' })
  const social = { width: SOCIAL.cols * SOCIAL.size, height: SOCIAL.rows * SOCIAL.size, scale: 1 }
  await rasterize(browser, socialPage(), { ...social, file: 'social-preview.png' })
} finally {
  await browser.close()
}
