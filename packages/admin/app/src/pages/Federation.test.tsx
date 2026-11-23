// @vitest-environment jsdom
// Network N2 Task 13: /federation — the org's links with both sides' sources and drift, the Published links section and
// its confirmed publish, asking to join (node), taking requests (hub), invites and the migration rows. The api is
// stubbed; nothing here reaches the network, and every network step is a plan the operator confirms.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import Federation from './Federation.tsx'
import { atprotoLine, driftFix, keptLine, linkWords, planCounts, policySentence } from './federationWords.ts'
import { fetchRoutes } from '../test/fetchRoutes.ts'
import { renderAt } from '../test/render.tsx'
import { baseRoutes, refuse } from '../test/data.ts'

afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState(null, '', '/') })
beforeEach(() => { window.history.replaceState(null, '', '/') })

const SELF_DID = 'did:plc:fixtureorg0000000000000'
const HUB_DID = 'did:plc:meshhub00000000000000000'
const PRIV_DID = 'did:plc:hiddengrove0000000000000'
const PRIV_NAME = 'Hidden Grove'
const HUB = 'https://mesh-hub.example.org'
const OUT_ID = '3f8a2c1e-5b7d-4e9a-8c10-2d6f4a9b7e31'
const TOKEN = 'tok-ONLY-ONCE-8812'

const res = (over: Record<string, unknown>) => ({ board: 'systems', status: null, attention: null, changed: null, source: { path: 'federation.yaml', editable: false }, ...over })

type Facts = Record<string, unknown>
const selfCard = (facts: Facts = {}) => res({
  id: 'instance:fixture-org', kind: 'instance', name: 'Fixture Org', status: 'this instance',
  facts: {
    self: true, did: SELF_DID, pds: 'https://pds-one.example.com',
    // Our record of the private peer is still published: urgent drift whose subject is its DID, which is never drawn.
    drift: [{ side: 'ours', text: 'Published, but federation.yaml no longer lists it.', urgent: true, uri: `at://${SELF_DID}/x/1`, subject: PRIV_DID }],
    networks: [{ name: 'Mesh', hub: HUB, role: 'node' }, { name: 'Grove Circle', hub: 'https://hidden-grove.example.org', role: 'node' }],
    join: null,
    published: { at: '2026-11-20T09:00:00.000Z', created: 1, deleted: 0 },
    toPublish: 2, publishBlocked: null, publishPlan: { create: 1, delete: 1, profile: false }, profileWithheld: false, kept: 1,
    outgoing: [], inbox: 0, toReply: [],
    ...facts,
  },
})
const hubCard = (facts: Facts = {}) => res({
  id: 'instance:mesh-hub', kind: 'instance', name: 'Mesh Hub', status: 'mutual',
  facts: { url: HUB, link: 'mutual', linkReason: 'checked 2026-11-22', checked: '2026-11-22T10:00:00.000Z', relation: 'memberOf', public: true,
    sources: { files: 'lists-us', atproto: 'lists-us', checked: '2026-11-22T10:00:00.000Z' },
    drift: [{ side: 'ours', text: 'Not published yet.' }, { side: 'theirs', text: "Their files list you; their record isn't published." }], ...facts },
})
const privateCard = () => res({
  id: 'instance:hidden-grove', kind: 'instance', name: PRIV_NAME, status: 'mutual',
  facts: { url: 'https://hidden-grove.example.org', link: 'mutual', linkReason: null, checked: null, relation: 'peerOf', public: false,
    sources: { files: 'lists-us', atproto: 'unknown', checked: null }, did: PRIV_DID,
    drift: [{ side: 'ours', text: 'Published, but federation.yaml lists it as private.', urgent: true, uri: `at://${SELF_DID}/x/2` }] },
})
const op = (id: string, label: string, over: Record<string, unknown> = {}) =>
  ({ id, label, effect: 'reads', network: true, confirm: true, params: { type: 'object' }, preset: null, unavailable: null, ...over })
