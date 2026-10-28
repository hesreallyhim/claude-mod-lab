// Run with node web/e2e-workspaces.mjs. Uses intercepted requests and an isolated temporary workspace; no session or project is modified.
/* global document */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { startServer } from './server.mjs'

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = { project: null, lessonWorkspace: null }
const requests = []
let lessonStarted = false
let hasSolution = false
const lesson = {
  id: 'tick',
  mod: 'tick-mod',
  title: 'A stopwatch',
  path: 'learn/tutorials/0a-tick',
  summary: 'Make a stopwatch.',
  kind: 'tutorial',
  steps: [],
  progress: null,
}
const component = { name: 'test-mod', isAdded: false, isForeign: false, isEdited: false, howToTry: null }
const files = { module: '', contract: '', test: '' }
const workshopMod = {
  name: 'tick-mod',
  folder: 'tick-mod',
  description: 'A stopwatch.',
  isOn: true,
  lessons: [],
  effects: [],
}
const checked = {
  validation: { ok: true, errors: [], facts: { hooks: [], calls: [], gating: [], state: [] } },
  types: { checked: false },
}

function answer(path) {
  if (path === '/api/lessons')
    return {
      lessons: [lesson],
      index: '# Lessons\n\nWork through each tutorial in order.\n\nOpen [A stopwatch](tutorials/0a-tick) to begin.',
      ...context,
    }
  if (path === '/api/lesson')
    return {
      ...lesson,
      folder: context.lessonWorkspace ? 'workshop/tick-mod' : null,
      isStarted: lessonStarted,
      hasSolution,
      solutionFolder: context.lessonWorkspace ? `${context.lessonWorkspace}/solutions/tick` : null,
      hasStarter: true,
      check: null,
      readme: '# A stopwatch\n\nRead this lesson before setting up a workspace.',
      ...context,
    }
  if (path === '/api/sandbox') return { dir: 'workshop/sandbox-mod', files, blank: files, examples: [], ...context }
  if (path === '/api/workshop')
    return { settings: '.claude/settings.local.json', mods: context.lessonWorkspace ? [workshopMod] : [], ...context }
  if (path === '/api/components')
    return context.project
      ? { dir: `${context.project}/.claude/skills`, components: [component], ...context }
      : { dir: null, components: [], error: 'Connect a session to add this mod to its project.', ...context }
  if (path === '/api/lesson/start') {
    const made = lessonStarted ? null : 'starter'
    lessonStarted = true
    hasSolution = true
    return { made, solutionFolder: `${context.lessonWorkspace}/solutions/tick` }
  }
  if (path === '/api/check') return { report: 'Checks passed.', progress: null }
  if (path === '/api/sandbox/save') return checked
  if (path === '/api/sandbox/test') return { results: [], output: 'No output was captured.' }
  if (path === '/api/workshop/switch') return { mod: { ...workshopMod, isOn: false }, reload: { note: 'Updated.' } }
  return null
}

async function render(page, view) {
  await page.evaluate(async view => {
    const modules = {
      lesson: 'lessons',
      lessons: 'lessons',
      sandbox: 'sandbox',
      workshop: 'workshop',
      component: 'components',
    }
    const module = await import(`/${modules[view]}.js`)
    const state = { session: null, mirror: { spend: { calls: [], totals: {} } } }
    const lessonsModule = '/lessons.js'
    const { stopWatching } = await import(lessonsModule)
    stopWatching()
    let page
    if (view === 'component') {
      module.forgetComponents()
      page = module.componentControl('test-mod')
    } else page = await module[`${view}Page`]({ state }, 'tick')
    document.body.replaceChildren(page)
  }, view)
}

async function checkLessonNavigation(browser) {
  const workspace = await mkdtemp(join(tmpdir(), 'mod-lab-lesson-navigation-'))
  let server
  let page
  try {
    await mkdir(join(workspace, '.claude-mod-lab'))
    await mkdir(join(workspace, 'workshop'))
    server = await startServer({
      port: 0,
      bridgeFile: join(workspace, 'bridge.json'),
      workspace,
      lessonWorkspace: workspace,
    })
    page = await browser.newPage()
    for (const id of ['fence', 'only-mine', 'stopwatch']) {
      await page.goto(`${server.url}/#/learn/${id}`)
      await page.waitForFunction(id => document.querySelector('main h1')?.textContent.startsWith(id), id, {
        timeout: 5_000,
      })
    }
  } finally {
    await page?.close()
    await server?.close()
    await rm(workspace, { recursive: true, force: true })
  }
}

