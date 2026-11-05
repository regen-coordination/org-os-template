import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEntries, loadShelf, LIBRARY_DIR } from '../../server/library/read.ts'
import { placeholdersOf, resolveInstalls } from '../../server/library/config.ts'
import type { LibraryEntry } from '../../server/library/types.ts'

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'test-shelf')
const scratch: string[] = []
afterEach(() => { for (const d of scratch.splice(0)) rmSync(d, { recursive: true, force: true }) })
const tmp = (from: string, prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix)); scratch.push(dir)
  cpSync(from, dir, { recursive: true })
  return dir
}
const edit = (file: string, from: string, to: string) => {
  const text = readFileSync(file, 'utf8')
  expect(text).toContain(from)
  writeFileSync(file, text.replace(from, to))
}

const entry = (id: string) => loadEntries().find(e => e.id === id)!
const SAFE = { name: 'Treasury', chain: 'eip155:11155111', address: '0x' + '1'.repeat(40) }

/** An invented entry, to try what the shipped ones do not hold. */
const made = (config: LibraryEntry['config'], value: Record<string, unknown>, record = 'systems:counter'): LibraryEntry => ({
  id: 'system:counter', shelf: 'system', title: 'Counter', summary: 'An invented entry.', version: '1.0.0', source: 'framework',
  standing: 'stated', as_of: '2026-10-29', config, installs: [{ op: 'create', record, value }],
})

describe('placeholdersOf', () => {
  it('names what an entry\'s installs ask for, in the order they first appear', () => {
    expect(placeholdersOf(entry('system:link'))).toEqual(['id', 'name', 'url'])
    expect(placeholdersOf(entry('system:safe'))).toEqual(['id', 'name', 'chain', 'address'])
    expect(placeholdersOf(entry('board:treasury-council'))).toEqual(['system'])
    expect(placeholdersOf(entry('board:onboarding'))).toEqual([])
  })
})

describe('resolveInstalls', () => {
  it('fills a system from what the person supplies, with the default id', () => {
    const { ops, errors } = resolveInstalls(entry('system:safe'), SAFE)
    expect(errors).toEqual([])
    expect(ops).toEqual([{
      op: 'create', record: 'systems:treasury-safe',
      value: { id: 'treasury-safe', ...SAFE, kind: 'safe', driver: 'safe', section: 'organization/treasury' },
    }])
  })

  it('takes an id the person gives in place of the default', () => {
    const { ops, errors } = resolveInstalls(entry('system:safe'), { ...SAFE, id: 'ops-safe' })
    expect(errors).toEqual([])
    expect(ops[0]!.record).toBe('systems:ops-safe')
    expect(ops[0]!.value!.id).toBe('ops-safe')
  })

  it('says a missing field is required', () => {
    const { name: _name, ...rest } = SAFE
    const { errors } = resolveInstalls(entry('system:safe'), rest)
    expect(errors).toEqual([{ record: 'system:safe', field: 'config.name', message: 'name is required.' }])
  })

  it('refuses a field the entry does not ask for', () => {
    const { errors } = resolveInstalls(entry('system:safe'), { ...SAFE, colour: 'green' })
    expect(errors).toEqual([{ record: 'system:safe', field: 'config.colour', message: 'colour is not one of the things this entry asks for.' }])
  })

  it('says when a field has the wrong type, in ajv\'s words', () => {
    const { errors } = resolveInstalls(entry('system:safe'), { ...SAFE, name: 7 })
    expect(errors).toEqual([{ record: 'system:safe', field: 'config.name', message: 'must be string' }])
  })

  it('keeps a number a number when a string is exactly its placeholder', () => {
    const e = made({ properties: { count: { type: 'number' } }, required: ['count'] }, { id: 'counter', kind: 'link', count: '${config.count}' })
    const { ops, errors } = resolveInstalls(e, { count: 3 })
    expect(errors).toEqual([])
    expect(ops[0]!.value!.count).toBe(3)
  })

  it('interpolates a placeholder inside a longer string, at any depth', () => {
    const e = made({ properties: { name: { type: 'string' } }, required: ['name'] }, { id: 'counter', blocks: [{ title: 'Board for ${config.name}' }] })
    const { ops } = resolveInstalls(e, { name: 'Ops' })
    expect(ops[0]!.value!.blocks).toEqual([{ title: 'Board for Ops' }])
  })

  it('fills a placeholder in an update\'s set too, and in the record id', () => {
    const e: LibraryEntry = { ...made({ properties: { id: { type: 'string', default: 'counter' }, name: { type: 'string' } } }, {}),
      installs: [{ op: 'update', record: 'systems:${config.id}', set: { name: '${config.name}' } }] }
    expect(resolveInstalls(e, { name: 'Ops' }).ops).toEqual([{ op: 'update', record: 'systems:counter', set: { name: 'Ops' } }])
  })

  it('lenient: defaults only, an unresolved placeholder kept as written, never an error', () => {
    const { ops, errors } = resolveInstalls(entry('system:safe'), {}, { lenient: true })
    expect(errors).toEqual([])
    expect(ops[0]!.record).toBe('systems:treasury-safe')
    expect(ops[0]!.value!.name).toBe('${config.name}')
    expect(resolveInstalls(entry('system:safe'), { nonsense: true, name: 3 }, { lenient: true }).errors).toEqual([])
  })

  it('reads treasury-council\'s Safe from its default', () => {
    const blocks = resolveInstalls(entry('board:treasury-council'), {}, { lenient: true }).ops[0]!.value!.blocks as { source: Record<string, unknown> }[]
    expect(blocks.filter(b => 'system' in b.source).map(b => b.source.system)).toEqual(['treasury-safe', 'treasury-safe'])
  })

  it('does not touch the entry it reads', () => {
    const e = entry('system:safe')
    const before = JSON.stringify(e)
    resolveInstalls(e, SAFE)
    resolveInstalls(e, {}, { lenient: true })
    expect(JSON.stringify(e)).toBe(before)
  })
})

describe('a placeholder the config does not declare is refused when the shelf is read', () => {
  it('on the framework shelf', () => {
    const dir = tmp(LIBRARY_DIR, 'library-')
    edit(join(dir, 'system/safe/entry.yaml'), 'name: "${config.name}"', 'name: "${config.nope}"')
    expect(() => loadEntries(dir)).toThrow(`${dir}/system/safe/entry.yaml: its installs name config.nope, which its config does not declare.`)
  })

  it('on a registered shelf, which leaves out only that entry', () => {
    const dir = tmp(FIXTURE, 'shelf-')
    edit(join(dir, 'system/test-link/entry.yaml'), 'url: "${config.url}"', 'url: "${config.nope}"')
    const shelf = loadShelf(dir, new Set())
    expect(shelf.entries.map(e => e.id)).toEqual(['board:test-desk'])
    expect(shelf.problems).toEqual([{ shelf: 'test-shelf', sentence: `${dir}/system/test-link/entry.yaml: its installs name config.nope, which its config does not declare.` }])
  })

  it('serves the test shelf\'s placeholder entry when it is sound', () => {
    expect(loadShelf(FIXTURE, new Set()).entries.map(e => e.id)).toEqual(['board:test-desk', 'system:test-link'])
  })
})
