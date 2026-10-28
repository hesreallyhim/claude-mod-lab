import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, realpathSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'

import { componentFolder } from './component-folders.mjs'
import { isWorkspace } from './roots.mjs'

function requireDirectory(path, allowMissing = false) {
  const stat = lstatSync(path, { throwIfNoEntry: false })
  if (stat === undefined && allowMissing) return false
  if (stat === undefined || !stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${path} must be an existing directory, not a file or symbolic link.`)
  }
  return true
}

/** A session's lesson plugins belong to its project, never the shared examples. */
export function lessonCollectionFolder(root, home = homedir()) {
  const canonical = existsSync(root) ? realpathSync(root) : resolve(root)
  const key = createHash('sha256').update(canonical).digest('hex')
  return join(home, '.claude-mod-lab', 'projects', key, 'lessons')
}

function collectionParents(root, collection, home) {
  if (root !== resolve(root)) throw new Error('Lesson links require an absolute project directory.')
  if (collection === componentFolder(root)) return [root, join(root, '.claude'), collection]
  if (collection === lessonCollectionFolder(root, home)) {
    return [
      root,
      home,
      join(home, '.claude-mod-lab'),
      join(home, '.claude-mod-lab', 'projects'),
      dirname(collection),
      collection,
    ]
  }
  throw new Error('Lesson links must use the current project’s component collection or its private lesson collection.')
}

/** Validate an existing collection before initializing any project files. */
export function validateLessonCollection(root, collection, home = homedir()) {
  for (const path of collectionParents(root, collection, home)) requireDirectory(path)
}

function publishWorkshop(root, collection, home) {
  const workshop = join(root, 'workshop')
  if (!requireDirectory(workshop, true)) return
  const publish = readdirSync(workshop)
    .filter(name => existsSync(join(workshop, name, '.claude-plugin', 'plugin.json')))
    .map(name => prepareLessonLink(root, name, collection, home))
  for (const link of publish) link()
}

/** Prepare the prospective loading folder without creating anything in the project. */
export function ensureLessonCollection(root, home = homedir()) {
  const collection = lessonCollectionFolder(root, home)
  const paths = collectionParents(root, collection, home)
  requireDirectory(root)
  requireDirectory(home)
  for (const path of paths.slice(2)) {
    if (!requireDirectory(path, true)) mkdirSync(path)
  }
  if (isWorkspace(root)) publishWorkshop(root, collection, home)
  return collection
}

/** Explicit local mode keeps lessons beside the project's examples. */
export function ensureLocalLessonCollection(root) {
  const collection = componentFolder(root)
  requireDirectory(root)
  for (const path of [join(root, '.claude'), collection]) {
    if (!requireDirectory(path, true)) mkdirSync(path)
  }
  if (isWorkspace(root)) publishWorkshop(root, collection, homedir())
  return collection
}

function checkLink(root, collection, target, link, allowMissingTarget, home) {
  validateLessonCollection(root, collection, home)
  requireDirectory(join(root, 'workshop'))
  const targetExists = requireDirectory(target, allowMissingTarget)
  const stat = lstatSync(link, { throwIfNoEntry: false })
  if (stat === undefined) return false
  if (!stat.isSymbolicLink() || resolve(dirname(link), readlinkSync(link)) !== target) {
    throw new Error(`${link} already exists and is not this lesson's link. It was left unchanged.`)
  }
  if (!targetExists) throw new Error(`${link} points to a missing lesson directory. It was left unchanged.`)
  return true
}

/** @param {string} root @param {string} mod @param {string | null} collection */
export function prepareLessonLink(root, mod, collection, home = homedir()) {
  if (collection === null) return () => {}
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(mod)) throw new Error('Invalid lesson mod name.')
  const target = join(root, 'workshop', mod)
  const link = join(collection, mod)
  checkLink(root, collection, target, link, true, home)
  return () => {
    if (!checkLink(root, collection, target, link, false, home)) {
      symlinkSync(relative(collection, target), link, 'dir')
    }
  }
}

function hasLessonLinks(root, collection) {
  for (const path of [join(root, '.claude'), collection]) {
    const stat = lstatSync(path, { throwIfNoEntry: false })
    if (stat === undefined || !stat.isDirectory() || stat.isSymbolicLink()) return false
  }
  return readdirSync(collection, { withFileTypes: true }).some(
    entry =>
      entry.isSymbolicLink() &&
      resolve(collection, readlinkSync(join(collection, entry.name))) === join(root, 'workshop', entry.name),
  )
}

/** @param {string} root */
export function lessonPluginFolders(root, home = homedir(), selectedCollection = null) {
  if (selectedCollection !== null) {
    validateLessonCollection(root, selectedCollection, home)
    publishWorkshop(root, selectedCollection, home)
    return [selectedCollection]
  }
  const workshop = join(root, 'workshop')
  const privateCollection = lessonCollectionFolder(root, home)
  if (lstatSync(privateCollection, { throwIfNoEntry: false }) !== undefined) {
    validateLessonCollection(root, privateCollection, home)
    publishWorkshop(root, privateCollection, home)
    return [privateCollection]
  }
  const collection = componentFolder(root)
  if (!hasLessonLinks(root, collection)) return [workshop]
  publishWorkshop(root, collection, home)
  return [collection]
}
