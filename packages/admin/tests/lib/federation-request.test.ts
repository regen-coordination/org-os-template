import { describe, it, expect } from 'vitest'
import { REQUEST_SPEC, buildRequest, parseRequest, requestText, hubPeerOf } from '../../lib/federation/request.mjs'
import { loadSchema } from '../../server/schema.ts'

const ID = '3f8a2c1e-5b7d-4e9a-8c10-2d6f4a9b7e31'
const make = (over: Record<string, unknown> = {}) => buildRequest({
  id: ID, from: { name: 'Mesa Verde', type: 'LocalNode', url: 'https://github.com/mesa-verde/mesa-os' },
  hub: { name: 'Rio Net', url: 'https://github.com/rio-net/hub' }, network: 'rio-net',
  answers: { operator: '@ana' }, now: '2026-11-22T10:00:00.000Z', ...over,
})

describe('federation request', () => {
  it('builds a request in the spec', () => {
    const r = make()
    expect(r.spec).toBe(REQUEST_SPEC)
    expect(REQUEST_SPEC).toBe('org-os/federation-request/1')
    expect(r).toMatchObject({ id: ID, network: 'rio-net', created: '2026-11-22T10:00:00.000Z' })
    expect('invite' in r).toBe(false)
  })
  it('round-trips through requestText and parseRequest, in a fixed key order', () => {
    const r = make({ invite: 'tok_abc' })
    const text = requestText(r)
    expect(text.split('\n').filter(l => /^\S/.test(l)).map(l => l.split(':')[0]))
      .toEqual(['spec', 'id', 'created', 'from', 'hub', 'network', 'answers', 'invite'])
    expect(parseRequest(text)).toEqual({ request: r, problems: [] })
  })
  it('reads JSON too', () => {
    expect(parseRequest(JSON.stringify(make())).request).toEqual(make())
  })
  it('refuses an extra key, at the top and inside from', () => {
    expect(parseRequest(requestText(make()) + 'peers: []\n')).toMatchObject({ request: null })
    expect(parseRequest(requestText(make()) + 'peers: []\n').problems[0]).toMatch(/peers/)
    const r = make(); (r.from as Record<string, unknown>).email = 'a@b.c'
    expect(parseRequest(JSON.stringify(r)).request).toBeNull()
  })
  it.each(['http://github.com/a/b', 'https://localhost/x', 'https://10.0.0.1/x'])('refuses from.url %s', url => {
    const r = parseRequest(requestText(make({ from: { name: 'N', type: 'LocalNode', url } })))
    expect(r.request).toBeNull()
    expect(r.problems.join(' ')).toMatch(/from\.url/)
  })
  it('refuses a non-UUID id, a wrong spec and text that is not a mapping', () => {
    expect(parseRequest(requestText(make({ id: 'abc' }))).request).toBeNull()
    expect(parseRequest(requestText({ ...make(), spec: 'x/1' })).request).toBeNull()
    expect(parseRequest('- a\n- b\n').request).toBeNull()
    expect(parseRequest(': : :\n\t[').request).toBeNull()
  })
  it('hubPeerOf gives exactly the six fields and the decision, and the did when one is known', () => {
    expect(hubPeerOf(make(), 'request 3f8a')).toEqual({
      name: 'Mesa Verde', url: 'https://github.com/mesa-verde/mesa-os', type: 'LocalNode', trust: 'read',
      relationship: 'node', since: '2026-11-22', decision: 'request 3f8a',
    })
    const did = 'did:plc:abcdefghijklmnopqrstuvwx'
    expect(hubPeerOf(make(), 'request 3f8a', did)).toEqual({
      name: 'Mesa Verde', url: 'https://github.com/mesa-verde/mesa-os', type: 'LocalNode', trust: 'read',
      relationship: 'node', since: '2026-11-22', decision: 'request 3f8a', did,
    })
    // a did that isn't one, or none at all, is left out
    expect(hubPeerOf(make(), 'request 3f8a', 'not-a-did')).not.toHaveProperty('did')
    expect(hubPeerOf(make(), 'request 3f8a', null)).not.toHaveProperty('did')
  })
  it('refuses a name, type or network with a control or format character, or longer than 200 characters', () => {
    const bad = (from: Record<string, string>, network?: string) =>
      parseRequest(requestText({ ...make(), from: { ...make().from, ...from }, ...(network !== undefined ? { network } : {}) })).problems
    expect(bad({ name: 'Mesa\u001b[31mVerde' })).toContain('from.name holds a control or format character.')
    expect(bad({ name: 'Mesa\u202eedreV' })).toContain('from.name holds a control or format character.')
    expect(bad({ type: 'Local\nNode' })).toContain('from.type holds a control or format character.')
    expect(bad({}, 'rio\u200fnet')).toContain('network holds a control or format character.')
    expect(bad({ name: 'Mesa\u2028Verde' })).toContain('from.name holds a control or format character.')
    expect(bad({}, 'rio\u2029net')).toContain('network holds a control or format character.')
    expect(bad({ name: 'x'.repeat(10_000) })).toContain('from.name is longer than 200 characters.')
    expect(bad({}, 'n'.repeat(201))).toContain('network is longer than 200 characters.')
    expect(bad({ name: 'x'.repeat(200) })).toEqual([])
    // a NUL cannot even be carried: whatever the YAML reader makes of it, nothing comes back
    expect(parseRequest(requestText(make()).replace('Mesa Verde', 'Mesa\u0000Verde')).request).toBeNull()
  })
  it('the requests ledger schema holds no person field, and refuses an invite that is not an invite id', () => {
    const s = loadSchema('federation-requests') as unknown as { additionalProperties: boolean, properties: Record<string, { pattern?: string }> }
    expect(s.additionalProperties).toBe(false)
    expect(Object.keys(s.properties).filter(k => /mail|contact|phone|handle|person|token/i.test(k))).toEqual([])
    expect(new RegExp(s.properties.invite!.pattern!).test('i-0a1b2c3d')).toBe(true)
    expect(new RegExp(s.properties.invite!.pattern!).test('x'.repeat(43))).toBe(false)
  })
})