const OPS = (publishWhy: string | null = null, more: unknown[] = []) => [
  op('federation.check-links', 'Check links'),
  op('federation.publish-links', 'Publish links', { effect: 'changes', unavailable: publishWhy }),
  ...more,
]
const MIGRATION = {
  rows: [
    { index: 0, name: 'Mesh Hub', did: HUB_DID, didSource: 'federation.yaml', didVerified: true, relation: 'memberOf', relationSource: 'derived', publishable: true, why: null, binding: null },
    { index: 3, name: 'River Coop', did: 'did:plc:rivercoop000000000000000', didSource: 'their federation.json', didVerified: false, relation: null, relationSource: null, publishable: false,
      why: 'No DID yet.', binding: 'The profile that ties this DID to this peer was read more than a day ago. Look it up again.' },
    { index: 4, name: 'Seat Council', did: null, didSource: null, didVerified: false, relation: null, relationSource: null, publishable: false, why: 'No DID yet.', binding: null },
  ],
  kept: { private: 1, noUrl: 0 },
}
const routes = (over: Record<string, unknown> = {}, self = selfCard()) => baseRoutes({
  'GET /api/resources': [self, hubCard(), privateCard()],
  'GET /api/operations': OPS(),
  'GET /api/federation/migration': MIGRATION,
  'GET /api/governance': { model: null, description: null, rules: [], problems: [], decisions: [
    { date: '2026-10-01', id: 'D-7', title: 'Open the network', status: 'approved', group: 'ratified', where: 'governance.yaml' },
    { date: '2026-11-01', id: 'D-9', title: 'Still being discussed', status: 'proposed', group: 'open', where: 'governance.yaml' },
  ] },
  'GET /api/jobs': [],
  ...over,
})
const nonGets = (calls: { method: string; path: string }[]) => calls.filter(c => c.method !== 'GET')
const region = (name: string) => screen.findByRole('region', { name })

describe('the words (pure)', () => {
  it('each link state in plain words, and a refusal with its reason', () => {
    expect(linkWords('mutual')).toBe('Part of it')
    expect(linkWords('requested')).toBe('Asked, waiting')
    expect(linkWords('claimed')).toBe('Only this side lists it')
    expect(linkWords('left')).toBe('Left')
    expect(linkWords('mutual', { reason: 'not a local node' })).toBe('Refused: not a local node')
    // A reason read back from the hub's verdict line keeps its word once.
    expect(linkWords('mutual', { reason: 'Refused: not a fit.' })).toBe('Refused: not a fit.')
    expect(linkWords('mutual', { reason: 'Refused:' })).toBe('Refused: no reason given')
    expect(linkWords('unknown')).toBe('Not checked yet')
  })

  it('each atproto line, and a left from a withdrawn record', () => {
    expect(atprotoLine('mutual', { atproto: 'lists-us' })).toBe("On atproto: they've published it")
    expect(atprotoLine('claimed', { atproto: 'silent' })).toBe('On atproto: not yet')
    expect(atprotoLine('claimed', { atproto: 'not-on-atproto' })).toBe("On atproto: they're not on atproto")
    expect(atprotoLine('unknown', { atproto: 'unknown' }, "couldn't check their records (2026-11-21T08:00:00.000Z)")).toBe("On atproto: couldn't check (2026-11-21)")
    expect(atprotoLine('left', { atproto: 'silent' })).toBe('They withdrew their record.')
  })

  it('the policy sentences, the plan counts, the private count and each drift fix', () => {
    expect(policySentence('closed')).toBe("This network isn't taking requests.")
    expect(policySentence(null)).toBe("This network isn't taking requests.")
    expect(policySentence('invite')).toBe('This network joins by invite.')
    expect(policySentence('open-with-approval')).toBe('Anyone can ask. The hub decides under its own rules.')
    expect(policySentence('open')).toBe('Anyone can join. The hub has agreed to accept requests.')
    expect(planCounts({ create: 1, delete: 2, profile: true })).toBe('1 link to publish, 2 to withdraw, and the profile to update.')
    expect(keptLine(0)).toBeNull()
    expect(keptLine(2)).toBe('2 peers are kept private and never published.')
    expect(driftFix({ side: 'ours', text: 'Not published yet.' })).toEqual({ publish: true })
    expect(driftFix({ side: 'theirs', text: "Their record is published; their files don't list you." })).toEqual({ say: 'Ask them to list you in their federation.yaml.' })
  })
})

