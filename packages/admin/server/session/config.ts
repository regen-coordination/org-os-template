// The emailed-link sign-in's configuration and its start checks (Lane 3 Task 4; I3, I5, I6). Every refusal is a
// sentence that names a variable, never a value: the pepper, the private key and the mail key are secrets, and Node's
// own JSON error would quote the text it could not read.
import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto'
import { HOSTED_SESSION_COOKIE, SESSION_COOKIE } from './sessions.ts'

/** Every variable the email method reads. Part of the hosted list (`HOSTED_ENV`), so the deploy example names them. */
export const SIGN_IN_ENV = [
  'HOUSE_EMAIL_PEPPER', 'HOUSE_SESSION_PRIVATE_JWK', 'SESSION_COOKIE_NAME', 'SESSION_COOKIE_DOMAIN', 'RESEND_API_KEY', 'MAIL_FROM',
] as const

/** The I5 cookie's name on a local house, when SESSION_COOKIE_NAME is not set. */
export const LOCAL_COOKIE_NAME = 'house_person_dev'

/** A local house's pepper when HOUSE_EMAIL_PEPPER is not set: fixed, public and for local use only, so email keys a
 *  developer loads keep working across restarts. A hosted house never uses it: it needs its own (ruling S4-1). */
export const LOCAL_PEPPER = '6c6f63616c2d6f6e6c792d6e6f742d612d7365637265742d6f72672d6f732d68'

export interface SignInConfig {
  pepper: string
  privateJwk: JsonWebKey
  publicJwk: JsonWebKey
  /** `ORG_OS_PUBLIC_ORIGIN` when hosted, or the local origin: the token's `iss`. */
  issuer: string
  cookie: { name: string; domain: string | null; secure: boolean }
  /** null: no mail provider (local only), and the link goes to the server's log. */
  mail: { apiKey: string; from: string } | null
}

const REQUIRED_HOSTED = ['HOUSE_EMAIL_PEPPER', 'HOUSE_SESSION_PRIVATE_JWK', 'SESSION_COOKIE_NAME', 'RESEND_API_KEY', 'MAIL_FROM'] as const

const COOKIE_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
const DOMAIN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/
const PEPPER = /^(?:[0-9a-fA-F]{2}){32,}$/
const ADDRESS = /^[^\s<>@]+@[^\s<>@]+$/
const NAMED_ADDRESS = /^[^\r\n<>]*<[^\s<>@]+@[^\s<>@]+>$/

const PEPPER_REFUSAL = 'HOUSE_EMAIL_PEPPER must be at least 32 bytes as hex (64 or more hex characters), such as openssl rand -hex 32 makes.'
const JWK_REFUSAL = 'HOUSE_SESSION_PRIVATE_JWK is not an Ed25519 private key as a JWK (kty OKP, crv Ed25519, d and its x). Make one with npm run house:session-key -- new.'
const FROM_REFUSAL = 'MAIL_FROM is not a sender: an address, or a name and <address>, on one line.'

