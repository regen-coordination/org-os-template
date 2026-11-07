import { describe, it, expect } from 'vitest'
import { createHmac, createPrivateKey, generateKeyPairSync, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  emailKey, newSessionClaims, signSession, verifySession, sessionCookie, clearedSessionCookie,
  SESSION_TTL_S, REISSUE_UNDER_S,
} from '../../lib/session-token.mjs'

// I3 (the email key) and I5 (the session JWS) of the hub-convergence plan; Lane 3 Task 1. Keys are made per test, and
// the vector's key pair was made once for the fixture and is deployed nowhere (its private half was not kept).

const VECTOR = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'i5-vector.json'), 'utf8')) as {
  i3: { email: string; pepper: string; emailKey: string; alsoMatches: string[] }
  i5: { publicJwk: JsonWebKey; token: string; claims: Record<string, unknown>; now: string; expiredAt: string }
}
const PEPPER = VECTOR.i3.pepper
const ISS = 'https://hub.example.org'

function keyPair(): { privateJwk: JsonWebKey; publicJwk: JsonWebKey } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return { privateJwk: privateKey.export({ format: 'jwk' }), publicJwk: publicKey.export({ format: 'jwk' }) }
}

const NOW = new Date('2026-11-18T09:00:00Z')
const claimsAt = (now = NOW) => newSessionClaims({ iss: ISS, sub: 'refidao:person:example-steward', roles: ['steward'], nodes: [] }, now)

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')

describe('emailKey (I3)', () => {
  it('emailKey normalises case and whitespace', () => {
    expect(emailKey(' Steward@Example.org ', PEPPER)).toBe(emailKey('steward@example.org', PEPPER))
    expect(emailKey('steward@example.org', PEPPER)).toMatch(/^[0-9a-f]{64}$/)
  })
  it('emailKey does not fold plus-addresses', () => {
    expect(emailKey('a+x@example.org', PEPPER)).not.toBe(emailKey('a@example.org', PEPPER))
  })
  it('is HMAC-SHA256 keyed by the pepper as written, over the trimmed lowercase address', () => {
    expect(emailKey('steward@example.org', PEPPER)).toBe(createHmac('sha256', Buffer.from(PEPPER, 'utf8')).update('steward@example.org').digest('hex'))
    expect(emailKey('steward@example.org', PEPPER)).not.toBe(emailKey('steward@example.org', PEPPER.replace(/0/g, '1')))
  })
  it('refuses an empty address or an empty pepper', () => {
    expect(() => emailKey('  ', PEPPER)).toThrow()
    expect(() => emailKey('steward@example.org', '')).toThrow()
  })
  it('the I3 vector matches', () => {
    expect(emailKey(VECTOR.i3.email, VECTOR.i3.pepper)).toBe(VECTOR.i3.emailKey)
    for (const typed of VECTOR.i3.alsoMatches) expect(emailKey(typed, VECTOR.i3.pepper)).toBe(VECTOR.i3.emailKey)
  })
})

