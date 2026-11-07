import { describe, it, expect } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { readSignInConfig, SIGN_IN_ENV, LOCAL_COOKIE_NAME, type SignInConfig } from '../../server/session/config.ts'
import { HOSTED_ENV } from '../../server/hosted/config.ts'
import { signSession, verifySession, newSessionClaims } from '../../lib/session-token.mjs'

// Lane 3 Task 4: what the emailed-link sign-in needs from the environment, and the start refusals. Every value here is
// synthetic; the private key is made per test.

const HUB = 'https://hub.example.org'
const PEPPER = '0f'.repeat(32)
const privateJwk = () => generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' })

function hostedEnv(over: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    HOUSE_EMAIL_PEPPER: PEPPER,
    HOUSE_SESSION_PRIVATE_JWK: JSON.stringify(privateJwk()),
    SESSION_COOKIE_NAME: 'org_session_dev',
    SESSION_COOKIE_DOMAIN: 'example.org',
    RESEND_API_KEY: 're_test_synthetic',
    MAIL_FROM: 'Example Hub <hub@example.org>',
    ...over,
  }
}
const hosted = (env: Record<string, string | undefined>) => readSignInConfig(env, { hosted: true, origin: HUB })
const local = (env: Record<string, string | undefined>) => readSignInConfig(env, { hosted: false, origin: 'http://127.0.0.1:4680' })
const configOf = (read: ReturnType<typeof readSignInConfig>): SignInConfig => {
  if ('refuse' in read) throw new Error(`refused: ${read.refuse}`)
  if (read.config === null) throw new Error('not offered')
  return read.config
}
const refusalOf = (read: ReturnType<typeof readSignInConfig>): string => {
  if (!('refuse' in read)) throw new Error('expected a refusal')
  return read.refuse
}

describe('readSignInConfig, hosted', () => {
  it('hosted with all of them: the method is offered, with the cookie and the mail they name', () => {
    const env = hostedEnv()
    const c = configOf(hosted(env))
    expect(c.pepper).toBe(PEPPER)
    expect(c.issuer).toBe(HUB)
    expect(c.cookie).toEqual({ name: 'org_session_dev', domain: 'example.org', secure: true })
    expect(c.mail).toEqual({ apiKey: 're_test_synthetic', from: 'Example Hub <hub@example.org>' })
    expect(c.publicJwk.d).toBeUndefined()
    // the pair signs and verifies
    const token = signSession(newSessionClaims({ iss: c.issuer, sub: 'example-org:person:example-steward', roles: [], nodes: [] }, new Date()), c.privateJwk)
    expect(verifySession(token, c.publicJwk, new Date(), { iss: HUB })?.sub).toBe('example-org:person:example-steward')
  })

  it('hosted with none of them: email sign-in not offered, the server starts', () => {
    expect(hosted({})).toEqual({ config: null })
    expect(hosted({ SESSION_COOKIE_NAME: '', RESEND_API_KEY: '  ' })).toEqual({ config: null })
  })

  it('hosted with some but not all: refuses with a sentence naming the missing variable, never a value', () => {
    for (const missing of ['HOUSE_EMAIL_PEPPER', 'HOUSE_SESSION_PRIVATE_JWK', 'SESSION_COOKIE_NAME', 'RESEND_API_KEY', 'MAIL_FROM']) {
      const env = hostedEnv({ [missing]: undefined })
      const words = refusalOf(hosted(env))
      expect(words).toBe(`Email sign-in needs ${missing} as well. Set it, or unset the other sign-in variables to start without email sign-in.`)
      for (const v of Object.values(env)) if (v) expect(words).not.toContain(v)
    }
    const two = refusalOf(hosted(hostedEnv({ RESEND_API_KEY: undefined, MAIL_FROM: undefined })))
    expect(two).toBe('Email sign-in needs RESEND_API_KEY and MAIL_FROM as well. Set them, or unset the other sign-in variables to start without email sign-in.')
    // the optional domain alone is a start too
    expect(refusalOf(hosted({ SESSION_COOKIE_DOMAIN: 'example.org' }))).toMatch(/^Email sign-in needs HOUSE_EMAIL_PEPPER, /)
  })

  it('a cookie domain the hub is not inside is refused', () => {
    for (const domain of ['other.example', 'ample.org', 'hub.example.org.evil', 'sub.hub.example.org']) {
      expect(refusalOf(hosted(hostedEnv({ SESSION_COOKIE_DOMAIN: domain })))).toBe(
        "SESSION_COOKIE_DOMAIN must be the Hub's host or a domain it is inside (the Hub is hub.example.org). Set it so, or unset it to keep the cookie on the Hub's host.")
    }
    expect(configOf(hosted(hostedEnv({ SESSION_COOKIE_DOMAIN: 'hub.example.org' }))).cookie.domain).toBe('hub.example.org')
    expect(configOf(hosted(hostedEnv({ SESSION_COOKIE_DOMAIN: '.Example.org' }))).cookie.domain).toBe('example.org')
    expect(configOf(hosted(hostedEnv({ SESSION_COOKIE_DOMAIN: undefined }))).cookie.domain).toBeNull()
    expect(refusalOf(hosted(hostedEnv({ SESSION_COOKIE_DOMAIN: 'example.org; Path=/x' })))).toMatch(/^SESSION_COOKIE_DOMAIN is not a host name/)
  })

  it('the private JWK is never echoed in a refusal', () => {
    const SENTINEL = 'SENTINELdSENTINELdSENTINELdSENTINELdSENT'
    const good = privateJwk()
    for (const jwk of [
      `{"kty":"OKP","crv":"Ed25519","d":"${SENTINEL}"`, // not JSON (Node's JSON error would quote it)
      JSON.stringify({ kty: 'OKP', crv: 'Ed25519', d: SENTINEL, x: good.x }), // a d that is no key
      JSON.stringify({ kty: 'OKP', crv: 'Ed25519', x: SENTINEL }), // public only
      JSON.stringify({ kty: 'EC', crv: 'P-256', d: SENTINEL, x: 'a', y: 'b' }),
      JSON.stringify({ ...good, x: privateJwk().x, kid: SENTINEL }), // x of another key
    ]) {
      const words = refusalOf(hosted(hostedEnv({ HOUSE_SESSION_PRIVATE_JWK: jwk })))
      expect(words).toBe('HOUSE_SESSION_PRIVATE_JWK is not an Ed25519 private key as a JWK (kty OKP, crv Ed25519, d and its x). Make one with npm run house:session-key -- new.')
      expect(words).not.toContain(SENTINEL)
      expect(words).not.toContain(good.d!)
    }
  })

  it('a pepper shorter than 32 bytes of hex is refused, without its value', () => {
    for (const p of ['0f'.repeat(31), 'not-hex-'.repeat(10)]) {
      const words = refusalOf(hosted(hostedEnv({ HOUSE_EMAIL_PEPPER: p })))
      expect(words).toBe('HOUSE_EMAIL_PEPPER must be at least 32 bytes as hex (64 or more hex characters), such as openssl rand -hex 32 makes.')
      expect(words).not.toContain(p)
    }
  })

  it('a cookie name a header cannot carry, a __Host- name, or the wallet session\'s name is refused', () => {
    expect(refusalOf(hosted(hostedEnv({ SESSION_COOKIE_NAME: '__Host-org_session' })))).toBe(
      'SESSION_COOKIE_NAME must not start with __Host-: the cookie names a Domain, which a __Host- cookie cannot.')
    for (const name of ['house_session', '__Host-house_session']) {
      expect(refusalOf(hosted(hostedEnv({ SESSION_COOKIE_NAME: name })))).toMatch(/SESSION_COOKIE_NAME/)
    }
    expect(refusalOf(hosted(hostedEnv({ SESSION_COOKIE_NAME: 'a b' })))).toBe('SESSION_COOKIE_NAME is not a name a cookie can have (letters, digits and !#$%&\'*+-.^_`|~ only).')
  })

  it('a MAIL_FROM that is no sender, or could break a header, is refused without its value', () => {
    for (const from of ['Example Hub', 'hub@example.org\r\nBcc: x@example.org']) {
      const words = refusalOf(hosted(hostedEnv({ MAIL_FROM: from })))
      expect(words).toBe('MAIL_FROM is not a sender: an address, or a name and <address>, on one line.')
    }
  })
})

