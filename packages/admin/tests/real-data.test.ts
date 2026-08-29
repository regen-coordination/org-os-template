// The admin app must be able to open and save THIS repository's actual data.
//
// Every other suite runs against hand-written fixtures, which is why four
// defects shipped invisibly: the schemas were derived from DATA-MODEL.md's
// examples rather than from the registries operators really have, so
// `validateEntity` rejected 13/13 projects and 7/7 relationships — the
// projects registry was unopenable-and-unsavable on day one — and the
// funding-opportunities top-level key did not match any file in the fleet.
//
// These tests read the repo's own data/*.yaml. If a schema and reality
// disagree again, this fails instead of the operator discovering it mid-demo.
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { validateEntity } from '../server/schema.ts'
import { REGISTRIES, resolveTopKey } from '../server/registries.ts'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

const collections = REGISTRIES.filter(
  (d) => d.kind === 'collection' && existsSync(join(repo, 'data', `${d.name}.yaml`)),
)

describe('the admin schemas accept this repository\'s real registries', () => {
  for (const def of collections) {
    it(`${def.name}: every entry validates`, () => {
      const doc = parse(readFileSync(join(repo, 'data', `${def.name}.yaml`), 'utf8')) ?? {}
      const key = resolveTopKey((k) => Object.hasOwn(doc, k), def)
      const entries = Array.isArray(doc[key]) ? doc[key] : []
      const failures = entries
        .map((e: Record<string, unknown>) => ({ id: e?.id, result: validateEntity(repo, def.name, e) }))
        .filter((r) => !r.result.valid)
        .map((r) => `${r.id}: ${r.result.errors?.map((e) => `${e.field} ${e.message}`).join(', ')}`)
      expect(failures, `${failures.length}/${entries.length} entries would 422 in the admin UI`).toEqual([])
    })
  }
})

describe('every registry\'s top-level key resolves against the real file', () => {
  for (const def of collections) {
    it(`${def.name}: the collection is found, not silently empty`, () => {
      const doc = parse(readFileSync(join(repo, 'data', `${def.name}.yaml`), 'utf8')) ?? {}
      const key = resolveTopKey((k) => Object.hasOwn(doc, k), def)
      // A key the file does not have means the UI shows an empty registry for
      // a populated file — and, on create, appends to a NEW second top-level
      // key, splitting the data. `opportunities` vs `funding_opportunities`
      // was exactly this.
      const arrayKeys = Object.keys(doc).filter((k) => Array.isArray(doc[k]))
      if (arrayKeys.length > 0) {
        expect(arrayKeys, `resolved "${key}" but the file's array keys are [${arrayKeys}]`).toContain(key)
      }
    })
  }
})
