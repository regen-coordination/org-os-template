import { describe, it, expect } from 'vitest'
import {
  entityType, originOf, wellKnown, memberUri, proposalUri, snapshotProposalUri,
  systemChains, contractIdsOf, grantPoolId, applicationId,
} from '../../lib/standards/ids.mjs'

const A1 = '0x00000000000000000000000000000000000000a1'

describe('entityType (L8-C5)', () => {
  it('maps all ten federation identity types', () => {
    const map: Record<string, string> = {
      DAO: 'DAO', Foundation: 'Foundation', PersonalNode: 'Person', Other: 'Entity',
      Cooperative: 'Organization', Project: 'Organization', LocalNode: 'Organization',
      RegionalNode: 'Organization', Hub: 'Organization', Network: 'Organization',
    }
    expect(Object.keys(map)).toHaveLength(10)
    for (const [k, v] of Object.entries(map)) expect(entityType(k)).toBe(v)
  })
  it('reads an unknown type as Organization', () => expect(entityType('Whatever')).toBe('Organization'))
})

describe('uris', () => {
  it('originOf', () => {
    expect(originOf('https://dao.example.org/.well-known/dao.json')).toBe('https://dao.example.org')
    expect(originOf('')).toBeNull()
    expect(originOf('http://dao.example.org/x')).toBeNull()
    expect(originOf('not a url')).toBeNull()
    expect(originOf(undefined)).toBeNull()
  })
  it('wellKnown', () => expect(wellKnown('https://dao.example.org', 'dao.json')).toBe('https://dao.example.org/.well-known/dao.json'))
  it('memberUri keeps a scheme and escapes a slug', () => {
    expect(memberUri(`did:ethr:${A1}`, 'https://dao.example.org')).toBe(`did:ethr:${A1}`)
    expect(memberUri('github:steward-a', 'https://dao.example.org')).toBe('github:steward-a')
    expect(memberUri('steward-a', 'https://dao.example.org')).toBe('https://dao.example.org/members/steward-a')
    expect(memberUri('steward a', 'https://dao.example.org')).toBe('https://dao.example.org/members/steward%20a')
  })
  it('proposalUri escapes ? and #', () => {
    expect(proposalUri('https://dao.example.org', 'p-1')).toBe('https://dao.example.org?proposalId=p-1')
    expect(proposalUri('https://dao.example.org', 'a?b#c')).toBe('https://dao.example.org?proposalId=a%3Fb%23c')
  })
  it('snapshotProposalUri', () => {
    expect(snapshotProposalUri('test.eth', '0xabc')).toBe('https://snapshot.box/#/s:test.eth/proposal/0xabc')
  })
})

describe('chains and contract ids', () => {
  it('systemChains: chain then chains, no repeat', () => {
    expect(systemChains({ chain: 'eip155:42220', chains: ['eip155:1', 'eip155:42220'] })).toEqual(['eip155:42220', 'eip155:1'])
    expect(systemChains({})).toEqual([])
  })
  it('a multi-chain Safe gives one id per chain, Celo first', () => {
    const ids = contractIdsOf({ kind: 'safe', chain: 'eip155:42220', chains: ['eip155:1', 'eip155:42220'], address: A1 })
    expect(ids).toEqual([
      { id: 'eip155:42220:0x00000000000000000000000000000000000000A1', chain: 'eip155:42220' },
      { id: 'eip155:1:0x00000000000000000000000000000000000000A1', chain: 'eip155:1' },
    ].map(x => ({ ...x, id: x.id })))
  })
  it('checksums a lower-case Safe address (EIP-55: https://eips.ethereum.org/EIPS/eip-55)', () => {
    const ids = contractIdsOf({ kind: 'safe', chain: 'eip155:1', address: '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed' })
    expect(ids).toEqual([{ id: 'eip155:1:0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', chain: 'eip155:1' }])
  })
  it('a hats tree address 13 on Celo is eip155:42220:13, and 0x0000000d the same', () => {
    expect(contractIdsOf({ kind: 'hats-tree', chain: 'eip155:42220', address: '13' })).toEqual([{ id: 'eip155:42220:13', chain: 'eip155:42220' }])
    expect(contractIdsOf({ kind: 'hats-tree', chain: 'eip155:42220', address: '0x0000000d' })[0].id).toBe('eip155:42220:13')
    expect(contractIdsOf({ kind: 'hats-tree', chain: 'eip155:42220', address: 13 })[0].id).toBe('eip155:42220:13')
  })
  it('gardens and registration give one CAIP-10', () => {
    for (const kind of ['gardens-community', 'gardens-pool', 'daouri-registration']) {
      expect(contractIdsOf({ kind, chain: 'eip155:42220', address: A1 })).toHaveLength(1)
    }
  })
  it('snapshot-space, link and unknown kinds give []', () => {
    expect(contractIdsOf({ kind: 'snapshot-space', space: 'test.eth' })).toEqual([])
    expect(contractIdsOf({ kind: 'link', url: 'https://dao.example.org' })).toEqual([])
    expect(contractIdsOf({ kind: 'other' })).toEqual([])
  })
  it('a Safe kind with no driver, or with driver link, is still a Safe contract', () => {
    const want = [{ id: 'eip155:1:0x00000000000000000000000000000000000000A1', chain: 'eip155:1' }]
    expect(contractIdsOf({ kind: 'safe', chain: 'eip155:1', address: A1 })).toEqual(want)
    expect(contractIdsOf({ kind: 'safe', driver: 'link', chain: 'eip155:1', address: A1 })).toEqual(want)
  })
  it('a hats tree with a non-numeric address gives []', () => {
    expect(contractIdsOf({ kind: 'hats-tree', chain: 'eip155:42220', address: 'abc' })).toEqual([])
  })
  it('a driver alone is not read: a record with only driver gives []', () => {
    expect(contractIdsOf({ driver: 'safe', chain: 'eip155:1', address: A1 })).toEqual([])
  })
  it('a non-string address (YAML read it as a number) gives no id and does not throw', () => {
    expect(contractIdsOf({ kind: 'safe', chain: 'eip155:1', address: 160 })).toEqual([])
    expect(contractIdsOf({ kind: 'gardens-pool', chain: 'eip155:1', address: 'nope' })).toEqual([])
  })
})

describe('grant pools and applications', () => {
  it('on chain the pool id is its CAIP-10', () => {
    expect(grantPoolId({ id: 'pool-a', kind: 'gardens-pool', chain: 'eip155:42220', address: A1 }, 'Test DAO'))
      .toBe('eip155:42220:0x00000000000000000000000000000000000000A1')
  })
  it('off chain it is daoip-5:<org>:grantPool:<id>', () => {
    expect(grantPoolId({ id: 'pool-a' }, 'Test DAO')).toBe('daoip-5:Test DAO:grantPool:pool-a')
  })
  it('applicationId', () => {
    expect(applicationId('eip155:42220:0x00000000000000000000000000000000000000A1', 7)).toBe('eip155:42220:0x00000000000000000000000000000000000000A1?proposalId=7')
  })
})
