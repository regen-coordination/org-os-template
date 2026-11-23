// Publishing this org's own link records (network N2 Task 7): planned from federation.yaml on the trunk, written through
// kms's atproto session, confirmed. Every test runs in a fresh temp repository with a solo governance file and the fake
// network on two hosts, and passes allowPlaceholderLexicons (the lexicon is still example.*). No test touches the
// network, a real PDS or plc.directory.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeFixtureRepo, removeFixtureRepo } from '../fixtures.ts'
import { makeFakeNetwork, plcDid, type FakeNetwork } from '../fake-pds.ts'
import { LINK_NSID, PROFILE_NSID, linkKey } from '../../lib/federation/links.mjs'
import { atprotoCache, readRepo } from '../../server/federation/atproto/read.ts'
import {
  publishLinks, planPublish, publishFacts, publishLinksOperation, guardedWriteFetch, receiptPath, SENTENCES, type PublishDeps,
} from '../../server/federation/atproto/publish.ts'
import { opById, type InProcess } from '../../server/operations/catalogue.ts'
import { LocalExecutor } from '../../server/operations/executor.ts'
import { JobStore, stateDir, type JobRecord } from '../../server/state.ts'
import { HttpError } from '../../server/errors.ts'
import { kms as loadKms } from '../../server/knowledge/kms.ts'
import { fleet } from '../../server/resources/adapters/fleet.ts'
import { runCommand } from '../../server/resources/run.ts'
import type { FetchLike } from '../../server/systems/driver.ts'
import type { Graph, Resource } from '../../server/resources/types.ts'

const ONE = 'pds-one.example.com'
const TWO = 'pds-two.example.net'
const SELF = plcDid('fixture-org')
const HUB = plcDid('mesh-hub')
const FRIEND = plcDid('friendly-peer')
const QUIET = plcDid('quiet-cove')
const STRAY = plcDid('stray-account')
/** Distinctive, so a grep finds any leak. */
const PASSWORD = 'zq7-UNMISTAKABLE-app-pass-4410'
const NOW = new Date('2026-11-22T12:00:00.000Z')
const HUB_SITE = 'https://mesh-hub.example.org'

let repo: string
let net: FakeNetwork
beforeEach(() => {
  repo = makeFixtureRepo()
  net = makeFakeNetwork({ hosts: {
    [`https://${ONE}`]: { accounts: { [SELF]: { handle: 'fixture-org.example.com', password: PASSWORD } } },
    [`https://${TWO}`]: { accounts: { [HUB]: { handle: 'mesh-hub.example.org', password: 'hub-pass' }, [FRIEND]: { handle: 'friendly.example.org', password: 'f' }, [QUIET]: { handle: 'quiet.example.org', password: 'q' } } },
  } })
  write('data/governance.yaml', 'schema_version: "2.0"\ngovernance:\n  model: "solo-maintainer"\n  decisions: []\n')
  writeKms()
  writeFed(['  - name: Mesh Hub', `    did: "${HUB}"`, `    url: ${HUB_SITE}`, '    decision: "2026-10-01"'])
  commit('a DID, kms and a hub')
})
afterEach(() => removeFixtureRepo(repo))

const write = (rel: string, text: string) => writeFileSync(join(repo, rel), text)
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' }).toString()
const commit = (msg: string) => { git('add', '-A'); git('commit', '-qm', msg) }
const writeKms = (atproto: Record<string, string> = {}) => {
  const at = { did: SELF, pds: `https://${ONE}`, handle: 'fixture-org.example.com', nsid_authority: 'org.fixture', ...atproto }
  write('kms.yaml', ['adapter: repo-data', 'target: "."', 'atproto:', ...Object.entries(at).map(([k, v]) => `  ${k}: "${v}"`), ''].join('\n'))
}
const writeFed = (peers: string[], identity: string[] = [`  did: "${SELF}"`], more: string[] = []) => write('federation.yaml', [
  'identity:', '  name: "Fixture Org"', '  slug: fixture-org', ...identity,
  'networks:', '  - name: Mesh', `    hub: ${HUB_SITE}`, ...more,
  ...(peers.length ? ['peers:', ...peers] : ['peers: []']), '',
].join('\n'))
const QUIET_PEER = ['  - name: Quiet Cove', `    did: "${QUIET}"`, '    url: https://quiet-cove.example.org', '    link: peerOf', '    visibility: private']
const HUB_PEER = ['  - name: Mesh Hub', `    did: "${HUB}"`, `    url: ${HUB_SITE}`, '    decision: "2026-10-01"']

