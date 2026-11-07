import { describe, it, expect } from 'vitest'
import { projectPublic } from '../../lib/standards/project.mjs'
import { MECHANISMS as VALID_MECHANISMS } from '../../lib/standards/validate.mjs'
import { validateStandards } from '../../lib/standards/validate.mjs'
import {
  grantPoolsDoc, applicationsDoc, formatUnits, usdOf, USD_PEGGED, MECHANISMS, GARDENS_STATUS,
} from '../../lib/standards/grants.mjs'
import { caip10, checksumAddress } from '../../lib/caip.mjs'
import { fixtureInput, fixtureReads, POOL, CELO, A, SAFE, POOL_PAGE, COMMUNITY } from './fixtures.ts'

const POOL_ID = caip10(CELO, POOL)
const build = (reads = true, edit?: (i: ReturnType<typeof fixtureInput>) => void, editReads?: (r: any) => void) => {
  const r: any = reads ? fixtureReads() : null
  if (r) editReads?.(r)
  const input = fixtureInput(reads ? { reads: r } : {})
  edit?.(input)
  const pub = projectPublic(input).pub
  return { pub, pools: grantPoolsDoc(pub), apps: applicationsDoc(pub) }
}
const pools = (b: ReturnType<typeof build>) => ((b.pools.doc as any)?.grantPools ?? []) as any[]
const poolOf = (b: ReturnType<typeof build>, id = POOL_ID) => pools(b).find(p => p.id === id)
const grantsSystem = (i: ReturnType<typeof fixtureInput>) => i.records.systems.find(s => s.id === 'grants') as any

describe('formatUnits', () => {
  it('is exact for big integers and strips trailing zeros', () => {
    expect(formatUnits('1500000000000000000', 18)).toBe('1.5')
    expect(formatUnits('1', 18)).toBe('0.000000000000000001')
    expect(formatUnits('1000000', 6)).toBe('1')
    expect(formatUnits('0', 18)).toBe('0')
    expect(formatUnits('0', 0)).toBe('0')
    expect(formatUnits('123456789012345678901234567890123', 18)).toBe('123456789012345.678901234567890123')
    expect(formatUnits('42', 0)).toBe('42')
    expect(formatUnits('1234500', 2)).toBe('12345')
  })
  it('refuses what is not a base-unit integer', () => {
    expect(() => formatUnits('1.5', 18)).toThrow()
    expect(() => formatUnits('-1', 18)).toThrow()
    expect(() => formatUnits('1', -1)).toThrow()
  })
})

describe('constants', () => {
  it('MECHANISMS is the validator list, GARDENS_STATUS maps into the statuses', () => {
    expect(MECHANISMS).toBe(VALID_MECHANISMS)
    expect(MECHANISMS.length).toBe(31)
    expect(GARDENS_STATUS).toEqual({ inactive: 'pending', active: 'in_review', paused: 'in_review', disputed: 'in_review', executed: 'funded', cancelled: 'rejected', rejected: 'rejected' })
  })
  it('USD_PEGGED holds EIP-55 CAIP-10s on supported chains, once each', () => {
    expect(USD_PEGGED.length).toBeGreaterThan(0)
    expect(new Set(USD_PEGGED).size).toBe(USD_PEGGED.length)
    for (const t of USD_PEGGED) {
      const m = /^(eip155:[0-9]+):(0x[0-9a-fA-F]{40})$/.exec(t)
      expect(m, t).not.toBeNull()
      expect(checksumAddress(m![2]!)).toBe(m![2])
    }
    expect(USD_PEGGED).toContain('eip155:42220:0xcebA9300f2b948710d2653dD7B07f33A8B32118C')
  })
})

