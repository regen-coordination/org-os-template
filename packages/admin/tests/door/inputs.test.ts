// The door's inputs (DAO-OS L9 spec §3.2, §3.4): public only, and the secrets the scan refuses. The fixture instance
// (tests/fixtures/door) is a fresh repository under the temp directory with its private store beside it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stringify } from 'yaml'
import { collectDoorInput, ledgerAccounts, storeStrings, DOOR_STORE_UNREADABLE, type DoorInput } from '../../server/door/inputs.ts'
import { parseCaip10 } from '../../lib/caip.mjs'
import {
  ACTOR, CHECKED, DOOR_ORIGIN, NOW, PROPOSAL, SENTINEL, SHOWN, TREASURY_READ_AT, WEARER, makeDoorInstance, standInReader, type DoorInstance,
} from '../fixtures/door/instance.ts'

const bare = (account: string) => parseCaip10(account)!.address.toLowerCase()
const lowered = (secrets: Set<string>) => new Set([...secrets].map(s => s.toLowerCase()))

let inst: DoorInstance
let input: DoorInput

beforeAll(async () => {
  inst = await makeDoorInstance()
  const got = await collectDoorInput(inst.repo, { reader: standInReader(), store: inst.store, storeConfigured: true, now: NOW, doorOrigin: DOOR_ORIGIN })
  if ('refuse' in got) throw new Error(got.refuse)
  input = got
}, 60_000)
afterAll(() => inst?.remove())

describe('collectDoorInput', () => {
  it('the secrets hold all three sentinels and the account', () => {
    for (const s of [SENTINEL.store, SENTINEL.field, SENTINEL.members]) expect(input.secrets.has(s), s).toBe(true)
    const secrets = lowered(input.secrets)
    expect(secrets.has(ACTOR.toLowerCase())).toBe(true)
    expect(secrets.has(bare(ACTOR))).toBe(true) // the address alone too: a page could print it without its chain
    // and the rest of what must not be published: a members field in git, a pending op's value, every other recorded account
    for (const s of [SENTINEL.budget, SENTINEL.pending]) expect(input.secrets.has(s), s).toBe(true)
    for (const a of [WEARER, CHECKED]) expect(secrets.has(a.toLowerCase()), a).toBe(true)
    expect(input.store).toBe('read')
  })

  it('a public string is not a secret', () => {
    // the store's record repeats the public project's title, and the public member's name is in git
    const secrets = lowered(input.secrets)
    for (const s of [SHOWN.project, SHOWN.member]) expect(secrets.has(s.toLowerCase()), s).toBe(false)
    // both are public indeed: not vacuous
    expect(JSON.stringify(input.projection)).toContain(SHOWN.project)
    expect(JSON.stringify(input.pub)).toContain(SHOWN.member)
    expect(input.secrets.has(SENTINEL.store)).toBe(true) // the same store record's withheld title stays one
  })

  it('an account stays a secret where L5\'s public projection shows it: only what L8 publishes clears an address', () => {
    // the gate keeps a public proposal's event `by`, a CAIP-10 here; the door never names an actor (§3.4 point 2)
    expect(JSON.stringify(input.projection.proposals).toLowerCase()).toContain(ACTOR.toLowerCase())
    const secrets = lowered(input.secrets)
    for (const s of [ACTOR.toLowerCase(), bare(ACTOR)]) expect(secrets.has(s), s).toBe(true)
  })

  it('edges link only public nodes', () => {
    const ids = new Set(input.projection.resources.map(n => n.id))
    expect(ids.has('project:proj-pub')).toBe(true)
    expect(ids.has('project:proj-mem')).toBe(false)
    expect(input.projection.edges).toContainEqual(expect.objectContaining({ from: 'project:proj-pub', to: 'person:steward-a' }))
    expect(input.projection.edges.every(e => ids.has(e.from) && ids.has(e.to))).toBe(true) // none to steward-b, the members' lead
    expect(JSON.stringify(input.projection)).not.toContain('SENTINEL')
  })

  it('a configured store that cannot be read refuses with the spec\'s sentence', async () => {
    const unopened = await collectDoorInput(inst.repo, { reader: standInReader(), store: null, storeConfigured: true, now: NOW, doorOrigin: DOOR_ORIGIN })
    expect(unopened).toEqual({ refuse: 'The public door was not built: the private store could not be read, so the check for what must not be published is incomplete.' })
    expect(DOOR_STORE_UNREADABLE).toBe(unopened && 'refuse' in unopened ? unopened.refuse : '')

    const other = await makeDoorInstance()
    try {
      other.store.close() // opened, then it fails: its reads throw
      const closed = await collectDoorInput(other.repo, { reader: standInReader(), store: other.store, storeConfigured: true, now: NOW })
      expect(closed).toEqual({ refuse: DOOR_STORE_UNREADABLE })
    } finally { other.remove() }
  }, 60_000)

  it('no store at all scans with store: none, and says so', async () => {
    const got = await collectDoorInput(inst.repo, { reader: standInReader(), store: null, storeConfigured: false, now: NOW })
    if ('refuse' in got) throw new Error(got.refuse)
    expect(got.store).toBe('none')
    expect(got.secrets.has(SENTINEL.members)).toBe(true)
    expect(lowered(got.secrets).has(ACTOR.toLowerCase())).toBe(true)
    expect(got.secrets.has(SENTINEL.store)).toBe(false) // the store's strings are what it cannot know
    expect(got.doorOrigin).toBeNull()
  }, 60_000)

  it('reads: each System read, with the time it was read; a System never read is absent, never zero', () => {
    expect(input.reads.map(r => [r.system, r.readAt, r.ok])).toEqual([['treasury', TREASURY_READ_AT, true]])
    expect(input.reads[0]!.read.readAt).toBe(TREASURY_READ_AT)
  })

  it('carries the commit, the time, the door origin, and the standards live and as in git', () => {
    expect(input.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(input.now).toBe(NOW)
    expect(input.doorOrigin).toBe(DOOR_ORIGIN)
    expect(Object.keys(input.standards)).toContain('dao.json')
    expect(Object.keys(input.gitStandards)).toContain('dao.json')
    expect(input.problems.filter(p => p.level === 'error')).toEqual([])
    // urls.proposal is the door's decisions section until per-record pages exist (Q-L9-12)
    const proposals = input.standards['proposals.json'] as { proposals: { contentURI?: string }[] }
    expect(proposals.proposals.map(p => p.contentURI)).toEqual([`${DOOR_ORIGIN}/#decisions`])
    expect(JSON.stringify([input.standards, input.gitStandards, input.pub])).not.toContain('SENTINEL')
  })

  it('a repository with no daoURI refuses: nothing public can be built', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'door-nouri-'))
    try {
      writeFileSync(join(repo, 'federation.yaml'), 'identity:\n  name: "Door Test Org"\n')
      const got = await collectDoorInput(repo, { reader: standInReader(), store: null, storeConfigured: false, now: NOW })
      expect(got).toEqual({ refuse: 'The public door was not built: federation.yaml: identity.daoURI is not set — every id is built from it.' })
    } finally { rmSync(repo, { recursive: true, force: true }) }
  })
})

