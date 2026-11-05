import { describe, it, expect } from 'vitest'
import { validateStandards, SCHEMA_OF, MECHANISMS, APPLICATION_STATUSES } from '../../lib/standards/validate.mjs'

type Doc = Record<string, any>
const texts = (files: Record<string, unknown>) => validateStandards(files).map((p: any) => p.text) as string[]
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x))

// EIP-4824 DAO JSON-LD Schema: https://github.com/ethereum/ERCs/blob/7e4222187c557efb31d728ded3ac4716342164fc/ERCS/erc-4824.md
const dao: Doc = {
  '@context': 'http://www.daostar.org/schemas', type: 'DAO', name: 'Test DAO', description: 'A test DAO',
  membersURI: 'https://dao.example.org/.well-known/members.json', proposalsURI: 'https://dao.example.org/.well-known/proposals.json',
  activityLogURI: 'https://dao.example.org/.well-known/activities.json', governanceURI: 'https://dao.example.org/.well-known/governance.md',
  contractsURI: 'https://dao.example.org/.well-known/contracts.json',
}
// EIP-4824 Members JSON-LD Schema (same URL)
const members: Doc = { '@context': 'https://www.daostar.org/schemas', type: 'DAO', members: [{ id: 'eip155:1:0x00000000000000000000000000000000000000a1' }, { id: 'did:ethr:0x00000000000000000000000000000000000000a2' }] }
// EIP-4824 Proposals JSON-LD Schema (same URL)
const proposals: Doc = { '@context': 'https://www.daostar.org/schemas', proposals: [{
  type: 'proposal', id: 'eip155:1:0x00000000000000000000000000000000000000a1?proposalId=1', name: 'Fund the thing',
  contentURI: 'https://dao.example.org/p/1', discussionURI: 'https://dao.example.org/d/1', status: 'passed',
  calls: [{ type: 'CallDataEVM', operation: 'call', from: '0x00000000000000000000000000000000000000a1', to: '0x00000000000000000000000000000000000000a2', value: '0', data: '0x' }] }] }
// EIP-4824 Activity Log JSON-LD Schema (same URL)
const activities: Doc = { '@context': 'https://www.daostar.org/schemas', activities: [{ id: 'act-1', type: 'activity',
  proposal: { type: 'proposal', id: 'p-1' }, member: { id: 'eip155:1:0x00000000000000000000000000000000000000a1' } }] }
// EIP-4824 Contracts JSON-LD Schema (same URL)
const contracts: Doc = { '@context': 'https://www.daostar.org/schemas', contracts: [{ id: 'eip155:1:0x0000000000000000000000000000000000005afe', name: 'Treasury', description: 'Primary operating treasury' }] }
// DAOIP-5 Grant Pool JSON-LD Schema: https://github.com/metagov/daostar/blob/c71b94ba47cd9d09bae9afb530bdb70c640e25cc/DAOIPs/daoip-5.md
const pools: Doc = { '@context': 'http://www.daostar.org/schemas', name: 'Test DAO', type: 'DAO', grantPools: [{
  type: 'GrantPool', id: 'eip155:1:0x000000000000000000000000000000000000b001', name: 'Pool', description: 'A pool',
  grantFundingMechanism: 'Direct Grants', isOpen: true, closeDate: '2026-12-31T23:59:59Z', applicationsURI: 'https://dao.example.org/.well-known/applications.json',
  governanceURI: 'https://dao.example.org/.well-known/governance.md', attestationIssuersURI: 'https://dao.example.org/.well-known/attestation-issuers.json',
  requiredCredentials: ['DAOContributor'], totalGrantPoolSize: [{ amount: '100', denomination: 'USDC' }], totalGrantPoolSizeInUSD: '100',
  email: 'grants@example.org', image: 'https://dao.example.org/i.png', coverImage: 'https://dao.example.org/c.png', extensions: { 'org-os.readAt': '2026-10-29T00:00:00Z' } }] }
// DAOIP-5 Applications JSON-LD Schema (same URL)
const apps: Doc = { '@context': 'http://www.daostar.org/schemas', name: 'Test DAO', type: 'DAO', grantPools: [{ type: 'GrantPool', name: 'Pool', applications: [{
  type: 'GrantApplication', id: 'a-1', grantPoolId: 'eip155:1:0x000000000000000000000000000000000000b001', grantPoolName: 'Pool',
  createdAt: '2026-10-29T10:00:00Z', projectName: 'Proj', contentURI: 'https://dao.example.org/a/1', fundsAsked: [{ amount: '5', denomination: 'USDC' }], status: 'pending' }] }] }
