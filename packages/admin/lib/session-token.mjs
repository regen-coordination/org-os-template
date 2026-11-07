// packages/admin/lib/session-token.mjs
//
// The email key (I3) and the session token (I5) of the emailed-link sign-in. The house looks a person up by a keyed
// fingerprint of their address and never keeps the address; it signs a compact JWS (EdDSA, Ed25519) that the org's
// other sites verify with the house's public key. node:crypto only: no dependency, server side only.

import { createHmac, createPrivateKey, createPublicKey, randomBytes, sign, verify } from 'node:crypto'

/** How long a session token lives: 24 h from when it is issued (I5). */
export const SESSION_TTL_S = 86_400
/** A token with less than this left is re-issued on a Hub visit (I5). */
export const REISSUE_UNDER_S = 43_200

/** I3: HMAC-SHA256 keyed by the pepper (its UTF-8 bytes, as the variable is written) over the address trimmed and in
 *  lower case, as lowercase hex. No plus-address folding: `a+x@…` and `a@…` are two keys.
 *  @param {string} email @param {string} pepper @returns {string} */
export function emailKey(email, pepper) {
  if (typeof pepper !== 'string' || pepper === '') throw new Error('emailKey needs the pepper')
  const normal = typeof email === 'string' ? email.trim().toLowerCase() : ''
  if (normal === '') throw new Error('emailKey needs an address')
  return createHmac('sha256', Buffer.from(pepper, 'utf8')).update(normal, 'utf8').digest('hex')
}

/** @typedef {{ iss: string, sub: string, roles: string[], nodes: string[], iat: number, exp: number, jti: string }} SessionClaims */

/** The claims of a session issued at `now`: `iat` in whole seconds, `exp = iat + 24 h`, and a fresh `jti` (16 random
 *  bytes, hex), extra to I5, by which the house ends a session at sign-out. Sites ignore it.
 *  @param {{ iss: string, sub: string, roles: string[], nodes: string[] }} who @param {Date} now @returns {SessionClaims} */
export function newSessionClaims(who, now) {
  const iat = Math.floor(now.getTime() / 1000)
  return { iss: who.iss, sub: who.sub, roles: [...who.roles], nodes: [...who.nodes], iat, exp: iat + SESSION_TTL_S, jti: randomBytes(16).toString('hex') }
}

const HEADER = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' })).toString('base64url')
const B64URL = /^[A-Za-z0-9_-]*$/

/** @param {unknown} v @returns {v is string[]} */
const strings = v => Array.isArray(v) && v.every(s => typeof s === 'string')
/** @param {unknown} v @returns {v is string} */
const text = v => typeof v === 'string' && v !== ''

/** True when `c` has I5's claims, each of its type.
 *  @param {any} c @returns {c is SessionClaims} */
function shaped(c) {
  return c !== null && typeof c === 'object' && !Array.isArray(c)
    && text(c.iss) && text(c.sub) && strings(c.roles) && strings(c.nodes)
    && Number.isInteger(c.iat) && Number.isInteger(c.exp) && text(c.jti)
}

/** Signs `claims` as a compact JWS (`alg: EdDSA`) with an Ed25519 private JWK (`d` present). Throws for any other key or
 *  for claims of the wrong shape; the key is never repeated in what it throws.
 *  @param {SessionClaims} claims @param {JsonWebKey} privateJwk @returns {string} */
export function signSession(claims, privateJwk) {
  if (!shaped(claims)) throw new Error('signSession needs I5 claims: iss, sub, roles, nodes, iat, exp and jti')
  if (!privateJwk || privateJwk.kty !== 'OKP' || privateJwk.crv !== 'Ed25519' || typeof privateJwk.d !== 'string') {
    throw new Error('signSession needs an Ed25519 private key as a JWK (kty OKP, crv Ed25519, with d)')
  }
  let key
  try { key = createPrivateKey({ key: /** @type {any} */ (privateJwk), format: 'jwk' }) } catch {
    throw new Error('The session private key could not be read as an Ed25519 JWK.')
  }
  const input = `${HEADER}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`
  return `${input}.${sign(null, Buffer.from(input), key).toString('base64url')}`
}

/** The claims of `token` when it is a compact JWS whose header says `alg: EdDSA`, whose Ed25519 signature `publicJwk`
 *  verifies, whose claims have I5's shape, that has not expired at `now` (`now < exp`), and, when `opts.iss` is
 *  given, that names that issuer. Null otherwise; never throws.
 *  @param {string} token @param {JsonWebKey} publicJwk @param {Date} now @param {{ iss?: string }} [opts]
 *  @returns {SessionClaims | null} */
export function verifySession(token, publicJwk, now, opts = {}) {
  try {
    if (typeof token !== 'string') return null
    const parts = token.split('.')
    if (parts.length !== 3 || !parts.every(p => p !== '' && B64URL.test(p))) return null
    const [h, p, s] = /** @type {[string, string, string]} */ (parts)
    const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'))
    if (header === null || typeof header !== 'object' || header.alg !== 'EdDSA') return null
    if (!publicJwk || publicJwk.kty !== 'OKP' || publicJwk.crv !== 'Ed25519' || typeof publicJwk.x !== 'string') return null
    const key = createPublicKey({ key: /** @type {any} */ ({ kty: 'OKP', crv: 'Ed25519', x: publicJwk.x }), format: 'jwk' })
    const sig = Buffer.from(s, 'base64url')
    if (sig.length !== 64 || !verify(null, Buffer.from(`${h}.${p}`), key, sig)) return null
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'))
    if (!shaped(claims)) return null
    if (Math.floor(now.getTime() / 1000) >= claims.exp) return null
    if (opts.iss !== undefined && claims.iss !== opts.iss) return null
    return claims
  } catch {
    return null
  }
}

// RFC 6265: a cookie name is a token; a value has no space, quote, comma, semicolon or backslash; a domain is a host name.
const COOKIE_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
const COOKIE_VALUE = /^[!#$%&'()*+./0-9:<=>?@A-Z[\]^_`a-z{|}~-]*$/
const DOMAIN = /^\.?[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*$/

/** @param {string} value @param {number} maxAge @param {{ name: string, domain: string | null, secure: boolean }} o */
function cookie(value, maxAge, o) {
  if (!COOKIE_NAME.test(o.name)) throw new Error('The session cookie\'s name is not one a header can carry.')
  if (!COOKIE_VALUE.test(value)) throw new Error('The session cookie\'s value is not one a header can carry.')
  if (o.domain !== null && !DOMAIN.test(o.domain)) throw new Error('The session cookie\'s domain is not a host name.')
  return `${o.name}=${value}${o.domain !== null ? `; Domain=${o.domain}` : ''}; Path=/; Max-Age=${maxAge}${o.secure ? '; Secure' : ''}; HttpOnly; SameSite=Lax`
}

/** The I5 Set-Cookie value: `<name>=<token>; Domain=<domain>; Path=/; Max-Age=86400; Secure; HttpOnly; SameSite=Lax`.
 *  No `Domain` when `domain` is null (the cookie stays on the Hub's host), no `Secure` when `secure` is false (local).
 *  @param {string} token @param {{ name: string, domain: string | null, secure: boolean }} o @returns {string} */
export function sessionCookie(token, o) { return cookie(token, SESSION_TTL_S, o) }

/** The Set-Cookie value that clears it: the same name and attributes, an empty value and `Max-Age=0`.
 *  @param {{ name: string, domain: string | null, secure: boolean }} o @returns {string} */
export function clearedSessionCookie(o) { return cookie('', 0, o) }
