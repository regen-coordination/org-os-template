import { describe, it, expect } from 'vitest'
import { api, ApiError } from './api.ts'
import { fetchRoutes } from './test/fetchRoutes.ts'
import { refuse } from './test/data.ts'

describe('api', () => {
  it('encodes resource ids in paths and queries', async () => {
    const { calls } = fetchRoutes({
      'GET /api/resources/person%3Aa%20b%2Fc': { resource: {}, edges: [], neighbours: [] },
      'GET /api/operations': [], 'GET /api/jobs': [],
    })
    await api.resource('person:a b/c')
    await api.operations('person:a b/c')
    await api.jobs('person:a b/c')
    expect(calls.map(c => c.path)).toEqual([
      '/api/resources/person%3Aa%20b%2Fc', '/api/operations?resource=person%3Aa%20b%2Fc', '/api/jobs?resource=person%3Aa%20b%2Fc',
    ])
  })

  it('sends plans and jobs as JSON, and a refusal arrives as its sentence', async () => {
    const { calls } = fetchRoutes({
      'POST /api/operations/role.seat/plan': { nonce: 'n' },
      'POST /api/jobs': new Response(JSON.stringify({ error: 'This confirmation was already used or has expired. Plan the operation again.' }), { status: 409 }),
    })
    await api.plan('role.seat', 'role:platform', { brief: 'b', title: 't' })
    expect(calls[0]!.body).toEqual({ resource: 'role:platform', params: { brief: 'b', title: 't' } })
    await expect(api.runJob({ nonce: 'n' })).rejects.toThrow(/already used or has expired/)
  })

  it('stages ops as JSON, and a 422 carries each error with its record', async () => {
    const { calls } = fetchRoutes({
      'POST /api/changes/ops': new Response(JSON.stringify({ errors: [{ record: 'projects:p', field: 'start', message: 'must match format "date"' }] }), { status: 422 }),
    })
    const err = await api.stage([{ op: 'update', record: 'projects:p', set: { start: '2026-13-01' } }]).catch((e: unknown) => e)
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/changes/ops', body: { ops: [{ op: 'update', record: 'projects:p', set: { start: '2026-13-01' } }] } })
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(422)
    expect((err as ApiError).errors).toEqual([{ record: 'projects:p', field: 'start', message: 'must match format "date"' }])
  })

  it('asks the rule a change would fall under with the ops it is given, as JSON', async () => {
    const { calls } = fetchRoutes({ 'POST /api/changes/rule': { direct: true, sentence: 'the maintainer decides alone', source: 's' } })
    const ops = [{ op: 'create' as const, record: 'projects:p', value: { id: 'p' } }]
    expect(await api.wouldRule(ops)).toEqual({ direct: true, sentence: 'the maintainer decides alone', source: 's' })
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/changes/rule', body: { ops } })
  })

  it('reads a 204 as nothing', async () => {
    fetchRoutes({ 'DELETE /api/changes': new Response(null, { status: 204 }) })
    await expect(api.discard()).resolves.toBeUndefined()
  })

  it('a refused apply arrives as its reason, with the whole body kept', async () => {
    fetchRoutes({ 'POST /api/changes/apply': new Response(JSON.stringify({ reason: 'example-coop-os decides changes by consensus.' }), { status: 403 }) })
    const refused = await api.apply().catch((e: unknown) => e) as ApiError
    expect(refused.message).toBe('example-coop-os decides changes by consensus.')
    expect(refused.status).toBe(403)
    fetchRoutes({ 'POST /api/changes/apply': new Response(JSON.stringify({ stale: [0, 2] }), { status: 409 }) })
    const stale = await api.apply().catch((e: unknown) => e) as ApiError
    expect(stale.body).toEqual({ stale: [0, 2] })
  })

  it('carries the refusal code and its extras: STALE, DIRTY, EMPTY', async () => {
    fetchRoutes({ 'POST /api/changes/apply': refuse(409, { error: 'Not applied: 1 op is stale.', code: 'STALE', stale: [1] }) })
    const stale = await api.apply().catch((e: unknown) => e) as ApiError
    expect([stale.code, stale.message, stale.body.stale]).toEqual(['STALE', 'Not applied: 1 op is stale.', [1]])
    fetchRoutes({ 'POST /api/changes/apply': refuse(409, { error: 'Not applied: data/projects.yaml has uncommitted edits.', code: 'DIRTY', paths: ['data/projects.yaml'] }) })
    const dirty = await api.apply().catch((e: unknown) => e) as ApiError
    expect([dirty.code, dirty.body.paths]).toEqual(['DIRTY', ['data/projects.yaml']])
    fetchRoutes({ 'POST /api/changes/apply': refuse(400, { error: 'Nothing is staged.', code: 'EMPTY' }) })
    expect(((await api.apply().catch((e: unknown) => e)) as ApiError).code).toBe('EMPTY')
  })

  it('a 409 without a code is a file-level refusal: its sentence, no code', async () => {
    fetchRoutes({ 'POST /api/changes/apply': refuse(409, { error: 'data/projects.yaml cannot be parsed; fix it in the file.' }) })
    const err = await api.apply().catch((e: unknown) => e) as ApiError
    expect([err.code, err.message, err.errors]).toEqual([null, 'data/projects.yaml cannot be parsed; fix it in the file.', []])
  })

  it('sends apply and rebase as JSON, since the server refuses a write without that content type', async () => {
    const { fn, calls } = fetchRoutes({ 'POST /api/changes/apply': { commit: 'abc1234' }, 'POST /api/changes/ops/2/rebase': { ops: [] } })
    await api.apply()
    await api.rebase(2, 'theirs')
    expect((fn.mock.calls[0]![1] as RequestInit).headers).toEqual({ 'content-type': 'application/json' })
    expect(calls[1]!.body).toEqual({ keep: 'theirs' })
  })

  it('encodes a decision anchor', async () => {
    const { calls } = fetchRoutes({ 'GET /api/governance/decisions/ld%202026%2F35': { markdown: 'x' } })
    await api.decision('ld 2026/35')
    expect(calls[0]!.path).toBe('/api/governance/decisions/ld%202026%2F35')
  })
})