describe('grantPoolsDoc', () => {
  it('a public Gardens pool with a read is one GrantPool', () => {
    const b = build()
    const doc = b.pools.doc as any
    expect(doc['@context']).toBe('http://www.daostar.org/schemas')
    expect(doc.name).toBe('Test DAO')
    expect(doc.type).toBe('DAO')
    expect(pools(b).length).toBe(1)
    const p = poolOf(b)
    expect(p.type).toBe('GrantPool')
    expect(p.name).toBe('SHOWN-14 Community grants')
    expect(p.description).toBe('SHOWN-15 Grants decided by conviction')
    expect(p.grantFundingMechanism).toBe('Conviction Voting')
    expect(p.isOpen).toBe(true)
    expect(p.totalGrantPoolSize).toEqual([{ amount: '1000', denomination: 'TEST' }])
    expect(p.applicationsURI).toBe('https://dao.example.org/.well-known/applications.json')
    expect(p.governanceURI).toBe('https://dao.example.org/.well-known/governance.md')
    expect(p.extensions['org-os.source']).toBe('unverified')
    expect(p.extensions['org-os.system']).toBe('grants')
    expect(p.extensions['org-os.readAt']).toBe('2026-10-29T09:00:00.000Z')
  })
  it('isOpen is enabled and not archived', () => {
    expect(poolOf(build(true, undefined, r => { r.grants.facts.enabled = false })).isOpen).toBe(false)
    expect(poolOf(build(true, undefined, r => { r.grants.facts.archived = true })).isOpen).toBe(false)
  })
  it('a pegged token counts 1:1; another token takes grant_pool.usd.amount; neither is absent and warned', () => {
    const pegged = build(true, undefined, r => { r.grants.facts.token = USD_PEGGED[0]; r.grants.facts.amount = '1500000000000000000'; r.grants.facts.decimals = 18 })
    expect(poolOf(pegged).totalGrantPoolSizeInUSD).toBe('1.5')
    const own = build(true, i => { grantsSystem(i).grant_pool = { mechanism: 'Conviction Voting', usd: { amount: 2500, as_of: '2026-10-01T00:00:00Z' } } })
    expect(poolOf(own).totalGrantPoolSizeInUSD).toBe('2500')
    const none = build()
    expect(poolOf(none)).not.toHaveProperty('totalGrantPoolSizeInUSD')
    expect(none.pools.problems.some(p => p.level === 'warn' && p.file === 'grant-pools.json' && p.text.includes('grants'))).toBe(true)
    // a pegged token without its amount does not count
    expect(usdOf(none.pub.systems.find(s => s.id === 'grants')!, undefined)).toBeNull()
  })
  it('without a read: size from grant_pool.size, else absent and warned; isOpen from is_open, else warned', () => {
    const withBlock = build(false, i => { grantsSystem(i).grant_pool = { mechanism: 'Direct Grants', is_open: false, size: [{ amount: 500, denomination: 'EUR' }] } })
    const p = poolOf(withBlock)
    expect(p.grantFundingMechanism).toBe('Direct Grants')
    expect(p.isOpen).toBe(false)
    expect(p.totalGrantPoolSize).toEqual([{ amount: '500', denomination: 'EUR' }])
    expect(p.extensions).not.toHaveProperty('org-os.readAt')
    const bare = build(false)
    const q = poolOf(bare)
    expect(q).not.toHaveProperty('totalGrantPoolSize')
    expect(q).not.toHaveProperty('isOpen')
    const text = bare.pools.problems.map(x => x.text).join('\n')
    expect(bare.pools.problems.every(x => x.level === 'warn')).toBe(true)
    expect(text).toMatch(/grants/)
    expect(bare.pools.problems.length).toBeGreaterThanOrEqual(3)
  })
  it('a read with ok === false is no read', () => {
    const b = build(true, i => { grantsSystem(i).grant_pool = { mechanism: 'Conviction Voting', is_open: true, size: [{ amount: 7, denomination: 'X' }] } },
      r => { r.grants = { ok: false, error: 'rpc down' } })
    const p = poolOf(b)
    expect(p.totalGrantPoolSize).toEqual([{ amount: '7', denomination: 'X' }])
    expect(p.extensions).not.toHaveProperty('org-os.readAt')
    expect(b.apps).toBeNull()
  })
  it('a Safe with a grant_pool block is a pool; grant_pool false removes a Gardens pool', () => {
    const b = build(true, i => {
      const safe = i.records.systems.find(s => s.id === 'treasury') as any
      safe.grant_pool = { mechanism: 'Gnosis Safe', description: 'SHOWN-70 Small grants', is_open: true, size: [{ amount: '100', denomination: 'USD' }], usd: { amount: 100, as_of: '2026-10-01T00:00:00Z' }, close_date: '2026-12-31T00:00:00Z', email: 'grants@dao.example.org' }
      grantsSystem(i).grant_pool = false
    })
    expect(pools(b).length).toBe(1)
    const p = poolOf(b, caip10(CELO, SAFE))
    expect(p.grantFundingMechanism).toBe('Gnosis Safe')
    expect(p.description).toBe('SHOWN-70 Small grants')
    expect(p.closeDate).toBe('2026-12-31T00:00:00Z')
    expect(p.email).toBe('grants@dao.example.org')
    expect(p.totalGrantPoolSizeInUSD).toBe('100')
    expect(b.apps).toBeNull()
  })
  it('a signaling pool is left out with a warn', () => {
    const b = build(true, undefined, r => { r.grants.facts.type = 'signaling' })
    expect(b.pools.doc).toBeNull()
    expect(b.pools.problems.some(p => p.level === 'warn' && /signal/i.test(p.text) && p.text.includes('grants'))).toBe(true)
  })
  it('an off-chain pool has the DAOIP-5 translated id', () => {
    const b = build(false, i => {
      i.records.systems.push({ id: 'mini', kind: 'database', name: 'Mini grants', description: 'Small', grant_pool: { mechanism: 'Bounties', is_open: true, size: [{ amount: 1, denomination: 'USD' }], usd: { amount: 1, as_of: '2026-10-01T00:00:00Z' } } })
    })
    expect(poolOf(b, 'daoip-5:Test DAO:grantPool:mini').name).toBe('Mini grants')
  })
  it('no description is an error naming the pool', () => {
    const b = build(true, i => { delete grantsSystem(i).description })
    expect(b.pools.problems.some(p => p.level === 'error' && p.text.includes('grants'))).toBe(true)
    expect(poolOf(b)).not.toHaveProperty('description')
  })
  it('no pool at all is null', () => {
    const b = build(true, i => { grantsSystem(i).grant_pool = false })
    expect(b.pools.doc).toBeNull()
    expect(b.apps).toBeNull()
  })
  it('conforms to the schema, the missing-USD case reporting it', () => {
    const ok = build(true, i => { grantsSystem(i).grant_pool = { mechanism: 'Conviction Voting', usd: { amount: 10, as_of: '2026-10-01T00:00:00Z' } } })
    expect(validateStandards({ 'grant-pools.json': ok.pools.doc, 'applications.json': ok.apps })).toEqual([])
    const bad = build()
    const problems = validateStandards({ 'grant-pools.json': bad.pools.doc })
    expect(problems.some(p => p.level === 'error' && p.file === 'grant-pools.json')).toBe(true)
  })
  it('is deterministic, sorted by id, with no null or empty string', () => {
    const b = build(true, i => {
      i.records.systems.push({ id: 'mini', kind: 'database', name: 'Mini grants', description: 'Small', grant_pool: { mechanism: 'Bounties' } })
    })
    const ids = pools(b).map(p => p.id)
    expect(ids).toEqual([...ids].sort())
    const s = JSON.stringify(b.pools.doc)
    expect(s).not.toContain('null')
    expect(s).not.toContain('""')
    expect(JSON.stringify(build().pools.doc)).toBe(JSON.stringify(build().pools.doc))
  })
})

