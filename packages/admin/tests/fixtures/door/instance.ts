// The door's fixture instance (DAO-OS L9, Tasks 13–16): a fresh git repository under the temp directory and a private
// store beside it (outside the repository), in the style of tests/fixtures.ts. It holds public, members and `hat:`
// things, and four sentinels that must never reach the door:
// - SENTINEL-store-1, in a private record kept at the Council hat (a `hat:` record lives only in the store);
// - SENTINEL-field-2, in a restricted field of a public member (kept in the store);
// - SENTINEL-members-3, the title of a members-level project (in git);
// - SENTINEL-budget-4, a members-level field of a public project (in git);
// and the ledger records acts by ACTOR (0x…a1) under the Council hat, which the door never names.
// Placeholders only (L9 spec §15): steward-a, steward-b, ops-lead; 0x…a1–a4; tree eip155:42220:13; example.org and
// door.example.test. Nothing here touches the network: the System reader is a stand-in.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import { stringify } from 'yaml'
import { openPrivateStore, type PrivateStore } from '../../../server/private/store.ts'
import type { SystemReader } from '../../../server/systems/reader.ts'
import type { DriverRead } from '../../../server/systems/driver.ts'
import { caip10 } from '../../../lib/caip.mjs'

export const CELO = 'eip155:42220'
/** `0x…<tail>`, lower case as a record writes it. */
export const addr = (tail: string) => `0x${tail.padStart(40, '0')}`
/** The member who acts in the ledger: the door names the hat, never this account. */
export const ACTOR = `${CELO}:${addr('a1')}`
/** Another wearer of the Council hat, recorded only in `wearers`. */
export const WEARER = `${CELO}:${addr('a2')}`
/** A third account, recorded only in a ratify's `closed.checked`. */
export const CHECKED = `${CELO}:${addr('a3')}`
/** The treasury Safe: a public System's contract, which the door may show. */
export const SAFE = addr('a4')
/** The Safe as the standards publish it (CAIP-10, checksummed). */
export const SAFE_ID = caip10(CELO, SAFE)
/** Tree 13 on Celo; the Council is its hat 13.1. */
export const COUNCIL_HAT = `${CELO}:0x0000000d0001${'0'.repeat(52)}`
export const DAO_URI = 'https://example.org/.well-known/dao.json'
export const DOOR_ORIGIN = 'https://door.example.test'
export const NOW = new Date('2026-10-30T12:00:00Z')
export const TREASURY_READ_AT = '2026-10-30T09:00:00Z'

export const SENTINEL = {
  store: 'SENTINEL-store-1',
  field: 'SENTINEL-field-2',
  members: 'SENTINEL-members-3',
  budget: 'SENTINEL-budget-4',
  pending: 'SENTINEL-pending-5',
} as const

/** Strings the door may show: none of them is ever a secret. */
export const SHOWN = { project: 'Public Project One', member: 'Steward A' } as const

export const PROPOSAL = 'p-2026-10-29-001-ab12'

const FEDERATION_YAML = `identity:
  name: "Door Test Org"
  type: "DAO"
  daoURI: "${DAO_URI}"
  chain: "${CELO}"
`
const VISIBILITY_YAML = `visibility:
  collections:
    members: { default: public, fields: { phone: "hat:${COUNCIL_HAT}" } }
    projects: { default: public, fields: { budget: members } }
    proposals: { default: public }
    systems: { default: public }
`
const MEMBERS_YAML = `schema_version: "2.0"
members:
  - { id: steward-a, name: "${SHOWN.member}", kind: person, handles: { git: ["steward-a@example.org"] } }
  - { id: steward-b, name: "Steward B", kind: person, visibility: members, handles: { git: ["steward-b@example.org"] } }
  - { id: ops-lead, name: "Ops Lead", kind: person }
`
const PROJECTS_YAML = `schema_version: "2.0"
projects:
  - id: "proj-pub"
    title: "${SHOWN.project}"
    status: "execute"
    type: "program"
    lead: "steward-b"
    contributors: ["steward-a"]
    budget: "${SENTINEL.budget}"
  - id: "proj-mem"
    title: "${SENTINEL.members}"
    status: "develop"
    type: "program"
    lead: "ops-lead"
    visibility: "members"
`
const SYSTEMS_YAML = `schema_version: "1.0"
systems:
  - { id: treasury, kind: safe, name: "Treasury", chain: "${CELO}", address: "${SAFE}", driver: safe }
  - { id: roles, kind: hats-tree, name: "Roles", chain: "${CELO}", address: "13", driver: hats-tree }
`
const GOVERNANCE_YAML = `schema_version: "2.0"
governance:
  model: "consensus"
  roles:
    council: { members: [steward-a, steward-b] }
    member: { all: true }
  rules:
    - { id: records, applies_to: [records], propose: member, decide: { by: council, method: approve, count: 1 } }
  decisions: []
`