const deps = (o: Partial<PublishDeps> = {}): PublishDeps => ({
  fetch: net.fetch, lookup: net.lookup, env: { ATPROTO_APP_PASSWORD: PASSWORD }, now: NOW, allowPlaceholderLexicons: true, run: runCommand, ...o,
})
/** What a confirmed check-links leaves: this instance's records, read and cached. */
const check = async () => atprotoCache(repo).put(SELF, await readRepo(SELF, { fetch: net.fetch, lookup: net.lookup, now: NOW }), NOW)
const linkWrites = () => net.writes.filter(w => w.nsid === 'com.atproto.repo.putRecord' || w.nsid === 'com.atproto.repo.deleteRecord')
const linksOn = (did = SELF) => net.records(did, LINK_NSID).map(r => r.value)
const seedLink = (rkey: string, subject: string, relation: string, network?: string) =>
  net.seed(SELF, LINK_NSID, rkey, { $type: LINK_NSID, subject, relation, ...(network ? { network } : {}), createdAt: '2026-01-01T00:00:00.000Z' })
const signal = () => new AbortController().signal
const selfCard = async (): Promise<Resource> => ((await fleet.read({ repo, now: () => NOW, run: runCommand, lastOk: () => null })) as Graph).nodes.find(n => n.facts.self === true)!
const op = (o: Partial<PublishDeps> = {}) => publishLinksOperation(deps(o))
const planOf = async (o: Partial<PublishDeps> = {}) => (await op(o).plan(await selfCard(), {}, repo)) as InProcess
/** Every file under a folder, as text. */
const filesUnder = (dir: string): string => {
  if (!existsSync(dir)) return ''
  let out = ''
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    out += statSync(p).isDirectory() ? filesUnder(p) : `\n${p}\n${readFileSync(p, 'utf8')}`
  }
  return out
}
const refusal = async (p: Promise<unknown>): Promise<string> => {
  try { await p } catch (err) { return (err as Error).message }
  throw new Error('expected a refusal')
}

