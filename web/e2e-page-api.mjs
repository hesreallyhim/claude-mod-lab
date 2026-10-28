import { join } from 'node:path'

/** @param {import('./e2e-page-helpers.mjs').PageChecks} ctx */
export async function checkApi(ctx) {
  const { page, server, expect, REPO } = ctx
  await page.goto(server.url)
  await page.waitForSelector('main .home')
  expect(
    (
      await page.locator('#areas [data-area]').evaluateAll(links => links.map(link => link.getAttribute('data-area')))
    ).join(',') === 'api,session,build' && (await page.locator('main .home .card').count()) === 3,
    'the home page and the header offer the three areas',
  )
  expect(!(await page.isVisible('#nav')) && !(await page.isVisible('#feed')), 'the home page has neither column')

  await page.goto(`${server.url}/#/$/fs.read`)
  await page.waitForSelector('form.probe')
  expect(
    (await page.locator('#areas [data-area=api][aria-current=page]').isVisible()) && !(await page.isVisible('#feed')),
    "a method's page is in the Mod API area, which has no feed",
  )
  expect(
    (await page.textContent('#session')).includes(server.hub.snapshot().session.facts.id.slice(0, 8)),
    'the header names the connected session',
  )
  const engine = await page.textContent('#engine .tip-value')
  expect(
    engine.startsWith(`Claude Code ${server.hub.snapshot().session.engine.version}`),
    `the header shows the session's build (${engine})`,
  )

  await page.fill('form.probe input[name=path]', join(REPO, 'package.json'))
  await page.click('form.probe button[type=submit]')
  await page.waitForSelector('form.probe article.run[data-probe="fs.read"][data-status=ok]', { timeout: 15_000 })
  const card = await page.textContent('form.probe .result article.run')
  expect(card.includes('fs.read') && card.includes('ok'), "the form's run comes back as a card under it")
  expect(card.includes(join(REPO, 'package.json')), 'the card shows the path the hooks saw, resolved')

  await page.locator('#feed-body details.trace[data-event="fs.read"]').first().waitFor({ state: 'attached' })
  expect(true, "the feed has the run on top, for the Session area's pages")

  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  const copyHooks = page.locator('form.probe article.run [data-action=copy-test-hooks]')
  await copyHooks.click()
  await page.locator('form.probe article.run [data-action=copy-test-hooks][data-copy-state=copied]').waitFor()
  const ejected = await page.evaluate(() => navigator.clipboard.readText())
  expect(
    ejected.includes("on('fs.read', () => (") && ejected.includes('package.json'),
    'a run card copies its calls as bottom hooks for a test',
  )

  await page.fill('#search', 'toast')
  await page.locator('#tree-count[data-filter=toast]').waitFor()
  const count = page.locator('#tree-count')
  const shown = Number(await count.getAttribute('data-shown'))
  const total = Number(await count.getAttribute('data-total'))
  // The index's links are found by where they go: their text carries the run glyph and the muted parts apart.
  const hrefs = await page.locator('#tree a').evaluateAll(links => links.map(link => link.getAttribute('href')))
  expect(
    hrefs.includes('#/$/ui.toast') &&
      !hrefs.includes('#/$/session.cwd') &&
      shown > 0 &&
      shown < total &&
      (await count.textContent()).includes(String(shown)) &&
      (await count.textContent()).includes(String(total)),
    'the filter narrows the reference, and says how much of it matches',
  )

  await page.goto(`${server.url}/#/api`)
  await page.locator('main button[data-filter-prefix="fs."]').click()
  const narrowed = await page.locator('#tree a').evaluateAll(links => links.map(link => link.getAttribute('href')))
  expect(
    (await page.inputValue('#search')) === 'fs.' &&
      narrowed.includes('#/$/fs.exists') &&
      !narrowed.includes('#/$/ui.toast'),
    "a noun's tile on the area's first page narrows the reference to it",
  )
  await page.fill('#search', '')

  await page.goto(`${server.url}/#/$/process.spawn`)
  await page.locator('main .cross a[href="#/streams"]').waitFor()
  expect(
    await page.locator('main .cross a[href="#/streams"]').isVisible(),
    "a method's page links to the Session pages that show it",
  )
  await page.locator('main .cross a[href="#/streams"]').click()
  await page.locator('main[data-page=streams]').waitFor()
  expect(
    (await page.locator('#areas [data-area=session][aria-current=page]').isVisible()) &&
      (await page.locator('main .cross a[href="#/$/process.spawn"]').isVisible()) &&
      (await page.locator('#tree a[href="#/turns"]').isVisible()),
    "a Session page lists the area's pages on the left and links back to the parts of $ it shows",
  )
  await page.click('#tab-trace')
  expect((await page.locator('#feed-body details.trace').count()) > 0, 'the session events tab lists traced events')
  await page.click('#tab-runs')

  await page.goto(`${server.url}/#/$/fs.exists`)
  await page.waitForSelector('form.intercept')
  await page.selectOption('form.intercept select[name=behavior]', 'refuse')
  await page.click('form.intercept button[type=submit]')
  await page.locator('form.intercept .result[data-status=done] .answer').waitFor({ timeout: 15_000 })
  expect(true, 'an intercept set from the form is answered by the session')
  await page.locator('[data-intercept-state="fs.exists"][data-behavior=refuse][data-scope=lab] .in-force').waitFor()
  expect(true, 'the method page shows the intercept in force')
  await page.click('form.probe:not(.intercept) button[type=submit]')
  await page.waitForSelector('form.probe:not(.intercept) .result article.run.failed', { timeout: 15_000 })
  expect(
    (await page.textContent('form.probe:not(.intercept) .result article.run')).includes('refused it'),
    "the probe run next is refused, in the lab's words",
  )
  await page
    .locator('[data-intercept-state="fs.exists"] details.trace[data-event="fs.exists"][data-intercepted=refuse]')
    .first()
    .waitFor()
  expect(true, 'the call the intercept acted on is listed under it')
  if (process.env.SCREENSHOT)
    await page.locator('section', { has: page.locator('form.intercept') }).screenshot({ path: process.env.SCREENSHOT })
  await page.goto(`${server.url}/#/turns`)
  await page.click('#tab-taps')
  expect((await page.locator('#feed-body details.trace').count()) > 0, 'the Intercepted tab lists it')
  expect(
    await page.locator('#feed-body .census-event[data-event="fs.exists"][data-calls="1"]').isVisible(),
    'and adds the calls up in its census',
  )
  await page.click('#tab-runs')
  await page.goto(`${server.url}/#/$/fs.exists`)
  await page.locator('[data-intercept-state="fs.exists"]').getByRole('button', { name: 'Clear', exact: true }).click()
  await page.locator('[data-intercept-state="fs.exists"][data-behavior=none] .no-intercept').waitFor()
  expect(true, 'Clear lifts it')
}
