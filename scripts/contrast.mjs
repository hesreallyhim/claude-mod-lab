// The explorer's colour pairs against WCAG 2.2 AA, in both schemes. Reads the
// colour tokens from the top of web/public/style.css (the :root block, and the
// one under prefers-color-scheme: dark), computes each pair's contrast ratio
// with the WCAG relative-luminance formula, prints them, and fails on any pair
// under its floor: 4.5:1 for text, 3:1 for the boundaries and states of
// controls and for marks a reader needs (the probe glyph, the session lamp).
//
//   node scripts/contrast.mjs            the table, and exit 1 on a failure
//   node scripts/contrast.mjs --markdown the same table as Markdown rows
//
// A pair a new rule uses goes in PAIRS below; the terminal's are derived from them. The focus ring stands 2px off the
// control it marks, so it is measured against the surfaces around controls.

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(fileURLToPath(new URL('..', import.meta.url)))
const css = readFileSync(join(REPO, 'web', 'public', 'style.css'), 'utf8')

const TEXT = 4.5
const UI = 3

/** [foreground, background, floor, where the pair is used] */
const PAIRS = [
  ['ink', 'bg', TEXT, 'body text on the paper'],
  ['ink', 'panel', TEXT, 'text on a sheet, a form, a run'],
  ['ink', 'code-bg', TEXT, 'code in its well'],
  ['ink', 'accent-wash', TEXT, 'the current entry in the index'],
  ['ink', 'warn-wash', TEXT, 'the intercept in force'],
  ['ink', 'ok-wash', TEXT, 'how to try a component added to the session'],
  ['ink', 'line', TEXT, "the X-ray's both-readers tag"],
  ['muted', 'bg', TEXT, 'secondary text on the paper'],
  ['muted', 'panel', TEXT, 'secondary text on a sheet'],
  ['muted', 'code-bg', TEXT, "secondary text in a well, the index on hover, a field's placeholder"],
  ['muted', 'panel', TEXT, 'JSON array indices'],
  ['muted', 'code-bg', UI, 'retained text in the prompt shape'],
  ['written', 'bg', UI, 'cache-write swatches in the calls legend'],
  ['ok', 'bg', UI, 'cache-read swatches in the calls legend'],
  ['muted', 'bg', UI, 'new-input swatches in the calls legend'],
  ['muted', 'accent-wash', TEXT, '() and namespaces in the current entry'],
  ['accent', 'bg', TEXT, 'links on the paper'],
  ['accent', 'panel', TEXT, 'links on a sheet, the probe tag'],
  ['accent', 'code-bg', TEXT, 'links in code'],
  ['accent', 'accent-wash', TEXT, 'links in the current entry'],
  ['accent-ink', 'accent', TEXT, "a primary button, the feed's selected tab"],
  ['accent-ink', 'ink', TEXT, 'the current area, the kind tag, the engine in Fig. 1'],
  ['ok', 'bg', TEXT, 'ok on the paper'],
  ['ok', 'panel', TEXT, 'ok, JSON strings on a sheet'],
  ['ok', 'ok-wash', TEXT, 'the OK stamp'],
  ['ok', 'code-bg', TEXT, 'JSON strings in a well'],
  ['bad', 'bg', TEXT, 'an error on the paper'],
  ['bad', 'panel', TEXT, 'an error on a sheet'],
  ['bad', 'bad-wash', TEXT, 'the FAILED stamp, a run error'],
  ['warn', 'bg', TEXT, 'a warning on the paper'],
  ['warn', 'code-bg', TEXT, 'a received e in a chain link'],
  ['bad', 'code-bg', TEXT, 'a rejected link in a chain'],
  ['warn', 'panel', TEXT, 'the effect and interceptable tags'],
  ['warn', 'warn-wash', TEXT, 'text on the intercept in force'],
  ['reader-model-ink', 'reader-model-bg', TEXT, "the X-ray's model tag"],
  ['reader-person-ink', 'reader-person-bg', TEXT, "the X-ray's person tag"],
  ['panel', 'bad', TEXT, "a stderr piece's cell"],
  ['line-strong', 'bg', UI, 'field, button and filter boundaries on the paper'],
  ['line-strong', 'panel', UI, 'field and tile boundaries on a sheet'],
  ['line-strong', 'code-bg', UI, 'boundaries in a well'],
  ['ink', 'panel', UI, 'the current area against the header'],
  ['accent', 'bg', UI, 'a primary button, the probe glyph, on the paper'],
  ['accent', 'panel', UI, 'a primary button, the probe glyph, on a sheet'],
  ['accent', 'accent-wash', UI, 'the probe glyph in the current entry'],
  ['focus', 'bg', UI, 'the focus ring on the paper'],
  ['focus', 'panel', UI, 'the focus ring on a sheet'],
  ['focus', 'code-bg', UI, 'the focus ring in a well'],
  ['ok', 'panel', UI, 'the session lamp, lit'],
  ['warn', 'panel', UI, 'the session lamp, not polling; the intercept form'],
  ['warn', 'warn-wash', UI, 'the intercept in force, its edge'],
  ['prompt', 'bg', TEXT, "the filter's slash, a heading's #"],
  ['prompt', 'panel', TEXT, 'a member with a probe in the index, its star, the readouts'],
  ['prompt', 'code-bg', TEXT, 'a member with a probe, on hover'],
  ['bg', 'ink', TEXT, 'reverse video: the current entry or page, the kind flag, a tile on hover'],
]