describe('the plan follows federation.yaml on the trunk, never the records', () => {
  it('a peer staged but not applied is not published; after apply it is; a record federation.yaml does not list is withdrawn, federation.yaml untouched', async () => {
    // Before: the trunk lists no peer.
    writeFed([])
    commit('no peers yet')
    await check()
    expect(await refusal(planOf())).toBe(`Not published: ${SENTENCES.nothing}`)
    // Staged (in the working tree and the index), not applied: still nothing.
    writeFed(HUB_PEER)
    git('add', 'federation.yaml')
    expect(await refusal(planOf())).toBe(`Not published: ${SENTENCES.nothing}`)
    const staged = await publishLinks(repo, deps())
    expect(staged.applied).toEqual({ created: 0, deleted: 0, profile: false })
    expect(linkWrites()).toEqual([])

    // Applied: on the trunk now.
    git('commit', '-qm', 'apply: the hub')
    expect((await planOf()).summary).toBe('Publish 1 link and withdraw 0, and update the profile.')
    const done = await publishLinks(repo, deps())
    expect(done.applied).toEqual({ created: 1, deleted: 0, profile: true })
    expect(linksOn()).toEqual([{ $type: LINK_NSID, subject: HUB, relation: 'memberOf', network: 'Mesh', createdAt: NOW.toISOString() }])
    expect(net.records(SELF, LINK_NSID)[0].uri).toBe(`at://${SELF}/${LINK_NSID}/${linkKey(HUB, 'memberOf', 'Mesh')}`)
    expect(net.records(SELF, PROFILE_NSID)[0].value).toEqual({ $type: PROFILE_NSID, networks: [{ hub: HUB, name: 'Mesh' }] })

    // An extra record on the PDS that federation.yaml doesn't list is planned for delete; the records never edit the file.
    const before = readFileSync(join(repo, 'federation.yaml'), 'utf8')
    const stray = seedLink('stray1', STRAY, 'peerOf')
    await check()
    expect((await planOf()).summary).toBe('Publish 0 links and withdraw 1.')
    const after = await publishLinks(repo, deps())
    expect(after.applied).toEqual({ created: 0, deleted: 1, profile: false })
    expect(net.records(SELF, LINK_NSID).map(r => r.uri)).not.toContain(stray.uri)
    expect(readFileSync(join(repo, 'federation.yaml'), 'utf8')).toBe(before)
    expect(git('status', '--porcelain')).toBe('')
    expect(git('diff', 'HEAD', '--', 'federation.yaml')).toBe('')
  })

  it('a peer removed in the working tree only is still published from the trunk', async () => {
    writeFed([]) // not committed
    await publishLinks(repo, deps())
    expect(linksOn().map(l => l.subject)).toEqual([HUB])
  })
})

describe('a private peer is never published, and an old record of it is withdrawn', () => {
  it('no record, no name in the plan, the job output or the receipt; counted only; its old record is deleted', async () => {
    writeFed([...HUB_PEER, ...QUIET_PEER])
    commit('a private peer')
    await check()
    const planned = await planOf()
    expect(planned.summary).toBe('Publish 1 link and withdraw 0, and update the profile. 1 peer is kept private.')
    const output = await planned.inProcess(repo, signal())
    const got = await publishLinks(repo, deps()) // a second run: nothing more, the same counts
    expect(got.withheld.private).toBe(1)
    expect(linksOn().map(l => l.subject)).toEqual([HUB])

    const receipt = readFileSync(receiptPath(repo), 'utf8')
    const everything = [planned.summary, output, receipt, JSON.stringify(got), JSON.stringify(net.writes), filesUnder(stateDir(repo))].join('\n')
    for (const leak of ['Quiet Cove', 'quiet-cove', 'Quiet', QUIET]) expect(everything, leak).not.toContain(leak)

    // It had a record from before, when it was public: the plan withdraws it.
    const old = seedLink('k0ld2', QUIET, 'peerOf')
    await check()
    expect((await planOf()).summary).toBe('Publish 0 links and withdraw 1. 1 peer is kept private.')
    const again = await publishLinks(repo, deps())
    expect(again.applied.deleted).toBe(1)
    expect(net.records(SELF, LINK_NSID).map(r => r.uri)).not.toContain(old.uri)
    expect(JSON.stringify(again) + readFileSync(receiptPath(repo), 'utf8')).not.toMatch(/Quiet|quiet/)
    expect(JSON.stringify(again) + readFileSync(receiptPath(repo), 'utf8')).not.toContain(QUIET)
  })

  it('a peer without a public https url is treated the same way', async () => {
    writeFed([...HUB_PEER, '  - name: Local Sibling', `    did: "${FRIEND}"`, '    repo: ../sibling', '    link: peerOf'])
    commit('a sibling folder')
    const old = seedLink('k0ld1', FRIEND, 'peerOf')
    const got = await publishLinks(repo, deps())
    expect(got.withheld.noUrl).toBe(1)
    expect(net.records(SELF, LINK_NSID).map(r => r.uri)).not.toContain(old.uri)
    expect(linksOn().map(l => l.subject)).toEqual([HUB])
    expect(JSON.stringify(got) + readFileSync(receiptPath(repo), 'utf8')).not.toMatch(/Sibling|sibling/)
  })
})