describe('readSignInConfig, local', () => {
  it('local with none: the method is offered and the link goes to the log', () => {
    const c = configOf(local({}))
    expect(c.mail).toBeNull() // no mailer: the server prints the link to its log (logMailer, Task 6)
    expect(c.cookie).toEqual({ name: LOCAL_COOKIE_NAME, domain: null, secure: false })
    expect(LOCAL_COOKIE_NAME).toBe('house_person_dev')
    expect(c.issuer).toBe('http://127.0.0.1:4680')
    expect(c.pepper).toMatch(/^[0-9a-f]{64,}$/)
    expect(c.privateJwk.d).toEqual(expect.any(String)) // a key of its own for this run
    expect(configOf(local({})).privateJwk.d).not.toBe(c.privateJwk.d)
    expect(configOf(local({})).pepper).toBe(c.pepper) // a fixed local pepper, so keys loaded locally keep working
  })

  it('local takes what is set, and refuses what is wrong as hosted does', () => {
    const c = configOf(local({ HOUSE_EMAIL_PEPPER: PEPPER, SESSION_COOKIE_NAME: 'my_dev' }))
    expect(c.pepper).toBe(PEPPER)
    expect(c.cookie.name).toBe('my_dev')
    expect(refusalOf(local({ HOUSE_EMAIL_PEPPER: 'short' }))).toMatch(/^HOUSE_EMAIL_PEPPER must be/)
    expect(refusalOf(local({ RESEND_API_KEY: 're_test_synthetic' }))).toBe('Email sign-in needs MAIL_FROM as well. Set it, or unset RESEND_API_KEY to print the link to the log.')
    expect(configOf(local({ RESEND_API_KEY: 're_test_synthetic', MAIL_FROM: 'hub@example.org' })).mail).toEqual({ apiKey: 're_test_synthetic', from: 'hub@example.org' })
  })
})

describe('the hosted variables', () => {
  it('HOSTED_ENV lists the sign-in variables', () => {
    expect([...SIGN_IN_ENV].sort()).toEqual(['HOUSE_EMAIL_PEPPER', 'HOUSE_SESSION_PRIVATE_JWK', 'MAIL_FROM', 'RESEND_API_KEY', 'SESSION_COOKIE_DOMAIN', 'SESSION_COOKIE_NAME'])
    for (const name of SIGN_IN_ENV) expect(HOSTED_ENV).toContain(name)
  })
})