try {
  const page = await browser.newPage()
  await page.route('http://workspace.test/**', async route => {
    const url = new URL(route.request().url())
    const path = url.pathname
    if (path.startsWith('/api/')) {
      const body = route.request().postDataJSON()
      requests.push({ path, method: route.request().method(), body, search: url.searchParams })
      if (path === '/api/lesson/watch')
        return route.fulfill({ contentType: 'text/event-stream', body: ': watching\n\n' })
      if (path === '/api/components/add')
        return route.fulfill({
          status: 409,
          json: { error: 'The connected project changed. Reload this page before adding a mod.' },
        })
      return route.fulfill({ json: answer(path) })
    }
    if (path === '/') return route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' })
    if (/^\/[a-z-]+\.js$/.test(path))
      return route.fulfill({
        contentType: 'text/javascript',
        body: await readFile(new URL(`./public${path}`, import.meta.url), 'utf8'),
      })
    return route.abort()
  })
  await page.goto('http://workspace.test/')
  for (const view of ['lessons', 'lesson', 'sandbox', 'workshop']) {
    await render(page, view)
    assert.equal(await page.getByRole('heading', { name: 'Set up a lesson workspace', exact: true }).count(), 1)
    assert.equal(await page.getByRole('button').count(), view === 'lessons' ? 1 : 0)
    if (view === 'lessons') {
      const url = page.url()
      const help = page.getByRole('button', { name: 'How lessons work', exact: true })
      let contents
      for (let opened = 0; opened < 2; opened++) {
        await help.click()
        const dialog = page.getByRole('dialog', { name: 'How lessons work', exact: true })
        await dialog.waitFor()
        assert.equal(await dialog.getByRole('heading').evaluate(node => node === document.activeElement), true)
        assert.match(await dialog.innerText(), /Work through each tutorial in order\./)
        assert.equal(await dialog.getByRole('link', { name: 'A stopwatch' }).getAttribute('href'), '#/learn/tick')
        const currentContents = await dialog.locator('.help-content').innerHTML()
        if (opened === 0) contents = currentContents
        else assert.equal(currentContents, contents, 'reopening retains every guide paragraph and link')
        assert.equal(page.url(), url, 'opening the guide does not change the app route')
        await page.keyboard.press('Escape')
        await dialog.waitFor({ state: 'detached' })
        assert.equal(await help.evaluate(node => node === document.activeElement), true, 'Escape restores focus')
      }
    }
    if (view === 'lesson')
      assert.ok((await page.textContent('body')).includes('Read this lesson before setting up a workspace.'))
  }
  assert.equal(requests.filter(request => request.path === '/api/lesson/watch' || request.method !== 'GET').length, 0)
  await render(page, 'component')
  await page.getByText('Connect a session to add this mod to its project.', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Add to project' }).count(), 0)

  context.project = '/projects/example'
  context.lessonWorkspace = '/lessons'
  await render(page, 'lesson')
  await page.getByRole('button', { name: 'Check now', exact: true }).click()
  await page.getByText('Checks passed.', { exact: true }).waitFor()
  await page.getByRole('button', { name: /Start from the lesson/ }).click()
  await page.getByText(/Copied the lesson's starter/).waitFor()
  assert.equal(requests.find(request => request.path === '/api/lesson/watch').search.get('lessonWorkspace'), '/lessons')
  for (const path of ['/api/check', '/api/lesson/start'])
    assert.equal(requests.find(request => request.path === path).body.lessonWorkspace, '/lessons')
  await page.getByText('/lessons/solutions/tick', { exact: true }).waitFor()
  await render(page, 'lesson')
  await page.getByText('/lessons/solutions/tick', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Copy reference solution', exact: true }).count(), 0)
  hasSolution = false
  await render(page, 'lesson')
  await page.getByRole('button', { name: 'Copy reference solution', exact: true }).click()
  await page.getByText('/lessons/solutions/tick', { exact: true }).waitFor()
  assert.equal(requests.filter(request => request.path === '/api/lesson/start').length, 2)

  await render(page, 'sandbox')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByText('The validator passes it.', { exact: true }).waitFor()
  assert.equal(requests.find(request => request.path === '/api/sandbox/save').body.lessonWorkspace, '/lessons')
  await page.getByRole('button', { name: 'Run tests', exact: true }).click()
  await page.getByText('No test ran.', { exact: true }).waitFor()
  assert.equal(requests.find(request => request.path === '/api/sandbox/test').body.lessonWorkspace, '/lessons')
  await render(page, 'workshop')
  await page.getByRole('switch', { name: 'tick-mod on' }).uncheck()
  await page.getByText('Updated.', { exact: true }).waitFor()
  assert.equal(requests.find(request => request.path === '/api/workshop/switch').body.lessonWorkspace, '/lessons')

  await render(page, 'component')
  await page.getByRole('button', { name: 'Add to project' }).waitFor()
  assert.ok((await page.textContent('body')).includes('/projects/example/.claude/skills'))
  context.project = '/projects/other'
  await page.getByRole('button', { name: 'Add to project' }).click()
  await page
    .getByText('The connected project changed. Reload this page before adding a mod.', { exact: true })
    .waitFor()
  assert.equal(requests.find(request => request.path === '/api/components/add').body.project, '/projects/example')
  console.log('Lesson browsing stays read-only; lesson and component actions carry their displayed destinations.')
  await checkLessonNavigation(browser)
  console.log('Navigating between lessons renders each page without invalidating its new watcher.')
} finally {
  await browser.close()
}