describe('nothing is written unless the identity lines up', () => {
  const expectNothingWritten = () => expect(net.writes).toEqual([])

  it('no identity.did on the trunk (one only in the working tree does not count)', async () => {
    writeFed(HUB_PEER, [])
    commit('no did')
    writeFed(HUB_PEER) // the DID, staged only
    expect(await refusal(publishLinks(repo, deps()))).toBe(SENTENCES.noDid)
    expect(await refusal(planOf())).toBe(`Not published: ${SENTENCES.noDid}`)
    expectNothingWritten()
  })

  it("kms.yaml's atproto account is another DID", async () => {
    writeKms({ did: STRAY })
    expect(await refusal(publishLinks(repo, deps()))).toBe(SENTENCES.kmsMismatch)
    expect(await refusal(planOf())).toBe(`Not published: ${SENTENCES.kmsMismatch}`)
    expectNothingWritten()
  })

  it('no app password in the environment', async () => {
    expect(await refusal(publishLinks(repo, deps({ env: {} })))).toBe(SENTENCES.noPassword)
    expect(await refusal(planOf({ env: {} }))).toBe(`Not published: ${SENTENCES.noPassword}`)
    expectNothingWritten()
  })

  it("the DID's document names another PDS than kms.yaml", async () => {
    net.editDidDoc(SELF, d => ({ ...d, service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: `https://${TWO}` }] }))
    expect(await refusal(publishLinks(repo, deps()))).toBe(SENTENCES.pdsMismatch)
    // The plan reads the cached document: a check that saw the other PDS.
    atprotoCache(repo).put(SELF, { did: SELF, pds: `https://${TWO}`, handle: null, profile: null, links: [], skipped: 0, fetchedAt: NOW.toISOString() }, NOW)
    expect(await refusal(planOf())).toBe(`Not published: ${SENTENCES.pdsMismatch}`)
    expectNothingWritten()
  })

  it('an example.* lexicon on a live account (allowPlaceholderLexicons not given)', async () => {
    await check()
    expect(await refusal(publishLinks(repo, deps({ allowPlaceholderLexicons: undefined })))).toBe(SENTENCES.placeholder)
    expect(await refusal(planOf({ allowPlaceholderLexicons: false }))).toBe(`Not published: ${SENTENCES.placeholder}`)
    expectNothingWritten()
  })

  it('a PDS on a private address is refused, and says so', async () => {
    net.resolveTo(ONE, ['10.1.2.3'])
    const said = await refusal(publishLinks(repo, deps()))
    expect(said).toBe(SENTENCES.privatePds)
    expect(said).toMatch(/private/)
    expectNothingWritten()
  })

  it('the plan reads only the cache: with none it says to check first, and it never fetches', async () => {
    expect(await refusal(planOf())).toBe(`Not published: ${SENTENCES.checkFirst}`)
    expect(net.requests).toEqual([])
    await check()
    const n = net.requests.length
    await planOf()
    expect(net.requests).toHaveLength(n)
    // A check that failed after the last good reading (its repo passed the page cap, say): the stale reading drives nothing.
    atprotoCache(repo).put(SELF, { problem: 'Not read: too many pages.' }, new Date(NOW.getTime() + 1000))
    expect(await refusal(planOf())).toBe(`Not published: ${SENTENCES.staleSelf}`)
  })

  it('each refusal is also the reason Publish is unavailable on the self card (R11), steps 2-4 and 6', async () => {
    const available = async (o: Partial<PublishDeps> = {}) => op(o).unavailable(await selfCard(), repo)
    await check()
    expect(await available()).toBeNull()
    expect(await available({ env: {} })).toBe(SENTENCES.noPassword)
    expect(await available({ allowPlaceholderLexicons: false })).toBe(SENTENCES.placeholder)
    writeKms({ did: STRAY })
    expect(await available()).toBe(SENTENCES.kmsMismatch)
    writeKms()
    writeFed(HUB_PEER, [])
    commit('no did')
    expect(await available()).toBe(SENTENCES.noDid)
    expectNothingWritten()
  })
})

