// A one-field edit must change one line — on THIS repository's real registries.
//
// The fixture suites could not see this defect: their files are short, already
// in the YAML library's own house style, and have no long strings or aligned
// comments. On the real files, re-serializing the whole document re-wrapped
// long quoted strings and re-aligned comments in entities nobody touched
// (adding one field to one project changed 55 lines and removed 13). The spec
// promises "one-field edit → one-line git diff"; these tests hold it to that.
//
// Every save here goes to a scratch copy under packages/admin/.scratch/.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { parseDocument, isSeq, isMap, type YAMLMap } from 'yaml'
import { makeRealDataRepo, removeFixtureRepo, REAL_REPO } from './fixtures.ts'
import { REGISTRIES, resolveTopKey } from '../server/registries.ts'
import { updateEntity, createEntity, deleteEntity, readRegistry, type Entity } from '../server/registry.ts'
import { createApp } from '../server/app.ts'

let repo: string
beforeAll(() => { repo = makeRealDataRepo() })
afterAll(() => removeFixtureRepo(repo))

const collections = REGISTRIES.filter(
  d => d.kind === 'collection' && existsSync(join(REAL_REPO, 'data', `${d.name}.yaml`)),
)
const file = (name: string) => join(repo, 'data', `${name}.yaml`)

/** Lines of `before` that are gone and lines of `after` that are new, found by
 *  trimming the common head and tail. `at` is the 0-based first differing line. */
function lineDiff(before: string, after: string) {
  const a = before.split('\n'); const b = after.split('\n')
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  return { at: head, removed: a.slice(head, a.length - tail), added: b.slice(head, b.length - tail) }
}

/** Each entity with the source lines it occupies, read from the untouched file. */
function entitiesWithLines(name: string, text: string) {
  const def = REGISTRIES.find(d => d.name === name)!
  const doc = parseDocument(text)
  const seq = doc.get(resolveTopKey(k => doc.has(k), def))
  if (!isSeq(seq)) return []
  const lineOf = (offset: number) => text.slice(0, offset).split('\n').length - 1
  return seq.items.filter(isMap).map(item => {
    const map = item as YAMLMap
    return {
      entity: map.toJSON() as Entity,
      first: lineOf(map.range![0]),
      last: lineOf(text.slice(0, map.range![1]).trimEnd().length - 1),
    }
  })
}

/** First, last and an even spread between: knowledge-gaps has 268 entries. */
function sample<T>(all: T[], max = 8): T[] {
  if (all.length <= max) return all
  return Array.from({ length: max }, (_, i) => all[Math.round((i * (all.length - 1)) / (max - 1))]!)
}

describe('a one-field edit to a real registry changes only that field\'s line', () => {
  for (const def of collections) {
    const name = def.name
    // Each save parses the file several times (once to edit, twice to check the
    // result, once to answer). On knowledge-gaps (about 5,000 lines) eight saves
    // took 4 to 4.7 s on a quiet machine: the reason for the suite's time limit
    // (vitest.config.ts).
    describe(name, () => {
      let original: string
      beforeAll(() => { original = readFileSync(file(name), 'utf8') })
      const restore = () => writeFileSync(file(name), original)

      it('saving an entity unchanged leaves the file byte-identical', () => {
        for (const { entity } of sample(entitiesWithLines(name, original))) {
          updateEntity(repo, name, String(entity.id), entity)
          expect(readFileSync(file(name), 'utf8'), `entity ${entity.id}`).toBe(original)
        }
      })

      it('adding one field adds one line and removes none', () => {
        for (const { entity, first, last } of sample(entitiesWithLines(name, original))) {
          updateEntity(repo, name, String(entity.id), { ...entity, admin_probe: 'x' })
          const d = lineDiff(original, readFileSync(file(name), 'utf8'))
          restore()
          expect({ removed: d.removed, added: d.added.length }, `entity ${entity.id}`).toEqual({ removed: [], added: 1 })
          expect(d.at, `entity ${entity.id}: the new line is inside the entity`).toBeGreaterThan(first)
          expect(d.at).toBeLessThanOrEqual(last + 1)
        }
      })

      it('changing one short text field changes that line only', () => {
        for (const { entity, first, last } of sample(entitiesWithLines(name, original))) {
          // A field whose value sits on one source line: short, single-line text.
          const key = Object.keys(entity).find(k => {
            const v = entity[k]
            return k !== 'id' && typeof v === 'string' && v.length > 0 && v.length < 40 && !v.includes('\n')
          })
          if (!key) continue
          updateEntity(repo, name, String(entity.id), { ...entity, [key]: 'admin-probe' })
          const after = readFileSync(file(name), 'utf8')
          const saved = readRegistry(repo, name).entries!.find(e => e.id === entity.id)
          restore()
          const d = lineDiff(original, after)
          expect({ removed: d.removed.length, added: d.added.length }, `entity ${entity.id} field ${key}`)
            .toEqual({ removed: 1, added: 1 })
          expect(d.at).toBeGreaterThanOrEqual(first)
          expect(d.at).toBeLessThanOrEqual(last)
          expect(saved).toEqual({ ...entity, [key]: 'admin-probe' })
        }
      })

      it('creating an entity adds its lines and removes none', () => {
        const before = entitiesWithLines(name, original)
        if (before.length === 0) return // an empty `key: []` is rewritten as a block list
        createEntity(repo, name, { id: 'admin-probe-entity', name: 'Probe' })
        const after = readFileSync(file(name), 'utf8')
        const entries = readRegistry(repo, name).entries!
        restore()
        const d = lineDiff(original, after)
        expect({ removed: d.removed, added: d.added.length }).toEqual({ removed: [], added: 2 })
        expect(entries.at(-1)).toEqual({ id: 'admin-probe-entity', name: 'Probe' })
        expect(entries.slice(0, -1)).toEqual(before.map(e => e.entity))
      })

      it('deleting an entity removes its lines and no one else\'s', () => {
        const all = entitiesWithLines(name, original)
        if (all.length < 2) return // deleting the only entry rewrites the list as `[]`
        for (const { entity, first, last } of sample(all, 4)) {
          deleteEntity(repo, name, String(entity.id))
          const after = readFileSync(file(name), 'utf8')
          const entries = readRegistry(repo, name).entries!
          restore()
          const d = lineDiff(original, after)
          expect(d.added, `entity ${entity.id}`).toEqual([])
          expect(d.at).toBeGreaterThanOrEqual(first - 1) // may take the blank line that separated it
          expect(d.at + d.removed.length - 1).toBeLessThanOrEqual(last + 1)
          expect(entries).toEqual(all.map(e => e.entity).filter(e => e.id !== entity.id))
        }
      })
    })
  }
})

describe('what the instance\'s git history shows of a one-field save', () => {
  it('PUT of one changed field on a real project commits a one-line diff', async () => {
    const app = createApp(repo)
    const project = readRegistry(repo, 'projects').entries![0]!
    const res = await app.request(`/api/registries/projects/${project.id}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...project, admin_probe: 'x' }),
    })
    expect(res.status).toBe(200)
    const numstat = execSync('git show --numstat --format= HEAD', { cwd: repo }).toString().trim()
    expect(numstat).toBe('1\t0\tdata/projects.yaml')
  })
})
