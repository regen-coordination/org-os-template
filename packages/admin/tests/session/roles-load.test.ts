import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeFixtureRepo } from '../fixtures.ts'
import { openPrivateStore } from '../../server/private/store.ts'
import { main } from '../../scripts/house-roles.ts'

// Lane 3 Task 3: `npm run house:roles -- load` reads an I4 RolesDoc on stdin, never a file, and replaces the Roles in
// house.db with it. It says counts only. Synthetic values only.

const cleanup: string[] = []
afterEach(() => { for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true }) })

const KEY_A = 'a'.repeat(64), KEY_B = 'b'.repeat(64)
const DOC = {
  roles_version: '2026-11-18',
  people: [
    { id: 'example-org:person:example-steward', name: 'Example Steward', email_keys: [KEY_A], roles: ['network-member', 'steward'], nodes: [] },
    { id: 'example-org:person:example-lead', name: 'Example Lead', email_keys: [KEY_B], roles: ['network-member', 'node-lead'], nodes: ['node-one', 'node-two'] },
    { id: 'example-org:person:example-contributor', name: 'Example Contributor', email_keys: [], roles: [], nodes: [] },
  ],
}

function setup() {
  const repo = makeFixtureRepo(); cleanup.push(repo)
  const dir = mkdtempSync(join(tmpdir(), 'roles-load-')); cleanup.push(dir)
  return { repo, dir, env: { ORG_OS_PRIVATE_DIR: dir } }
}

async function run(args: string[], stdin: string, at: ReturnType<typeof setup>) {
  const out: string[] = [], err: string[] = []
  const code = await main(args, { repo: at.repo, env: at.env, stdin: async () => stdin, out: t => out.push(t), err: t => err.push(t) })
  return { code, out: out.join('\n'), err: err.join('\n') }
}

async function storeOf(at: ReturnType<typeof setup>) {
  const s = await openPrivateStore(at.repo, { dir: at.dir })
  try { return { version: s.rolesVersion(), steward: s.person('example-org:person:example-steward'), byKey: s.personByEmailKey(KEY_B) } } finally { s.close() }
}

describe('house:roles load (Lane 3 Task 3)', () => {
  it('load prints counts, never names or keys', async () => {
    const at = setup()
    const r = await run(['load'], JSON.stringify(DOC), at)
    expect(r).toEqual({ code: 0, out: 'roles 2026-11-18: 3 people, 1 steward, 1 node-lead, 2 network-member', err: '' })
    for (const p of DOC.people) { expect(r.out).not.toContain(p.name); expect(r.out).not.toContain(p.id) }
    expect(r.out).not.toContain(KEY_A)
    const s = await storeOf(at)
    expect(s.version).toBe('2026-11-18')
    expect(s.byKey?.id).toBe('example-org:person:example-lead')
  })

  it('a second load replaces the first', async () => {
    const at = setup()
    await run(['load'], JSON.stringify(DOC), at)
    const r = await run(['load'], JSON.stringify({ roles_version: '2026-11-25', people: [DOC.people[0]] }), at)
    expect(r.out).toBe('roles 2026-11-25: 1 people, 1 steward, 0 node-lead, 1 network-member')
    expect((await storeOf(at)).byKey).toBeNull()
  })

  it('a doc with an address is refused', async () => {
    const at = setup()
    await run(['load'], JSON.stringify(DOC), at)
    for (const bad of [
      { ...DOC, people: [{ ...DOC.people[0]!, name: 'steward@example.org' }] },
      { ...DOC, people: [{ ...DOC.people[0]!, email: 'steward@example.org' }] },
      { ...DOC, note: 'steward@example.org' },
    ]) {
      const r = await run(['load'], JSON.stringify(bad), at)
      expect(r.code).toBe(1)
      expect(r.out).toBe('')
      expect(r.err).toContain('no address')
      expect(r.err).not.toContain('example.org')
    }
    const s = await storeOf(at) // untouched
    expect(s.version).toBe('2026-11-18')
    expect(s.steward?.name).toBe('Example Steward')
  })

  it('a doc with an unknown role is refused', async () => {
    const at = setup()
    const r = await run(['load'], JSON.stringify({ ...DOC, people: [{ ...DOC.people[0]!, roles: ['steward', 'admin'] }] }), at)
    expect(r.code).toBe(1)
    expect(r.err).toBe('The Roles document does not match its schema at /people/0/roles/1 (must be equal to one of the allowed values); nothing was loaded.')
    expect((await storeOf(at)).version).toBeNull()
  })

  it('an email key that is not 64 lowercase hex is refused', async () => {
    const at = setup()
    for (const key of ['A'.repeat(64), 'a'.repeat(63), 'g'.repeat(64)]) {
      const r = await run(['load'], JSON.stringify({ ...DOC, people: [{ ...DOC.people[0]!, email_keys: [key] }] }), at)
      expect(r.code).toBe(1)
      expect(r.err).toContain('/people/0/email_keys/0')
      expect(r.err).not.toContain(key)
    }
    expect((await storeOf(at)).version).toBeNull()
  })

  it('a key held by two people is refused, and nothing is loaded', async () => {
    const at = setup()
    const r = await run(['load'], JSON.stringify({ ...DOC, people: [DOC.people[0], { ...DOC.people[1]!, email_keys: [KEY_A] }] }), at)
    expect(r).toEqual({ code: 1, out: '', err: 'An email key is held by two people in this Roles document; nothing was loaded.' })
    expect((await storeOf(at)).version).toBeNull()
  })

  it('what is not JSON, or not the shape, is refused without repeating it', async () => {
    const at = setup()
    const notJson = await run(['load'], '{"roles_version": "Example Steward"', at)
    expect(notJson).toEqual({ code: 1, out: '', err: 'The Roles document on stdin is not JSON; nothing was loaded.' })
    const extra = await run(['load'], JSON.stringify({ ...DOC, people: [{ ...DOC.people[0]!, wallet: 'x' }] }), at)
    expect(extra.err).toBe('The Roles document does not match its schema at /people/0 (must NOT have additional properties); nothing was loaded.')
    const empty = await run(['load'], '', at)
    expect(empty.code).toBe(1)
    expect((await storeOf(at)).version).toBeNull()
  })

  it('reads stdin only: a path, a flag or another verb is refused before anything is read', async () => {
    const at = setup()
    let read = false
    const io = { repo: at.repo, env: at.env, stdin: async () => { read = true; return JSON.stringify(DOC) }, out: () => {}, err: () => {} }
    for (const args of [['load', 'roles.json'], ['load', '--file', 'roles.json'], [], ['dump']]) expect(await main(args, io)).toBe(1)
    expect(read).toBe(false)
  })

  it('the schema file is the I4 shape', () => {
    const schema = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'schemas', 'roles-doc.schema.json'), 'utf8')) as {
      required: string[]; properties: { people: { items: { required: string[]; properties: { roles: { items: { enum: string[] } } } } } }
    }
    expect(schema.required).toEqual(['roles_version', 'people'])
    expect(schema.properties.people.items.required).toEqual(['id', 'name', 'email_keys', 'roles', 'nodes'])
    expect(schema.properties.people.items.properties.roles.items.enum).toEqual(['steward', 'node-lead', 'network-member'])
  })
})
