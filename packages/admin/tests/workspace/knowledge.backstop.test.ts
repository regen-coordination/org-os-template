/** PF-R3 (review I1): an edit writes only the entries it names. An anchor shared between entries let an edit of one change
 *  the other through its alias, so a knowledge op is judged over the whole file at every apply (the tray's, the entry
 *  page's, a ratify's build): every other entry as it was, and the file's publishing set grown only by the entries the op
 *  names, and only when the change was decided as a publication. PF-R2 refuses such files first; this suite bypasses it
 *  (the module's `canonReadDiffers` answers null here) to reach the backstop behind it, with the reviewer's alias fixture.
 *  Each test builds a fresh temporary instance (the kms fixture as its own git repository); members are placeholders. */
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Hono } from 'hono'
import { parse } from 'yaml'
import { createApp } from '../../server/app.ts'
import { applyEdit, prepareEdit } from '../../server/knowledge/write.ts'
import { judgeCanonWrite } from '../../server/knowledge/canon-text.ts'
import { FIXTURE_NOW, makeKmsInstance, type FixtureInstance } from '../server/knowledge/fixture.ts'

vi.mock('../../lib/workspace/knowledge.mjs', async original => ({ ...(await original<object>()), canonReadDiffers: () => null }))

let instance: FixtureInstance | null = null
afterEach(() => { instance?.cleanup(); instance = null })

const MEMBERS = `schema_version: "2.0"
members:
  - { id: steward-a, name: Steward A, kind: person, handles: { git: ["steward-a@example.test"] } }
`
/** The reviewer's alias fixture: the sibling's public use is an alias of the draft's anchor. */
const CANON = `schema_version: "1.0"
entries:
  draft-claim:
    title: A draft claim
    type: claim-evidence
    id: id-draft-claim
    maturity: held
    public_use: &pu internal-only
  sibling-claim:
    title: A sibling claim that shares its public use
    type: claim-evidence
    id: id-sibling-claim
    maturity: reviewed
    public_use: *pu
`
/** What the in-place writer makes of the draft's public use: the anchored scalar's own characters, so the alias follows. */
const AFTER = CANON.replace('&pu internal-only', '&pu ok-with-caveat')
const PLAIN = CANON.replace('&pu internal-only', 'internal-only').replace('public_use: *pu', 'public_use: internal-only')

function world(canon: string): string {
  instance = makeKmsInstance()
  const dir = instance.dir
  git(dir, 'init -q -b main')
  git(dir, 'config user.email steward-a@example.test')
  git(dir, 'config user.name Test')
  writeFileSync(join(dir, 'data/members.yaml'), MEMBERS)
  writeFileSync(join(dir, 'data/kb/claim-evidence.yaml'), canon)
  git(dir, 'add -A')
  git(dir, 'commit -qm "fixture: the canon and the members"')
  return dir
}
const git = (dir: string, cmd: string) => execSync(`git -C "${dir}" ${cmd}`, { stdio: 'pipe' }).toString()
const json = (method: string, body?: unknown) => ({ method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), headers: { 'content-type': 'application/json' } })
async function call(app: Hono, path: string, init?: RequestInit): Promise<{ status: number; body: any }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const res = await app.request(path, init)
  const text = await res.text()
  return { status: res.status, body: text === '' ? null : JSON.parse(text) }
}
const sibling = (dir: string) => (parse(readFileSync(join(dir, 'data/kb/claim-evidence.yaml'), 'utf8')) as { entries: Record<string, unknown> }).entries['sibling-claim']
const STEWARD = { id: 'steward-a', name: 'Steward A', kind: 'person' as const }

describe('the whole-file judgement (PF-R3)', () => {
  it('refuses a write that changes an entry the op does not name, naming it', () => {
    let err: unknown = null
    try { judgeCanonWrite(CANON, AFTER, 'claim-evidence', new Set(['draft-claim']), true) } catch (e) { err = e }
    expect(err).toMatchObject({ status: 409 })
    expect(String((err as Error).message)).toMatch(/sibling-claim/)
    expect(String((err as Error).message)).toMatch(/Nothing was written/)
  })

  it('lets the publishing set grow only by a named entry, and only when the change was decided as a publication', () => {
    const released = PLAIN.replace('maturity: held\n    public_use: internal-only', 'maturity: held\n    public_use: ok-with-caveat')
      .replace('maturity: held', 'maturity: reviewed')
    expect(() => judgeCanonWrite(PLAIN, released, 'claim-evidence', new Set(['draft-claim']), true)).not.toThrow()
    expect(() => judgeCanonWrite(PLAIN, released, 'claim-evidence', new Set(['draft-claim']), false)).toThrow(/publishable/)
    expect(() => judgeCanonWrite(PLAIN, PLAIN.replace('A draft claim', 'A drafted claim'), 'claim-evidence', new Set(['draft-claim']), false)).not.toThrow()
  })
})

describe('every apply judges the whole file (PF-R3), behind PF-R2', () => {
  it('the tray\'s apply refuses the reviewer\'s alias edit, and the sibling is as it was', async () => {
    const dir = world(CANON)
    const app = createApp(dir)
    const staged = await call(app, '/api/changes/ops', json('POST', { ops: [{ op: 'update', record: 'knowledge:claim-evidence/draft-claim', set: { public_use: 'ok-with-caveat' } }] }))
    expect(staged.status, JSON.stringify(staged.body)).toBe(200)
    const head = git(dir, 'rev-parse HEAD')
    const applied = await call(app, '/api/changes/apply', json('POST', {}))
    expect(applied.status, JSON.stringify(applied.body)).toBe(409)
    expect(JSON.stringify(applied.body)).toMatch(/sibling-claim/)
    expect(git(dir, 'rev-parse HEAD')).toBe(head)
    expect(sibling(dir)).toMatchObject({ public_use: 'internal-only' })
  })

  it('the entry page\'s apply refuses it too', async () => {
    const dir = world(CANON)
    const edit = await prepareEdit(dir, 'claim-evidence', 'draft-claim', { fields: { public_use: 'ok-with-caveat' } }, { now: FIXTURE_NOW }, STEWARD)
    await expect(applyEdit(dir, 'claim-evidence', 'draft-claim', { fields: { public_use: 'ok-with-caveat' }, base: edit.base }, STEWARD)).rejects.toMatchObject({ status: 409 })
    expect(readFileSync(join(dir, 'data/kb/claim-evidence.yaml'), 'utf8')).toBe(CANON)
  })
})