describe('storeStrings', () => {
  it('every string of 6 characters or more in records, fields and pending ops, read through the reader connection', async () => {
    const strings = storeStrings(inst.store)
    for (const s of [SENTINEL.store, SENTINEL.field, SENTINEL.pending, 'proj-hat']) expect(strings.has(s), s).toBe(true)
    expect([...strings].every(s => s.length >= 6)).toBe(true)
    // a write not yet committed is not read: the reader sees what was last committed
    const t = await inst.store.begin()
    try {
      t.putField({ registry: 'members', record: 'steward-a', field: 'phone', visibility: 'members', value: 'SENTINEL-uncommitted-6' }, 'steward-a', null)
      expect(storeStrings(inst.store).has('SENTINEL-uncommitted-6')).toBe(false)
    } finally { t.rollback() }
  })
})

describe('ledgerAccounts', () => {
  it('by (CAIP-10), as, opened_as and closed.as accounts, wearers and checked accounts; never a member id', () => {
    const repo = mkdtempSync(join(tmpdir(), 'door-ledger-'))
    try {
      mkdirSync(join(repo, 'data'))
      const a = (t: string) => `eip155:42220:0x${t.padStart(40, '0')}`
      const reading = (account: string, wearers: string[] = []) => ({ hat: 'h', account, block: 1, readAt: '2026-10-29T10:00:00Z', wearers })
      writeFileSync(join(repo, 'data', 'proposals.yaml'), stringify({
        proposals: [
          {
            id: PROPOSAL, author: 'steward-a', opened_as: reading(a('b1'), [a('b2')]),
            events: [{ by: a('b3'), kind: 'approve', as: reading(a('b4')) }, { by: 'steward-b', kind: 'comment' }],
            closed: { by: 'steward-a', as: reading(a('b5'), [a('b6')]), checked: [{ account: a('b7'), wears: false }] },
          },
          { id: 'p-2', events: 'not a list' },
          'not a proposal',
        ],
      }))
      const accounts = ledgerAccounts(repo)
      const want = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7'].map(a)
      for (const w of want) {
        expect(accounts.has(w), w).toBe(true)
        expect(lowered(accounts).has(bare(w)), w).toBe(true)
      }
      expect(accounts.has('steward-a')).toBe(false)
      expect(accounts.has('steward-b')).toBe(false)
    } finally { rmSync(repo, { recursive: true, force: true }) }
  })

  it('no ledger: no accounts', () => {
    const repo = mkdtempSync(join(tmpdir(), 'door-noledger-'))
    try { expect(ledgerAccounts(repo).size).toBe(0) } finally { rmSync(repo, { recursive: true, force: true }) }
  })
})