/** What L5 records beside an act (L5 spec §7.2): the hat, the account, and the hat's wearers as read. */
const as = { hat: COUNCIL_HAT, account: ACTOR, block: 31000123, readAt: '2026-10-29T10:00:00Z', wearers: [ACTOR, WEARER], complete: true }
const RULE = { id: 'records', applies_to: ['records'], propose: 'member', decide: { by: 'council', method: 'approve', count: 1 } }

/** One public proposal, ratified: opened, approved and closed by ACTOR under the Council hat. */
export function ledger(): Record<string, unknown> {
  return {
    schema_version: '2.0',
    proposals: [{
      id: PROPOSAL, title: 'Move the public project', author: 'steward-a', opened_as: as, classes: ['records'], rules: [RULE],
      state: 'ratified', opened: '2026-10-29T09:00:00Z', rev: '0a1b2c3d4e5f',
      ops: [{ op: 'update', record: 'projects:proj-pub', set: { status: 'develop' } }],
      events: [
        { id: 'e-a1-01', at: '2026-10-29T10:00:00Z', by: ACTOR, kind: 'approve', rev: '0a1b2c3d4e5f', as },
        { id: 'e-a1-02', at: '2026-10-29T11:00:00Z', by: 'steward-a', kind: 'ratify' },
      ],
      closed: {
        at: '2026-10-29T11:00:00Z', by: 'steward-a', decision: 'gov-2026-001', as,
        checked: [{ account: CHECKED, hat: COUNCIL_HAT, wears: true, block: 31000124, readAt: '2026-10-29T11:00:00Z' }],
      },
    }],
  }
}

/** The reads a stand-in reader answers: the treasury was read; the roles tree never was. */
export function fixtureReads(): Record<string, DriverRead> {
  return {
    treasury: { ok: true, readAt: TREASURY_READ_AT, facts: {}, sections: [], open: null },
    roles: { ok: false, readAt: null, error: 'the RPC did not answer', facts: {}, sections: [], open: null },
  }
}

/** A System reader that answers from `reads` and never reaches a network. */
export function standInReader(reads: Record<string, DriverRead> = fixtureReads()): SystemReader {
  const never: DriverRead = { ok: false, readAt: null, error: 'never read', facts: {}, sections: [], open: null }
  return { read: async (system: Record<string, unknown>) => reads[String(system.id)] ?? never } as unknown as SystemReader
}

export interface DoorInstance {
  repo: string
  /** The private store's folder, outside the repository. */
  storeDir: string
  store: PrivateStore
  remove(): void
}

/** The fixture instance: a committed repository and an open private store holding the store's sentinels. */
export async function makeDoorInstance(): Promise<DoorInstance> {
  const repo = mkdtempSync(join(tmpdir(), 'door-fixture-'))
  mkdirSync(join(repo, 'data'))
  writeFileSync(join(repo, 'federation.yaml'), FEDERATION_YAML)
  writeFileSync(join(repo, 'data', 'visibility.yaml'), VISIBILITY_YAML)
  writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS_YAML)
  writeFileSync(join(repo, 'data', 'projects.yaml'), PROJECTS_YAML)
  writeFileSync(join(repo, 'data', 'systems.yaml'), SYSTEMS_YAML)
  writeFileSync(join(repo, 'data', 'governance.yaml'), GOVERNANCE_YAML)
  writeFileSync(join(repo, 'data', 'proposals.yaml'), stringify(ledger()))
  const git = (cmd: string) => execSync(`git ${cmd}`, { cwd: repo, stdio: 'pipe' })
  git('init -q -b main')
  git('config user.email steward-a@example.org')
  git('config user.name steward-a')
  git('add -A')
  git('commit -qm "fixture: the door\'s instance"')

  const storeDir = mkdtempSync(join(tmpdir(), 'door-store-'))
  const store = await openPrivateStore(repo, { dir: storeDir })
  await store.putRecord({
    collection: 'projects', id: 'proj-hat', visibility: `hat:${COUNCIL_HAT}`, rev: 'r1',
    body: { id: 'proj-hat', title: SENTINEL.store, status: 'develop', note: SHOWN.project },
  }, 'steward-a', null)
  await store.putField({ registry: 'members', record: 'steward-a', field: 'phone', visibility: `hat:${COUNCIL_HAT}`, value: SENTINEL.field }, 'steward-a', null)
  await store.tx(w => w.putPending({
    ref: 'prv_0123456789abcdef', proposal: PROPOSAL, salt: 'salt-1',
    ops: [{ op: 'update', record: 'projects:proj-hat', set: { status: SENTINEL.pending } }], digest: `sha256:${'ff'.repeat(32)}`,
  }))
  return {
    repo, storeDir, store,
    remove() {
      try { store.close() } catch { /* closed by a test */ }
      rmSync(repo, { recursive: true, force: true })
      rmSync(storeDir, { recursive: true, force: true })
    },
  }
}