describe('applicationsDoc', () => {
  it('each pool proposal is a GrantApplication', () => {
    const b = build()
    const doc = b.apps as any
    expect(doc['@context']).toBe('http://www.daostar.org/schemas')
    expect(doc.grantPools.length).toBe(1)
    expect(doc.grantPools[0].type).toBe('GrantPool')
    expect(doc.grantPools[0].name).toBe('SHOWN-14 Community grants')
    const apps = doc.grantPools[0].applications as any[]
    expect(apps.map(a => a.id)).toEqual([`${POOL_ID}?proposalId=1`, `${POOL_ID}?proposalId=2`])
    const one = apps[0]
    expect(one.type).toBe('GrantApplication')
    expect(one.grantPoolId).toBe(POOL_ID)
    expect(one.grantPoolName).toBe('SHOWN-14 Community grants')
    expect(one.projectName).toBe('SHOWN-56 Seed the nursery')
    expect(one.createdAt).toBe(new Date(1791000000 * 1000).toISOString())
    expect(one.fundsAsked).toEqual([{ amount: '100', denomination: 'TEST' }])
    expect(one.status).toBe('in_review')
    // the pool's page, as gardens.ts builds it (its open.url)
    expect(one.contentURI).toBe(POOL_PAGE)
    expect(POOL_PAGE).toBe(`https://app.gardens.fund/gardens/42220/${COMMUNITY.toLowerCase()}/${POOL.toLowerCase()}`)
    expect(one.extensions['org-os.source']).toBe('unverified')
    expect(apps[1].status).toBe('funded')
    expect(apps[1].fundsAsked).toEqual([{ amount: '50', denomination: 'TEST' }])
  })
  it('publishes no payoutAddress, projectsURI, projectId, and no beneficiary anywhere', () => {
    const b = build(true, undefined, r => {
      for (const p of r.grants.facts.proposals) { p.beneficiary = caip10(CELO, A.a4); p.beneficiaryAddress = A.a4 }
    })
    const s = JSON.stringify(b.apps)
    for (const w of ['payoutAddress', 'projectsURI', 'projectId']) expect(s).not.toContain(w)
    expect(s.toLowerCase()).not.toContain(A.a4.slice(2).toLowerCase())
    expect(s).not.toContain('WITHHELD-')
    expect(validateStandards({ 'applications.json': b.apps })).toEqual([])
  })
  it('a signaling pool has applications without fundsAsked', () => {
    const b = build(true, undefined, r => { r.grants.facts.type = 'signaling' })
    const apps = (b.apps as any).grantPools[0].applications as any[]
    expect(apps.length).toBe(2)
    for (const a of apps) expect(a).not.toHaveProperty('fundsAsked')
    expect(b.pools.doc).toBeNull()
  })
  it('maps every Gardens status and skips an unknown one', () => {
    const b = build(true, undefined, r => {
      const f = r.grants.facts
      f.proposals = ['inactive', 'paused', 'cancelled', 'disputed', 'rejected', 'weird'].map((status, n) => ({ id: `${POOL}-${n + 1}`, number: n + 1, status, title: `T${n}`, requested: '1', created: 1791000000 + n, executed: null }))
    })
    const apps = (b.apps as any).grantPools[0].applications as any[]
    expect(apps.map(a => a.status)).toEqual(['pending', 'in_review', 'rejected', 'in_review', 'rejected', undefined])
  })
  it('is null without a pool read, and carries nothing from a pool with no proposals', () => {
    expect(build(false).apps).toBeNull()
    const none = build(true, undefined, r => { r.grants.facts.proposals = [] })
    expect((none.apps as any).grantPools[0].applications).toEqual([])
  })
})