describe('Networks', () => {
  it('each network with its state and its atproto line', async () => {
    fetchRoutes(routes())
    renderAt(<Federation />, '/federation')
    const nets = await region('Networks')
    const row = await within(nets).findByRole('listitem', { name: 'Mesh' })
    expect(within(row).getByText('Part of it')).toBeTruthy()
    expect(within(row).getByText("On atproto: they've published it")).toBeTruthy()
  })

  it('a refused request says why; an accepted one offers Record it; an invited file send offers the saved file, never its text', async () => {
    const outgoing = [{ id: OUT_ID, network: 'Mesh', hub: HUB, onTrunk: true, invited: true, where: 'https://github.com/mesh/hub',
      sent: { transport: 'file', ref: 'file', at: '2026-11-22T10:00:00.000Z' }, status: { state: 'accepted', reason: 'Welcome', at: '2026-11-22T11:00:00.000Z' }, atproto: { theirs: 'silent' } }]
    const { calls } = fetchRoutes(routes({ 'GET /api/resources': [selfCard({ outgoing }), hubCard({ link: 'requested' }), privateCard()] }))
    renderAt(<Federation />, '/federation')
    const row = await within(await region('Networks')).findByRole('listitem', { name: 'Mesh' })
    expect(within(row).getByRole('button', { name: 'Record it' })).toBeTruthy()
    expect(within(row).getByText('Accepted: Welcome. Record it, then publish.')).toBeTruthy()
    const file = within(row).getByRole('link', { name: 'Download the request file' }) as HTMLAnchorElement
    expect(file.getAttribute('href')).toBe(`/api/federation/outgoing/${OUT_ID}/request-file`)
    expect(file.hasAttribute('download')).toBe(true)
    // The page only links to it: the file (and the invite in it) is never fetched into the page.
    expect(calls.some(c => c.path.includes('request-file'))).toBe(false)
  })

  it('a refused request shows its reason', async () => {
    const outgoing = [{ id: OUT_ID, network: 'Mesh', hub: HUB, onTrunk: true, invited: false, where: null, sent: { transport: 'github', ref: 'mesh/hub#4', at: '2026-11-22T10:00:00.000Z' },
      status: { state: 'refused', reason: 'not a local node', at: '2026-11-22T11:00:00.000Z' }, atproto: { theirs: 'unknown' } }]
    fetchRoutes(routes({ 'GET /api/resources': [selfCard({ outgoing }), hubCard({ link: 'requested' }), privateCard()] }))
    renderAt(<Federation />, '/federation')
    const row = await within(await region('Networks')).findByRole('listitem', { name: 'Mesh' })
    expect(within(row).getByText('Refused: not a local node')).toBeTruthy()
  })
})

describe('privacy: the page names no private or url-less peer', () => {
  it('no private peer name or DID renders anywhere; it is counted only', async () => {
    fetchRoutes(routes())
    renderAt(<Federation />, '/federation')
    await region('Published links')
    await screen.findByText('1 peer is kept private and never published.')
    await screen.findByText('1 network is kept private, so it is not listed here.')
    const text = document.body.textContent ?? ''
    for (const hidden of [PRIV_NAME, PRIV_DID, 'hidden-grove', 'Grove Circle']) expect(text).not.toContain(hidden)
    // Its drift line is still there, without a name: its fix is the confirmed publish.
    expect(screen.getAllByText('Published, but federation.yaml lists it as private.').length).toBe(1)
  })
})

