// Session surface checks: use stable state and action markers for behavior,
// and visible user data for content. This flow never starts a model request.
import assert from 'node:assert/strict'

/** @param {Pick<import('./e2e-page-helpers.mjs').PageChecks, 'page' | 'server' | 'expect'>} ctx */
export async function checkSessionOverview({ page, server, expect }) {
  await page.goto(`${server.url}/#/ledger`)
  await page.locator('[data-action="measure-ledger"]').click()
  await page.locator('.ledger-result[data-status="done"] .answer').waitFor({ timeout: 15_000 })
  expect(
    (await page.locator('.ledger-result .report-table tbody tr').count()) > 0 &&
      (await page.locator('.ledger-result .report-table td').allTextContents()).some(value => /\d/.test(value)),
    'the ledger measures the session and displays its answer',
  )
  if (process.env.SCREENSHOT)
    await page.locator('main').screenshot({ path: process.env.SCREENSHOT.replace(/\.png$/, '-ledger.png') })

  await page.goto(`${server.url}/#/turns`)
  await page.locator('[data-empty="turns"]').waitFor()
  expect(
    (await page.locator('[data-empty="turns"]').innerText()).length > 0,
    'the turn timeline explains its empty state before any model request',
  )

  await page.goto(`${server.url}/#/mods`)
  const mod = page.locator('article.mod-card[data-mod="mod-lab"]')
  await mod.waitFor({ timeout: 60_000 })
  expect(
    (await mod.locator('.mod-capabilities li').count()) > 0,
    'the Installed mods page reads the lab hooks module and its capabilities',
  )
}

/** @param {Pick<import('./e2e-page-helpers.mjs').PageChecks, 'page' | 'server' | 'expect'>} ctx */
async function checkWorkbench({ page, server, expect }) {
  await page.goto(`${server.url}/#/workbench`)
  const free = page.locator('button[data-free]')
  await free.click()
  await page.locator('button[data-free][aria-pressed="true"]').waitFor({ timeout: 15_000 })
  // Fail closed: a misleading UI state must never permit a paid model request.
  const intercepts = server.hub.snapshot().mirror.intercepts
  assert(
    ['model.complete', 'model.fork'].every(event =>
      intercepts.some(
        one =>
          one.event === event && one.behavior === 'answer' && String(one.value?.text ?? '').startsWith('Free mode'),
      ),
    ),
    'Both free-mode intercepts must be active before submitting the workbench',
  )
  expect(true, 'free mode is enabled and visibly selected')
  await page.locator('form.workbench').getByRole('button', { name: 'Send', exact: true }).click()
  await page
    .locator('form.workbench .result [data-probe="model.complete"][data-status="ok"]')
    .waitFor({ timeout: 15_000 })
  await page.locator('table.calls [data-call-sent="false"]').waitFor({ timeout: 15_000 })
  expect(
    (await page.locator('table.calls [data-call-sent="true"]').count()) === 0,
    'the workbench displays the intercepted completion without a sent model call',
  )
  expect(
    server.hub.snapshot().mirror.spend.calls.every(call => !call.isSent),
    'the session meter confirms no model call was sent',
  )
  if (process.env.SCREENSHOT)
    await page.locator('main').screenshot({ path: process.env.SCREENSHOT.replace(/\.png$/, '-workbench.png') })
  await free.click()
  await page.locator('button[data-free][aria-pressed="false"]').waitFor({ timeout: 15_000 })
}

/** @param {Pick<import('./e2e-page-helpers.mjs').PageChecks, 'page' | 'server' | 'expect'>} ctx */
async function checkAgents({ page, server, expect }) {
  await page.goto(`${server.url}/#/agents`)
  await page.locator('#agents-register > summary').click()
  await page.locator('#agents-register').getByRole('button', { name: 'Register', exact: true }).click()
  await page.locator('#agents-session > summary').click()
  await page.locator('[data-agent-types~="mod-lab:counter"]').waitFor({ timeout: 15_000 })
  expect(
    (await page.locator('[data-agent-types]').innerText()).includes('mod-lab:counter'),
    'the registered agent type is visible under its full name',
  )
  await page.locator('#agents-routing > summary').click()
  await page.locator('#agents-routing button[value="hide"]').click()
  await page.locator('[data-hidden-types~="Plan"]').waitFor({ timeout: 15_000 })
  expect(
    (await page.locator('[data-hidden-types]').innerText()).includes('Plan'),
    'the hidden built-in type is shown in the session summary',
  )
  await page.locator('#agents-routing button[value="show"]').click()
  await page.locator('[data-hidden-types=""]').waitFor({ timeout: 15_000 })
  expect(true, 'offering the type again clears its hidden state')
}

