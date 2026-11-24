// The proposals ledger is written only by its own routes (P2 spec §3.1): the change engine and the old
// registry routes answer the same sentence.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { removeFixtureRepo } from '../fixtures.ts'
import { makeChangeRepo, git } from './fixtures.ts'
import { FEDERATION_REQUESTS_SENTENCE, LEDGER_SENTENCE, stage } from '../../server/changes/stage.ts'
import { applyOps, StageRefusal } from '../../server/changes/apply.ts'
import { createApp } from '../../server/app.ts'

const SENTENCE = /proposals are changed by their own routes/
let repo: string
beforeEach(() => { repo = makeChangeRepo() })
afterEach(() => removeFixtureRepo(repo))
const json = (method: string, body?: unknown) => ({ method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const ENTRY = { id: 'p-2026-10-18-001', title: 'x' }

describe('an op on proposals', () => {
  it.each([
    ['create', { op: 'create', record: 'proposals:p-2026-10-18-001', value: ENTRY }],
    ['update', { op: 'update', record: 'proposals:p-2026-10-18-001', set: { title: 'y' } }],
    ['delete', { op: 'delete', record: 'proposals:p-2026-10-18-001' }],
    ['replace', { op: 'replace', record: 'proposals:p-2026-10-18-001', value: ENTRY }],
  ])('is refused when staged (%s), with the sentence, and nothing is kept', (_name, op) => {
    const { ops, errors } = stage(repo, [], [op as never])
    expect(ops).toEqual([])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ record: 'proposals:p-2026-10-18-001', field: '' })
    expect(errors[0]!.message).toMatch(SENTENCE)
  })
  it('is refused with the others of the same change: one bad op keeps the whole change out', () => {
    const { ops, errors } = stage(repo, [], [
      { op: 'update', record: 'projects:proj-001', set: { status: 'develop' } },
      { op: 'create', record: 'proposals:p-2026-10-18-001', value: ENTRY },
    ])
    expect(ops).toEqual([])
    expect(errors.map(e => e.record)).toEqual(['proposals:p-2026-10-18-001'])
  })
  it('is refused by apply as well, so an old stored change cannot write the ledger', async () => {
    const op = { op: 'create' as const, record: 'proposals:p-2026-10-18-001', value: ENTRY, base: null, before: null }
    await expect(applyOps(repo, [op], { message: 'x', trailers: {} })).rejects.toBeInstanceOf(StageRefusal)
    expect(existsSync(join(repo, 'data', 'proposals.yaml'))).toBe(false)
  })
  it('the staging route answers 422 with the sentence', async () => {
    const res = await createApp(repo).request('/api/changes/ops', json('POST', { ops: [{ op: 'create', record: 'proposals:p-2026-10-18-001', value: ENTRY }] }))
    expect(res.status).toBe(422)
    expect(JSON.stringify(await res.json())).toMatch(SENTENCE)
  })
})

describe('the old registry routes', () => {
  it.each([
    ['POST', '/api/registries/proposals', ENTRY],
    ['PUT', '/api/registries/proposals/p-2026-10-18-001', ENTRY],
    ['DELETE', '/api/registries/proposals/p-2026-10-18-001', undefined],
  ])('%s %s answers the same sentence and writes nothing', async (method, path, body) => {
    const before = git(repo, 'rev-parse HEAD')
    const res = await createApp(repo).request(path, json(method, body))
    expect(res.status).toBe(403)
    const answer = await res.json()
    expect(answer.error).toMatch(SENTENCE)
    expect(answer.code).toBe('LEDGER')
    expect(git(repo, 'rev-parse HEAD')).toBe(before)
    expect(existsSync(join(repo, 'data', 'proposals.yaml'))).toBe(false)
  })
  it('reading is still allowed', async () => {
    writeFileSync(join(repo, 'data', 'proposals.yaml'), 'proposals: []\n')
    const res = await createApp(repo).request('/api/registries/proposals')
    expect(res.status).toBe(200)
    expect((await res.json()).entries).toEqual([])
  })
})

// Replay M4: federation-requests is a ledger too, but the federation routes write it, not Propose: its refusal says so.
describe('federation-requests: its own sentence, never Propose\'s', () => {
  const REQ = { id: 'req-1', from: 'Valley Node', network: 'Mesh', outcome: 'held' }
  const OWN = FEDERATION_REQUESTS_SENTENCE('federation-requests')
  it('the sentence names the Federation page and never Propose', () => {
    expect(OWN).toBe('federation-requests are written only by the Federation page\'s own routes (receiving a request, Accept and Refuse), not by staging a change here or by hand. Nothing was staged.')
    expect(OWN).not.toContain('Propose')
    expect(LEDGER_SENTENCE('proposals')).toMatch(SENTENCE)
  })
  it.each([
    ['create', { op: 'create', record: 'federation-requests:req-1', value: REQ }],
    ['update', { op: 'update', record: 'federation-requests:req-1', set: { outcome: 'accepted' } }],
  ])('a staged %s is refused with it', (_name, op) => {
    const { ops, errors } = stage(repo, [], [op as never])
    expect(ops).toEqual([])
    expect(errors.map(e => e.message)).toEqual([OWN])
  })
  it('the staging route answers 422 with it', async () => {
    const res = await createApp(repo).request('/api/changes/ops', json('POST', { ops: [{ op: 'create', record: 'federation-requests:req-1', value: REQ }] }))
    expect(res.status).toBe(422)
    const text = JSON.stringify(await res.json())
    expect(text).toContain(OWN)
    expect(text).not.toMatch(/Propose/)
  })
  it.each([
    ['POST', '/api/registries/federation-requests', REQ],
    ['PUT', '/api/registries/federation-requests/req-1', REQ],
    ['DELETE', '/api/registries/federation-requests/req-1', undefined],
  ])('%s %s answers 403 LEDGER with it and writes nothing', async (method, path, body) => {
    const before = git(repo, 'rev-parse HEAD')
    const res = await createApp(repo).request(path, json(method, body))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: OWN, code: 'LEDGER' })
    expect(git(repo, 'rev-parse HEAD')).toBe(before)
  })
})
