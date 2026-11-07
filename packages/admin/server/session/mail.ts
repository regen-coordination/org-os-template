// The sign-in mailer (Lane 3 Task 6, I6): one plain-text mail holding the emailed link. Injected, so tests use
// `recordingMailer` and never reach the network, and a local house with no provider prints the link to its log. No
// failure repeats the address, the key or the link: the provider's own answer is never read into a message.
import type { FetchLike } from '../systems/driver.ts'

export interface Mailer { send(to: string, link: string, org: string): Promise<void> }

/** The provider's send endpoint (the one the org's other sites use). */
export const RESEND_URL = 'https://api.resend.com/emails'
/** How long a send may take before it is given up. */
export const MAIL_TIMEOUT_MS = 10_000

/** The mail's subject and plain-text body for `link` from `org`. */
export function mailText(link: string, org: string): { subject: string; text: string } {
  return {
    subject: `Sign in to ${org}`,
    text: `Sign in to ${org} with this link:\n\n${link}\n\nThis link works for 15 minutes, once.\n\nIf you did not ask for it, ignore this email.\n`,
  }
}

/** Sends through the provider's API: one POST with the bearer key, from `from`, to the one address. Throws a fixed
 *  sentence on failure (the status, never the provider's words, which may quote the address). */
export function resendMailer(o: { apiKey: string; from: string; fetch: FetchLike }): Mailer {
  return {
    async send(to, link, org) {
      let res: Awaited<ReturnType<FetchLike>>
      try {
        res = await o.fetch(RESEND_URL, {
          method: 'POST',
          headers: { authorization: `Bearer ${o.apiKey}`, 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ from: o.from, to: [to], ...mailText(link, org) }),
          redirect: 'error',
          signal: AbortSignal.timeout(MAIL_TIMEOUT_MS),
        })
      } catch {
        throw new Error('The sign-in mail was not sent: the mail provider could not be reached.')
      }
      if (!res.ok) throw new Error(`The sign-in mail was not sent: the mail provider answered ${res.status}.`)
    },
  }
}

/** For tests: keeps each mail it is asked to send, and sends nothing. */
export function recordingMailer(): Mailer & { sent: { to: string; link: string }[] } {
  const sent: { to: string; link: string }[] = []
  return { sent, async send(to, link) { sent.push({ to, link }) } }
}

/** Local only, with no provider set: prints the link to the server's log, never the address. */
export function logMailer(log: (line: string) => void = line => console.log(line)): Mailer {
  return { async send(_to, link, org) { log(`org-os admin: a sign-in link for ${org} (local, not mailed): ${link}`) } }
}