describe('Published links', () => {
  it('the DID and its PDS, the plan in counts, and each drift line with its fix, ours first', async () => {
    fetchRoutes(routes())
    renderAt(<Federation />, '/federation')
    const pub = await region('Published links')
    expect(within(pub).getByText(SELF_DID)).toBeTruthy()
    expect(within(pub).getByText('https://pds-one.example.com')).toBeTruthy()
    expect(within(pub).getByText('1 link to publish, 1 to withdraw.')).toBeTruthy()
    const lines = within(within(pub).getByRole('list', { name: 'Drift' })).getAllByRole('listitem')
    expect(lines.map(l => l.querySelector('.fed-drift-t')?.textContent)).toEqual([
      'Published, but federation.yaml no longer lists it.',
      'Published, but federation.yaml lists it as private.',
      'Mesh Hub: Not published yet.',
      "Mesh Hub: Their files list you; their record isn't published.",
    ])
    expect(within(lines[0]!).getByText('Publish fixes it.')).toBeTruthy()
    // One Publish for every line of ours: the confirmed publish-links, never a write per line.
    expect((await within(pub).findAllByRole('button', { name: /^Publish/ })).map(b => b.textContent)).toEqual(['Publish links'])
    expect(within(lines[3]!).getByText('Ask them to publish their record.')).toBeTruthy()
  })

  it('without a DID it says to set one first', async () => {
    fetchRoutes(routes({}, selfCard({ did: null, pds: null })))
    renderAt(<Federation />, '/federation')
    expect(await within(await region('Published links')).findByText("Set this instance's DID first.")).toBeTruthy()
  })

  it('Publish is disabled with each refusal sentence of the plan', async () => {
    const SENTENCES = [
      "Set this instance's DID first (identity.did).", "kms.yaml's atproto account isn't this instance's DID.",
      "Put the app password in the server's environment (ATPROTO_APP_PASSWORD).", "This DID's PDS isn't the one kms.yaml names.",
      "The network's lexicon isn't set yet (example.*), so nothing is written to a live account.", 'Check the links first.',
      "The last check of this instance's records failed. Check the links again.", 'This would remove every published link at once (3). Nothing was written.',
      'Nothing to publish.', "Nothing to publish. Your profile record couldn't be read, so it was left as it is.",
      "Publishing can't be planned here right now. Check the links, then try again.",
    ]
    for (const why of SENTENCES) {
      const { calls } = fetchRoutes(routes({ 'GET /api/operations': OPS(why) }))
      const view = renderAt(<Federation />, '/federation')
      const pub = await region('Published links')
      const button = await waitFor(() => { const b = within(pub).getByRole('button', { name: 'Publish links' }); expect(b.getAttribute('aria-disabled')).toBe('true'); return b })
      expect(pub.querySelector('.ops-why')?.textContent).toBe(why)
      fireEvent.click(button)
      expect(nonGets(calls)).toEqual([])
      view.unmount()
    }
  })

  it('publish is reached only through the plan, then the confirm, then the job with its nonce', async () => {
    const { calls } = fetchRoutes(routes({
      'POST /api/operations/federation.publish-links/plan': { op: 'federation.publish-links', resource: 'instance:fixture-org', inProcess: true, cmd: null, args: [], writes: [], timeoutMs: 300000,
        confirm: true, nonce: 'n-1', summary: 'Publish 1 link and withdraw 1. 1 peer is kept private.' },
      'POST /api/jobs': { id: 'job-1', op: 'federation.publish-links', resource: 'instance:fixture-org', label: 'Publish links', status: 'queued', created: '2026-11-23T10:00:00.000Z' },
      'GET /api/jobs/job-1': { job: { id: 'job-1', op: 'federation.publish-links', resource: 'instance:fixture-org', label: 'Publish links', status: 'ok', created: '2026-11-23T10:00:00.000Z',
        started: null, ended: null, exitCode: 0, changed: [], surprises: [], sentence: 'Published 1 link and withdrew 1.', cmd: null, args: [], writes: [] }, log: 'Published 1 link and withdrew 1.\n' },
    }))
    renderAt(<Federation />, '/federation')
    const pub = await region('Published links')
    fireEvent.click(await within(pub).findByRole('button', { name: 'Publish links' }))
    const dialog = await screen.findByRole('dialog', { name: 'Publish links' })
    expect(within(dialog).getByText('Publish 1 link and withdraw 1. 1 peer is kept private.')).toBeTruthy()
    expect(within(dialog).getByText('This writes to atproto.')).toBeTruthy()
    expect(dialog.textContent).not.toMatch(/reads only/)
    expect(calls.filter(c => c.method === 'POST').map(c => c.path)).toEqual(['/api/operations/federation.publish-links/plan'])
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(calls.some(c => c.method === 'POST' && c.path === '/api/jobs')).toBe(true))
    expect(calls.filter(c => c.method === 'POST' && c.path === '/api/jobs').map(c => c.body)).toEqual([{ nonce: 'n-1' }])
    expect((await within(pub).findAllByText('Published 1 link and withdrew 1.')).length).toBeGreaterThan(0)
  })
})

describe('Bring your peers onto atproto', () => {
  it('a suggested DID is a suggestion to look up; a stale one says to look it up again; Stage sends only did and link', async () => {
    const { calls } = fetchRoutes(routes({ 'POST /api/federation/migration': { set: [4], staged: true } }))
    renderAt(<Federation />, '/federation')
    const mig = await region('Bring your peers onto atproto')
    const river = await within(mig).findByRole('listitem', { name: 'River Coop' })
    expect(river.textContent).toContain('Suggested: did:plc:rivercoop000000000000000 (from their federation.json).')
    expect(within(river).getByText('The profile that ties this DID to this peer was read more than a day ago. Look it up again.')).toBeTruthy()
    expect(within(river).getByRole('button', { name: 'Look it up' })).toBeTruthy()
    expect(within(river).queryByRole('button', { name: 'Use it' })).toBeNull()
    const seat = within(mig).getByRole('listitem', { name: 'Seat Council' })
    fireEvent.change(within(seat).getByLabelText('DID or handle'), { target: { value: 'did:plc:seatcouncil00000000000000' } })
    fireEvent.change(within(seat).getByLabelText('How it is linked'), { target: { value: 'peerOf' } })
    fireEvent.click(within(mig).getByRole('button', { name: 'Stage' }))
    await within(mig).findByText('Staged. Review it in Changes.')
    const sent = calls.filter(c => c.method === 'POST' && c.path === '/api/federation/migration').map(c => c.body as { set: Record<string, unknown>[] })
    expect(sent).toEqual([{ set: [{ index: 4, did: 'did:plc:seatcouncil00000000000000', link: 'peerOf' }] }])
    for (const entry of sent[0]!.set) expect(Object.keys(entry).sort().every(k => ['did', 'index', 'link'].includes(k))).toBe(true)
  })

  it('Look it up is the confirmed check, by DID or by handle', async () => {
    const { calls } = fetchRoutes(routes({
      'POST /api/operations/federation.check-links/plan': { op: 'federation.check-links', resource: 'instance:fixture-org', inProcess: true, cmd: null, args: [], writes: [], timeoutMs: 1,
        confirm: true, nonce: 'n-2', summary: 'look up seat.example.org on atproto, both ways: a download, it changes no file' },
    }))
    renderAt(<Federation />, '/federation')
    const seat = await within(await region('Bring your peers onto atproto')).findByRole('listitem', { name: 'Seat Council' })
    fireEvent.change(within(seat).getByLabelText('DID or handle'), { target: { value: 'seat.example.org' } })
    fireEvent.click(within(seat).getByRole('button', { name: 'Look it up' }))
    await screen.findByRole('dialog', { name: 'Look it up' })
    expect(calls.filter(c => c.method === 'POST').map(c => c.body)).toEqual([{ resource: 'instance:fixture-org', params: { handle: 'seat.example.org' } }])
  })

  it('is not shown when every row is publishable', async () => {
    fetchRoutes(routes({ 'GET /api/federation/migration': { rows: [MIGRATION.rows[0]], kept: { private: 0, noUrl: 0 } } }))
    renderAt(<Federation />, '/federation')
    await region('Published links')
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Bring your peers onto atproto' })).toBeNull())
  })
})