describe('api: proposals (0.6 P2, spec 3.15)', () => {
  it('reads the list and one proposal, encoding the id', async () => {
    const { calls } = fetchRoutes({ 'GET /api/proposals': [], 'GET /api/proposals/p-2026-10-18-001': { id: 'p-2026-10-18-001' }, 'GET /api/proposals/a%2Fb': {} })
    await api.proposals()
    await api.proposal('p-2026-10-18-001')
    await api.proposal('a/b')
    expect(calls.map(c => `${c.method} ${c.path}`)).toEqual(['GET /api/proposals', 'GET /api/proposals/p-2026-10-18-001', 'GET /api/proposals/a%2Fb'])
  })

  it('proposes as JSON, and a 422 carries its field errors', async () => {
    const { calls } = fetchRoutes({ 'POST /api/proposals': { id: 'p-1', branchState: 'built' } })
    const v = await api.propose({ title: 'T', rationale: 'R', statement: { title: 'T', decision: 'D', why: 'W' } })
    expect(v.branchState).toBe('built')
    expect(calls[0]!.body).toEqual({ title: 'T', rationale: 'R', statement: { title: 'T', decision: 'D', why: 'W' } })
    fetchRoutes({ 'POST /api/proposals': refuse(422, { errors: [{ field: 'rationale', message: 'is required' }] }) })
    const err = await api.propose({ title: 'T' }).catch((e: unknown) => e) as ApiError
    expect([err.status, err.errors]).toEqual([422, [{ field: 'rationale', message: 'is required' }]])
  })

  it('a machine refusal arrives as REFUSED with its reason', async () => {
    fetchRoutes({ 'POST /api/proposals/p-1/events': refuse(409, { code: 'REFUSED', machine: 'proposal', state: 'approving', event: 'approve', reason: 'You wrote it.', error: 'You wrote it.' }) })
    const err = await api.proposalEvent('p-1', { kind: 'approve' }).catch((e: unknown) => e) as ApiError
    expect([err.code, err.message, err.body.event]).toEqual(['REFUSED', 'You wrote it.', 'approve'])
  })

  it('Revise is POST /api/proposals/:id/load with an empty JSON body, and answers the tray’s change', async () => {
    const { calls } = fetchRoutes({ 'POST /api/proposals/p%2F1/load': { id: 'chg_1', revises: 'p/1', ops: [] } })
    expect(await api.loadProposal('p/1')).toMatchObject({ revises: 'p/1' })
    expect(calls).toEqual([{ method: 'POST', path: '/api/proposals/p%2F1/load', body: {} }])
  })

  it('sends every write to its route as JSON', async () => {
    const { calls } = fetchRoutes({
      'POST /api/proposals/p-1/events': {}, 'POST /api/proposals/p-1/revise': {}, 'POST /api/proposals/p-1/replay': {},
      'POST /api/proposals/p-1/ratify': {}, 'POST /api/proposals/p-1/close': {}, 'POST /api/proposals/p-1/check': {},
      'POST /api/proposals/p-1/prepare': {}, 'GET /api/sync': { ahead: 0, behind: 0 }, 'POST /api/sync': { state: 'up-to-date' },
    })
    await api.proposalEvent('p-1', { kind: 'vote', vote: 'yes' })
    await api.revise('p-1', [{ op: 'delete', record: 'projects:a', base: 'h', before: { id: 'a' } }])
    await api.replay('p-1')
    await api.replay('p-1', 'theirs')
    await api.ratify('p-1')
    await api.closeProposal('p-1', 'rejected')
    await api.checkProposal('p-1')
    await api.prepareProposal('p-1', { to: '0x1', value: '0', operation: 0 })
    await api.syncRead()
    await api.sync('n1')
    expect(calls.map(c => `${c.method} ${c.path}`)).toEqual([
      'POST /api/proposals/p-1/events', 'POST /api/proposals/p-1/revise', 'POST /api/proposals/p-1/replay', 'POST /api/proposals/p-1/replay',
      'POST /api/proposals/p-1/ratify', 'POST /api/proposals/p-1/close', 'POST /api/proposals/p-1/check', 'POST /api/proposals/p-1/prepare',
      'GET /api/sync', 'POST /api/sync',
    ])
    expect(calls.map(c => c.body)).toEqual([
      { kind: 'vote', vote: 'yes' },
      { ops: [{ op: 'delete', record: 'projects:a', base: 'h' }] }, // `before` is the tray's, never the ledger's
      {}, { choose: 'theirs' }, {}, { outcome: 'rejected' }, {}, { to: '0x1', value: '0', operation: 0 }, undefined, { nonce: 'n1' },
    ])
  })
})