describe('the app password', () => {
  it('appears in no output, error, receipt or log, even when createSession fails and echoes it', async () => {
    const echoing: FetchLike = async (url, init) => {
      if (url.endsWith('/xrpc/com.atproto.server.createSession')) {
        const body = JSON.parse(String((init as { body?: string }).body)) as { password: string }
        const text = JSON.stringify({ error: 'AuthenticationRequired', message: `wrong password: ${body.password}` })
        return { ok: false, status: 401, headers: { get: () => null }, text: async () => text, json: async () => JSON.parse(text) }
      }
      return net.fetch(url, init)
    }
    const failed = await refusal(publishLinks(repo, deps({ fetch: echoing })))
    expect(failed).toContain('***')
    expect(failed).not.toContain(PASSWORD)
    // An answer that isn't JSON and starts with the password: kms's parse error quotes its first characters.
    const raw: FetchLike = async (url, init) => {
      if (!url.endsWith('/xrpc/com.atproto.server.createSession')) return net.fetch(url, init)
      const text = `${PASSWORD} is not the password`
      return { ok: false, status: 401, headers: { get: () => null }, text: async () => text, json: async () => JSON.parse(text) }
    }
    const parsed = await refusal(publishLinks(repo, deps({ fetch: raw })))
    expect(parsed).not.toContain(PASSWORD.slice(0, 8))
    // A client that throws with the password in its message: the last scrub catches it.
    const real = await loadKms(repo)
    if (!real.ok) throw new Error(real.reason)
    const throwing = { loadKmsConfig: real.kms.loadKmsConfig, createClient: () => ({ login: async ({ password }: { password: string }) => { throw new Error(`boom ${password}`) } }) }
    const thrown = await refusal(publishLinks(repo, deps({ kms: throwing })))
    expect(thrown).toBe('boom ***')

    // Through the operation and the executor: the job's log, its sentence, and every file under the state folder.
    await check()
    const finished: JobRecord[] = []
    const jobs = new JobStore(repo)
    const exec = new LocalExecutor(repo, jobs, { started: () => {}, output: () => {}, finished: j => finished.push(j) })
    const planned = await planOf({ fetch: echoing })
    const job = exec.submit({ op: op({ fetch: echoing }), resource: await selfCard(), planned })
    await expect.poll(() => finished.find(j => j.id === job.id), { interval: 20, timeout: 15_000 }).toBeTruthy()
    const end = finished.find(j => j.id === job.id)!
    expect(end.status).toBe('failed')
    const all = [JSON.stringify(end), jobs.readLog(job.id), filesUnder(stateDir(repo)), JSON.stringify(net.writes), planned.summary].join('\n')
    expect(all).not.toContain(PASSWORD)

    // And a run that succeeds.
    const ok = await publishLinks(repo, deps())
    expect([JSON.stringify(ok), filesUnder(stateDir(repo)), JSON.stringify(net.writes)].join('\n')).not.toContain(PASSWORD)
  })
})

describe('never deletes every record in one run', () => {
  it('refuses two or more withdrawals with nothing wanted; allows a single withdrawal, so a node can leave its only network', async () => {
    writeFed([])
    commit('left everything')
    seedLink('a', HUB, 'memberOf', 'Mesh')
    seedLink('b', FRIEND, 'peerOf')
    await check()
    expect(await refusal(planOf())).toBe(`Not published: ${SENTENCES.massDelete}`)
    expect(await refusal(publishLinks(repo, deps()))).toBe(SENTENCES.massDelete)
    expect(linkWrites()).toEqual([])
    expect(net.records(SELF, LINK_NSID)).toHaveLength(2)

    // One record left: leaving is one withdrawal, and it goes through.
    const one = makeFakeNetwork({ hosts: { [`https://${ONE}`]: { accounts: { [SELF]: { handle: 'fixture-org.example.com', password: PASSWORD } } } } })
    one.seed(SELF, LINK_NSID, 'a', { $type: LINK_NSID, subject: HUB, relation: 'memberOf', network: 'Mesh', createdAt: '2026-01-01T00:00:00.000Z' })
    const left = await publishLinks(repo, deps({ fetch: one.fetch, lookup: one.lookup }))
    expect(left.applied.deleted).toBe(1)
    expect(one.records(SELF, LINK_NSID)).toEqual([])
  })
})

