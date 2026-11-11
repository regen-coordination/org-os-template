// DAO-OS L7 (spec §5.1, §6, L7-D9): a DAO template is an entry whose installs create several composed Systems and a
// board, staged as one change; the composition is checked as a whole at add; removal deletes exactly its records while
// they are composed, and is refused once one of its Systems is deployed. Every test builds a throwaway repository.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Hono } from 'hono'
import { removeFixtureRepo } from '../fixtures.ts'
import { makeSyntheticRepo, git } from '../changes/fixtures.ts'
import { createApp } from '../../server/app.ts'
import { readRegistry } from '../../server/registry.ts'
import { validateRepo } from '../../lib/data-validate.mjs'

const SHELF = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'test-shelf')
const OWNERS = ['eip155:11155111:0x00000000000000000000000000000000000000a1', 'eip155:11155111:0x00000000000000000000000000000000000000a2']
const CONFIG = { owners: OWNERS, threshold: 2 }
const CHECKSUMMED = ['eip155:11155111:0x00000000000000000000000000000000000000A1', 'eip155:11155111:0x00000000000000000000000000000000000000A2']
const RECORDS = ['systems:test-dao-safe', 'systems:test-dao-roles', 'boards:test-dao-council']
const DEPLOYED = 'Its Systems are deployed. Remove each System as its own change; the chain keeps them.'

let repo: string
let app: Hono
beforeEach(() => {
  repo = makeSyntheticRepo()
  writeFileSync(join(repo, 'federation.yaml'), `identity:\n  name: Test DAO\n  slug: test-dao\nlibrary:\n  shelves:\n    - { path: ${SHELF} }\n`)
  git(repo, 'add federation.yaml')
  git(repo, 'commit -qm "fixture: the test shelf"')
  app = createApp(repo)
})
afterEach(() => removeFixtureRepo(repo))

const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const add = (id: string, body: unknown = {}) => app.request(`/api/library/${encodeURIComponent(id)}/add`, json('POST', body))
const remove = (id: string, body: unknown = {}) => app.request(`/api/library/receipts/${encodeURIComponent(id)}/remove`, json('POST', body))
const removal = (id: string) => app.request(`/api/library/receipts/${encodeURIComponent(id)}/removal`)
const stageOps = (ops: unknown[]) => app.request('/api/changes/ops', json('POST', { ops }))
const view = async () => (await app.request('/api/changes')).json()
const apply = () => app.request('/api/changes/apply', json('POST', {}))
const records = (ops: { record: string }[]) => ops.map(o => o.record)
const ids = (registry: string) => (readRegistry(repo, registry).entries ?? []).map(e => String(e.id))
const errorsOf = () => validateRepo(repo).filter((p: { level: string }) => p.level === 'error')
async function ok(res: Response, status = 200): Promise<Record<string, any>> {
  const body = await res.json()
  expect(res.status, JSON.stringify(body)).toBe(status)
  return body
}

describe('adding a DAO template', () => {
  it('stages the composed Systems and the board, and the receipt, in one change', async () => {
    const head = git(repo, 'rev-parse HEAD')
    const body = await ok(await add('template:test-council', { config: CONFIG }))
    expect(records(body.ops)).toEqual([...RECORDS, 'library:template-test-council'])
    // owners and wearers are written CAIP-10 on the chain, checksummed (spec §4.1; L7 Task 11 closes PF-R152's carry)
    expect(body.ops[0].value).toMatchObject({
      kind: 'safe', chain: 'eip155:11155111',
      deployment: { status: 'composed', owners: CHECKSUMMED, threshold: 2, on_deploy: { roles: { council: { hat: '${hat.test-dao-roles/council}' } } } },
    })
    expect(body.ops[1].value.hats[0]).toMatchObject({ key: 'council', wearers: CHECKSUMMED })
    expect(body.ops[3].value.created).toEqual(RECORDS.map(record => ({ record, base: null })))
    expect(body.ops[3].value).not.toHaveProperty('modified')
    expect(git(repo, 'rev-parse HEAD')).toBe(head)
  })

  it('a bare 0x owner is accepted, and written as an account on the composition\'s chain (CAIP-10, checksummed)', async () => {
    const bare = OWNERS.map(o => o.slice('eip155:11155111:'.length))
    const body = await ok(await add('template:test-council', { config: { owners: bare, threshold: 2 } }))
    expect(body.ops[0].value.deployment.owners).toEqual(CHECKSUMMED)
    expect(body.ops[1].value.hats[0].wearers).toEqual(CHECKSUMMED)
  })

  it('names its records from config.id: ${config.id}-safe, -roles, -council, and the references between them', async () => {
    const body = await ok(await add('template:test-council', { config: { ...CONFIG, id: 'my-dao' } }))
    expect(records(body.ops)).toEqual(['systems:my-dao-safe', 'systems:my-dao-roles', 'boards:my-dao-council', 'library:template-test-council'])
    expect(body.ops[0].value).toMatchObject({ id: 'my-dao-safe', signer_gate: { hats: ['my-dao-roles/council'] } })
    expect(body.ops[0].value.deployment.on_deploy.roles.council.hat).toBe('${hat.my-dao-roles/council}')
    expect(body.ops[1].value.deployment.top.worn_by).toBe('my-dao-safe')
  })

  it('an id config.id makes that the engine cannot address is refused with 422, and nothing is staged', async () => {
    const body = await ok(await add('template:test-council', { config: { ...CONFIG, id: 'My DAO' } }), 422)
    expect(body.errors).toContainEqual({ record: 'template:test-council', field: 'config', message: 'systems:My DAO-safe is not a record this entry can add: an id is lowercase letters, digits and hyphens, starting with a letter or a digit.' })
    expect((await view()).ops).toEqual([])
  })

  it('a composition with a bad threshold is refused with 422, naming the record and field, and nothing is staged', async () => {
    const body = await ok(await add('template:test-council', { config: { owners: OWNERS, threshold: 3 } }), 422)
    expect(body.errors).toContainEqual({
      record: 'systems:test-dao-safe', field: 'deployment.threshold',
      message: 'threshold is 3, and the Safe has 2 owners; it is between 1 and the number of owners.',
    })
    expect((await view()).ops).toEqual([])
  })

  it('an owner that is no account on the composition’s chain is refused with 422 on deployment.owners (review M1)', async () => {
    for (const bad of ['cosmos:cosmoshub-4:0x00000000000000000000000000000000000000a1', 'eip155:1:0x00000000000000000000000000000000000000a1']) {
      const body = await ok(await add('template:test-council', { config: { owners: [bad, OWNERS[1]], threshold: 1 } }), 422)
      expect(body.errors, bad).toContainEqual(expect.objectContaining({ record: 'systems:test-dao-safe', field: 'deployment.owners' }))
      expect((await view()).ops, bad).toEqual([])
    }
  })

  it('applies with the receipt sealed, and the repository validates', async () => {
    await ok(await add('template:test-council', { config: CONFIG }))
    await ok(await apply())
    expect(ids('systems')).toEqual(['test-dao-safe', 'test-dao-roles'])
    expect(ids('boards')).toEqual(['test-dao-council'])
    expect(errorsOf()).toEqual([])
  })
})

