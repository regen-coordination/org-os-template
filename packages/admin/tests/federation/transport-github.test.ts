import { describe, it, expect } from 'vitest'
import { buildRequest, requestText } from '../../lib/federation/request.mjs'
import { transportOf } from '../../server/federation/transports/index.ts'
import { withFakeGh } from '../gh-shim.ts'

const gh = transportOf('github')!
const WHERE = 'https://github.com/moss/hub'
const mk = (extra: Record<string, unknown> = {}) => buildRequest({
  id: '11111111-2222-4333-8444-555555555555',
  from: { name: 'Fern Node', type: 'cooperative', url: 'https://fern.example.org' },
  hub: { name: 'Moss Hub', url: 'https://moss.example.org' },
  network: 'moss-network', answers: {}, now: '2026-11-22T10:00:00Z', ...extra,
})
const request = mk()
const ctxOf = (run: any) => ({ run, repo: '/nowhere' })
const fenced = (y: string) => `A request.\n\n\`\`\`yaml\n${y}\`\`\`\n`

describe('github transport', () => {
  it('is the real transport at the github position', () => {
    expect(gh.label).toBe('Send as a GitHub issue')
  })
  it('unavailable: wrong where, and an invite', () => {
    expect(gh.unavailable(WHERE, request)).toBeNull()
    expect(gh.unavailable('https://gitlab.com/a/b', request)).toBe("This hub doesn't take requests on GitHub.")
    expect(gh.unavailable(null, request)).toBe("This hub doesn't take requests on GitHub.")
    expect(gh.unavailable('https://github.com/a', request)).toBe("This hub doesn't take requests on GitHub.")
    expect(gh.unavailable(WHERE, mk({ invite: 'tok-secret' }))).toBe('An invited request goes as a file, so the invite stays private.')
  })
  it('ready: gh missing, not signed in, fine', async () => {
    let r = await withFakeGh({ '--version': { code: 1 } }, run => gh.ready(ctxOf(run)))
    expect(r.result).toBe('Install the GitHub CLI (gh) to send this way, or send it as a file.')
    r = await withFakeGh({ '--version': {}, 'auth status': { code: 1 } }, run => gh.ready(ctxOf(run)))
    expect(r.result).toBe('Sign in to gh first: gh auth login.')
    expect(r.calls).toEqual([['--version'], ['auth', 'status']])
    r = await withFakeGh({ '--version': {}, 'auth status': {} }, run => gh.ready(ctxOf(run)))
    expect(r.result).toBeNull()
  })
  it('send: exact argv, body from a file never on the command line, ref is the URL', async () => {
    const { result, calls, bodies } = await withFakeGh(
      { 'issue create': { stdout: 'https://github.com/moss/hub/issues/7\n' } }, run => gh.send(request, WHERE, ctxOf(run)))
    expect(result.ref).toBe('https://github.com/moss/hub/issues/7')
    expect(calls).toHaveLength(1)
    const a = calls[0]
    expect(a.slice(0, 6)).toEqual(['issue', 'create', '--repo', 'moss/hub', '--title', 'org-os join request: Fern Node → moss-network'])
    expect(a[6]).toBe('--body-file')
    expect(a).toHaveLength(8)
    expect(a.join(' ')).not.toContain('Fern Node\ntype')
    expect(a.slice(7).join(' ')).not.toContain('fern.example.org')
    expect(bodies[0]).toContain('```yaml\n' + requestText(request) + '```')
  })
  it('send escapes a backtick fence in the request', async () => {
    const r = mk({ answers: { why: 'x\n```\n# injected\n```\n' } })
    const { bodies } = await withFakeGh({ 'issue create': { stdout: 'https://github.com/moss/hub/issues/8' } }, run => gh.send(r, WHERE, ctxOf(run)))
    const polled = await withFakeGh({ 'issue list': { stdout: JSON.stringify([{ url: 'u', body: bodies[0] }]) } }, run => gh.poll!(WHERE, ctxOf(run)))
    expect(polled.result).toHaveLength(1)
    expect(polled.result[0].text).toBe(requestText(r))
  })
  it('an invited request never goes into an issue', async () => {
    const inv = mk({ invite: 'tok-secret' })
    expect(gh.unavailable(WHERE, inv)).toBe('An invited request goes as a file, so the invite stays private.')
    const { calls } = await withFakeGh({ 'issue create': {} }, async run => { await expect(gh.send(inv, WHERE, ctxOf(run))).rejects.toThrow('invite stays private') })
    expect(calls).toEqual([])
  })
  it('send throws with a sentence when gh fails, and on a wrong where', async () => {
    await withFakeGh({ 'issue create': { code: 1 } }, async run => { await expect(gh.send(request, WHERE, ctxOf(run))).rejects.toThrow(/GitHub/) })
    const { calls } = await withFakeGh({}, async run => { await expect(gh.send(request, 'https://x.org/a/b', ctxOf(run))).rejects.toThrow("doesn't take requests on GitHub") })
    expect(calls).toEqual([])
  })
  it('poll: exact argv, yaml blocks become Incoming, an issue with no block is skipped', async () => {
    const list = JSON.stringify([{ url: 'https://github.com/moss/hub/issues/1', body: fenced(requestText(request)) }, { url: 'https://github.com/moss/hub/issues/2', body: 'no yaml here' }])
    const { result, calls } = await withFakeGh({ 'issue list': { stdout: list } }, run => gh.poll!(WHERE, ctxOf(run)))
    expect(calls[0]).toEqual(['issue', 'list', '--repo', 'moss/hub', '--state', 'open', '--search', 'org-os join request in:title', '--json', 'url,body', '--limit', '50'])
    expect(result).toEqual([{ ref: 'https://github.com/moss/hub/issues/1', text: requestText(request) }])
  })
  it('status: open, accepted, refused, closed without a verdict', async () => {
    const ref = 'https://github.com/moss/hub/issues/1'
    const st = async (o: unknown) => (await withFakeGh({ 'issue view': { stdout: JSON.stringify(o) } }, run => gh.status!(ref, ctxOf(run)))).result
    const c = (body: string, authorAssociation = 'MEMBER') => ({ body, authorAssociation })
    expect(await st({ state: 'OPEN', comments: [] })).toEqual({ state: 'waiting' })
    expect(await st({ state: 'CLOSED', comments: [c('hi'), c('Accepted: welcome aboard.\nmore', 'OWNER')] })).toEqual({ state: 'accepted', reason: 'Accepted: welcome aboard.' })
    expect(await st({ state: 'CLOSED', comments: [c('Refused: not a fit.', 'COLLABORATOR')] })).toEqual({ state: 'refused', reason: 'Refused: not a fit.' })
    expect(await st({ state: 'CLOSED', comments: [c('closing')] })).toEqual({ state: 'waiting' })
    const { calls } = await withFakeGh({ 'issue view': { stdout: '{"state":"OPEN","comments":[]}' } }, run => gh.status!(ref, ctxOf(run)))
    expect(calls[0]).toEqual(['issue', 'view', ref, '--json', 'state,comments'])
  })
  it('status: only trusted commenters decide', async () => {
    const ref = 'https://github.com/moss/hub/issues/1'
    const st = async (o: unknown) => (await withFakeGh({ 'issue view': { stdout: JSON.stringify(o) } }, run => gh.status!(ref, ctxOf(run)))).result
    const c = (body: string, authorAssociation: string) => ({ body, authorAssociation })
    expect(await st({ state: 'CLOSED', comments: [c('Accepted: sure.', 'NONE')] })).toEqual({ state: 'waiting' })
    expect(await st({ state: 'CLOSED', comments: [c('Accepted: sure.', 'CONTRIBUTOR')] })).toEqual({ state: 'waiting' })
    // the requester closing with their own verdict (they are not the hub's people)
    expect(await st({ state: 'CLOSED', comments: [c('Accepted: me, myself.', 'NONE')] })).toEqual({ state: 'waiting' })
    expect(await st({ state: 'CLOSED', comments: [c('Refused: no.', 'MEMBER'), c('Accepted: yes!', 'NONE'), c('Accepted: yes!', 'CONTRIBUTOR')] })).toEqual({ state: 'refused', reason: 'Refused: no.' })
    expect(await st({ state: 'CLOSED', comments: [c('Acceptedx', 'OWNER')] })).toEqual({ state: 'waiting' })
    const long = await st({ state: 'CLOSED', comments: [c('Refused: ' + 'y'.repeat(500), 'OWNER')] }) as { reason: string }
    expect(long.reason).toHaveLength(200)
  })
  it('status and reply refuse a malformed ref without calling gh', async () => {
    for (const bad of ['--web', 'https://evil.example/moss/hub/issues/1', 'https://github.com/moss/hub/pull/1', 'https://github.com/moss/hub/issues/x']) {
      const { calls } = await withFakeGh({ 'issue view': {}, 'issue close': {} }, async run => {
        await expect(gh.status!(bad, ctxOf(run))).rejects.toThrow()
        await expect(gh.reply!(bad, { kind: 'accepted', sentence: 'x' }, ctxOf(run))).rejects.toThrow()
      })
      expect(calls).toEqual([])
    }
  })
  it('reply: closes with the comment', async () => {
    const ref = 'https://github.com/moss/hub/issues/1'
    const { calls } = await withFakeGh({ 'issue close': {} }, run => gh.reply!(ref, { kind: 'refused', sentence: 'Not a fit.' }, ctxOf(run)))
    expect(calls[0]).toEqual(['issue', 'close', ref, '--comment', 'Refused: Not a fit.'])
    const a = await withFakeGh({ 'issue close': {} }, run => gh.reply!(ref, { kind: 'accepted', sentence: 'Welcome.' }, ctxOf(run)))
    expect(a.calls[0][4]).toBe('Accepted: Welcome.')
  })
})
