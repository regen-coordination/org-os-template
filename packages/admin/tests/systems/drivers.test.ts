import { describe, it, expect } from 'vitest'
import { DRIVERS } from '../../server/systems/drivers.ts'

const EXPECTED_HOSTS: Record<string, string[]> = {
  link: [],
  safe: ['api.safe.global'],
  'hats-tree': ['forno.celo.org', 'celo.blockscout.com'],
  'snapshot-space': ['hub.snapshot.org'],
  'gardens-community': ['api.studio.thegraph.com', 'forno.celo.org'],
  'gardens-pool': ['api.studio.thegraph.com', 'forno.celo.org'],
}

describe('DRIVERS', () => {
  it('are, in this order, the seven the framework knows', () => {
    expect(DRIVERS.map(d => d.name)).toEqual(['link', 'safe', 'hats-tree', 'snapshot-space', 'gardens-community', 'gardens-pool', 'daouri-registration'])
  })
  it('declare host names only: no scheme, path or port', () => {
    for (const d of DRIVERS) for (const h of d.hosts) expect(h, `${d.name}: ${h}`).toMatch(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/)
  })
  it('declare every host their fixtures were fetched from', () => {
    for (const d of DRIVERS) expect(d.hosts, d.name).toEqual(expect.arrayContaining(EXPECTED_HOSTS[d.name] ?? []))
  })
})