describe('publishes only the five fields', () => {
  it('every key of every record the PDS received is allowed; no request, answer, invite, token, decision or note reaches it', async () => {
    writeFed([
      '  - name: Mesh Hub', `    did: "${HUB}"`, `    url: ${HUB_SITE}`, '    decision: "request req-7f3a91"', '    requested: "2026-11-01"',
      '    since: "2026-11-02"', '    notes: "call Ana on tuesday, token tok-55aa"',
      '  - name: Friendly Peer', `    did: "${FRIEND}"`, '    url: https://friendly.example.org', '    link: peerOf', '    trust: read',
    ], undefined, ['join:', '  policy: invite', '  decision: "standing decision dec-9931"'])
    mkdirSync(join(repo, 'federation'))
    write('federation/outgoing.yaml', 'request: { id: req-7f3a91, invite: inv-2c2c, token: tok-55aa, answers: { why: "we grow seeds" } }\n')
    commit('peers with request history')
    net.seed(SELF, PROFILE_NSID, 'self', { $type: PROFILE_NSID, networks: [], displayName: 'Fixture', description: 'Seeds' })
    await publishLinks(repo, deps())

    const puts = net.writes.filter(w => w.nsid === 'com.atproto.repo.putRecord')
    expect(puts.length).toBe(3)
    for (const w of puts) {
      expect(Object.keys(w.body).sort()).toEqual(expect.arrayContaining(['collection', 'record', 'repo', 'rkey']))
      for (const k of Object.keys(w.body)) expect(['repo', 'collection', 'rkey', 'record', 'validate', 'swapRecord']).toContain(k)
      const record = w.body.record as Record<string, unknown>
      if (w.body.collection === LINK_NSID) {
        for (const k of Object.keys(record)) expect(['$type', 'subject', 'relation', 'network', 'createdAt'], k).toContain(k)
        for (const k of ['$type', 'subject', 'relation', 'createdAt']) expect(record).toHaveProperty(k)
      } else {
        expect(w.body.collection).toBe(PROFILE_NSID)
        for (const k of Object.keys(record)) expect(['$type', 'networks', 'displayName', 'description'], k).toContain(k)
      }
    }
    expect(puts.find(w => (w.body.record as { subject?: string }).subject === HUB)!.body.record).toMatchObject({ createdAt: '2026-11-02T00:00:00.000Z' })
    const log = JSON.stringify(net.writes)
    for (const leak of ['req-7f3a91', 'inv-2c2c', 'tok-55aa', 'dec-9931', 'standing decision', 'tuesday', 'we grow seeds', 'request ', '2026-11-01']) {
      expect(log, leak).not.toContain(leak)
    }
  })
})

