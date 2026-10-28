// Browser checks for adding Gallery examples, editing the Sandbox, and working through lessons.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** @param {import('./e2e-page-helpers.mjs').PageChecks} ctx */
export async function checkGallery({ page, server, expect, workspace }) {
  await page.goto(`${server.url}/#/gallery`)
  const rasterCells = page.locator('table.matrix [data-element="Raster"] [data-surface]')
  await rasterCells.first().waitFor()
  const surfaces = await rasterCells.evaluateAll(cells =>
    Object.fromEntries(cells.map(cell => [cell.getAttribute('data-surface'), cell.getAttribute('aria-label')])),
  )
  expect(
    surfaces.terminal === 'drawn' &&
      ['desktop', 'vscode', 'mobile'].every(surface => surfaces[surface] === 'not drawn'),
    'the Gallery matrix shows Raster on the terminal alone',
  )
  expect(
    (await page.locator('section.technique').count()) >= 7 && (await page.locator('main p.error').count()) === 0,
    "it shows each of the gallery's techniques, its source found",
  )
  const technique = page.locator('#gallery-raster')
  await technique.getByRole('button', { name: 'View source', exact: true }).first().click()
  const source = page.getByRole('dialog')
  await source.waitFor()
  expect(
    (await source.locator('.text-reader-content').textContent()).includes('Raster'),
    'a technique opens its source in a reading dialog',
  )
  await source.getByRole('button', { name: 'Close source', exact: true }).click()
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: server.url })
  await technique.getByRole('button', { name: 'Copy as a mod', exact: true }).click()
  await technique.locator('[data-copy-state="copied"]').waitFor()
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  await technique.getByRole('button', { name: 'View snippet', exact: true }).click()
  const snippet = page.getByRole('dialog')
  expect(
    copied === (await snippet.locator('.text-reader-content').textContent()) &&
      copied.includes("cat > workshop/raster-mod/hooks/register.tsx <<'MOD'"),
    'Copy as a mod copies the complete snippet shown in its dialog',
  )
  await snippet.getByRole('button', { name: 'Close snippet', exact: true }).click()
  if (process.env.SCREENSHOT)
    await page.locator('main').screenshot({ path: process.env.SCREENSHOT.replace(/\.png$/, '-gallery.png') })
  const raster = page.locator('[data-component="raster-mod"]')
  const localCopy = join(workspace, '.claude', 'mod-lab', 'raster-mod')
  await raster.getByRole('button', { name: 'Add to project', exact: true }).click()
  await raster.getByRole('button', { name: 'Remove from project', exact: true }).waitFor({ timeout: 20_000 })
  expect(
    existsSync(join(localCopy, 'hooks', 'register.tsx')),
    'Add to project copies the example into the project mod folder',
  )
  await raster.getByRole('button', { name: 'Remove from project', exact: true }).click()
  await raster.getByRole('button', { name: 'Add to project', exact: true }).waitFor({ timeout: 20_000 })
  expect(!existsSync(localCopy), 'Remove from project deletes the copy it made')
}

/** @param {import('./e2e-page-helpers.mjs').PageChecks} ctx */
async function checkSandbox({ page, server, expect }) {
  await page.goto(`${server.url}/#/sandbox`)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const validation = page.locator('[data-validation="passed"]')
  await validation.waitFor({ timeout: 30_000 })
  expect(
    (await validation.locator('[data-fact="hooks"]').textContent()).includes('command.run{command=sandbox-mod}'),
    'the Sandbox saves the blank mod and shows the hooks read by the validator',
  )
  await page.selectOption('main select[name=start]', 'raster-mod')
  const exampleResponse = page.waitForResponse(response => response.url().includes('/api/sandbox/example?'))
  await page.getByRole('button', { name: 'Load', exact: true }).click()
  const example = await (await exampleResponse).json()
  await page.waitForFunction(
    module =>
      /** @type {HTMLTextAreaElement} */ (document.querySelector('textarea[aria-label="hooks/register.tsx"]'))
        ?.value === module,
    example.files.module,
  )
  await page.getByRole('button', { name: 'Run tests', exact: true }).click()
  const results = page.locator('main [data-test-status]')
  await results.first().waitFor({ timeout: 60_000 })
  const statuses = await results.evaluateAll(rows => rows.map(row => row.getAttribute('data-test-status')))
  expect(
    statuses.length === 3 && statuses.every(status => status === 'pass'),
    'the loaded sandbox example saves and all three tests pass',
  )
  if (process.env.SCREENSHOT)
    await page.locator('main').screenshot({ path: process.env.SCREENSHOT.replace(/\.png$/, '-sandbox.png') })
}

