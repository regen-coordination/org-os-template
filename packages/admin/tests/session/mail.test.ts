import { describe, it, expect, vi, afterEach } from 'vitest'
import { resendMailer, recordingMailer, logMailer, mailText, RESEND_URL } from '../../server/session/mail.ts'
import type { FetchLike } from '../../server/systems/driver.ts'

// Lane 3 Task 6: the sign-in mailer. Tests never reach the network: the provider is a fake fetch. Synthetic values only.

const LINK = 'https://hub.example.org/sign-in/link?token=synthetic-token'
const TO = 'steward@example.org'

afterEach(() => { vi.restoreAllMocks() })

type Call = { url: string; init: Parameters<FetchLike>[1] }
function fakeFetch(answer: { ok: boolean; status: number; body?: unknown } | Error): FetchLike & { calls: Call[] } {
  const calls: Call[] = []
  const f = (async (url, init) => {
    calls.push({ url, init })
    if (answer instanceof Error) throw answer
    return { ok: answer.ok, status: answer.status, json: async () => answer.body ?? {} }
  }) as FetchLike & { calls: Call[] }
  f.calls = calls
  return f
}

describe('the mail itself', () => {
  it('is plain text: the link, how long it works, and what to do if it was not asked for', () => {
    expect(mailText(LINK, 'Example Org')).toEqual({
      subject: 'Sign in to Example Org',
      text: `Sign in to Example Org with this link:\n\n${LINK}\n\nThis link works for 15 minutes, once.\n\nIf you did not ask for it, ignore this email.\n`,
    })
  })
})

describe('resendMailer', () => {
  it('resend: one POST with the bearer key and the from', async () => {
    const fetch = fakeFetch({ ok: true, status: 200, body: { id: 'synthetic' } })
    await resendMailer({ apiKey: 're_test_synthetic', from: 'Example Hub <hub@example.org>', fetch }).send(TO, LINK, 'Example Org')
    expect(fetch.calls).toHaveLength(1)
    const [{ url, init }] = fetch.calls as [Call]
    expect(url).toBe(RESEND_URL)
    expect(RESEND_URL).toBe('https://api.resend.com/emails')
    expect(init.method).toBe('POST')
    expect(init.redirect).toBe('error')
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(init.headers).toEqual({ authorization: 'Bearer re_test_synthetic', 'content-type': 'application/json', accept: 'application/json' })
    expect(JSON.parse(init.body!)).toEqual({ from: 'Example Hub <hub@example.org>', to: [TO], ...mailText(LINK, 'Example Org') })
  })

  it('a provider error throws without the address in the message', async () => {
    for (const answer of [{ ok: false, status: 422, body: { message: `Invalid to: ${TO}` } }, new Error(`getaddrinfo failed for ${TO}`)]) {
      const fetch = fakeFetch(answer)
      const err = await resendMailer({ apiKey: 're_test_synthetic', from: 'hub@example.org', fetch }).send(TO, LINK, 'Example Org').then(() => null, (e: Error) => e)
      expect(err).toBeInstanceOf(Error)
      expect(err!.message).not.toContain(TO)
      expect(err!.message).not.toContain('example.org')
      expect(err!.message).not.toContain('re_test_synthetic')
      expect(err!.message).not.toContain(LINK)
      expect(err!.message).toMatch(answer instanceof Error
        ? /^The sign-in mail was not sent: the mail provider could not be reached\.$/
        : /^The sign-in mail was not sent: the mail provider answered 422\.$/)
    }
  })
})

describe('logMailer (local only)', () => {
  it('logMailer prints no address', async () => {
    const said: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { said.push(a.join(' ')) })
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { said.push(a.join(' ')) })
    vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => { said.push(a.join(' ')) })
    await logMailer().send(TO, LINK, 'Example Org')
    expect(spy).toHaveBeenCalledTimes(1)
    expect(said).toEqual([`org-os admin: a sign-in link for Example Org (local, not mailed): ${LINK}`])
    expect(said.join('\n')).not.toContain(TO)
  })
})

describe('recordingMailer (tests)', () => {
  it('keeps what it was asked to send, and sends nothing', async () => {
    const m = recordingMailer()
    await m.send(TO, LINK, 'Example Org')
    expect(m.sent).toEqual([{ to: TO, link: LINK }])
  })
})
