// packages/admin/tests/lib/deployments.test.ts
//
// The values are spec §3's table (docs/superpowers/specs/2026-10-30-dao-os-l7-compose-deploy-design.md), read 2026-10-30 from
// the sources each `sources` entry names.
import { describe, it, expect } from 'vitest'
import { DEPLOYMENTS, deploymentsOn } from '../../lib/deployments.mjs'
import { isAddress } from '../../lib/caip.mjs'
import { checksumAddress } from '../../lib/caip.mjs'

const SEPOLIA = 'eip155:11155111'

describe('DEPLOYMENTS', () => {
  it('has Sepolia only, with the spec §3 addresses exactly', () => {
    expect(Object.keys(DEPLOYMENTS)).toEqual([SEPOLIA])
    const d = DEPLOYMENTS[SEPOLIA]
    expect(d.safe).toEqual({
      version: '1.4.1',
      proxyFactory: '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67',
      singletonL2: '0x29fcB43b46531BcA003ddC8FCB67FFE91900C762',
      fallbackHandler: '0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99',
      multiSend: '0x38869bf66a61cF6bDB996A6aE40D5853Fd43B526',
      multiSendCallOnly: '0x9641d764fc13c8B624c04430C7356C1C7C8102e2',
    })
    expect(d.hats).toEqual({ version: 'v1', address: '0x3bc1A0Ad72417f2d411118085256fC53CBdDd137' })
    expect(d.hsg).toEqual({ version: '2.0.0', implementation: '0x148057884AC910Bdd93693F230C5c35a8c47CA3b', moduleProxyFactory: '0x000000000000aDdB49795b0f9bA5BC298cDda236' })
    expect(d.ens).toEqual({ universalResolver: '0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe' })
  })
  it('keeps every address checksummed and sourced by an https URL', () => {
    const d = DEPLOYMENTS[SEPOLIA]
    const paths: string[] = []
    for (const [group, rec] of Object.entries(d)) {
      if (group === 'sources') continue
      for (const [k, v] of Object.entries(rec as Record<string, string>)) {
        if (!/^0x/.test(v)) continue
        expect(isAddress(v) && checksumAddress(v) === v, `${group}.${k}`).toBe(true)
        paths.push(`${group}.${k}`)
      }
    }
    expect(paths.length).toBe(9)
    for (const p of paths) expect(d.sources[p], `source for ${p}`).toMatch(/^https:\/\//)
    expect(Object.keys(d.sources).sort()).toEqual([...paths].sort())
  })
})

describe('deploymentsOn', () => {
  it('returns Sepolia and refuses every other chain', () => {
    expect(deploymentsOn(SEPOLIA)).toBe(DEPLOYMENTS[SEPOLIA])
    expect(() => deploymentsOn('eip155:42220')).toThrow('Deploying is built for Sepolia (eip155:11155111) only.')
    expect(() => deploymentsOn('constructor')).toThrow('Deploying is built for Sepolia (eip155:11155111) only.')
  })
})
