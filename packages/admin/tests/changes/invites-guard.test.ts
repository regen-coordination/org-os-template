// data/invites.yaml holds token hashes and `used_by`: an invite is created, and used by the hub's own writer, but never
// replaced, updated or deleted by hand (a used invite would be usable again). Network N2 Task 10, fix round 1 (I3).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { stringify } from 'yaml'
import { makeChangeRepo, git } from './fixtures.ts'
import { removeFixtureRepo } from '../fixtures.ts'
import { createApp } from '../../server/app.ts'
import { ledgerErrors, OWN_ROUTES_SENTENCE } from '../../server/changes/stage.ts'

const USED = { id: 'i-aaaa0001', name: 'For Mesa', type: 'LocalNode', network: 'Mesh', expires: '2027-01-01', token_sha256: 'a'.repeat(64), used_by: 'https://mesa.example.org' }
const NEW = { id: 'i-bbbb0002', name: 'For Roda', type: 'LocalNode', network: 'Mesh', expires: '2027-01-01', token_sha256: 'b'.repeat(64), used_by: null }

let repo: string
let app: ReturnType<typeof createApp>
beforeEach(() => {
  repo = makeChangeRepo()
  writeFileSync(join(repo, 'data', 'invites.yaml'), stringify({ invites: [USED] }))
  git(repo, 'add -A'); git(repo, 'commit -qm "an invite, used"')
  app = createApp(repo)
})
afterEach(() => removeFixtureRepo(repo))

const json = (body: unknown, method = 'POST') => ({ method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const stage = (ops: unknown[]) => app.request('/api/changes/ops', json({ ops }))

describe('invites: create only', () => {
  it('ledgerErrors refuses replace, update and delete on invites with the own-routes sentence, and lets create through', () => {
    const rec = 'invites:i-aaaa0001'
    expect(ledgerErrors([{ op: 'replace', record: rec, value: { ...USED, used_by: null } }]).map(e => e.message)).toEqual([OWN_ROUTES_SENTENCE('invites')])
    expect(ledgerErrors([{ op: 'update', record: rec, set: { used_by: null } }])).toHaveLength(1)
    expect(ledgerErrors([{ op: 'delete', record: rec }])).toHaveLength(1)
    expect(ledgerErrors([{ op: 'create', record: 'invites:i-bbbb0002', value: NEW }])).toEqual([])
  })

  it('a staged replace, update or delete is refused, and the invite stays used; a staged create is accepted', async () => {
    for (const op of [
      { op: 'replace', record: 'invites:i-aaaa0001', value: { ...USED, used_by: null } },
      { op: 'update', record: 'invites:i-aaaa0001', set: { used_by: null } },
      { op: 'delete', record: 'invites:i-aaaa0001' },
    ]) {
      const res = await stage([op])
      expect(res.status, op.op).toBeGreaterThanOrEqual(400)
      expect(JSON.stringify(await res.json()), op.op).toContain(OWN_ROUTES_SENTENCE('invites'))
    }
    expect((await stage([{ op: 'create', record: 'invites:i-bbbb0002', value: NEW }])).status).toBe(200)
  })

  it('the registry routes refuse PUT and DELETE (403) and still create (201); the used invite is untouched', async () => {
    const put = await app.request('/api/registries/invites/i-aaaa0001', json({ ...USED, used_by: null }, 'PUT'))
    expect(put.status).toBe(403)
    expect((await put.json()).error).toBe(OWN_ROUTES_SENTENCE('invites'))
    const del = await app.request('/api/registries/invites/i-aaaa0001', { method: 'DELETE' })
    expect(del.status).toBe(403)
    const made = await app.request('/api/registries/invites', json(NEW))
    expect(made.status, JSON.stringify(await made.clone().json())).toBe(201)
    const list = await (await app.request('/api/registries/invites')).json() as { entries?: { id: string; used_by: unknown }[] }
    expect(list.entries!.find(e => e.id === 'i-aaaa0001')!.used_by).toBe('https://mesa.example.org')
  })
})