/** @param {import('./e2e-page-helpers.mjs').PageChecks} ctx */
async function checkLessonCommands({ page, server, expect }) {
  await page.goto(`${server.url}/#/learn`)
  await page.waitForSelector('ul.lessons li')
  expect((await page.locator('ul.lessons li').count()) >= 7, 'the Lessons page lists the lessons')
  await page.locator('ul.lessons a[href="#/learn/fence"]').click()
  await page.locator('[data-lesson="fence"]').waitFor()
  expect((await page.locator('main h2').count()) >= 6, "a lesson's README is drawn on its page, step by step")
  const probe = page.locator('[data-lesson-command="/mod-lab fs.read workshop/demo.env"]')
  const runResponse = page.waitForResponse(
    response => response.url().endsWith('/api/run') && response.request().method() === 'POST',
  )
  await probe.getByRole('button', { name: 'run', exact: true }).click()
  const submitted = await runResponse
  assert(submitted.ok(), 'The lesson probe must be accepted by the server')
  const { job } = await submitted.json()
  const completed = await server.hub.settled(job, 15_000)
  // The file need not exist yet, but a lost job or transport failure is not a probe result.
  assert.equal(completed?.status, 'done', 'The session must finish the lesson probe')
  assert.equal(completed.probe, 'fs.read')
  assert.equal(completed.args.path, 'workshop/demo.env')
  await probe
    .locator('.inline-result[data-status="done"], .inline-result[data-status="failed"]')
    .waitFor({ timeout: 15_000 })
  expect(
    (await probe.locator('.inline-result').innerText()).trim().length > 0,
    "a lesson's probe command runs in the session and displays its outcome",
  )
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: server.url })
  const code = page.locator('main .md-code-block').first()
  await code.getByRole('button', { name: 'Copy', exact: true }).click()
  await code.locator('[data-copy-state="copied"]').waitFor()
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(
    copied.length > 0 && copied === (await code.locator('pre').textContent()),
    'a lesson code block copies its complete contents',
  )
  if (process.env.SCREENSHOT)
    await page.locator('main').screenshot({ path: process.env.SCREENSHOT.replace(/\.png$/, '-lesson.png') })

  await page.goto(`${server.url}/#/learn/only-mine`)
  await page.locator('[data-lesson="only-mine"]').waitFor()
  const command = page.locator('[data-lesson-command="/mod-lab intercept session.cwd watch others"]')
  await page.locator('details.md').filter({ has: command }).locator('summary').click()
  await command.getByRole('button', { name: 'set', exact: true }).click()
  await command.locator('.inline-result[data-status="done"] .inline-answer').waitFor({ timeout: 15_000 })
  await command.getByRole('button', { name: 'View response', exact: true }).click()
  const response = page.getByRole('dialog')
  await response.waitFor()
  expect(
    (await response.locator('.text-reader-content').textContent()).includes('session.cwd'),
    'a lesson command shows its session response in a reading dialog',
  )
  if (process.env.SCREENSHOT)
    await response.screenshot({ path: process.env.SCREENSHOT.replace(/\.png$/, '-command.png') })
  await response.getByRole('button', { name: 'Close contents', exact: true }).click()
  server.hub.enqueueCommand('intercept clear')
}

/** @param {import('./e2e-page-helpers.mjs').PageChecks} ctx */
async function checkLessonFiles({ page, server, expect, workspace }) {
  await page.goto(`${server.url}/#/learn/stopwatch`)
  const startResponse = page.waitForResponse(response => response.url().includes('/api/lesson/start?id=stopwatch'))
  await page.locator('[data-lesson="stopwatch"] [data-action="start-lesson"]').click()
  const started = await startResponse
  expect(started.ok(), 'the lesson start request succeeds')
  await page.locator('[data-lesson-passed="0"]').waitFor({ timeout: 30_000 })
  const stopwatch = join(workspace, 'workshop', 'stopwatch')
  expect(
    JSON.parse(readFileSync(join(stopwatch, '.claude-plugin', 'plugin.json'), 'utf8')).name === 'stopwatch',
    'starting a lesson creates its manifest in workshop and displays its initial check result',
  )
  mkdirSync(join(stopwatch, 'hooks'))
  writeFileSync(
    join(stopwatch, 'hooks', 'register.ts'),
    "import type { Register } from 'claude-code'\n\nexport const register: Register = on => {}\n",
  )
  writeFileSync(join(stopwatch, 'hooks', 'hooks.json'), '{ "modules": ["./register.ts"] }\n')
  await page.waitForFunction(
    () => Number(document.querySelector('[data-lesson-passed]')?.getAttribute('data-lesson-passed')) > 0,
    null,
    { timeout: 60_000 },
  )
  expect(true, 'saving a valid hooks module updates the open lesson to show a passing step')
  if (process.env.SCREENSHOT)
    await page.locator('main').screenshot({ path: process.env.SCREENSHOT.replace(/\.png$/, '-checked.png') })
}

/** @param {import('./e2e-page-helpers.mjs').PageChecks} ctx */
async function checkWorkshop({ page, server, expect, workspace }) {
  await page.goto(`${server.url}/#/workshop`)
  const row = page.locator('main tr[data-mod="stopwatch"]')
  const toggle = row.getByRole('switch')
  const settings = () => JSON.parse(readFileSync(join(workspace, '.claude', 'settings.local.json'), 'utf8'))
  await toggle.uncheck()
  // Wait for the write and reload response, not the checkbox's optimistic input state.
  await row.locator('input[role="switch"]:enabled:not(:checked)').waitFor({ timeout: 15_000 })
  expect(
    settings().enabledPlugins?.['stopwatch@inline'] === false,
    'the Workshop switch disables the mod in workspace settings',
  )
  if (process.env.SCREENSHOT)
    await page.locator('main').screenshot({ path: process.env.SCREENSHOT.replace(/\.png$/, '-workshop.png') })
  await toggle.check()
  await row.locator('input[role="switch"]:enabled:checked').waitFor({ timeout: 15_000 })
  expect(settings().enabledPlugins === undefined, 'switching the mod back on removes its settings override')
}

/** @param {import('./e2e-page-helpers.mjs').PageChecks} ctx */
export async function checkBuild(ctx) {
  await checkSandbox(ctx)
  await checkLessonCommands(ctx)
  await checkLessonFiles(ctx)
  await checkWorkshop(ctx)
}
