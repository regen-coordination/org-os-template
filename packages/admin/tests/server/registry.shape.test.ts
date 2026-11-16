// DAO-OS L6 Task 2 (spec §7.1, §7.2): a registry has its own file and shape, the registry list is dynamic, and `tasks`
// is a registry of its own.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { removeFixtureRepo } from '../fixtures.ts'
import { makeChangeRepo, git } from '../changes/fixtures.ts'
import { REGISTRIES, registriesOf, registryDef, registryFile, type RegistryDef } from '../../server/registries.ts'
import { readRegistry, entriesFromText, updatedText, createdText, deletedText, registryPath, listRegistries } from '../../server/registry.ts'
import { taskProject, customRegistries } from '../../lib/registries.mjs'
import { validateEntry } from '../../lib/data-validate.mjs'
import { parseRecord } from '../../lib/ops.mjs'
import { stage, classesOf, idErrors } from '../../server/changes/stage.ts'
import { applyOps } from '../../server/changes/apply.ts'
import { privateClass } from '../../server/private/ops.ts'
import { registryOfPath } from '../../server/watcher.ts'

/** A map-shaped file, as kms keeps its store: the top level is `entries:`, each entry keyed by its id. */
const KB: RegistryDef = { name: 'kb-resource', topKey: 'entries', kind: 'collection', shape: 'map', file: 'data/kb/resource.yaml' }
const MAP = `# Resources the commons holds.
schema_version: "1.0"
entries:
  # the first one
  alpha:
    title: Alpha
    public_use: not-for-public
  beta:
    title: "Beta" # quoted on purpose
    maturity: held

generated: "2026-10-30"
`

describe('a map-shaped registry file', () => {
  it('reads entries with `id` from their key', () => {
    expect(entriesFromText(MAP, KB)).toEqual([
      { id: 'alpha', title: 'Alpha', public_use: 'not-for-public' },
      { id: 'beta', title: 'Beta', maturity: 'held' },
    ])
  })

  it('reads the same through readRegistry, from the def\'s own file', () => {
    const repo = makeChangeRepo()
    try {
      mkdirSync(join(repo, 'data', 'kb'))
      writeFileSync(join(repo, 'data', 'kb', 'resource.yaml'), MAP)
      expect(registryPath(repo, KB)).toBe(join(repo, 'data', 'kb', 'resource.yaml'))
      expect(readRegistry(repo, KB).entries!.map(e => e.id)).toEqual(['alpha', 'beta'])
    } finally { removeFixtureRepo(repo) }
  })

  it('updating a map entry keeps the file\'s comments and other keys byte for byte', () => {
    const text = updatedText(MAP, KB, 'alpha', { id: 'alpha', title: 'Alpha', public_use: 'ok-with-caveat' })
    expect(text).toBe(MAP.replace('public_use: not-for-public', 'public_use: ok-with-caveat'))
    // A field the entry did not have is written at its keys' column; the id stays the key, never a field.
    const added = updatedText(MAP, KB, 'beta', { id: 'beta', title: 'Beta', maturity: 'held', steward: 'steward-a' })
    expect(added).toBe(MAP.replace('    maturity: held\n', '    maturity: held\n    steward: steward-a\n'))
    // Nothing differs: the text is the file's own.
    expect(updatedText(MAP, KB, 'beta', { id: 'beta', title: 'Beta', maturity: 'held' })).toBe(MAP)
  })

  it('creating and deleting a map entry', () => {
    const created = createdText(MAP, KB, { id: 'gamma', title: 'Gamma' })
    expect(created).toBe(MAP.replace('    maturity: held\n', '    maturity: held\n  gamma:\n    title: Gamma\n'))
    expect(entriesFromText(created, KB).map(e => e.id)).toEqual(['alpha', 'beta', 'gamma'])
    expect(() => createdText(MAP, KB, { id: 'alpha', title: 'Again' })).toThrow('entity already exists: alpha')
    // The entry goes with the comment lines directly above it.
    expect(deletedText(MAP, KB, 'alpha')).toBe(MAP.replace('  # the first one\n  alpha:\n    title: Alpha\n    public_use: not-for-public\n', ''))
    expect(() => deletedText(MAP, KB, 'nope')).toThrow('entity not found: nope')
    // An empty map takes its first entry.
    expect(createdText('entries: {}\n', KB, { id: 'gamma', title: 'Gamma' })).toBe('entries:\n  gamma:\n    title: Gamma\n')
  })
})