/**
 * The terminal (the status line, the bench, a run's window) draws the same rules
 * with its own tokens, --term-*, so each pair above is measured there too, but
 * the X-ray's, which never sit on it. Then the pairs only the terminal has.
 */
const PAPER_ONLY = new Set(['reader-model-ink', 'reader-person-ink', 'line', 'written'])
PAIRS.push(
  ...PAIRS.filter(([fg, bg]) => !PAPER_ONLY.has(fg) && !PAPER_ONLY.has(bg) && !(fg === 'panel' && bg === 'bad')).map(
    ([fg, bg, floor, use]) => [`term-${fg}`, `term-${bg}`, floor, `${use}; in the terminal`],
  ),
  ['term-bg', 'term-prompt', TEXT, 'the brand on the status line'],
  ['term-prompt', 'term-bg', UI, 'the brand block against the status line'],
)

/** The `--name: #hex` declarations in a block of CSS. */
function tokens(block) {
  return Object.fromEntries([...block.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})\b/gi)].map(([, name, hex]) => [name, hex]))
}

const rootStart = css.indexOf(':root {')
const light = tokens(css.slice(rootStart, css.indexOf('\n}', rootStart)))
const darkStart = css.indexOf('@media (prefers-color-scheme: dark)')
const dark = { ...light, ...tokens(css.slice(darkStart, css.indexOf('\n}', darkStart))) }

function luminance(hex) {
  const channel = index => {
    const value = parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2)
}

function ratio(a, b) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (high + 0.05) / (low + 0.05)
}

const markdown = process.argv.includes('--markdown')
const failures = []
if (markdown) console.log('| pair | floor | light | dark | used for |\n| --- | --- | --- | --- | --- |')
for (const [fg, bg, floor, use] of PAIRS) {
  const cells = [light, dark].map(scheme => {
    if (!scheme[fg] || !scheme[bg]) throw new Error(`no colour token --${fg} or --${bg} in style.css`)
    const value = ratio(scheme[fg], scheme[bg])
    if (value < floor) failures.push(`${fg} on ${bg} (${use}): ${value.toFixed(2)} under ${floor}`)
    return value.toFixed(2)
  })
  if (markdown) console.log(`| ${fg} on ${bg} | ${floor}:1 | ${cells[0]} | ${cells[1]} | ${use} |`)
  else console.log(`${`${fg} on ${bg}`.padEnd(36)} ${String(floor).padEnd(4)} light ${cells[0].padStart(5)}  dark ${cells[1].padStart(5)}  ${use}`)
}
if (failures.length > 0) {
  console.log(`\n${failures.length} pair(s) under their floor:\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
if (!markdown) console.log(`\nall ${PAIRS.length} pairs meet their floor in both schemes`)