describe('the session token (I5)', () => {
  it('token exp is 24h', () => {
    const c = claimsAt()
    expect(SESSION_TTL_S).toBe(86_400)
    expect(REISSUE_UNDER_S).toBe(43_200)
    expect(c.exp - c.iat).toBe(86_400)
    expect(c.iat).toBe(NOW.getTime() / 1000)
    const { privateJwk, publicJwk } = keyPair()
    const back = verifySession(signSession(c, privateJwk), publicJwk, NOW)
    expect(back).not.toBeNull()
    expect(back!.exp - back!.iat).toBe(86_400)
  })

  it('signs a compact EdDSA JWS that verifies, with its claims back whole', () => {
    const { privateJwk, publicJwk } = keyPair()
    const c = claimsAt()
    const token = signSession(c, privateJwk)
    const [header, payload, sig] = token.split('.')
    expect(JSON.parse(Buffer.from(header!, 'base64url').toString())).toEqual({ alg: 'EdDSA', typ: 'JWT' })
    expect(JSON.parse(Buffer.from(payload!, 'base64url').toString())).toEqual(c)
    expect(Buffer.from(sig!, 'base64url')).toHaveLength(64)
    expect(verifySession(token, publicJwk, NOW, { iss: ISS })).toEqual(c)
    expect(c.jti).toMatch(/^[0-9a-f]{32}$/)
    expect(claimsAt().jti).not.toBe(c.jti)
  })

  it('a token signed by another key is refused', () => {
    const a = keyPair(), b = keyPair()
    expect(verifySession(signSession(claimsAt(), a.privateJwk), b.publicJwk, NOW)).toBeNull()
  })

  it('a tampered payload is refused', () => {
    const { privateJwk, publicJwk } = keyPair()
    const [h, , s] = signSession(claimsAt(), privateJwk).split('.')
    const forged = `${h}.${b64({ ...claimsAt(), roles: ['steward', 'node-lead'] })}.${s}`
    expect(verifySession(forged, publicJwk, NOW)).toBeNull()
  })

  it('an expired token is refused', () => {
    const { privateJwk, publicJwk } = keyPair()
    const token = signSession(claimsAt(), privateJwk)
    expect(verifySession(token, publicJwk, new Date(NOW.getTime() + 86_399_000))).not.toBeNull()
    expect(verifySession(token, publicJwk, new Date(NOW.getTime() + 86_400_000))).toBeNull()
  })

  it('a token from another issuer is refused when iss is given', () => {
    const { privateJwk, publicJwk } = keyPair()
    const token = signSession(claimsAt(), privateJwk)
    expect(verifySession(token, publicJwk, NOW, { iss: 'https://other.example.org' })).toBeNull()
    expect(verifySession(token, publicJwk, NOW)).not.toBeNull()
  })

  it('alg other than EdDSA is refused', () => {
    const { privateJwk, publicJwk } = keyPair()
    const [, payload, sig] = signSession(claimsAt(), privateJwk).split('.')
    expect(verifySession(`${b64({ alg: 'none', typ: 'JWT' })}.${payload}.`, publicJwk, NOW)).toBeNull()
    expect(verifySession(`${b64({ alg: 'none', typ: 'JWT' })}.${payload}.${sig}`, publicJwk, NOW)).toBeNull()
    const input = `${b64({ alg: 'HS256', typ: 'JWT' })}.${payload}`
    const hs = createHmac('sha256', Buffer.from(publicJwk.x!, 'utf8')).update(input).digest('base64url')
    expect(verifySession(`${input}.${hs}`, publicJwk, NOW)).toBeNull()
    // A real Ed25519 signature over a header that names another alg is refused too: the header is read before the key.
    const { privateKey } = generateKeyPairSync('ed25519')
    const other = `${b64({ alg: 'ES256' })}.${payload}`
    expect(verifySession(`${other}.${sign(null, Buffer.from(other), privateKey).toString('base64url')}`, publicJwk, NOW)).toBeNull()
  })

  it('anything that is not a token answers null and never throws', () => {
    const { publicJwk } = keyPair()
    for (const junk of ['', 'a', 'a.b', 'a.b.c', '...', `${b64({ alg: 'EdDSA' })}.not-json.x`, `${b64({ alg: 'EdDSA' })}.${b64([1])}.x`]) {
      expect(verifySession(junk, publicJwk, NOW)).toBeNull()
    }
    expect(verifySession(VECTOR.i5.token, { kty: 'OKP', crv: 'Ed25519', x: 'bad' }, NOW)).toBeNull()
  })

  it('claims of the wrong shape are refused when verified', () => {
    const { privateJwk, publicJwk } = keyPair()
    const key = createPrivateKey({ key: privateJwk as never, format: 'jwk' })
    for (const bad of [
      { ...claimsAt(), sub: '' },
      { ...claimsAt(), roles: 'steward' },
      { ...claimsAt(), nodes: [1] },
      { ...claimsAt(), exp: '1' },
      { ...claimsAt(), iss: undefined },
    ]) {
      // signed with the matching key through the raw primitive, so only the shape refuses it
      const input = `${b64({ alg: 'EdDSA', typ: 'JWT' })}.${b64(bad)}`
      expect(verifySession(`${input}.${sign(null, Buffer.from(input), key).toString('base64url')}`, publicJwk, NOW)).toBeNull()
    }
  })

  it('signSession refuses a key that is not a private Ed25519 JWK', () => {
    const { publicJwk } = keyPair()
    expect(() => signSession(claimsAt(), publicJwk)).toThrow()
    expect(() => signSession(claimsAt(), { kty: 'EC', crv: 'P-256', d: 'x', x: 'y', y: 'z' } as JsonWebKey)).toThrow()
  })

  it('the vector verifies', () => {
    const v = VECTOR.i5
    expect(verifySession(v.token, v.publicJwk, new Date(v.now), { iss: v.claims.iss as string })).toEqual(v.claims)
    expect(verifySession(v.token, v.publicJwk, new Date(v.expiredAt))).toBeNull()
  })
})

describe('the session cookie (I5)', () => {
  it('carries the name and Domain it is given, Path=/, Secure, HttpOnly, SameSite=Lax and 24 h', () => {
    expect(sessionCookie('t.o.k', { name: 'org_session', domain: 'example.org', secure: true }))
      .toBe('org_session=t.o.k; Domain=example.org; Path=/; Max-Age=86400; Secure; HttpOnly; SameSite=Lax')
  })
  it('locally: no Domain and no Secure', () => {
    expect(sessionCookie('t.o.k', { name: 'house_person_dev', domain: null, secure: false }))
      .toBe('house_person_dev=t.o.k; Path=/; Max-Age=86400; HttpOnly; SameSite=Lax')
  })
  it('the cleared cookie has the same name and attributes, an empty value and Max-Age=0', () => {
    expect(clearedSessionCookie({ name: 'org_session', domain: 'example.org', secure: true }))
      .toBe('org_session=; Domain=example.org; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax')
  })
  it('refuses a name or domain a header cannot carry', () => {
    expect(() => sessionCookie('t', { name: 'a b', domain: null, secure: false })).toThrow()
    expect(() => sessionCookie('t', { name: 'ok', domain: 'example.org; Path=/x', secure: true })).toThrow()
    expect(() => sessionCookie('t;x', { name: 'ok', domain: null, secure: false })).toThrow()
  })
})
