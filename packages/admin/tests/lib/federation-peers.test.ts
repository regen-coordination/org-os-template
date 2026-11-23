import { it, expect } from 'vitest'
import { resolve } from 'node:path'
import { addressOf, sameAddress, selfAddresses, isPublicUrl, publicHref, linkState, LINK_STATES } from '../../lib/federation/peers.mjs'

type R = { found: false } | { found: true, doc: unknown } | { found: true, error: string }
const io = (map: Record<string, R>) => ({
  resolve: (base: string, rel: string) => resolve(base, rel),
  isDir: (abs: string) => abs in map,
  readFederationAt: (abs: string): R => map[abs] ?? { found: false },
})
const peer = (ref: string) => ({ index: 0, name: 'P', ref, url: null, type: null, trust: null, relationship: null,
  since: null, decision: null, requested: null, did: null, link: null, private: false })

it('lists the four link states', () => {
  expect(LINK_STATES).toEqual(['mutual', 'claimed', 'requested', 'left', 'not-an-instance', 'unknown'])
})
it('a bare repos/egregore that is a local folder is a path, not GitHub user "repos"', () => {
  expect(addressOf('repos/egregore', '/w/me', io({ '/w/me/repos/egregore': { found: false } }))).toEqual({ kind: 'path', path: '/w/me/repos/egregore' })
  expect(addressOf('ReFiDAO/refi-dao-os', '/w/me', io({}))).toEqual({ kind: 'github', owner: 'refidao', repo: 'refi-dao-os', path: '' })
})
it('reads a monorepo folder link as github with a path', () => {
  expect(addressOf('https://github.com/luizfernandosg/Zettelkasten/tree/main/03%20Libraries/ReFi%20DAO', '/w', io({})))
    .toEqual({ kind: 'github', owner: 'luizfernandosg', repo: 'zettelkasten', path: '03 Libraries/ReFi DAO' })
})
it('git@, https, .git, trailing slash and case are the same repo', () => {
  const a = addressOf('git@github.com:ReFiDAO/refi-dao-os.git', '/', io({}))!
  for (const r of ['https://github.com/refidao/refi-dao-os', 'https://github.com/ReFiDAO/refi-dao-os/', 'github.com/ReFiDAO/refi-dao-os.git'])
    expect(sameAddress(a, addressOf(r, '/', io({}))!)).toBe(true)
})
it('credentials in an https remote and the ssh:// form are the same repo', () => {
  const a = addressOf('https://github.com/o/r', '/', io({}))!
  for (const r of ['https://user:token@github.com/O/R.git', 'ssh://git@github.com/O/R.git', 'ssh://git@github.com/o/r'])
    expect(sameAddress(a, addressOf(r, '/', io({}))!)).toBe(true)
})
it('a ? or # before the @ is not userinfo, so it is not GitHub', () => {
  for (const r of ['https://a?@github.com/o/r', 'https://a#@github.com/o/r'])
    expect(addressOf(r, '/', io({}))?.kind).not.toBe('github')
})
it('other URLs, dot paths, spaces and unknown refs', () => {
  expect(addressOf('https://Refidao.com/', '/w', io({}))).toEqual({ kind: 'url', href: 'https://refidao.com' })
  expect(addressOf('../hub', '/w/me', io({}))).toEqual({ kind: 'path', path: '/w/hub' })
  expect(addressOf('My Folder', '/w', io({}))).toEqual({ kind: 'path', path: '/w/My Folder' })
  expect(addressOf('nothing', '/w', io({}))).toBeNull()
  expect(addressOf('nothing', '/w', io({ '/w/nothing': { found: false } }))).toEqual({ kind: 'path', path: '/w/nothing' })
})
it('isPublicUrl takes only https URLs', () => {
  expect([isPublicUrl('https://refidao.com'), isPublicUrl('http://x.org'), isPublicUrl('../refi-bcn-os'), isPublicUrl(null), isPublicUrl('https://user:pw@example.org'), isPublicUrl('https://user@example.org')]).toEqual([true, false, false, false, false, false])
})
it('isPublicUrl refuses local hosts, IP literals, queries and fragments', () => {
  for (const u of ['https://localhost/x', 'https://app.localhost/', 'https://box.local/', 'https://db.internal/', 'https://10.0.0.1', 'https://[::1]/',
    'https://example.org/?access_token=x', 'https://example.org/#t', 'https://example.org?']) expect(isPublicUrl(u), u).toBe(false)
  expect(isPublicUrl('https://refidao.com')).toBe(true)
  expect(isPublicUrl('https://github.com/ReFiDAO/refi-dao-os')).toBe(true)
})
it('mutual when their side lists us by our remote URL', () => {
  const fs: Record<string, R> = { '/w/hub': { found: true, doc: { peers: [{ name: 'Me', repo: 'https://github.com/me-org/me-os' }] } } }
  const self = selfAddresses('/w/me', ['git@github.com:me-org/me-os.git'], io(fs))
  expect(linkState(peer('../hub'), self, '/w/me', io(fs))).toEqual({ state: 'mutual', path: '/w/hub', reason: null })
})
it('mutual when their side lists us by a relative path', () => {
  const fs: Record<string, R> = { '/w/hub': { found: true, doc: { peers: [{ name: 'Me', repo: '../me' }] } }, '/w/me': { found: true, doc: {} } }
  expect(linkState(peer('../hub'), selfAddresses('/w/me', [], io(fs)), '/w/me', io(fs)).state).toBe('mutual')
})
it('claimed when their side does not list us', () => {
  const fs: Record<string, R> = { '/w/hub': { found: true, doc: { peers: [] } } }
  expect(linkState(peer('../hub'), selfAddresses('/w/me', [], io(fs)), '/w/me', io(fs)).state).toBe('claimed')
})
it('not-an-instance when the folder has no federation.yaml', () => {
  expect(linkState(peer('repos/site'), [], '/w/me', io({ '/w/me/repos/site': { found: false } })).state).toBe('not-an-instance')
})
it('unknown, with the reason, when their federation.yaml is broken', () => {
  expect(linkState(peer('../hub'), [], '/w/me', io({ '/w/hub': { found: true, error: 'bad indentation' } })))
    .toEqual({ state: 'unknown', path: '/w/hub', reason: "their federation.yaml can't be read: bad indentation" })
})
it('unknown for a GitHub-only peer and for a missing folder', () => {
  expect(linkState(peer('someone/far-away'), [], '/w/me', io({})).reason).toBe("can't read their side from here")
  expect(linkState(peer('../gone'), [], '/w/me', io({})).reason).toBe('no folder at /w/gone')
})