/** "A", "A and B", "A, B and C". */
const listed = (names: readonly string[]) => names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`

/** The key pair of a private JWK, or null when it is not an Ed25519 private key whose `x` (when given) is its own. */
function keyPair(text: string): { privateJwk: JsonWebKey; publicJwk: JsonWebKey } | null {
  let jwk: JsonWebKey
  try { jwk = JSON.parse(text) as JsonWebKey } catch { return null }
  if (jwk === null || typeof jwk !== 'object' || jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || typeof jwk.d !== 'string') return null
  try {
    const priv = createPrivateKey({ key: { kty: 'OKP', crv: 'Ed25519', d: jwk.d, x: jwk.x ?? '' } as never, format: 'jwk' })
    const pub = createPublicKey(priv).export({ format: 'jwk' })
    if (jwk.x !== undefined && jwk.x !== pub.x) return null
    return { privateJwk: { kty: 'OKP', crv: 'Ed25519', d: jwk.d, x: pub.x! }, publicJwk: { kty: 'OKP', crv: 'Ed25519', x: pub.x! } }
  } catch { return null }
}

/** A fresh pair, for a local house with no key set: its sessions end when it stops. */
function freshPair(): { privateJwk: JsonWebKey; publicJwk: JsonWebKey } {
  const { privateKey } = generateKeyPairSync('ed25519')
  const d = privateKey.export({ format: 'jwk' })
  return { privateJwk: { kty: 'OKP', crv: 'Ed25519', d: d.d!, x: d.x! }, publicJwk: { kty: 'OKP', crv: 'Ed25519', x: d.x! } }
}

/** What the email method needs, or the sentence that stops the start. Hosted: with none of the variables set, the
 *  method is not offered (`config: null`) and the server starts; with some, every required one must be set. Local:
 *  every variable is optional (a fixed local pepper, a key made for the run, `house_person_dev`, no Domain, and with no
 *  mail provider the link goes to the log). `origin` is the Hub's own (`ORG_OS_PUBLIC_ORIGIN`, or the local one). */
export function readSignInConfig(
  env: Record<string, string | undefined>, o: { hosted: boolean; origin: string },
): { config: SignInConfig | null } | { refuse: string } {
  const get = (k: string): string | undefined => env[k]?.trim() ? env[k]!.trim() : undefined

  if (o.hosted) {
    const set = SIGN_IN_ENV.filter(k => get(k) !== undefined)
    if (set.length === 0) return { config: null }
    const missing = REQUIRED_HOSTED.filter(k => get(k) === undefined)
    if (missing.length > 0) {
      return { refuse: `Email sign-in needs ${listed(missing)} as well. Set ${missing.length === 1 ? 'it' : 'them'}, or unset the other sign-in variables to start without email sign-in.` }
    }
  }

  const pepper = get('HOUSE_EMAIL_PEPPER') ?? LOCAL_PEPPER
  if (!PEPPER.test(pepper)) return { refuse: PEPPER_REFUSAL }

  const jwkText = get('HOUSE_SESSION_PRIVATE_JWK')
  const pair = jwkText === undefined ? freshPair() : keyPair(jwkText)
  if (pair === null) return { refuse: JWK_REFUSAL }

  const name = get('SESSION_COOKIE_NAME') ?? LOCAL_COOKIE_NAME
  if (!COOKIE_NAME.test(name)) return { refuse: 'SESSION_COOKIE_NAME is not a name a cookie can have (letters, digits and !#$%&\'*+-.^_`|~ only).' }
  if (/^__Host-/i.test(name)) return { refuse: 'SESSION_COOKIE_NAME must not start with __Host-: the cookie names a Domain, which a __Host- cookie cannot.' }
  if (name === SESSION_COOKIE || name === HOSTED_SESSION_COOKIE) {
    return { refuse: `SESSION_COOKIE_NAME must not be ${name}: that is the wallet session's cookie. Choose another name.` }
  }

  const host = new URL(o.origin).hostname.toLowerCase()
  let domain: string | null = null
  const domainText = get('SESSION_COOKIE_DOMAIN')
  if (domainText !== undefined) {
    const d = domainText.replace(/^\./, '').toLowerCase()
    if (!DOMAIN.test(d)) return { refuse: 'SESSION_COOKIE_DOMAIN is not a host name (such as example.org). Set it so, or unset it.' }
    if (host !== d && !host.endsWith(`.${d}`)) {
      return { refuse: `SESSION_COOKIE_DOMAIN must be the Hub's host or a domain it is inside (the Hub is ${host}). Set it so, or unset it to keep the cookie on the Hub's host.` }
    }
    domain = d
  }

  const apiKey = get('RESEND_API_KEY'), from = get('MAIL_FROM')
  if ((apiKey === undefined) !== (from === undefined)) {
    const [missing, present] = apiKey === undefined ? ['RESEND_API_KEY', 'MAIL_FROM'] : ['MAIL_FROM', 'RESEND_API_KEY']
    return { refuse: `Email sign-in needs ${missing} as well. Set it, or unset ${present} to print the link to the log.` }
  }
  if (from !== undefined && !(ADDRESS.test(from) || NAMED_ADDRESS.test(from))) return { refuse: FROM_REFUSAL }

  return {
    config: {
      pepper, ...pair, issuer: o.origin.replace(/\/$/, ''),
      cookie: { name, domain, secure: o.hosted || o.origin.startsWith('https:') },
      mail: apiKey !== undefined && from !== undefined ? { apiKey, from } : null,
    },
  }
}