describe('a canvas edit of a composed System is checked as the composition it leaves (P8)', () => {
  beforeEach(async () => {
    await ok(await add('template:test-council', { config: CONFIG }))
    await ok(await apply())
  })

  it('a threshold above the owners is refused at stage', async () => {
    const body = await ok(await stageOps([{ op: 'update', record: 'systems:test-dao-safe', set: { deployment: { status: 'composed', owners: OWNERS, threshold: 5, salt: '1' } } }]), 422)
    expect(body.errors).toContainEqual({ record: 'systems:test-dao-safe', field: 'deployment.threshold', message: 'threshold is 5, and the Safe has 2 owners; it is between 1 and the number of owners.' })
  })

  it('a Safe with no owners yet is incomplete, not refused: the deployment says it later', async () => {
    await ok(await stageOps([{ op: 'create', record: 'systems:second-safe', value: { id: 'second-safe', kind: 'safe', name: 'Second', chain: 'eip155:11155111', deployment: { status: 'composed', threshold: 1 } } }]))
  })
})

describe('removing a DAO template', () => {
  beforeEach(async () => {
    await ok(await add('template:test-council', { config: CONFIG }))
    await ok(await apply())
  })

  it('while composed, deletes exactly its records and marks the receipt removed', async () => {
    const preview = await ok(await removal('template-test-council'))
    expect(preview.records.map((r: { record: string; state: string }) => [r.record, r.state])).toEqual(RECORDS.map(r => [r, 'as added']))
    const body = await ok(await remove('template-test-council'))
    expect(body.ops.map((o: { op: string; record: string }) => `${o.op} ${o.record}`))
      .toEqual([...RECORDS.map(r => `delete ${r}`), 'update library:template-test-council'])
    await ok(await apply())
    expect(ids('systems')).toEqual([])
    expect(ids('boards')).toEqual([])
    expect((readRegistry(repo, 'library').entries ?? [])[0]).toMatchObject({ status: 'removed', removed: { by: 'bruno' } })
    expect(errorsOf()).toEqual([])
  })

  it('a template whose Systems are deployed is not removed', async () => {
    // Read-back's change, in miniature: one System is deployed; its on_deploy stays until the governance flip.
    await ok(await stageOps([{
      op: 'update', record: 'systems:test-dao-safe',
      set: {
        address: '0x0000000000000000000000000000000000005afe',
        deployment: {
          status: 'deployed', read_back: '2026-10-30',
          on_deploy: {
            roles: { council: { hat: '${hat.test-dao-roles/council}' } },
            rules: [{ id: 'treasury', applies_to: ['treasury'], propose: 'council', decide: { by: 'system', system: 'test-dao-safe' } }],
          },
        },
      },
    }]))
    await ok(await apply())
    const head = git(repo, 'rev-parse HEAD')
    expect(await ok(await removal('template-test-council'), 409)).toEqual({ code: 'DEPLOYED', error: DEPLOYED })
    expect(await ok(await remove('template-test-council'), 409)).toEqual({ code: 'DEPLOYED', error: DEPLOYED })
    expect((await view()).ops).toEqual([])
    expect(git(repo, 'rev-parse HEAD')).toBe(head)
    expect(ids('systems')).toEqual(['test-dao-safe', 'test-dao-roles'])
  })
})