/** @param {Pick<import('./e2e-page-helpers.mjs').PageChecks, 'page' | 'server' | 'expect'>} ctx */
async function checkXray({ page, server, expect }) {
  await page.goto(`${server.url}/#/xray`)
  await page
    .locator('details')
    .filter({ has: page.locator('form[data-command="note"]') })
    .locator('summary')
    .click()
  for (const [command, text] of [
    ['note', 'note-x1 for the model'],
    ['notice', 'notice-x2 for the person'],
  ]) {
    const form = page.locator(`form[data-command="${command}"]`)
    await form.locator('input[name="text"]').fill(text)
    await form.locator('button[type="submit"]').click()
    await page.locator('table.xray-rows tbody tr', { hasText: text }).first().waitFor({ timeout: 15_000 })
  }
  const rowFor = text => page.locator('table.xray-rows tbody tr', { hasText: text }).first()
  expect(
    (await rowFor('note-x1').getAttribute('data-audience')) === 'model' &&
      (await rowFor('notice-x2').getAttribute('data-audience')) === 'person',
    'the X-ray assigns the model note and chat notice to their respective audiences',
  )
  await checkCompaction({ page, server, expect })
  if (process.env.SCREENSHOT)
    await page.locator('main').screenshot({ path: process.env.SCREENSHOT.replace(/\.png$/, '-xray.png') })
}

/** @param {Pick<import('./e2e-page-helpers.mjs').PageChecks, 'page' | 'server' | 'expect'>} ctx */
async function checkCompaction({ page, server, expect }) {
  await page.locator('section.compactor input[name="keep"]').fill('2')
  await page.locator('section.compactor button[value="on"]').click()
  await page.locator('[data-live="compaction"][data-compactor-enabled="true"]').waitFor({ timeout: 15_000 })
  expect(true, 'the X-ray shows the enabled lab compactor')
  const compact = page.locator('[data-action="compact"]')
  await compact.click()
  expect((await compact.getAttribute('data-armed')) === 'true', 'the first compact press only arms confirmation')
  await compact.click()
  await page.locator('section.compactor [data-command="compact"][data-status="done"]').waitFor({ timeout: 15_000 })
  expect(
    (await compact.getAttribute('data-armed')) === 'false',
    'the second compact press sends the command and clears confirmation',
  )

  // Headless serve holds the turn, so real compaction is refused. Seed one completed
  // compaction via the bridge mirror to check its visualization without a model call.
  const brief = (role, isKept, chars) => ({ role, chars, tools: 0, results: 0, preview: `${role}-${chars}`, isKept })
  const before = [
    brief('user', true, 40),
    brief('assistant', false, 900),
    brief('user', false, 30),
    brief('assistant', false, 1200),
    brief('user', true, 50),
    brief('assistant', true, 300),
  ]
  const after = [
    brief('user', true, 40),
    brief('user', false, 200),
    brief('user', true, 50),
    brief('assistant', true, 300),
  ]
  const compaction = {
    at: Date.now(),
    trigger: 'manual',
    agentId: null,
    by: 'mod-lab',
    before,
    after,
    tokensBefore: 31_000,
    tokensAfter: 30_200,
    sizedBy: 'request',
    summarizer: null,
    skipped: null,
  }
  server.hub.mirror(server.hub.snapshot().session.client, 'compactor', { keep: 2, compactions: [compaction] })
  const rendered = page.locator('article.compaction[data-compactor="mod-lab"]')
  await rendered.locator('.strip').first().waitFor()
  const header = await rendered.locator('header').innerText()
  expect(
    (await rendered.getAttribute('data-tokens-before')) === '31000' &&
      (await rendered.getAttribute('data-tokens-after')) === '30200' &&
      ['mod-lab', '31,000', '30,200'].every(value => header.includes(value)),
    'the compaction shows its owner and before/after token measurements',
  )
  expect(
    (await rendered.locator('.msg.dropped').count()) === before.filter(one => !one.isKept).length,
    'the before strip marks every dropped message',
  )
  expect(
    (await rendered.locator('.msg.built').count()) === after.filter(one => !one.isKept).length,
    'the after strip marks the replacement message',
  )
}

