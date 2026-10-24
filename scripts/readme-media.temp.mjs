// Historical README capture script. The outdated media has been removed.
// Written in October 2026; kept so the media can
// be taken again when the explorer's look changes. It drives an explorer whose
// lab session is already running (start one with `npx claude-mod-lab run <folder>`,
// ideally with `--setting-sources project,local` so your own plugins stay out of
// the picture), in the installed Google Chrome through playwright-core. Such a
// session skips the folder's trust prompt, and Claude Code loads plugins from a
// project's .claude/skills/ only once that is accepted, so Add to session copies a
// template there but the session does not load it; nothing here relies on that.
//
//   node scripts/readme-media.temp.mjs --url http://localhost:4977 \
//     --workspace <the lab's folder> --out <folder> [--scenes api,lesson,shots]
//
// Scenes:
//   api     #/$/fs.read: run the probe, refuse the lab's own calls with an
//           intercept, run it again, lift the intercept. Writes api.webm.
//   lesson  #/learn/tick: start from the starter, then save each step's fix to
//           <workspace>/workshop/tick and let the page check it. Writes lesson.webm.
//           It removes workshop/tick first, so the lesson starts fresh.
//   shots   PNG screenshots of a few pages, in the light scheme.
//
// A clip becomes a GIF with ffmpeg and gifski, for example:
//   mkdir -p frames docs/media
//   ffmpeg -i api.webm -vf fps=12,scale=1200:-1:flags=lanczos frames/%04d.png
//   gifski --fps 12 --width 1200 --quality 90 -o docs/media/api.gif frames/*.png

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { chromium } from 'playwright-core'

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:4977' },
    workspace: { type: 'string' },
    out: { type: 'string', default: '/tmp/readme-media' },
    scenes: { type: 'string', default: 'api,lesson,shots' },
  },
})
const out = resolve(values.out)
mkdirSync(out, { recursive: true })
const VIEWPORT = { width: 1440, height: 900 }
const pause = ms => new Promise(done => setTimeout(done, ms))

// A visible pointer, since a recorded video has none: a dot that follows the mouse and pulses on a click.
const POINTER = `
  window.addEventListener('DOMContentLoaded', () => {
    const dot = document.createElement('div')
    dot.style.cssText = 'position:fixed;z-index:99999;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;' +
      'background:rgba(255,120,40,.55);border:2px solid rgba(255,120,40,.95);pointer-events:none;left:-40px;top:-40px;transition:transform .12s'
    document.body.appendChild(dot)
    addEventListener('mousemove', e => { dot.style.left = e.clientX + 'px'; dot.style.top = e.clientY + 'px' }, true)
    addEventListener('mousedown', () => { dot.style.transform = 'scale(1.6)' }, true)
    addEventListener('mouseup', () => { dot.style.transform = 'scale(1)' }, true)
  })`

/** Moves the pointer to the element in visible steps, then clicks it. */
async function clickOn(page, locator) {
  await locator.scrollIntoViewIfNeeded()
  const box = await locator.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 25 })
  await pause(250)
  await locator.click()
}

async function record(browser, name, act) {
  const dir = join(out, `${name}-video`)
  rmSync(dir, { recursive: true, force: true })
  const context = await browser.newContext({ viewport: VIEWPORT, colorScheme: 'light', recordVideo: { dir, size: VIEWPORT } })
  await context.addInitScript(POINTER)
  const page = await context.newPage()
  try {
    await act(page)
  } finally {
    await context.close()
  }
  const [file] = readdirSync(dir)
  renameSync(join(dir, file), join(out, `${name}.webm`))
  rmSync(dir, { recursive: true, force: true })
  console.log(`wrote ${join(out, `${name}.webm`)}`)
}

async function apiScene(page) {
  await page.goto(`${values.url}/#/$/fs.read`)
  await page.waitForSelector('.probe button[type=submit]')
  await page.mouse.move(700, 450)
  await pause(1500)
  const probe = page.locator('form.probe:not(.intercept)').filter({ hasText: 'fs.read' }).first()
  await clickOn(page, probe.getByRole('button', { name: 'Run in the session' }))
  await page.waitForSelector('article.run')
  await pause(2500)
  const intercept = page.locator('form.intercept').first()
  await intercept.scrollIntoViewIfNeeded()
  await pause(600)
  await intercept.locator('select[name=behavior]').selectOption('refuse')
  await pause(500)
  await intercept.locator('select[name=scope]').selectOption('lab')
  await pause(500)
  await clickOn(page, intercept.getByRole('button', { name: 'Set in the session' }))
  await pause(1500)
  await clickOn(page, probe.getByRole('button', { name: 'Run in the session' }))
  await page.waitForSelector('article.run.failed')
  await pause(3500)
  // Leaves the session as it was: the intercept is lifted.
  const lift = page.getByRole('button', { name: /^(Lift|Remove|Clear)/ }).first()
  if (await lift.count()) await lift.click()
}

/** The tick tutorial's three fixes, each a line of its starter replaced by the solution's. */
const TICK_STEPS = [
  ['  // Step 2: add one to `seconds`.', '  await update($, seconds, n => n + 1)'],
  ['  timer = null // Step 3: in place of null, a timer that calls tick($) every 1000 ms.', '  timer = $.clock.every(1000, () => tick($))'],
  ['  // Step 4: stop the timer before letting go of it.', '  timer?.cancel()'],
]

async function lessonScene(page) {
  if (values.workspace === undefined) throw new Error('the lesson scene needs --workspace')
  const folder = join(resolve(values.workspace), 'workshop', 'tick')
  rmSync(folder, { recursive: true, force: true })
  await page.goto(`${values.url}/#/learn/tick`)
  await page.mouse.move(700, 300)
  await pause(1500)
  await clickOn(page, page.getByRole('button', { name: /Start from the lesson's starter/ }))
  const file = join(folder, 'hooks', 'register.tsx')
  for (let tries = 0; !existsSync(file) && tries < 50; tries += 1) await pause(200)
  await pause(5000)
  for (const [from, to] of TICK_STEPS) {
    const text = readFileSync(file, 'utf8')
    if (!text.includes(from)) throw new Error(`the starter no longer holds: ${from}`)
    writeFileSync(file, text.replace(from, to))
    await pause(6000)
  }
  await pause(2000)
}

const SHOTS = [
  { name: 'turns', hash: '#/turns' },
  { name: 'xray', hash: '#/xray' },
  { name: 'gallery', hash: '#/gallery' },
  { name: 'keys', hash: '#/keys' },
  { name: 'home', hash: '#/' },
]

async function shots(browser) {
  const context = await browser.newContext({ viewport: VIEWPORT, colorScheme: 'light', deviceScaleFactor: 2 })
  const page = await context.newPage()
  for (const shot of SHOTS) {
    await page.goto(`${values.url}/${shot.hash}`)
    await pause(2000)
    await page.screenshot({ path: join(out, `${shot.name}.png`) })
    console.log(`wrote ${join(out, `${shot.name}.png`)}`)
  }
  await context.close()
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const scenes = new Set(values.scenes.split(','))
  if (scenes.has('api')) await record(browser, 'api', apiScene)
  if (scenes.has('lesson')) await record(browser, 'lesson', lessonScene)
  if (scenes.has('shots')) await shots(browser)
} finally {
  await browser.close()
}
