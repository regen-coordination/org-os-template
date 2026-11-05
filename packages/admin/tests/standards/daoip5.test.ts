import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { MECHANISMS, APPLICATION_STATUSES } from '../../lib/standards/daoip5.mjs'

const lib = (rel: string) => new URL(`../../lib/standards/${rel}`, import.meta.url)
const schema = (rel: string) => JSON.parse(readFileSync(new URL(`../../schemas/${rel}`, import.meta.url), 'utf8'))

describe('daoip5.mjs', () => {
  it('its lists equal the enums of the schemas', () => {
    const pools = schema('standards/daoip5-grant-pools.schema.json').properties.grantPools.items.properties.grantFundingMechanism.enum
    const apps = schema('standards/daoip5-applications.schema.json').properties.grantPools.items.properties.applications.items.properties.status.enum
    const sys = schema('systems.schema.json').properties.grant_pool.oneOf.find((o: any) => o.type === 'object').properties.mechanism.enum
    expect(MECHANISMS).toEqual(pools)
    expect(MECHANISMS).toEqual(sys)
    expect(MECHANISMS).toHaveLength(31)
    expect(APPLICATION_STATUSES).toEqual(apps)
    expect(Object.isFrozen(MECHANISMS) && Object.isFrozen(APPLICATION_STATUSES)).toBe(true)
  })
  it('has no imports at all', () => {
    expect(readFileSync(lib('daoip5.mjs'), 'utf8')).not.toMatch(/^\s*import\b|\bimport\s*\(|\brequire\s*\(/m)
  })
  it('grants.mjs reaches no npm package and no node: module through its relative imports', () => {
    const seen = new Set<string>()
    const walk = (rel: string) => {
      if (seen.has(rel)) return
      seen.add(rel)
      const src = readFileSync(new URL(rel, lib('grants.mjs')), 'utf8')
      for (const m of src.matchAll(/^\s*(?:import|export)\b[^'"\n]*?from\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm)) {
        const spec = (m[1] ?? m[2])!
        expect(spec.startsWith('./') || spec.startsWith('../'), `${rel} imports ${spec}`).toBe(true)
        walk(new URL(spec, new URL(rel, lib('grants.mjs'))).pathname.replace(lib('').pathname, ''))
      }
      expect(src.replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, ''), rel).not.toMatch(/\bimport\s*\(|\brequire\s*\(/)
    }
    walk('grants.mjs')
    expect(seen.has('daoip5.mjs')).toBe(true)
    expect(seen.has('validate.mjs')).toBe(false)
  })
})