describe('the registry list', () => {
  let repo: string
  beforeEach(() => { repo = makeChangeRepo() })
  afterEach(() => removeFixtureRepo(repo))
  const collections = (text: string) => writeFileSync(join(repo, 'data', 'collections.yaml'), text)

  it('`registryFile` for `tasks` is `data/tasks.yaml`; tasks is a collection under `tasks:`, before proposals', () => {
    expect(registryFile(repo, 'tasks')).toBe('data/tasks.yaml')
    expect(registryDef('tasks')).toEqual({ name: 'tasks', topKey: 'tasks', kind: 'collection' })
    const names = REGISTRIES.map(r => r.name)
    expect(names.indexOf('tasks')).toBeLessThan(names.indexOf('proposals'))
  })

  it('a custom collection in `data/collections.yaml` is a registry with file `data/collections/<id>.yaml`', () => {
    expect(registriesOf(repo)).toEqual(REGISTRIES)
    collections(`collections:
  - id: circles
    name: Circles
    fields:
      - { id: name, type: text }
  - id: tasks
    views:
      - { id: open, name: Open, kind: table }
`)
    const circles = { name: 'circles', topKey: 'circles', kind: 'collection', file: 'data/collections/circles.yaml', custom: true }
    expect(registriesOf(repo)).toEqual([...REGISTRIES, circles])
    expect(registryDef('circles', repo)).toEqual(circles)
    expect(registryFile(repo, 'circles')).toBe('data/collections/circles.yaml')
    expect(() => registryDef('circles')).toThrow('unknown registry: circles')
    // Its records read from its own file.
    mkdirSync(join(repo, 'data', 'collections'))
    writeFileSync(join(repo, 'data', 'collections', 'circles.yaml'), 'circles:\n  - id: c-1\n    name: Stewards\n')
    expect(readRegistry(repo, 'circles').entries).toEqual([{ id: 'c-1', name: 'Stewards' }])
    expect(parseRecord('circles:c-1', registriesOf(repo))).toEqual({ registry: 'circles', id: 'c-1' })
    // The list follows the file.
    collections('collections:\n  - id: guilds\n    fields: []\n')
    expect(registriesOf(repo).filter(d => d.custom).map(d => d.name)).toEqual(['guilds'])
  })

  it('a registry name git knows is never taken by a custom collection', () => {
    collections(`collections:
  - id: projects
    fields: [{ id: name, type: text }]
  - id: members
    fields: []
  - id: pages
  - id: knowledge
  - id: collections
  - id: tree-handbook
  - id: Circles
  - id: c
  - id: circles
  - id: circles
`)
    const defs = registriesOf(repo)
    expect(defs.filter(d => d.name === 'projects')).toEqual([{ name: 'projects', topKey: 'projects', kind: 'collection' }])
    expect(defs.filter(d => d.name === 'members')).toEqual([{ name: 'members', topKey: 'members', kind: 'collection' }])
    expect(defs.filter(d => d.custom).map(d => d.name)).toEqual(['circles'])
    expect(customRegistries([{ id: 'tasks' }, { id: 'visibility' }])).toEqual([])
  })

  it('a collections file that cannot be read adds no collection', () => {
    collections('collections: [\n')
    expect(registriesOf(repo)).toEqual(REGISTRIES)
  })
})