describe('the profile', () => {
  it('keeps a key it did not write; a profile changed elsewhere gives the swap sentence, and the links still go', async () => {
    net.seed(SELF, PROFILE_NSID, 'self', { $type: PROFILE_NSID, networks: [], displayName: 'X' })
    await publishLinks(repo, deps())
    expect(net.records(SELF, PROFILE_NSID)[0].value).toEqual({ $type: PROFILE_NSID, displayName: 'X', networks: [{ hub: HUB, name: 'Mesh' }] })

    // Another client rewrites the profile between our read and our write.
    writeFed([...HUB_PEER, '  - name: Friendly Peer', `    did: "${FRIEND}"`, '    url: https://friendly.example.org', '    link: memberOf'], undefined,
      ['  - name: Friends', '    hub: https://friendly.example.org'])
    commit('a second network')
    let edits = 0
    const racing: FetchLike = async (url, init) => {
      const body = (init as { body?: string }).body
      if (url.endsWith('com.atproto.repo.putRecord') && body && JSON.parse(body).collection === PROFILE_NSID) {
        net.seed(SELF, PROFILE_NSID, 'self', { $type: PROFILE_NSID, networks: [], displayName: `Changed elsewhere ${++edits}` })
      }
      return net.fetch(url, init)
    }
    const got = await publishLinks(repo, deps({ fetch: racing }))
    expect(got.failures).toEqual([{ action: 'profile', uri: `at://${SELF}/${PROFILE_NSID}/self`, error: SENTENCES.swap }])
    expect(got.applied).toEqual({ created: 1, deleted: 0, profile: false })
    expect(net.records(SELF, PROFILE_NSID)[0].value).toMatchObject({ displayName: 'Changed elsewhere 1' })
    // The job says so and fails, after the rest went.
    const planned = await planOf({ fetch: racing })
    await expect(planned.inProcess(repo, signal())).rejects.toThrow(SENTENCES.swap)
  })
})

describe('running twice', () => {
  it('plans nothing the second time, and writes nothing', async () => {
    await check()
    expect((await planOf()).summary).toBe('Publish 1 link and withdraw 0, and update the profile.')
    await (await planOf()).inProcess(repo, signal())
    const n = net.writes.length
    expect(await refusal(planOf())).toBe(`Not published: ${SENTENCES.nothing}`)
    expect((await selfCard()).facts).toMatchObject({ toPublish: 0, published: { at: NOW.toISOString(), created: 1, deleted: 0 } })
    expect(op().unavailable(await selfCard(), repo)).toBe(SENTENCES.nothing)
    const second = await publishLinks(repo, deps())
    expect(second.applied).toEqual({ created: 0, deleted: 0, profile: false })
    expect(net.writes).toHaveLength(n)
  })
})

describe('the receipt and the self card', () => {
  it('the receipt holds uris and the profile cid only; the card counts what is left to publish', async () => {
    await check()
    expect((await selfCard()).facts).toMatchObject({ toPublish: 2, published: null, publishBlocked: null })
    await publishLinks(repo, deps())
    const receipt = JSON.parse(readFileSync(receiptPath(repo), 'utf8'))
    expect(receipt).toEqual({
      at: NOW.toISOString(), did: SELF, created: [`at://${SELF}/${LINK_NSID}/${linkKey(HUB, 'memberOf', 'Mesh')}`], deleted: [],
      profileCid: net.records(SELF, PROFILE_NSID)[0].cid,
    })
    expect(JSON.stringify(receipt)).not.toContain('Mesh Hub')
    expect(await publishFacts(repo, { run: runCommand, now: NOW })).toMatchObject({ toPublish: 0 })
  })
})

