import { existsSync, lstatSync, readdirSync, readlinkSync, symlinkSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

import { componentFolder } from './component-folders.mjs'

function requireDirectory(path, allowMissing = false) {
  const stat = lstatSync(path, { throwIfNoEntry: false })
  if (stat === undefined && allowMissing) return false
  if (stat === undefined || !stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${path} must be an existing directory, not a file or symbolic link.`)
  }
  return true
}

function checkLink(root, collection, target, link, allowMissingTarget) {
  for (const path of [root, join(root, '.claude'), collection, join(root, 'workshop')]) requireDirectory(path)
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
export function prepareLessonLink(root, mod, collection) {
  if (collection === null) return () => {}
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(mod)) throw new Error('Invalid lesson mod name.')
  if (root !== resolve(root) || collection !== componentFolder(root)) {
    throw new Error('Lesson links must use the current project’s component collection.')
  }
  const target = join(root, 'workshop', mod)
  const link = join(collection, mod)
  checkLink(root, collection, target, link, true)
  return () => {
    if (!checkLink(root, collection, target, link, false)) {
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
export function lessonPluginFolders(root) {
  const workshop = join(root, 'workshop')
  const collection = componentFolder(root)
  if (!hasLessonLinks(root, collection)) return [workshop]
  requireDirectory(workshop)
  const publish = readdirSync(workshop)
    .filter(name => existsSync(join(workshop, name, '.claude-plugin', 'plugin.json')))
    .map(name => prepareLessonLink(root, name, collection))
  for (const link of publish) link()
  return [collection]
}