describe('tasks', () => {
  it('the tasks schema accepts the spec\'s fields and an older `related_project`', () => {
    const task = {
      id: 't-1', title: 'Draft the handbook', status: 'open', owner: 'steward-a', due: '2026-11-15', project: 'proj-001',
      meeting: 'm-1', proposal: 'p-1', page: 'handbook-1f2e3d4c5b6a', priority: 'high',
      from: { source: 'notion', id: 'abc', exported: '2026-10-30' },
    }
    expect(validateEntry('tasks', task).filter(p => p.level === 'error')).toEqual([])
    expect(validateEntry('tasks', { id: 't-2', owner: 'eip155:42220:0x00000000000000000000000000000000000000a1', related_project: 'proj-001' })
      .filter(p => p.level === 'error')).toEqual([])
    expect(validateEntry('tasks', { id: 't-3', due: 'next week' }).filter(p => p.level === 'error').map(p => p.path)).toEqual(['due'])
  })

  it('`taskProject` reads `project`, else `related_project`', () => {
    expect(taskProject({ id: 't', project: 'a', related_project: 'b' })).toBe('a')
    expect(taskProject({ id: 't', related_project: 'b' })).toBe('b')
    expect(taskProject({ id: 't' })).toBeNull()
    expect(taskProject({ id: 't', project: null, related_project: 'b' })).toBe('b')
  })

  it('staging and applying a task writes `data/tasks.yaml` in one commit', async () => {
    const repo = makeChangeRepo()
    try {
      const commits = () => Number(git(repo, 'rev-list --count HEAD').trim())
      const was = commits()
      const { ops, errors } = stage(repo, [], [{ op: 'create', record: 'tasks:t-1', value: { title: 'Draft the handbook', status: 'open', owner: 'steward-a', project: 'proj-001' } }])
      expect(errors).toEqual([])
      const { commit } = await applyOps(repo, ops, { message: 'admin(tasks): create t-1', trailers: { actor: 'steward-a', change: 'chg_test', rule: 'solo/direct' } })
      expect(commit).toBe(git(repo, 'rev-parse HEAD').trim())
      expect(commits()).toBe(was + 1)
      expect(git(repo, 'show --name-only --pretty=format: HEAD').trim()).toBe('data/tasks.yaml')
      expect(readRegistry(repo, 'tasks').entries).toEqual([{ id: 't-1', title: 'Draft the handbook', status: 'open', owner: 'steward-a', project: 'proj-001' }])
      expect(git(repo, 'status --porcelain')).toBe('')
    } finally { removeFixtureRepo(repo) }
  })
})

describe('classing and watching by the registry\'s file (ruling P-5)', () => {
  let repo: string
  beforeEach(() => {
    repo = makeChangeRepo()
    writeFileSync(join(repo, 'data', 'collections.yaml'), 'collections:\n  - id: circles\n    fields: []\n')
  })
  afterEach(() => removeFixtureRepo(repo))

  it('a custom collection\'s op is classed by its file, as the class table reads `data/collections/<id>.yaml`', () => {
    expect(classesOf([{ op: 'update', record: 'circles:c-1', set: { name: 'x' } }], repo))
      .toEqual(['workspace'])
    // A built-in registry classes as it always has.
    expect(classesOf([{ op: 'update', record: 'members:ana', set: {} }], repo)).toEqual(['members'])
    expect(classesOf([{ op: 'update', record: 'tasks:t-1', set: {} }])).toEqual(['workspace'])
  })

  it('an op on a custom collection is addressed through the instance\'s list, and its file is named in words', () => {
    mkdirSync(join(repo, 'data', 'collections'))
    const entries = () => [{ id: 'c-1' }, { id: 'c-1' }]
    expect(idErrors([{ op: 'delete', record: 'circles:c-1' }], entries, registriesOf(repo)))
      .toEqual([{ record: 'circles:c-1', field: 'id', message: 'id `c-1` appears 2 times in `data/collections/circles.yaml`; fix it in the file.' }])
  })

  it('a private page and a private collection class by the file they would have', () => {
    const page = { op: 'create-record' as const, collection: 'pages', id: 'p-0123456789ab', visibility: 'hat:steward', value: {} }
    expect(privateClass(page)).toBe('workspace')
    const memory = { op: 'create-record' as const, collection: 'council-memory', id: 'n-1', visibility: 'hat:steward', value: {} }
    expect(privateClass(memory)).toBe('workspace')
    expect(privateClass({ op: 'delete-field', registry: 'members', record: 'ana', field: 'email' })).toBe('members')
    expect(privateClass({ op: 'delete-record', collection: 'projects', id: 'proj-001' })).toBe('records')
  })

  it('the watcher names a registry by its file', () => {
    expect(registryOfPath('data/kb/resource.yaml', [...REGISTRIES, KB])).toBe('kb-resource')
    expect(registryOfPath('data/collections/circles.yaml', registriesOf(repo))).toBe('circles')
    expect(registryOfPath('data/projects.yaml', REGISTRIES)).toBe('projects')
    // An instance's own data file, not a registry, is reported by its name, as before.
    expect(registryOfPath('data/crm.yaml', REGISTRIES)).toBe('crm')
    expect(registryOfPath('data/notes.txt', REGISTRIES)).toBeNull()
  })

  it('listRegistries lists tasks once its file is there', () => {
    expect(listRegistries(repo).find(r => r.name === 'tasks')).toBeUndefined()
    writeFileSync(join(repo, 'data', 'tasks.yaml'), 'tasks:\n  - id: t-1\n')
    expect(listRegistries(repo)).toContainEqual({ name: 'tasks', kind: 'collection', count: 1 })
  })
})