describe('federation.publish-links, the operation', () => {
  it('is in the catalogue: changes, network, no params, refreshes the fleet; its plan is a 409 before any nonce', async () => {
    const o = opById('federation.publish-links')!
    expect(o).toMatchObject({ kinds: ['instance'], effect: 'changes', network: true, refreshes: 'fleet', params: { type: 'object', additionalProperties: false } })
    expect(o.params.properties).toBeUndefined()
    // The catalogue's own copy reaches the real network, which refuses under a test run; its plan needs no network.
    await check()
    const err = await Promise.resolve(op({ allowPlaceholderLexicons: false }).plan(await selfCard(), {}, repo)).then(() => null, (e: unknown) => e)
    expect(err).toBeInstanceOf(HttpError)
    expect((err as HttpError).status).toBe(409)
    expect(o.unavailable({ ...(await selfCard()), facts: { self: false } }, repo)).toBe("offered on this instance's own card")
  })

  it("without kms, publishing is unavailable with kms's own sentence", async () => {
    git('rm', '-q', 'kms.yaml')
    commit('no kms')
    expect(op().unavailable(await selfCard(), repo)).toMatch(/^the commons is not set up here/)
  })

  it("the executor's snapshot shows no changed file", async () => {
    await check()
    const finished: JobRecord[] = []
    const exec = new LocalExecutor(repo, new JobStore(repo), { started: () => {}, output: () => {}, finished: j => finished.push(j) })
    const job = exec.submit({ op: op(), resource: await selfCard(), planned: await planOf() })
    await expect.poll(() => finished.find(j => j.id === job.id), { interval: 20, timeout: 15_000 }).toBeTruthy()
    expect(finished.find(j => j.id === job.id)).toMatchObject({ status: 'ok', changed: [], surprises: [], sentence: 'Done. No file changed.' })
    expect(git('status', '--porcelain')).toBe('')
    expect(linksOn().map(l => l.subject)).toEqual([HUB])
  })
})

describe('the guarded fetch kms writes through (R9)', () => {
  const kmsCall = (f: ReturnType<typeof guardedWriteFetch>, url = `https://${ONE}/xrpc/com.atproto.server.createSession`) =>
    f(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: SELF, password: 'x' }) })

  it('passes redirect: error and a signal to the fetch, and returns the answer', async () => {
    const seen: unknown[] = []
    const spy: FetchLike = async (url, init) => { seen.push(init); return net.fetch(url, init) }
    const res = await kmsCall(guardedWriteFetch(spy, { lookup: net.lookup }))
    expect(res.status).toBe(401)
    expect(seen[0]).toMatchObject({ method: 'POST', redirect: 'error', signal: expect.any(AbortSignal) })
  })

  it('refuses a redirect, an IP literal, a private resolution, http, and an answer over the cap', async () => {
    net.misbehave(ONE, 'redirect')
    await expect(kmsCall(guardedWriteFetch(net.fetch, { lookup: net.lookup }))).rejects.toThrow(/redirect/)
    net.misbehave(ONE, null)
    await expect(kmsCall(guardedWriteFetch(net.fetch, { lookup: net.lookup }), 'https://93.184.216.34/xrpc/x')).rejects.toThrow(/not a public https address/)
    await expect(kmsCall(guardedWriteFetch(net.fetch, { lookup: net.lookup }), `http://${ONE}/xrpc/x`)).rejects.toThrow(/not a public https address/)
    net.resolveTo(ONE, ['192.168.1.20'])
    await expect(kmsCall(guardedWriteFetch(net.fetch, { lookup: net.lookup }))).rejects.toThrow(/private/)
    net.resolveTo(ONE, ['93.184.216.34'])
    net.misbehave(ONE, 'oversized')
    await expect(kmsCall(guardedWriteFetch(net.fetch, { lookup: net.lookup }))).rejects.toThrow(/KB/)
  })

  it('times out a PDS that never answers, and stops on the job signal', async () => {
    net.misbehave(ONE, 'slow')
    vi.useFakeTimers()
    try {
      const p = kmsCall(guardedWriteFetch(net.fetch, { lookup: net.lookup }))
      const caught = p.then(() => null, e => e as Error)
      await vi.advanceTimersByTimeAsync(10_001)
      expect((await caught)?.message).toMatch(/longer than 10 seconds/)
    } finally { vi.useRealTimers() }
    const ac = new AbortController()
    const p = kmsCall(guardedWriteFetch(net.fetch, { lookup: net.lookup, signal: ac.signal }))
    ac.abort()
    await expect(p).rejects.toThrow(/cancelled/)
  })

  it('the default lookup refuses under a test run', async () => {
    await expect(kmsCall(guardedWriteFetch(net.fetch, {}))).rejects.toThrow(/no network in tests/)
  })
})