// DAOIP-3 attestationIssuers: https://github.com/metagov/daostar/blob/fec9462c5e10d79a5a43c7649630e3db24b9e672/DAOIPs/daoip-3.md
const issuers: Doc = { '@context': 'http://www.daostar.org/schemas', attestationIssuers: [{ type: 'AttestationIssuer', name: 'Issuer', issuer: 'https://issuer.example.org/' }] }

const good: Record<string, Doc> = { 'dao.json': dao, 'members.json': members, 'proposals.json': proposals, 'activities.json': activities,
  'contracts.json': contracts, 'grant-pools.json': pools, 'applications.json': apps, 'attestation-issuers.json': issuers }

describe('standards schemas', () => {
  it('maps eight outputs to eight schemas', () => {
    expect(Object.keys(SCHEMA_OF)).toHaveLength(8)
    expect(MECHANISMS).toHaveLength(31)
    expect(APPLICATION_STATUSES).toEqual(['pending', 'in_review', 'approved', 'funded', 'rejected', 'completed'])
  })
  for (const [file, d] of Object.entries(good)) {
    it(`the template for ${file}, filled with examples, validates`, () => {
      expect(validateStandards({ [file]: d })).toEqual([])
    })
  }
  it('skips files with no schema', () => {
    expect(validateStandards({ 'governance.md': '# x', 'meetings.json': {} })).toEqual([])
  })
  it('a missing required field is an error naming it', () => {
    const d = clone(dao); delete d.name
    expect(texts({ 'dao.json': d }).join('\n')).toMatch(/"name"/)
    const p = clone(pools); delete p.grantPools[0].totalGrantPoolSizeInUSD
    expect(texts({ 'grant-pools.json': p }).join('\n')).toMatch(/"totalGrantPoolSizeInUSD"/)
    const a = clone(activities); delete a.activities[0].proposal
    expect(texts({ 'activities.json': a }).join('\n')).toMatch(/"proposal"/)
  })
  it('names file and JSON pointer', () => {
    const p = clone(pools); p.grantPools[0].isOpen = 'yes'
    const [e] = validateStandards({ 'grant-pools.json': p })
    expect(e).toMatchObject({ level: 'error', file: 'grant-pools.json' })
    expect(e.text).toContain('/grantPools/0/isOpen')
  })
  it('a wrong @context is an error', () => {
    expect(validateStandards({ 'dao.json': { ...dao, '@context': 'https://www.daostar.org/schemas' } }).length).toBeGreaterThan(0)
    expect(validateStandards({ 'members.json': { ...members, '@context': 'http://www.daostar.org/schemas' } }).length).toBeGreaterThan(0)
  })
  it('null and "" are errors anywhere', () => {
    expect(validateStandards({ 'dao.json': { ...dao, description: '' } }).length).toBeGreaterThan(0)
    const c = clone(contracts); c.contracts[0].name = null
    expect(validateStandards({ 'contracts.json': c }).length).toBeGreaterThan(0)
    const p = clone(pools); p.grantPools[0].extensions = { 'org-os.x': { deep: [null] } }
    expect(validateStandards({ 'grant-pools.json': p }).length).toBeGreaterThan(0)
    expect(validateStandards({ 'dao.json': { ...dao, 'org-os.extra': '' } }).length).toBeGreaterThan(0)
  })
  it('membersURI together with members is an error', () => {
    expect(validateStandards({ 'dao.json': { ...dao, members: { '@context': 'https://www.daostar.org/schemas', members: [] } } }).length).toBeGreaterThan(0)
    const { membersURI, ...rest } = dao
    expect(validateStandards({ 'dao.json': { ...rest, members: [] } })).toEqual([])
  })
  it('a mechanism outside the 31 is an error', () => {
    const p = clone(pools); p.grantPools[0].grantFundingMechanism = 'Quadratic voting'
    expect(validateStandards({ 'grant-pools.json': p }).length).toBeGreaterThan(0)
  })
  it('an application status outside the six is an error', () => {
    const a = clone(apps); a.grantPools[0].applications[0].status = 'withdrawn'
    expect(validateStandards({ 'applications.json': a }).length).toBeGreaterThan(0)
  })
  it('type literals and formats are enforced', () => {
    const p = clone(proposals); p.proposals[0].type = 'Proposal'
    expect(validateStandards({ 'proposals.json': p }).length).toBeGreaterThan(0)
    const a = clone(apps); a.grantPools[0].applications[0].createdAt = 'yesterday'
    expect(validateStandards({ 'applications.json': a }).length).toBeGreaterThan(0)
    expect(validateStandards({ 'dao.json': { ...dao, membersURI: 'not a uri' } }).length).toBeGreaterThan(0)
  })
})