const HUB_VIEW = (join: Record<string, unknown> | null) => ({ hub: { name: 'Mesh Hub', type: 'Network', url: HUB, networks: ['Mesh', 'Valley'], join } })
const JOIN = (policy: string, asks: string[] = []) => ({ policy, types: [], asks, where: 'https://github.com/mesh/hub', decision: null })

describe('Ask to join a network', () => {
  it('pre-fills from the link and sends nothing', async () => {
    window.history.replaceState(null, '', `/federation?hub=${encodeURIComponent(HUB)}&network=Mesh#invite=${TOKEN}`)
    const { calls } = fetchRoutes(routes({ 'GET /api/federation/hub': { problem: 'Look it up first.' } }))
    renderAt(<Federation />, `/federation?hub=${encodeURIComponent(HUB)}&network=Mesh`)
    const ask = await region('Ask to join a network')
    await waitFor(() => expect((within(ask).getByLabelText("The hub's address") as HTMLInputElement).value).toBe(HUB))
    expect((within(ask).getByLabelText('The network') as HTMLInputElement).value).toBe('Mesh')
    expect((within(ask).getByLabelText('Invite link') as HTMLInputElement).value).toBe(TOKEN)
    expect(window.location.hash).toBe('')
    await new Promise(r => setTimeout(r, 30))
    expect(nonGets(calls)).toEqual([])
    expect(calls.some(c => c.path.startsWith('/api/operations/') || c.path === '/api/federation/ask' || c.path.includes('federation.publish-links'))).toBe(false)
  })

  it('reads an encoded #invite= from the launcher back to the token, and clears it', async () => {
    const odd = 'a b/+=&x'
    window.history.replaceState(null, '', `/federation?hub=${encodeURIComponent(HUB)}&network=Mesh#invite=${encodeURIComponent(odd)}`)
    fetchRoutes(routes({ 'GET /api/federation/hub': { problem: 'Look it up first.' } }))
    renderAt(<Federation />, `/federation?hub=${encodeURIComponent(HUB)}&network=Mesh`)
    const ask = await region('Ask to join a network')
    await waitFor(() => expect((within(ask).getByLabelText('Invite link') as HTMLInputElement).value).toBe(odd))
    expect(window.location.hash).toBe('')
  })

  it('Look it up is the confirmed check of that address', async () => {
    const { calls } = fetchRoutes(routes({
      'GET /api/federation/hub': { problem: 'Look it up first.' },
      'POST /api/operations/federation.check-links/plan': { op: 'federation.check-links', resource: 'instance:fixture-org', inProcess: true, cmd: null, args: [], writes: [], timeoutMs: 1,
        confirm: true, nonce: 'n-3', summary: `read ${HUB}: a download, it changes no file` },
    }))
    renderAt(<Federation />, '/federation')
    const ask = await region('Ask to join a network')
    fireEvent.change(within(ask).getByLabelText("The hub's address"), { target: { value: HUB } })
    fireEvent.click(await within(ask).findByRole('button', { name: 'Look it up' }))
    expect(await screen.findByText(`read ${HUB}: a download, it changes no file`)).toBeTruthy()
    expect(screen.getByRole('dialog').textContent).not.toMatch(/This writes|This posts|reaches the network and changes/)
    expect(calls.filter(c => c.method === 'POST').map(c => c.body)).toEqual([{ resource: 'instance:fixture-org', params: { address: HUB } }])
  })

  const lookedUp = async (join: Record<string, unknown> | null, over: Record<string, unknown> = {}) => {
    const stub = fetchRoutes(routes({ 'GET /api/federation/hub': HUB_VIEW(join), ...over }))
    renderAt(<Federation />, `/federation?hub=${encodeURIComponent(HUB)}&network=Mesh`)
    const ask = await region('Ask to join a network')
    await within(ask).findByText(/^Mesh Hub \(Network\)\./)
    return { ask, ...stub }
  }

  it('a closed hub disables Ask', async () => {
    const { ask } = await lookedUp(JOIN('closed'))
    expect(within(ask).getByText("Mesh Hub (Network). This network isn't taking requests.")).toBeTruthy()
    expect(within(ask).getByRole('button', { name: 'Ask' }).getAttribute('aria-disabled')).toBe('true')
  })

  it('the invite field appears only for invite', async () => {
    const one = await lookedUp(JOIN('open-with-approval'))
    expect(within(one.ask).queryByLabelText('Invite link')).toBeNull()
    document.body.innerHTML = ''
    const two = await lookedUp(JOIN('invite'))
    expect(within(two.ask).getByLabelText('Invite link')).toBeTruthy()
    expect(within(two.ask).getByText('Mesh Hub (Network). This network joins by invite.')).toBeTruthy()
  })

  it('an unanswered ask disables Ask; answered, Ask stages, then Send offers each way, the waiting ones greyed with their sentence', async () => {
    const { ask, calls } = await lookedUp(JOIN('open-with-approval', ['why']), {
      'POST /api/federation/ask': { id: OUT_ID, staged: true },
      'GET /api/federation/transports': [
        { id: 'file', label: 'Save a file to send', unavailable: null },
        { id: 'github', label: 'Send as a GitHub issue', unavailable: null },
        { id: 'hosted', label: 'Send through a hosted hub', unavailable: 'Comes with hosted hubs, after sign-in.' },
        { id: 'p2p', label: 'Send peer to peer', unavailable: 'Comes later.' },
        { id: 'atproto', label: 'Publish a request (public)', unavailable: 'Comes with the network index.' },
      ],
    })
    const askButton = within(ask).getByRole('button', { name: 'Ask' })
    expect(askButton.getAttribute('aria-disabled')).toBe('true')
    expect(ask.querySelector('.ops-why')?.textContent).toBe('Answer every question first.')
    fireEvent.change(within(ask).getByLabelText('why'), { target: { value: 'We run the valley node.' } })
    await waitFor(() => expect(within(ask).getByRole('button', { name: 'Ask' }).getAttribute('aria-disabled')).toBeNull())
    fireEvent.click(within(ask).getByRole('button', { name: 'Ask' }))
    await within(ask).findByText('Staged. Apply your change, then send it.')
    expect(calls.filter(c => c.method === 'POST').map(c => c.body)).toEqual([{ hub: HUB, network: 'Mesh', answers: { why: 'We run the valley node.' } }])
    const ways = await within(ask).findByRole('list', { name: 'Ways to send' })
    for (const [label, why] of [['Send through a hosted hub', 'Comes with hosted hubs, after sign-in.'], ['Send peer to peer', 'Comes later.'], ['Publish a request (public)', 'Comes with the network index.']]) {
      expect(within(ways).getByRole('button', { name: label }).getAttribute('aria-disabled')).toBe('true')
      expect(within(ways).getAllByText(why).length).toBeGreaterThan(0)
    }
    expect(within(ways).getByRole('button', { name: 'Save a file to send' }).getAttribute('aria-disabled')).toBeNull()
    expect(calls.some(c => c.path.includes('federation.publish-links'))).toBe(false)
  })
})

