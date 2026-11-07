import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PACKAGE_SCHEMAS } from './fixtures.ts'

/** The schemas the sections add to carry the new-record form's words (spec 2026-11-04 §3): a `title` and a
 *  `description` per property, and `x-groups`. These are annotations only. The skeleton beside this test is each
 *  schema as it validated before they were added, its annotations taken out; the schema now, taken out the same way,
 *  must be it. A change to what a schema accepts changes the skeleton, on purpose and in the same commit. */

const ANNOTATED = ['projects', 'members', 'funding-opportunities', 'relationships', 'ideas', 'meetings', 'systems', 'sources']
const ANNOTATION = new Set(['title', 'description', '$comment', 'examples'])
/** Maps whose keys are names (a property called `title`), not keywords. */
const NAMED = new Set(['properties', 'patternProperties', '$defs', 'definitions'])

/** A schema with its annotations taken out: `title`, `description`, `$comment`, `examples` and every `x-` keyword.
 *  A property left with no keyword at all (`{}`) accepts anything, as no property does, so it goes too. */
function strip(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(strip)
  if (typeof v !== 'object' || v === null) return v
  const o: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v)) {
    if (ANNOTATION.has(k) || k.startsWith('x-')) continue
    o[k] = NAMED.has(k) && x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).map(([n, s]) => [n, strip(s)]))
      : strip(x)
  }
  const props = o.properties as Record<string, unknown> | undefined
  if (props && typeof props === 'object') {
    for (const [k, x] of Object.entries(props)) if (x && typeof x === 'object' && Object.keys(x).length === 0) delete props[k]
    if (Object.keys(props).length === 0) delete o.properties
  }
  return o
}

const schemaOf = (name: string) => JSON.parse(readFileSync(join(PACKAGE_SCHEMAS, `${name}.schema.json`), 'utf8')) as {
  properties: Record<string, { title?: string; description?: string }>; 'x-groups'?: { label: string; fields: string[] }[]
}
const skeleton = JSON.parse(readFileSync(new URL('./schema.skeleton.json', import.meta.url), 'utf8')) as Record<string, unknown>

describe('the new-record form’s annotations (spec 2026-11-04 §3)', () => {
  it('take nothing out and put nothing in: each schema validates as it did', () => {
    for (const name of ANNOTATED) expect(strip(schemaOf(name)), name).toEqual(skeleton[name])
  })

  it('give every property a title and a description, and groups that name only the schema’s properties, each once', () => {
    for (const name of ANNOTATED) {
      const s = schemaOf(name)
      for (const [k, p] of Object.entries(s.properties)) {
        expect(typeof p.title, `${name}.${k} title`).toBe('string')
        expect(typeof p.description, `${name}.${k} description`).toBe('string')
      }
      const grouped = (s['x-groups'] ?? []).flatMap(g => g.fields)
      expect(s['x-groups']?.length, `${name} x-groups`).toBeGreaterThan(0)
      expect(grouped.filter(f => !Object.hasOwn(s.properties, f)), `${name} groups name no property`).toEqual([])
      expect(new Set(grouped).size, `${name} groups name a field once`).toBe(grouped.length)
    }
  })

  it('strip keeps a field named like a keyword, and drops only what accepts anything', () => {
    expect(strip({ title: 'T', properties: { title: { type: 'string', title: 'Title' }, note: { description: 'd' } }, 'x-groups': [] }))
      .toEqual({ properties: { title: { type: 'string' } } })
  })
})
