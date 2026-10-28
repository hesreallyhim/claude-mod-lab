// Component loading feedback with a mocked session; no plugins or trust settings are changed.
/* global document */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const blocked =
  'Project plugins were skipped because this workspace was not trusted. Accept workspace trust, then /reload-plugins.'
const base = {
  name: 'gallery-mod',
  scope: 'local',
  directory: '/work/.claude/skills',
  command: null,
  commandAvailable: null,
  isAdded: true,
  isForeign: false,
  isEdited: false,
  howToTry: '/mod-gallery opens the gallery.',
}
/** @type {typeof base & { loadProblem?: string | null, destinations?: Array<typeof base & { loadProblem?: string | null, commandEligible?: boolean }> }} */
let component = { ...base, loadProblem: blocked }
let reload = { isReloaded: false, note: blocked }
let listGate = null
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('http://components.test/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/components') {
      const snapshot = { ...component }
      if (listGate) await listGate
      return route.fulfill({ json: { project: '/work', dir: '/work/.claude/skills', components: [snapshot] } })
    }
    if (path === '/api/components/add') {
      const submitted = route.request().postDataJSON()
      const selected = component.destinations?.find(one => one.scope === submitted.scope) ?? component
      assert.deepEqual(submitted, {
        name: 'gallery-mod',
        project: '/work',
        scope: selected.scope,
        directory: selected.directory ?? '/work/.claude/skills',
      })
      const added = { ...selected, isAdded: true }
      component = component.destinations
        ? { ...component, destinations: component.destinations.map(one => (one.scope === added.scope ? added : one)) }
        : added
      return route.fulfill({ json: { component: added, reload } })
    }
    if (path === '/api/components/remove') {
      const submitted = route.request().postDataJSON()
      const selected = component.destinations.find(one => one.scope === submitted.scope)
      assert.equal(submitted.directory, selected.directory)
      const removed =
        selected.isEdited && !submitted.force
          ? { ...selected, isRefused: true }
          : { ...selected, isAdded: false, isEdited: false, isRefused: false }
      if (!removed.isRefused)
        component.destinations = component.destinations.map(one => (one.scope === removed.scope ? removed : one))
      return route.fulfill({ json: { component: removed, reload } })
    }
    if (path === '/') return route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' })
    if (/^\/[a-z-]+\.js$/.test(path))
      return route.fulfill({
        contentType: 'text/javascript',
        body: await readFile(new URL(`./public${path}`, import.meta.url), 'utf8'),
      })
    return route.abort()
  })
  await page.goto('http://components.test/')
  const render = async () => {
    await page.evaluate(async () => {
      const module = '/components.js'
      const { componentControl, forgetComponents } = await import(module)
      forgetComponents()
      document.body.replaceChildren(componentControl('gallery-mod'))
    })
    await page.locator('.component button').first().waitFor()
  }

  await render()
  assert.equal(await page.getByRole('status').textContent(), blocked)
  assert.equal(await page.getByRole('button', { name: 'Remove', exact: true }).count(), 1)
  assert.match(await page.locator('.component-state').textContent(), /Added to project/)
  assert.doesNotMatch(await page.locator('body').textContent(), /Live in the session/)

  component = { ...base, isAdded: false, loadProblem: blocked }
  await render()
  await page.getByRole('button', { name: 'Add to project', exact: true }).click()
  await page.getByRole('button', { name: 'Remove', exact: true }).waitFor()
  assert.equal(
    await page.getByText(blocked, { exact: true }).count(),
    1,
    'the diagnostic is not repeated as a reload note',
  )

  component = { ...base, directory: '/work/.claude/mod-lab', isAdded: false, loadProblem: null }
  reload = { isReloaded: true, note: 'Reload command completed.' }
  await render()
  await page.getByRole('button', { name: 'Add to project', exact: true }).click()
  await page.getByText('Reload command completed.', { exact: true }).waitFor()
  assert.match(await page.locator('.component-state').textContent(), /\/work\/\.claude\/mod-lab\/gallery-mod/)
  assert.equal(await page.getByRole('status').count(), 0)
  assert.doesNotMatch(await page.locator('body').textContent(), /Live in the session/)
  component = {
    ...base,
    directory: '/home/test/.claude-mod-lab/examples',
    scope: 'shared',
    isAdded: false,
    loadProblem: null,
  }
  await render()
  await page.getByRole('button', { name: 'Add to lab', exact: true }).click()
  await page.getByRole('button', { name: 'Remove', exact: true }).waitFor()
  assert.match(await page.locator('.component-state').textContent(), /Added to your lab/)
  assert.match(await page.locator('body').textContent(), /Activate it separately in each session/)
  component = { ...base, command: 'mod-gallery', commandAvailable: true, loadProblem: null }
  await render()
  await page.getByText('Available in session: /mod-gallery', { exact: true }).waitFor()
  await page.evaluate(async () => {
    const module = '/components.js'
    const { refreshComponentCommands } = await import(module)
    refreshComponentCommands([{ name: 'mod-gallery', plugin: 'different-plugin' }])
  })
  await page.getByText('Not listed in this session: /mod-gallery', { exact: true }).waitFor()
  await page.evaluate(async () => {
    const module = '/components.js'
    const { refreshComponentCommands } = await import(module)
    refreshComponentCommands(null)
  })
  await page.getByText('Session command not checked yet: /mod-gallery', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Remove', exact: true }).count(), 1)
  // A registry event arriving during a slow page request must survive the older response.
  component = { ...base, command: 'mod-gallery', commandAvailable: false, loadProblem: null }
  let releaseList = () => {}
  listGate = new Promise(resolve => {
    releaseList = () => resolve(null)
  })
  const requested = page.waitForRequest('http://components.test/api/components')
  const rendering = render()
  await requested
  await page.evaluate(async () => {
    const module = '/components.js'
    const { refreshComponentCommands } = await import(module)
    refreshComponentCommands([{ name: 'mod-gallery', plugin: 'gallery-mod' }])
  })
  releaseList()
  await rendering
  listGate = null
  await page.getByText('Available in session: /mod-gallery', { exact: true }).waitFor()
  // Session changes discard the old registry; the new page can use its own server status.
  await page.evaluate(async () => {
    const module = '/components.js'
    const { resetComponentCommands } = await import(module)
    resetComponentCommands()
  })
  await render()
  await page.getByText('Not listed in this session: /mod-gallery', { exact: true }).waitFor()
  component = {
    ...base,
    destinations: [
      { ...base, scope: 'shared', directory: '/home/test/.claude-mod-lab/examples', isAdded: false },
      {
        ...base,
        scope: 'local',
        directory: '/work/.claude/mod-lab',
        isAdded: false,
        command: 'mod-gallery',
        commandEligible: false,
      },
    ],
  }
  reload = { isReloaded: false, note: 'Start a session with npx claude-mod-lab run --local to use these mods.' }
  await render()
  const sharedButton = page.getByRole('button', { name: 'Add to lab', exact: true })
  const localButton = page.getByRole('button', { name: 'Add to project', exact: true })
  assert.equal(await sharedButton.locator('..').evaluate(node => node.children.length), 2)
  await localButton.click()
  await page.getByRole('button', { name: 'Remove from project', exact: true }).waitFor()
  assert.equal(await sharedButton.count(), 1)
  await page.evaluate(async () => {
    const module = '/components.js'
    const { refreshComponentCommands } = await import(module)
    refreshComponentCommands([{ name: 'mod-gallery', plugin: 'gallery-mod' }])
  })
  assert.match(
    await page.locator('[data-component-scope="local"] .component-command').textContent(),
    /Not listed in this session/,
  )

  await page.getByText(reload.note, { exact: true }).waitFor()
  await sharedButton.click()
  await page.getByRole('button', { name: 'Remove from lab', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Remove from project', exact: true }).count(), 1)
  assert.equal(await page.locator('.component-state').count(), 2)
  component.destinations[1].isEdited = true
  await render()
  await page.getByRole('button', { name: 'Remove from project', exact: true }).click()
  await page.getByRole('button', { name: 'Remove with changes', exact: true }).waitFor()
  assert.match(await page.locator('[data-component-scope="local"]').textContent(), /has changes of yours/)
  assert.equal(await page.getByRole('button', { name: 'Remove from lab', exact: true }).count(), 1)
  await page.getByRole('button', { name: 'Keep it', exact: true }).click()
  await page.getByRole('button', { name: 'Remove from project', exact: true }).click()
  await page.getByRole('button', { name: 'Remove with changes', exact: true }).click()
  await page.getByRole('button', { name: 'Add to project', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Remove from lab', exact: true }).count(), 1)

  assert.deepEqual(errors, [])
  console.log(
    'Copied components show trust diagnostics on load and add; a completed reload is not claimed as proof a plugin is live.',
  )
} finally {
  await browser.close()
}
