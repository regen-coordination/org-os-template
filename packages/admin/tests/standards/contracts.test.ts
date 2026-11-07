import { describe, it, expect } from 'vitest'
import { projectPublic } from '../../lib/standards/project.mjs'
import { contractsDoc, registrationProblems } from '../../lib/standards/contracts.mjs'
import { validateStandards } from '../../lib/standards/validate.mjs'
import { HATS_V1 } from '../../lib/hats.mjs'
import { caip10 } from '../../lib/caip.mjs'
import { fixtureInput, fixtureReads, SAFE, POOL, CELO, ETHEREUM, A } from './fixtures.ts'

const build = (reads = false, edit?: (i: ReturnType<typeof fixtureInput>) => void) => {
  const input = fixtureInput(reads ? { reads: fixtureReads() } : {})
  edit?.(input)
  return contractsDoc(projectPublic(input).pub)
}
const entries = (r: ReturnType<typeof build>) => (r.doc as any).contracts as any[]
const byId = (r: ReturnType<typeof build>, id: string) => entries(r).find(e => e.id === id)

describe('contractsDoc', () => {
  it('the public Safe on two chains is two entries', () => {
    const r = build()
    for (const chain of [CELO, ETHEREUM]) {
      const e = byId(r, caip10(chain, SAFE))
      expect(e.name).toBe('SHOWN-10 Treasury')
      expect(e.extensions['org-os.kind']).toBe('safe')
      expect(e.extensions['org-os.system']).toBe('treasury')
    }
  })
  it('the hats tree is the tree id, naming Hats v1', () => {
    const e = byId(build(), 'eip155:42220:13')
    expect(e.extensions['org-os.contract']).toBe(`eip155:42220:${HATS_V1}`)
  })
  it('the Gardens pool and a registration System are entries, with the registration defaults', () => {
    const r = build(false, i => {
      i.records.systems.push({ id: 'reg', kind: 'daouri-registration', chain: CELO, address: A.a4, driver: 'daouri-registration' })
    })
    expect(byId(r, caip10(CELO, POOL)).name).toBe('SHOWN-14 Community grants')
    const reg = byId(r, caip10(CELO, A.a4))
    expect(reg.name).toBe('Registration contract')
    expect(reg.description).toBe('ERC-4824 registration contract')
  })
  it('Snapshot, links and the members-level Safe are absent', () => {
    const r = build()
    const s = JSON.stringify(r.doc).toLowerCase()
    expect(s).not.toContain('snapshot')
    expect(s).not.toContain('forum')
    expect(s).not.toContain(A.a9.slice(2))
    expect(entries(r).length).toBe(4)
  })
  it('checksums a lower-case address; an unquoted one is skipped and named', () => {
    const r = build(false, i => {
      i.records.systems.push({ id: 'num-pool', kind: 'gardens-pool', name: 'Numeric', chain: CELO, address: 1234567, driver: 'gardens-pool' })
    })
    expect(byId(r, caip10(CELO, SAFE))).toBeTruthy()
    expect(entries(r).some(e => e.extensions['org-os.system'] === 'num-pool')).toBe(false)
    expect(r.problems.some(p => p.level === 'warn' && p.file === 'contracts.json' && p.text.includes('num-pool'))).toBe(true)
  })
  it('with reads, a Safe carries threshold, a signer count and readAt per chain; no owner address anywhere', () => {
    const r = build(true)
    for (const chain of [CELO, ETHEREUM]) {
      const x = byId(r, caip10(chain, SAFE)).extensions
      expect(x['org-os.threshold']).toBe(2)
      expect(x['org-os.signers']).toBe(4)
      expect(x['org-os.readAt']).toBe('2026-10-29T09:00:00.000Z')
    }
    const s = JSON.stringify(r.doc).toLowerCase()
    for (const a of [A.a1, A.a2, A.a3, A.a4]) expect(s).not.toContain(a.slice(2))
  })
  it('a single-chain Safe takes the top-level facts', () => {
    const r = build(true, i => { i.records.systems[0] = { ...(i.records.systems[0] as object), chains: undefined } as any })
    const x = byId(r, caip10(CELO, SAFE)).extensions
    expect(x['org-os.threshold']).toBe(2)
    expect(x['org-os.signers']).toBe(4)
  })
  it('is sorted by id, and passes validateStandards', () => {
    for (const reads of [false, true]) {
      const r = build(reads)
      const ids = entries(r).map(e => e.id)
      expect(ids).toEqual([...ids].sort())
      expect(validateStandards({ 'contracts.json': r.doc })).toEqual([])
      expect(JSON.stringify(r.doc)).not.toMatch(/null|""/)
    }
  })
})

describe('registrationProblems', () => {
  const REG = 'registry'
  const pubWith = (daoURI: string | null | undefined) => {
    const input = fixtureInput({ reads: fixtureReads() })
    ;(input.records.systems as any[]).push({ id: REG, kind: 'daouri-registration', chain: CELO, address: A.a4, driver: 'daouri-registration' })
    if (daoURI !== undefined) (input.reads as any)[REG] = { ok: true, readAt: '2026-10-29T09:00:00.000Z', facts: { chain: CELO, account: caip10(CELO, A.a4), daoURI }, sections: [] }
    return projectPublic(input).pub
  }
  it('a registered daoURI that differs is one warn naming the System and both URIs', () => {
    const pub = pubWith('https://other.example.org/dao.json')
    const r = registrationProblems(pub)
    expect(r).toHaveLength(1)
    expect(r[0].level).toBe('warn')
    expect(r[0].file).toBe('dao.json')
    expect(r[0].text).toContain(REG)
    expect(r[0].text).toContain('https://other.example.org/dao.json')
    expect(r[0].text).toContain(String(pub.identity.daoURI))
  })
  it('the same daoURI is no problem', () => {
    const pub = pubWith('x'); expect(registrationProblems(projectPublic(Object.assign(fixtureInput(), {})).pub)).toEqual([])
    const same = pubWith(String(pub.identity.daoURI)); expect(registrationProblems(same)).toEqual([])
  })
  it('no read, or a null daoURI, is no problem', () => {
    expect(registrationProblems(pubWith(undefined))).toEqual([])
    expect(registrationProblems(pubWith(null))).toEqual([])
  })
})