// Final review I1: a vault-relative ref (`03 Libraries/…`, spec §12 R2) is found under a folder above the instance.
it('a bare relative ref is looked for under the instance first, then under each folder above it', () => {
  const fs = { '/v/03 Libraries/b': { found: false } as R }
  expect(addressOf('03 Libraries/b', '/v/03 Libraries/a', io(fs))).toEqual({ kind: 'path', path: '/v/03 Libraries/b' })
  expect(addressOf('repos/x', '/v/me', io({ '/v/me/repos/x': { found: false }, '/v/repos/x': { found: false } }))).toEqual({ kind: 'path', path: '/v/me/repos/x' })
  expect(addressOf('03 Libraries/none', '/v/03 Libraries/a', io(fs))).toEqual({ kind: 'path', path: '/v/03 Libraries/a/03 Libraries/none' })
  expect(addressOf('o/r', '/v/a', io({}))).toEqual({ kind: 'github', owner: 'o', repo: 'r', path: '' })
  expect(addressOf('./b', '/v/03 Libraries/a', io(fs))).toEqual({ kind: 'path', path: '/v/03 Libraries/a/b' })
})
it('mutual when two instances in a vault list each other by vault-relative paths', () => {
  const fs: Record<string, R> = {
    '/v/03 Libraries/a': { found: true, doc: { peers: [{ name: 'B', repo: '03 Libraries/b' }] } },
    '/v/03 Libraries/b': { found: true, doc: { peers: [{ name: 'A', repo: '03 Libraries/a' }] } },
  }
  const self = selfAddresses('/v/03 Libraries/a', [], io(fs))
  expect(linkState(peer('03 Libraries/b'), self, '/v/03 Libraries/a', io(fs))).toEqual({ state: 'mutual', path: '/v/03 Libraries/b', reason: null })
})
it('mutual when their entry for us has a ref that does not match but a url that does', () => {
  const fs: Record<string, R> = {
    '/v/hub': { found: true, doc: { peers: [{ name: 'Me', repo: '03 Libraries/elsewhere', url: 'https://github.com/me-org/me-os' }] } },
  }
  const self = selfAddresses('/v/me', ['git@github.com:me-org/me-os.git'], io(fs))
  expect(linkState(peer('../hub'), self, '/v/me', io(fs)).state).toBe('mutual')
})

// Final review I2: single-label hosts and a trailing-dot localhost are not public; github.com/… without a scheme is.
it('isPublicUrl refuses a host with no dot and a localhost written with a trailing dot', () => {
  for (const u of ['https://nas/', 'https://intranet', 'https://localhost./', 'https://box.local./', 'https://db.internal.'])
    expect(isPublicUrl(u), u).toBe(false)
  expect(isPublicUrl('https://example.org./')).toBe(true)
})
it('publicHref reads github.com/<o>[/<r>] without a scheme as https, and anything else not public as null', () => {
  expect(publicHref('github.com/ReFi-DAO')).toBe('https://github.com/ReFi-DAO')
  expect(publicHref('github.com/regen-coordination/hub')).toBe('https://github.com/regen-coordination/hub')
  expect(publicHref('https://hub.example.org/')).toBe('https://hub.example.org/')
  for (const u of ['github.com/o/r/tree/main/x', 'example.org', '../x', 'https://nas/', null]) expect(publicHref(u), String(u)).toBeNull()
})
