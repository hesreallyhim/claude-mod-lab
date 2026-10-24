// Build operations target the selected project or an explicitly initialized lesson workspace.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadLessons } from '../../learn/lib/lessons.mjs'
import { copyLessonSolution, startLesson } from '../../learn/lib/start.mjs'
import { componentFolder } from './component-folders.mjs'
import { createComponents } from './components.mjs'
import { installedCopies, skillsCopyNote } from './installed.mjs'
import { checkSummary, createLessonChecks } from './lesson-checks.mjs'
import { openLesson, readProgress } from './progress.mjs'
import { PACKAGE_ROOT } from './roots.mjs'
import { BLANK, createSandbox, templateFiles, templateNames } from './sandbox.mjs'
import { listWorkshop, SETTINGS, switchMod } from './workshop.mjs'

const LEARN = join(PACKAGE_ROOT, 'learn')
const TEMPLATES = join(PACKAGE_ROOT, 'templates')
const RELOAD_WAIT_MS = 5_000

/** All requests use destinations captured in their page, so a stale tab cannot write to a newly connected project. */
export function createBuildApi({
  context,
  hub,
  send,
  readBody,
  currentTypes,
  compat,
  sandboxDir,
  skillsDir,
  lessonChecks,
  installed,
}) {
  let activeLessons = null
  let checks = null
  const streams = new Set()

  function closeWatches() {
    for (const close of streams) close()
    streams.clear()
    checks?.close()
    checks = null
  }

  function synchronize() {
    const selected = context.snapshot().lessonWorkspace
    if (activeLessons !== selected) {
      closeWatches()
      activeLessons = selected
    }
  }

  function checker() {
    synchronize()
    checks ??= lessonChecks ?? createLessonChecks({ workspace: activeLessons })
    return checks
  }

  function sandbox(root) {
    return createSandbox(sandboxDir ?? join(root, 'workshop', 'sandbox-mod'), { currentTypes })
  }

  function components(project) {
    const collection = componentFolder(project)
    const legacy = join(project, '.claude', 'skills')
    const destination = skillsDir ?? (existsSync(collection) ? collection : legacy)
    return createComponents({
      templatesDir: TEMPLATES,
      skillsDir: destination,
      legacyDir: destination === collection ? legacy : null,
      others: { 'gallery-mod': join(PACKAGE_ROOT, 'mods', 'gallery-mod') },
    })
  }

  async function reloadSession(project) {
    const session = hub.snapshot().session
    if (!session?.isConnected || session.facts.cwd !== project)
      return { isReloaded: false, note: 'Start a session in this project to load the changes.' }
    const queued = hub.enqueueReload()
    if ('error' in queued) return { isReloaded: false, note: queued.error }
    const job = await hub.settled(queued.job, RELOAD_WAIT_MS)
    return job?.status === 'done'
      ? { isReloaded: true, note: job.answer }
      : { isReloaded: false, note: 'The session is busy. It reloads once its turn ends.' }
  }

  function sandboxInfo() {
    const selected = context.snapshot()
    const own = selected.lessonWorkspace === null ? null : sandbox(selected.lessonWorkspace)
    return {
      ...selected,
      dir: own?.dir ?? null,
      files: own?.read() ?? BLANK,
      blank: BLANK,
      templates: templateNames(TEMPLATES),
    }
  }

  async function sandboxApi(req, res, url) {
    if (url.pathname === '/api/sandbox' && req.method === 'GET') return send(res, 200, sandboxInfo())
    if (url.pathname === '/api/sandbox/template' && req.method === 'GET') {
      const files = templateFiles(TEMPLATES, url.searchParams.get('name') ?? '')
      return files === null ? send(res, 404, { error: 'no such template' }) : send(res, 200, { files })
    }
    if (req.method !== 'POST') return send(res, 404, { error: 'not found' })
    const body = await readBody(req)
    const own = sandbox(context.requireLessons(body.lessonWorkspace))
    if (url.pathname === '/api/sandbox/save') {
      own.write(body.files)
      return send(res, 200, await own.check())
    }
    if (url.pathname === '/api/sandbox/test') return send(res, 200, await own.test())
    return send(res, 404, { error: 'not found' })
  }

  function suppliedToSession(component, project) {
    const session = hub.snapshot().session
    if (!session?.isConnected || session.facts.cwd !== project) return false
    const directories = session.lab?.componentDirs
    if (!Array.isArray(directories)) return false
    return (
      (component.directory === componentFolder(project) && directories.includes(component.directory)) ||
      directories.includes(join(component.directory, component.name))
    )
  }

  async function inspectComponents(names, project) {
    const own = components(project)
    const discovered = names.filter(name => !suppliedToSession(own.view(name), project))
    if (discovered.length === 0) return { copies: [], problem: null }
    return installed ? installed(discovered) : installedCopies(discovered, { cwd: project })
  }

  function componentProblem(component, project, inspection) {
    if (suppliedToSession(component, project)) return null
    if (component.directory === componentFolder(project))
      return 'This folder is loaded by the lab launcher. Start a session with npx claude-mod-lab@alpha run in this project to use these mods.'
    const copy = inspection.copies.find(one => one.name === component.name || one.id.split('@')[0] === component.name)
    return inspection.problem ?? (copy === undefined ? null : skillsCopyNote(copy))
  }

  function withCommandStatus(component, project) {
    const snapshot = hub.snapshot()
    const commands = snapshot.mirror.commands
    const connected = snapshot.session?.isConnected && snapshot.session.facts.cwd === project
    const commandAvailable =
      connected && Array.isArray(commands)
        ? commands.some(one => one?.name === component.command && one?.plugin === component.name)
        : null
    return { ...component, commandAvailable }
  }

  async function componentsInfo() {
    const selected = context.snapshot()
    if (selected.project === null)
      return { ...selected, dir: null, components: [], error: 'Connect a session to add components to its project.' }
    const own = components(selected.project)
    const plugins = compat()?.plugins ?? {}
    const available = own.list()
    const inspection = await inspectComponents(
      available.map(one => one.name),
      selected.project,
    )
    context.requireProject(selected.project)
    const list = available.map(one => ({
      ...withCommandStatus(one, selected.project),
      since: plugins[one.name]?.since ?? null,
      loadProblem: one.isAdded ? componentProblem(one, selected.project, inspection) : null,
    }))
    return { ...selected, dir: own.dir, components: list }
  }

  function requireComponentDestination(project, name, expected) {
    if (expected !== undefined && expected !== components(project).view(name).directory)
      throw new Error('The component destination changed. Refresh this page before changing its files.')
  }

  async function addComponent(own, name, project, directory) {
    const sessionId = hub.snapshot().session?.facts.id
    const before = await inspectComponents([name], project)
    context.requireProject(project)
    if (hub.snapshot().session?.facts.id !== sessionId)
      throw new Error('The connected session changed. Refresh this page before adding a component.')
    requireComponentDestination(project, name, directory)
    const component = own.add(name)
    const inspection =
      componentProblem(component, project, before) === null ? await inspectComponents([name], project) : before
    const loadProblem = componentProblem(component, project, inspection)
    if (loadProblem !== null)
      return {
        component: { ...withCommandStatus(component, project), loadProblem },
        reload: { isReloaded: false, note: loadProblem },
      }
    context.requireProject(project)
    if (hub.snapshot().session?.facts.id !== sessionId)
      throw new Error('Files copied, but the connected session changed. Refresh this page before reloading.')
    const reload = await reloadSession(project)
    return { component: withCommandStatus(component, project), reload }
  }

  async function componentsApi(req, res, url) {
    if (url.pathname === '/api/components' && req.method === 'GET') return send(res, 200, await componentsInfo())
    if (req.method !== 'POST') return send(res, 404, { error: 'not found' })
    const body = await readBody(req)
    const project = context.requireProject(body.project)
    const own = components(project)
    const name = String(body.name ?? '')
    requireComponentDestination(project, name, body.directory)
    if (url.pathname === '/api/components/add')
      return send(res, 200, await addComponent(own, name, project, body.directory))
    if (url.pathname === '/api/components/remove') {
      const component = own.remove(name, { force: body.force === true })
      return send(res, 200, { component, reload: component.isRefused ? null : await reloadSession(project) })
    }
    return send(res, 404, { error: 'not found' })
  }

  function lessonView(lesson, selected) {
    const root = selected.lessonWorkspace
    const folder = root === null ? null : join(root, 'workshop', lesson.mod)
    const solutionFolder = root === null ? null : join(root, 'solutions', lesson.id)
    const check = root === null ? undefined : readProgress(root).lessons[lesson.id]
    return {
      ...selected,
      id: lesson.id,
      mod: lesson.mod,
      title: lesson.title,
      minVersion: lesson.minVersion ?? null,
      path: lesson.path,
      readme: readFileSync(join(lesson.dir, 'README.md'), 'utf8'),
      folder,
      solutionFolder,
      hasSolution: solutionFolder !== null && existsSync(solutionFolder),
      isStarted: folder !== null && existsSync(folder),
      hasStarter: lesson.starter !== null,
      check: check === undefined ? null : { report: check.report, progress: checkSummary(check) },
    }
  }

  function watch(req, res, lesson) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
    res.write(': watching\n\n')
    const stop = checker().watch(lesson, event => res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`))
    const beat = setInterval(synchronize, 3_000)
    const close = () => {
      clearInterval(beat)
      stop()
      streams.delete(close)
      res.end()
    }
    streams.add(close)
    req.on('close', close)
  }

  function lessonsInfo(lessons, selected) {
    const progress = selected.lessonWorkspace === null ? {} : readProgress(selected.lessonWorkspace).lessons
    const list = lessons.map(({ id, mod, title, summary, minVersion, kind, path, steps }) => ({
      id,
      mod,
      title,
      summary,
      minVersion: minVersion ?? null,
      kind,
      path,
      steps,
      progress: checkSummary(progress[id]),
    }))
    return { ...selected, lessons: list, index: readFileSync(join(LEARN, 'README.md'), 'utf8') }
  }

  function beginLesson(lesson, root) {
    const folder = join(root, 'workshop', lesson.mod)
    const solutionFolder = join(root, 'solutions', lesson.id)
    copyLessonSolution(lesson, solutionFolder)
    const made = startLesson(lesson, folder)
    openLesson(root, lesson.id)
    if (made !== null) checker().poke(lesson)
    return { folder, made, solutionFolder }
  }

  function lessonRead(req, res, url, lesson, selected) {
    if (url.pathname === '/api/lesson') return send(res, 200, lessonView(lesson, selected))
    if (url.pathname === '/api/lesson/watch') {
      context.requireLessons(url.searchParams.get('lessonWorkspace'))
      return watch(req, res, lesson)
    }
    return send(res, 404, { error: 'not found' })
  }

  async function lessonApi(req, res, url) {
    synchronize()
    const selected = context.snapshot()
    const lessons = loadLessons(LEARN)
    if (url.pathname === '/api/lessons' && req.method === 'GET') return send(res, 200, lessonsInfo(lessons, selected))
    const lesson = lessons.find(one => one.id === url.searchParams.get('id'))
    if (lesson === undefined) return send(res, 404, { error: 'no such lesson' })
    if (req.method === 'GET') return lessonRead(req, res, url, lesson, selected)
    if (req.method !== 'POST') return send(res, 404, { error: 'not found' })
    const body = await readBody(req)
    const root = context.requireLessons(body.lessonWorkspace)
    if (url.pathname === '/api/lesson/start') return send(res, 200, beginLesson(lesson, root))
    if (url.pathname === '/api/check') return send(res, 200, await checker().check(lesson))
    return send(res, 404, { error: 'not found' })
  }

  async function workshopApi(req, res, url) {
    const selected = context.snapshot()
    if (url.pathname === '/api/workshop' && req.method === 'GET')
      return send(res, 200, {
        ...selected,
        settings: SETTINGS,
        mods: selected.lessonWorkspace === null ? [] : listWorkshop(selected.lessonWorkspace, loadLessons(LEARN)),
      })
    if (url.pathname === '/api/workshop/switch' && req.method === 'POST') {
      const body = await readBody(req)
      const root = context.requireLessons(body.lessonWorkspace)
      const mod = switchMod(root, loadLessons(LEARN), String(body.name ?? ''), body.isOn === true)
      return send(res, 200, { mod, reload: await reloadSession(root) })
    }
    return send(res, 404, { error: 'not found' })
  }

  return { sandboxApi, componentsApi, lessonApi, workshopApi, synchronize, close: closeWatches }
}
