import { test, expect } from 'vitest'
import { matchesNode, websiteHost } from '../../server/network/match.ts'

// The match rule (spec §5.4, Q19): signing in proves control, not ownership, so a node's account goes live by itself
// only on the node's own website domain or when the node's own record already names it. Everything else is pending.

const acct = (handle: string, did = 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa') => ({ did, handle })
const none = { resolveHandle: async () => null }

test('a handle equal to the website host matches', async () =>
  expect(await matchesNode(acct('refi-somewhere.org'), { url: 'https://refi-somewhere.org/' }, null, none)).toEqual({ match: true, why: 'domain' }))
// Luiz, 2026-11-24 (final review point 5): only the exact host goes live. Orgs hand members handles under their domain
// (someone.refi-x.org), and a person's own account must never go live as the node's; a subdomain handle is pending.
test('the website host with www. dropped matches', async () =>
  expect(await matchesNode(acct('refi-somewhere.org'), { url: 'https://www.refi-somewhere.org' }, null, none)).toEqual({ match: true, why: 'domain' }))
test('a subdomain of the website host does not match by itself (pending for a steward)', async () => {
  expect((await matchesNode(acct('node.refi-somewhere.org'), { url: 'https://www.refi-somewhere.org' }, null, none)).match).toBe(false)
  expect((await matchesNode(acct('someone.refi-somewhere.org'), { url: 'https://refi-somewhere.org/' }, null, none)).match).toBe(false)
})
test('links.web counts when url is empty', async () =>
  expect((await matchesNode(acct('refi-somewhere.org'), { url: null, links: { web: 'https://refi-somewhere.org' } }, null, none)).match).toBe(true))
test('a website with a path never matches', async () =>
  expect((await matchesNode(acct('github.com'), { url: 'https://github.com/refi-x' }, null, none)).match).toBe(false))
test('a sibling on a shared host does not match', async () =>
  expect((await matchesNode(acct('attacker.github.io'), { url: 'https://refi-x.github.io/' }, null, none)).match).toBe(false))
test('a suffix without a dot does not match', async () =>
  expect((await matchesNode(acct('evilrefi-somewhere.org'), { url: 'https://refi-somewhere.org' }, null, none)).match).toBe(false))
test('a Dec 9 entry for the same DID with check pass matches', async () =>
  expect(await matchesNode(acct('x.bsky.social'), {}, { did: 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa', check: 'pass' }, none)).toEqual({ match: true, why: 'record' }))
test('a Dec 9 entry that failed its check does not match', async () =>
  expect((await matchesNode(acct('x.bsky.social'), {}, { did: 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa', check: 'fail' }, none)).match).toBe(false))
test('a profile link on the node resolving to the DID matches', async () =>
  expect(await matchesNode(acct('refix.bsky.social'), { links: { web: 'https://bsky.app/profile/refix.bsky.social' } }, null,
    { resolveHandle: async (h) => (h === 'refix.bsky.social' ? 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa' : null) })).toEqual({ match: true, why: 'record' }))
test('a profile link by DID matches without resolving', async () =>
  expect((await matchesNode(acct('a.bsky.social'), { url: 'https://certified.app/profile/did:plc:aaaaaaaaaaaaaaaaaaaaaaaa' }, null, none)).match).toBe(true))
test('a profile link resolving elsewhere, or a resolver that throws, does not match', async () => {
  expect((await matchesNode(acct('a.bsky.social'), { url: 'https://bsky.app/profile/b.bsky.social' }, null, { resolveHandle: async () => 'did:plc:bbbbbbbbbbbbbbbbbbbbbbbb' })).match).toBe(false)
  expect((await matchesNode(acct('a.bsky.social'), { url: 'https://bsky.app/profile/b.bsky.social' }, null, { resolveHandle: async () => { throw new Error('down') } })).match).toBe(false)
})
test.each(['', 'not a url', 'refi-somewhere.org', 'https://refi-somewhere.org:8443/', 'HTTPS://REFI-SOMEWHERE.ORG/',
  'https://refi-somewhere.org./', 'https://xn--rfi-bpa.org/', 'mailto:a@b.c', 'https://refi-somewhere.org/?ref=x#top'])(
  'websiteHost never throws on %j', (s) => expect(() => websiteHost(s)).not.toThrow())
test('capitals, a trailing dot and a query on a root path still give the host', () => {
  expect(websiteHost('HTTPS://REFI-SOMEWHERE.ORG/')).toBe('refi-somewhere.org')
  expect(websiteHost('https://refi-somewhere.org./')).toBe('refi-somewhere.org')
  expect(websiteHost('https://refi-somewhere.org/?ref=x#top')).toBe('refi-somewhere.org')
  expect(websiteHost('refi-somewhere.org')).toBe(null)          // no scheme: not a website address
  expect(websiteHost('https://refi-somewhere.org/about')).toBe(null)
})

// Final review, Important 1: a node whose website is a bare public suffix or a host that hands out subdomains to
// other people (a handle provider, a hosting platform) must never let a throwaway account match by domain.
test.each([
  ['https://www.org/', 'attacker.org'],
  ['https://www.co.uk/', 'attacker.co.uk'],
  ['https://co.uk/', 'attacker.co.uk'],
  ['https://bsky.social', 'attacker.bsky.social'],
  ['https://certified.one/', 'attacker.certified.one'],
  ['https://github.io/', 'attacker.github.io'],
  ['https://netlify.app/', 'attacker.netlify.app'],
  ['https://invalid/', 'handle.invalid'],
])('a website at %s never lets %s match by domain', async (url, handle) =>
  expect((await matchesNode(acct(handle), { url }, null, none)).match).toBe(false))
test('websiteHost refuses a single label, a bare two-level country suffix, and www. in front of either', () => {
  for (const s of ['https://invalid/', 'https://co.uk/', 'https://www.com.br/', 'https://bsky.social/']) expect(websiteHost(s)).toBe(null)
  expect(websiteHost('https://www.org/')).toBe('www.org')   // two labels: www. stays, so only handles under www.org match
  expect(websiteHost('https://refi-somewhere.co.uk/')).toBe('refi-somewhere.co.uk')
  expect(websiteHost('https://www.refi.org/')).toBe('refi.org')
})
// Final review, the port ruling reversed: a handle is proven on DNS or port 443; whoever runs :8443 may be someone else.
test('a website on a non-default port never matches', async () => {
  expect(websiteHost('https://sharedhost.com:8443/')).toBe(null)
  expect((await matchesNode(acct('sharedhost.com'), { url: 'https://sharedhost.com:8443/' }, null, none)).match).toBe(false)
  expect(websiteHost('https://refi-somewhere.org:443/')).toBe('refi-somewhere.org')
})
