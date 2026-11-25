import { describe, it, expect } from 'vitest'
import { makeInvite, inviteMatch } from '../../lib/federation/invite.mjs'
import { sha256Hex } from '../../lib/sha256.mjs'

const random = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) % 256)
const request = (type = 'LocalNode', network = 'rio-net') => ({ from: { type }, network }) as never
const NOW = '2026-11-22T10:00:00.000Z'
const made = () => makeInvite({ name: 'Mesa Verde', type: 'LocalNode', network: 'rio-net', expires: '2026-12-22', random })

describe('invites', () => {
  it('makes a record holding the hash and a token of 32 random bytes, base64url', () => {
    const { record, token } = made()
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(record).toMatchObject({ name: 'Mesa Verde', type: 'LocalNode', network: 'rio-net', expires: '2026-12-22', used_by: null })
    expect(record.id).toMatch(/^i-[0-9a-f]{8}$/)
    expect(record.token_sha256).toBe(sha256Hex(token))
  })
  it('the invite record never contains the token', () => {
    const { record, token } = made()
    expect(JSON.stringify(record)).not.toContain(token)
  })
  it('an invite matches once, before expiry, for its type, by token hash', () => {
    const { record, token } = made()
    expect(inviteMatch([record], token, request(), NOW)).toEqual({ invite: record })
    expect(inviteMatch([{ ...record, used_by: 'r-1' }], token, request(), NOW)).toEqual({ problem: 'This invite has been used.' })
    expect(inviteMatch([record], token, request(), '2027-01-01T00:00:00.000Z')).toEqual({ problem: 'This invite has expired.' })
    expect(inviteMatch([record], token, request(), '2026-12-22T20:00:00.000Z')).toEqual({ invite: record })
    expect(inviteMatch([record], token, request('Cooperative'), NOW)).toEqual({ problem: 'This invite is for a LocalNode.' })
    expect(inviteMatch([record], 'wrong', request(), NOW)).toEqual({ problem: "This invite doesn't match." })
    expect(inviteMatch([record], token, request('LocalNode', 'another-net'), NOW)).toEqual({ problem: 'This invite is for another network.' })
    expect(inviteMatch([record], undefined, request(), NOW)).toEqual({ problem: "This invite doesn't match." })
  })
})