const HUB_SELF = (facts: Facts = {}) => selfCard({ networks: [{ name: 'Mesh', hub: null, role: 'hub' }], join: JOIN('open-with-approval'), drift: [], kept: 0, ...facts })

describe('taking requests (hub)', () => {
  it('without a join block the hub sections wait behind Take requests', async () => {
    fetchRoutes(routes())
    renderAt(<Federation />, '/federation')
    const take = await region('Take requests')
    expect(screen.queryByRole('region', { name: 'Join policy' })).toBeNull()
    fireEvent.click(within(take).getByRole('button', { name: 'Take requests' }))
    expect(await region('Join policy')).toBeTruthy()
  })

  it('the policy picker marks Recommended and stages; open without a decision says the fallback', async () => {
    const { calls } = fetchRoutes(routes({ 'GET /api/resources': [HUB_SELF(), hubCard()], 'POST /api/federation/join': { policy: 'open', staged: true } }))
    renderAt(<Federation />, '/federation')
    const pol = await region('Join policy')
    const recommended = within(pol).getByText('Recommended')
    expect(recommended.closest('label')?.textContent).toContain('Anyone can ask; you decide under your rules')
    fireEvent.click(within(pol).getByLabelText(/Anyone can join, under a standing decision/))
    expect(await within(pol).findByText('Without a decision, this works as "anyone can ask, the hub decides".')).toBeTruthy()
    fireEvent.click(within(pol).getByRole('button', { name: 'Stage' }))
    await within(pol).findByText('Staged. Review it in Changes.')
    expect(calls.filter(c => c.method === 'POST' && c.path === '/api/federation/join').map(c => c.body))
      .toEqual([{ policy: 'open', decision: null }])
    // The decision picker lists only what this instance has decided.
    const picker = within(pol).getByLabelText('The decision that agreed to it') as HTMLSelectElement
    expect([...picker.options].map(o => o.value)).toEqual(['', 'D-7'])
  })

  it('the one-time invite link shows once: in the answer, never again after a reload', async () => {
    const invite = { id: 'inv-1', link: `https://mesh-hub.example.org/.well-known/federation.json#invite=${TOKEN}`, text: "Copy this link now. It won't be shown again.", expires: '2026-12-23', staged: true }
    const { calls } = fetchRoutes(routes({ 'GET /api/resources': [HUB_SELF(), hubCard()], 'POST /api/federation/invites': () => new Response(JSON.stringify(invite), { status: 201 }) }))
    const view = renderAt(<Federation />, '/federation')
    const inv = await region('Invites')
    fireEvent.change(within(inv).getByLabelText('Their name'), { target: { value: 'Valley Node' } })
    fireEvent.change(within(inv).getByLabelText('Their type'), { target: { value: 'LocalNode' } })
    fireEvent.click(within(inv).getByRole('button', { name: 'Make an invite' }))
    expect(await within(inv).findByText(invite.link)).toBeTruthy()
    expect(within(inv).getByText("Copy this link now. It won't be shown again.")).toBeTruthy()
    expect(within(inv).getByText('For the network Mesh.')).toBeTruthy()
    expect(within(inv).getByText('Good through the end of 2026-12-23 (UTC).')).toBeTruthy()
    expect(within(inv).getByText('It works only once your change is applied.')).toBeTruthy()
    expect(calls.filter(c => c.method === 'POST' && c.path === '/api/federation/invites').map(c => c.body)).toEqual([{ name: 'Valley Node', type: 'LocalNode', network: 'Mesh', days: 30 }])
    view.unmount()
    renderAt(<Federation />, '/federation')
    await region('Invites')
    expect(document.body.textContent).not.toContain(TOKEN)
    expect(JSON.stringify(window.localStorage)).not.toContain(TOKEN)
    expect(window.location.href).not.toContain(TOKEN)
  })

  it('Import posts the file\'s text', async () => {
    const { calls } = fetchRoutes(routes({ 'GET /api/resources': [HUB_SELF(), hubCard()],
      'POST /api/federation/requests/receive': [{ ref: null, outcome: 'held', sentence: 'Held for your decision.' }] }))
    renderAt(<Federation />, '/federation')
    const reqs = await region('Requests')
    const file = new File(['spec: org-os/federation-request/1\nid: abc\n'], 'request.yaml', { type: 'text/yaml' })
    fireEvent.change(within(reqs).getByLabelText('Import a request'), { target: { files: [file] } })
    await within(reqs).findByText('Held for your decision.')
    expect(calls.filter(c => c.method === 'POST' && c.path === '/api/federation/requests/receive').map(c => c.body))
      .toEqual([{ text: 'spec: org-os/federation-request/1\nid: abc\n' }])
  })

  it('a held request shows Accept and Refuse, and Refuse needs a reason; answers are the board\'s capped ones', async () => {
    const held = res({ id: 'federation-request:req-1', kind: 'federation-request', board: 'organization', name: 'Valley Node', status: 'under-decision',
      facts: { from: 'Valley Node', network: 'Mesh', transport: 'file', ref: null, received: '2026-11-22', outcome: 'held', sentence: 'Held for your decision.', replied: null,
        answers: { why: 'We run the valley node.' } } })
    const { calls } = fetchRoutes(routes({ 'GET /api/resources': [HUB_SELF(), hubCard(), held],
      'POST /api/federation/requests/req-1/decide': { id: 'req-1', outcome: 'refused', sentence: 'Refused: not yet.' } }))
    renderAt(<Federation />, '/federation')
    const row = await within(await region('Requests')).findByRole('listitem', { name: 'Valley Node' })
    expect(within(row).getByText('why: We run the valley node.')).toBeTruthy()
    expect(within(row).getByRole('button', { name: 'Accept' })).toBeTruthy()
    const refuseButton = within(row).getByRole('button', { name: 'Refuse' })
    expect(refuseButton.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(refuseButton)
    expect(calls.some(c => c.path.endsWith('/decide'))).toBe(false)
    fireEvent.change(within(row).getByLabelText('Why you refuse'), { target: { value: 'not yet' } })
    fireEvent.click(within(row).getByRole('button', { name: 'Refuse' }))
    await within(row).findByText('Refused: not yet.')
    expect(calls.filter(c => c.path.endsWith('/decide')).map(c => c.body)).toEqual([{ accept: false, reason: 'not yet' }])
  })

  it('Receive them (n) shows when the inbox holds requests', async () => {
    fetchRoutes(routes({ 'GET /api/resources': [HUB_SELF({ inbox: 2 }), hubCard()] }))
    renderAt(<Federation />, '/federation')
    expect(await within(await region('Requests')).findByRole('button', { name: 'Receive them (2)' })).toBeTruthy()
  })
})

describe('a refusal is said, and nothing is sent', () => {
  it('a plan the server refuses is an error note in place', async () => {
    fetchRoutes(routes({ 'POST /api/operations/federation.publish-links/plan': refuse(409, { error: 'Not published: Check the links first.' }) }))
    renderAt(<Federation />, '/federation')
    const pub = await region('Published links')
    fireEvent.click(await within(pub).findByRole('button', { name: 'Publish links' }))
    expect(await within(pub).findByText('Not published: Check the links first.')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('review fixes, round 1', () => {
  it('I1: staging a policy change leaves an ask with a comma byte for byte; a touched ask list is one ask per line', async () => {
    const ask = 'Who are you, and why do you want to join?'
    const { calls } = fetchRoutes(routes({ 'GET /api/resources': [HUB_SELF({ join: { ...JOIN('open-with-approval', [ask]) } }), hubCard()],
      'POST /api/federation/join': { policy: 'invite', staged: true } }))
    renderAt(<Federation />, '/federation')
    const pol = await region('Join policy')
    expect((within(pol).getByLabelText('What a request has to say') as HTMLTextAreaElement).value).toBe(ask)
    fireEvent.click(within(pol).getByLabelText(/By invite only/))
    fireEvent.click(within(pol).getByRole('button', { name: 'Stage' }))
    await within(pol).findByText('Staged. Review it in Changes.')
    fireEvent.change(within(pol).getByLabelText('What a request has to say'), { target: { value: `${ask}\nYour portal, if any?` } })
    fireEvent.click(within(pol).getByRole('button', { name: 'Stage' }))
    await waitFor(() => expect(calls.filter(c => c.path === '/api/federation/join')).toHaveLength(2))
    expect(calls.filter(c => c.path === '/api/federation/join').map(c => c.body)).toEqual([
      { policy: 'invite' },
      { policy: 'invite', asks: [ask, 'Your portal, if any?'] },
    ])
  })

  it('M1: hosted networks count, and only role: hub is hosted (the invite picker too)', async () => {
    fetchRoutes(routes({ 'GET /api/resources': [HUB_SELF({ networks: [{ name: 'Mesh', hub: null, role: 'hub' }, { name: 'Loose', hub: null, role: 'node' }] }), hubCard()] }))
    renderAt(<Federation />, '/federation')
    const nets = await region('Networks')
    expect(nets.querySelector('.sect-n')?.textContent).toBe('1')
    expect(within(nets).getByText('This instance is the hub of Mesh.')).toBeTruthy()
    const picker = within(await region('Invites')).getByLabelText('For the network') as HTMLSelectElement
    expect([...picker.options].map(o => o.value)).toEqual(['', 'Mesh'])
  })

  it('M2: the invite fragment is cleared even when the page cannot load', async () => {
    window.history.replaceState(null, '', `/federation#invite=${TOKEN}`)
    fetchRoutes(routes({ 'GET /api/resources': refuse(500, { error: 'cannot read' }) }))
    renderAt(<Federation />, '/federation')
    await screen.findByText('cannot read')
    expect(window.location.hash).toBe('')
    expect(window.location.href).not.toContain(TOKEN)
  })

  it('M7: a hub with no type says no "(null)"', async () => {
    fetchRoutes(routes({ 'GET /api/federation/hub': { hub: { name: 'Mesh Hub', type: null, url: HUB, networks: ['Mesh'], join: JOIN('open-with-approval') } } }))
    renderAt(<Federation />, `/federation?hub=${encodeURIComponent(HUB)}&network=Mesh`)
    const ask = await region('Ask to join a network')
    expect(await within(ask).findByText('Mesh Hub. Anyone can ask. The hub decides under its own rules.')).toBeTruthy()
    expect(ask.textContent).not.toContain('(null)')
  })
})