/** @param {Pick<import('./e2e-page-helpers.mjs').PageChecks, 'page' | 'server' | 'expect'>} ctx */
async function checkStreams({ page, server, expect }) {
  await page.goto(`${server.url}/#/streams`)
  await page
    .locator('form.inline-form select[name="argv"]')
    .selectOption("sh -c 'echo to stdout; echo to stderr >&2; exit 3'")
  await page.locator('form.inline-form button[type="submit"]').click()
  const spawned = page.locator('[data-live="streams"] article.run[data-exit-code="3"]').first()
  await spawned.waitFor({ timeout: 15_000 })
  // OS buffering can split a write into multiple chunks; require both channels,
  // not exactly one chunk per channel.
  expect(
    (await spawned.locator('.tick.stdout').count()) > 0 && (await spawned.locator('.tick.stderr').count()) > 0,
    'the process output is drawn on separate stdout and stderr channels',
  )
  expect(
    (await spawned.locator('.pieces .stdout td:last-child').allTextContents()).join('').includes('to stdout') &&
      (await spawned.locator('.pieces .stderr td:last-child').allTextContents()).join('').includes('to stderr'),
    'both process output values are visible alongside the exit status',
  )
  if (process.env.SCREENSHOT)
    await page.locator('main').screenshot({ path: process.env.SCREENSHOT.replace(/\.png$/, '-streams.png') })
}

/** @param {Pick<import('./e2e-page-helpers.mjs').PageChecks, 'page' | 'server' | 'expect'>} ctx */
async function checkKeysAndConfig({ page, server, expect }) {
  await page.goto(`${server.url}/#/keys`)
  await page
    .locator('details')
    .filter({ has: page.locator('form[data-prompt-action="fill"]') })
    .locator('summary')
    .click()
  const form = page.locator('form[data-prompt-action="fill"]')
  await form.getByRole('textbox', { name: 'Text to fill', exact: true }).fill('filled-f1 from the page')
  await form.getByRole('button', { name: 'Fill', exact: true }).click()
  const fill = page.locator('main .result [data-probe="prompt.fill"]')
  await fill.waitFor({ timeout: 15_000 })
  expect(
    (await fill.innerText()).includes('no_composer'),
    'prompt.fill returns the headless session no_composer result',
  )
  const tries = await page.locator('ol.tries > li').count()
  expect(
    tries > 0 && (await page.locator('ol.tries > li.done').count()) === 0,
    'the walkthrough has no completed prompt edits in a headless session',
  )

  await page.goto(`${server.url}/#/config`)
  await page.getByRole('button', { name: 'Read the settings', exact: true }).click()
  const tables = page.locator('[data-live="config"] table[data-provider]')
  await tables.first().locator('tbody tr').first().waitFor({ timeout: 15_000 })
  expect(
    (await tables.first().getAttribute('data-provider')) === 'engine (core)' &&
      (await tables.first().locator('.config-key').first().innerText()).length > 0,
    'settings are shown by provider, with populated engine settings first',
  )
  if (process.env.SCREENSHOT)
    await page.locator('main').screenshot({ path: process.env.SCREENSHOT.replace(/\.png$/, '-config.png') })
}

/** @param {Pick<import('./e2e-page-helpers.mjs').PageChecks, 'page' | 'server' | 'expect'>} ctx */
export async function checkSessionTools(ctx) {
  await checkWorkbench(ctx)
  await checkAgents(ctx)
  await checkXray(ctx)
  await checkStreams(ctx)
  await checkKeysAndConfig(ctx)
}
