import assert from 'node:assert/strict'
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { test } from 'node:test'

import { componentFolder } from '../lib/component-folders.mjs'
import {
  ensureLessonCollection,
  ensureLocalLessonCollection,
  lessonCollectionFolder,
  lessonPluginFolders,
  prepareLessonLink,
  validateLessonCollection,
} from '../lib/lesson-loading.mjs'

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'mod-lab-lesson-loading-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const collection = componentFolder(root)
  mkdirSync(collection, { recursive: true })
  mkdirSync(join(root, 'workshop'))
  return { root, collection, target: join(root, 'workshop', 'tick'), link: join(collection, 'tick') }
}

test('a lesson is linked after creation, and editing it changes the source loaded through the collection', t => {
  const { root, collection, target, link } = fixture(t)
  const publish = prepareLessonLink(root, 'tick', collection)
  assert.equal(lstatSync(link, { throwIfNoEntry: false }), undefined)
  mkdirSync(target)
  writeFileSync(join(target, 'hooks.ts'), 'first edit')
  publish()
  assert.equal(readlinkSync(link), relative(collection, target))
  assert.equal(readFileSync(join(link, 'hooks.ts'), 'utf8'), 'first edit')
  writeFileSync(join(target, 'hooks.ts'), 'second edit')
  assert.equal(readFileSync(join(link, 'hooks.ts'), 'utf8'), 'second edit')
  publish()
  prepareLessonLink(root, 'tick', collection)()
  assert.equal(readlinkSync(link), relative(collection, target))
})

test('an absent collection means no linking or filesystem checks', () => {
  assert.doesNotThrow(() => prepareLessonLink('/not-present', 'tick', null)())
})

test('publishing requires the lesson directory and rechecks collisions', t => {
  const { root, collection, target, link } = fixture(t)
  const publish = prepareLessonLink(root, 'tick', collection)
  assert.throws(publish, /must be an existing directory/)
  assert.equal(lstatSync(link, { throwIfNoEntry: false }), undefined)
  mkdirSync(target)
  writeFileSync(link, 'keep this file')
  assert.throws(publish, /already exists/)
  assert.equal(readFileSync(link, 'utf8'), 'keep this file')
})

test('preflight refuses occupied links without overwriting them', t => {
  for (const kind of ['file', 'directory', 'foreign-link', 'broken-link']) {
    const { root, collection, target, link } = fixture(t)
    mkdirSync(target)
    if (kind === 'file') writeFileSync(link, 'user file')
    else if (kind === 'directory') mkdirSync(link)
    else symlinkSync(kind === 'foreign-link' ? root : join(root, 'missing'), link)
    const before = lstatSync(link)
    assert.throws(() => prepareLessonLink(root, 'tick', collection), /already exists/)
    assert.equal(lstatSync(link).ino, before.ino)
    if (kind === 'file') assert.equal(readFileSync(link, 'utf8'), 'user file')
  }
})

test('an existing link whose own lesson is missing is refused', t => {
  const { root, collection, target, link } = fixture(t)
  symlinkSync(relative(collection, target), link)
  assert.throws(() => prepareLessonLink(root, 'tick', collection), /missing lesson directory/)
  assert.equal(readlinkSync(link), relative(collection, target))
})

test('collection selection and mod names cannot escape the project', t => {
  const { root, collection } = fixture(t)
  for (const mod of ['', '.', '..', '../tick', 'one/tick', 'one\\tick', '/tick']) {
    assert.throws(() => prepareLessonLink(root, mod, collection), /Invalid lesson mod name/)
  }
  for (const other of [root, join(root, 'other'), `${collection}/../mod-lab`]) {
    assert.throws(() => prepareLessonLink(root, 'tick', other), /current project’s component collection/)
  }
})

test('symlinked or non-directory collection and lesson paths are refused', t => {
  for (const reserved of ['.claude', '.claude/mod-lab', 'workshop', 'workshop/tick']) {
    for (const kind of ['file', 'symlink']) {
      const { root, collection } = fixture(t)
      const path = join(root, reserved)
      rmSync(path, { recursive: true, force: true })
      if (kind === 'file') writeFileSync(path, 'keep this file')
      else symlinkSync(root, path)
      assert.throws(() => prepareLessonLink(root, 'tick', collection), /must be an existing directory/)
      if (kind === 'file') assert.equal(readFileSync(path, 'utf8'), 'keep this file')
      else assert.equal(readlinkSync(path), root)
    }
  }
})

function plugin(root, name) {
  const folder = join(root, 'workshop', name)
  mkdirSync(join(folder, '.claude-plugin'), { recursive: true })
  writeFileSync(join(folder, '.claude-plugin', 'plugin.json'), JSON.stringify({ name, version: '0.1.0' }))
  return folder
}

test('a dedicated workspace without lesson links keeps loading workshop directly', t => {
  const { root, collection } = fixture(t)
  plugin(root, 'tick')
  assert.deepEqual(lessonPluginFolders(root), [join(root, 'workshop')])
  assert.equal(lstatSync(join(collection, 'tick'), { throwIfNoEntry: false }), undefined)
  rmSync(join(root, '.claude'), { recursive: true })
  assert.deepEqual(lessonPluginFolders(root), [join(root, 'workshop')])
})