describe('api: a refused read said to the session (coordinator ruling L9-O1)', () => {
  const SIGN_IN = 'Sign in to see this: it is for members only.'
  const BAND = 'Your hats could not be read for an hour; you see what anyone sees until they can be.'
  const ACCOUNT = 'eip155:42220:0x00000000000000000000000000000000000000a1'
  const IN = { mode: 'hosted', signedIn: true, actor: ACCOUNT, account: ACCOUNT, expiresAt: '2026-10-31T10:00:00.000Z' }
  const refusedRead = async (session: unknown) => {
    fetchRoutes({ 'GET /api/session': session, 'GET /api/changes': refuse(401, { error: SIGN_IN, code: 'SIGN_IN' }) })
    await api.session()
    return api.changes().then(() => null, (e: ApiError) => e)
  }

  it('a signed-in member who wears no hat is told so, in the ruling\'s words, in place of SIGN_IN', async () => {
    const err = await refusedRead({ ...IN, hats: [] })
    expect([err!.status, err!.code, err!.message]).toEqual([401, 'SIGN_IN', 'You are signed in, but you wear no hat in this DAO now.'])
  })

  it('no reading kept yet (a restart, the tree down): the band, never NO_HAT (final review I1)', async () => {
    const err = await refusedRead({ ...IN, hats: [], unread: true, band: BAND })
    expect(err!.message).toBe(BAND)
  })

  it('an empty reading that exists (no `unread`, not stale) is NO_HAT', async () => {
    expect((await refusedRead({ ...IN, hats: [] }))!.message).toBe('You are signed in, but you wear no hat in this DAO now.')
  })

  it('signed out, the SIGN_IN sentence stands', async () => {
    const err = await refusedRead({ mode: 'hosted', signIn: { chainId: 'eip155:42220', tree: 'eip155:42220:13' }, signedIn: false })
    expect(err!.message).toBe(SIGN_IN)
  })

  it('signed in with a hat, SIGN_IN stands; past the grace (hats not read), the band says why (§5.2)', async () => {
    expect((await refusedRead({ ...IN, hats: [{ hat: 'eip155:42220:0x0000000d', name: 'Top' }] }))!.message).toBe(SIGN_IN)
    expect((await refusedRead({ ...IN, hats: [], stale: true, band: BAND }))!.message).toBe(BAND)
  })

  it('a refusal that is not SIGN_IN is left as the server said it', async () => {
    fetchRoutes({ 'GET /api/session': { ...IN, hats: [] }, 'GET /api/changes': refuse(401, { error: 'Sign in to change anything here.' }) })
    await api.session()
    await expect(api.changes()).rejects.toThrow('Sign in to change anything here.')
  })
})