test('an in-session workspace links all current lesson plugins and loads only the collection on restart', t => {
  const { root, collection } = fixture(t)
  plugin(root, 'tick')
  const egg = plugin(root, 'egg')
  mkdirSync(join(root, 'workshop', 'notes'))
  writeFileSync(join(root, 'workshop', 'notes', 'README.md'), 'user notes')
  prepareLessonLink(root, 'tick', collection)()

  assert.deepEqual(lessonPluginFolders(root), [collection])
  assert.equal(realpathSync(join(collection, 'egg')), egg)
  assert.equal(lstatSync(join(collection, 'notes'), { throwIfNoEntry: false }), undefined)
  assert.deepEqual(lessonPluginFolders(root), [collection])
  assert.equal(readFileSync(join(root, 'workshop', 'notes', 'README.md'), 'utf8'), 'user notes')
})

test('restart checks every lesson collision before creating missing links', t => {
  const { root, collection } = fixture(t)
  plugin(root, 'tick')
  plugin(root, 'a-first')
  plugin(root, 'z-last')
  prepareLessonLink(root, 'tick', collection)()
  const collision = join(collection, 'z-last')
  writeFileSync(collision, 'user file')

  assert.throws(() => lessonPluginFolders(root), /already exists/)
  assert.equal(lstatSync(join(collection, 'a-first'), { throwIfNoEntry: false }), undefined)
  assert.equal(readFileSync(collision, 'utf8'), 'user file')
  assert.equal(realpathSync(join(collection, 'tick')), join(root, 'workshop', 'tick'))
})

test('an unrelated collection symlink does not switch the workspace loader', t => {
  const { root, collection } = fixture(t)
  plugin(root, 'tick')
  symlinkSync(root, join(collection, 'other'))
  assert.deepEqual(lessonPluginFolders(root), [join(root, 'workshop')])
  assert.equal(lstatSync(join(collection, 'tick'), { throwIfNoEntry: false }), undefined)
})

test('private collections isolate projects and publish initialized workshop plugins on restart', t => {
  const { root } = fixture(t)
  const home = join(root, 'home')
  const other = join(root, 'other-project')
  mkdirSync(home)
  mkdirSync(other)
  mkdirSync(join(root, '.claude-mod-lab'))
  const tick = plugin(root, 'tick')
  const collection = ensureLessonCollection(root, home)
  const otherCollection = ensureLessonCollection(other, home)
  assert.notEqual(collection, otherCollection)
  assert.equal(collection, lessonCollectionFolder(root, home))
  assert.equal(realpathSync(join(collection, 'tick')), tick)
  assert.deepEqual(lessonPluginFolders(root, home), [collection])
  const egg = plugin(root, 'egg')
  prepareLessonLink(root, 'egg', collection, home)()
  assert.equal(realpathSync(join(collection, 'egg')), egg)
  assert.throws(() => validateLessonCollection(other, collection, home), /current project/)
  assert.throws(
    () => prepareLessonLink(root, 'tick', join(home, '.claude-mod-lab', 'examples'), home),
    /current project/,
  )
})

test('prospective collection creation leaves unrelated project files untouched', t => {
  const { root } = fixture(t)
  const home = join(root, 'home')
  mkdirSync(home)
  rmSync(join(root, 'workshop'), { recursive: true })
  writeFileSync(join(root, 'workshop'), 'unrelated project file')
  const collection = ensureLessonCollection(root, home)
  assert.equal(lstatSync(collection).isDirectory(), true)
  assert.equal(readFileSync(join(root, 'workshop'), 'utf8'), 'unrelated project file')
})

test('private collection parents cannot redirect lesson links through symlinks', t => {
  const { root } = fixture(t)
  const home = join(root, 'home')
  mkdirSync(home)
  const collection = ensureLessonCollection(root, home)
  rmSync(join(home, '.claude-mod-lab', 'projects'), { recursive: true })
  symlinkSync(root, join(home, '.claude-mod-lab', 'projects'))
  assert.throws(() => ensureLessonCollection(root, home), /not a file or symbolic link/)
  assert.throws(() => prepareLessonLink(root, 'tick', collection, home), /not a file or symbolic link/)
})

test('explicit local selection loads lessons only through the local collection even after a shared run', t => {
  const { root, collection } = fixture(t)
  const home = join(root, 'home')
  mkdirSync(home)
  mkdirSync(join(root, '.claude-mod-lab'))
  const tick = plugin(root, 'tick')
  const privateCollection = ensureLessonCollection(root, home)
  assert.equal(ensureLocalLessonCollection(root), collection)
  assert.deepEqual(lessonPluginFolders(root, home, collection), [collection])
  assert.equal(realpathSync(join(collection, 'tick')), tick)
  assert.equal(realpathSync(join(privateCollection, 'tick')), tick)
})
