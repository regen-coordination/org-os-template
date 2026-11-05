// buildStandards (lane L8, Task 12): projection → documents → leak scan → schema validation, and what the CLI writes.
import { describe, it, expect } from 'vitest'
import { buildStandards, STANDARD_FILES } from '../../lib/standards/index.mjs'
import { buildCore, planWrites, serializeFile } from '../../lib/standards/build.mjs'
import { validateStandards } from '../../lib/standards/validate.mjs'
import { fixtureInput, fixtureReads, A, POOL, addr, withheldPoolInput, BENEFICIARY, POOL_PAGE, SNAPSHOT_VOTE } from './fixtures.ts'
import { projectPublic, checkNoLeak } from '../../lib/standards/project.mjs'
import { snapshotLink } from '../../server/systems/snapshot.ts'
import type { StandardsInput } from '../../lib/standards/project.mjs'

/** The fixture made complete for DAOIP-5: the Gardens pool states its value in US dollars (its token is no stablecoin). */
function complete(input: StandardsInput): StandardsInput {
  const grants = (input.records.systems as Record<string, unknown>[]).find(s => s.id === 'grants')!
  grants.grant_pool = { mechanism: 'Conviction Voting', usd: { amount: 1000, as_of: '2026-10-29T00:00:00Z' } }
  return input
}
const gitCopy = () => buildStandards(fixtureInput())
const liveCopy = () => buildStandards(complete(fixtureInput({ reads: fixtureReads() })))
/** Every file as the CLI writes it, joined. */
const serialised = (files: Record<string, unknown>) => Object.keys(files).map(f => serializeFile(f, files[f])).join('\n')

describe('STANDARD_FILES', () => {
  it('names the fourteen files, in order', () => {
    expect(STANDARD_FILES).toEqual(['dao.json', 'members.json', 'proposals.json', 'activities.json', 'contracts.json', 'governance.md',
      'grant-pools.json', 'applications.json', 'attestation-issuers.json', 'meetings.json', 'projects.json', 'finances.json', 'ideas.json', 'knowledge.json'])
  })
})

describe('buildStandards: the two copies', () => {
  it('the git copy: every file but applications.json, grant pools with their sizes warned, no reads', () => {
    const out = gitCopy()
    expect(Object.keys(out.files)).toEqual(['dao.json', 'members.json', 'proposals.json', 'activities.json', 'contracts.json', 'governance.md',
      'grant-pools.json', 'attestation-issuers.json', 'meetings.json', 'projects.json', 'finances.json', 'ideas.json', 'knowledge.json'])
    expect(out.problems.filter(p => p.file === 'grant-pools.json' && p.level === 'warn').map(p => p.text).join('\n')).toMatch(/totalGrantPoolSize is absent/)
    expect(out.reads).toEqual([])
    const dao = out.files['dao.json'] as Record<string, unknown>
    expect(dao.grantPoolsURI).toBe('https://dao.example.org/.well-known/grant-pools.json')
    expect(dao.attestationIssuersURI).toBe('https://dao.example.org/.well-known/attestation-issuers.json')
    expect(dao).not.toHaveProperty('projectsURI')
    expect(dao.governanceURI).toBe('https://dao.example.org/.well-known/governance.md')
    expect(typeof out.files['governance.md']).toBe('string')
  })

  it('the live copy: applications.json appears, grant pools are conformant, each read is listed with its time', () => {
    const out = liveCopy()
    expect(Object.keys(out.files)).toContain('applications.json')
    expect(out.problems.filter(p => p.level === 'error')).toEqual([])
    expect(out.problems.filter(p => p.file === 'grant-pools.json')).toEqual([])
    expect(out.reads.map(r => r.system)).toEqual(['grants', 'roles', 'treasury', 'votes'])   // the members-level Safe's read is dropped
    expect(out.reads.every(r => r.readAt === '2026-10-29T09:00:00.000Z')).toBe(true)
  })

  it('without attestation issuers there is no attestation-issuers.json and dao.json does not point to one', () => {
    const input = fixtureInput()
    delete input.identity.attestationIssuers
    const out = buildStandards(input)
    expect(out.files).not.toHaveProperty('attestation-issuers.json')
    expect(out.files['dao.json']).not.toHaveProperty('attestationIssuersURI')
  })

  it('every document passes validateStandards when the fixture is complete', () => {
    const out = liveCopy()
    expect(Object.keys(out.files)).toHaveLength(STANDARD_FILES.length)   // not vacuous: every file is there
    expect(validateStandards(out.files)).toEqual([])
  })

  it('the core without validation writes the same files (the vendored builder of an instance)', () => {
    for (const make of [() => fixtureInput(), () => complete(fixtureInput({ reads: fixtureReads() }))]) {
      expect(planWrites(buildCore(make()))).toEqual(planWrites(buildStandards(make())))
    }
  })

  it('schema problems are reported and change nothing that is written', () => {
    const out = gitCopy()   // the Gardens pool has no size and no isOpen without a read
    expect(out.problems.some(p => p.level === 'error' && p.file === 'grant-pools.json' && /daoip5-grant-pools/.test(p.text))).toBe(true)
    expect(planWrites(out).refuse).toBe(false)
  })

  it('two runs on the same input give the same bytes', () => {
    expect(planWrites(gitCopy())).toEqual(planWrites(gitCopy()))
    expect(planWrites(liveCopy())).toEqual(planWrites(liveCopy()))
    expect(serialised(gitCopy().files)).toBe(serialised(gitCopy().files))
  })
})

describe('buildStandards: nothing stricter than public', () => {
  /** SHOWN- markers each copy must carry: the public strings some builder publishes. */
  const SHOWN_GIT = ['SHOWN-1 ', 'SHOWN-2 ', 'SHOWN-10 ', 'SHOWN-12 ', 'SHOWN-13 ', 'SHOWN-14 ', 'SHOWN-15 ', 'SHOWN-20 ', 'SHOWN-21 ',
    'SHOWN-30 ', 'SHOWN-31 ', 'SHOWN-32 ', 'SHOWN-40 ', 'SHOWN-41 ', 'SHOWN-42 ']
  const SHOWN_LIVE = [...SHOWN_GIT, 'SHOWN-54 ', 'SHOWN-55 ', 'SHOWN-56 ', 'SHOWN-57 ']

  for (const [copy, build, shown] of [['git', gitCopy, SHOWN_GIT], ['live', liveCopy, SHOWN_LIVE]] as const) {
    it(`the ${copy} copy: no file contains a WITHHELD- canary, and every expected SHOWN- marker is there`, () => {
      const out = build()
      const all = serialised(out.files)
      expect(all).not.toContain('WITHHELD-')
      for (const s of shown) expect(all, s).toContain(s)
      expect(out.problems.filter(p => /withheld value/.test(p.text))).toEqual([])
    })
  }

  it('no Safe owner address appears in any file, in any case', () => {
    for (const out of [gitCopy(), liveCopy()]) {
      const all = serialised(out.files).toLowerCase()
      for (const owner of [A.a1, A.a2, A.a3, A.a4]) expect(all, owner).not.toContain(owner.slice(2).toLowerCase())
    }
  })

  it('a builder made to leak: an error problem, no files, and the CLI path writes nothing', () => {
    const out = buildStandards(fixtureInput(), {
      afterProject(pub) {
        const treasury = pub.systems.find(s => s.id === 'treasury')!
        treasury.name = 'WITHHELD-10-xxxxxx: moderator rota'   // the forum's members-level field `notes`, set on a public field
      },
    })
    const leaks = out.problems.filter(p => p.level === 'error' && p.file === 'contracts.json')
    expect(leaks).toHaveLength(1)
    expect(leaks[0]!.text).not.toContain('WITHHELD-')
    expect(out.files).toEqual({})
    expect(planWrites(out)).toEqual({ refuse: true, write: {}, remove: [] })
  })

  it('a daoURI that is not an https URL: an error, no files, nothing written', () => {
    const out = buildStandards(fixtureInput({ identity: { ...fixtureInput().identity, daoURI: 'http://dao.example.org/.well-known/dao.json' } }))
    expect(out.problems.some(p => p.level === 'error' && p.file === 'federation.yaml')).toBe(true)
    expect(out.files).toEqual({})
    expect(planWrites(out).refuse).toBe(true)
  })

  it('a public Gardens pool whose address and community are members-level, with a live read: no address anywhere, no applications.json (C1)', () => {
    const out = buildStandards(withheldPoolInput())
    expect(out.files).not.toHaveProperty('applications.json')
    expect(out.reads).toEqual([])
    const all = serialised(out.files).toLowerCase()
    expect(all).not.toContain(POOL.slice(2).toLowerCase())
    expect(all).not.toContain(addr('c0c0').slice(2).toLowerCase())
    expect(all).not.toContain('app.gardens.fund')
    expect(out.withheld).toContainEqual({ collection: 'systems', records: 0, fields: 2, reads: 1 })
    expect(out.files).toHaveProperty('grant-pools.json')   // the pool is still listed, from its public view
    expect(out.problems.filter(p => /withheld value/.test(p.text))).toEqual([])
  })

  it('a C1 pool whose read carries driver-shaped sections (its page on every proposal row) still publishes no address (C1, R38)', () => {
    const input = withheldPoolInput()
    expect(JSON.stringify(input.reads!['pool-a']!.sections)).toContain(POOL.slice(2).toLowerCase())   // not vacuous
    const out = buildStandards(input)
    const all = serialised(out.files).toLowerCase()
    expect(all).not.toContain(POOL.slice(2).toLowerCase())
    expect(all).not.toContain(addr('c0c0').slice(2).toLowerCase())
    expect(all).not.toContain('app.gardens.fund')
    expect(out.files).not.toHaveProperty('applications.json')
    // the dropped read's page is a secret: a builder made to publish it is refused
    const { secrets } = projectPublic(withheldPoolInput())
    const page = input.reads!['pool-a']!.open!.url
    expect(secrets.has(page)).toBe(true)
    const leaks = checkNoLeak({ 'grant-pools.json': { grantPools: [{ contentURI: page }] } }, secrets)
    expect(leaks.length).toBeGreaterThan(0)   // the page, and the addresses inside it
    expect(leaks.every(p => p.level === 'error' && p.file === 'grant-pools.json')).toBe(true)
  })

  it('withheld counts come through, for the members side only', () => {
    const out = gitCopy()
    // steward-b's record; steward-a's role, email and handles
    expect(out.withheld).toContainEqual({ collection: 'members', records: 1, fields: 3 })
    expect(serialised(out.files)).not.toMatch(/"withheld"/)
  })
})

describe('planWrites', () => {
  it('JSON as JSON.stringify(doc, null, 2) and a newline; governance.md as it is', () => {
    const plan = planWrites(gitCopy())
    expect(plan.write['dao.json']).toBe(JSON.stringify(gitCopy().files['dao.json'], null, 2) + '\n')
    expect(plan.write['governance.md']).toBe(gitCopy().files['governance.md'])
    expect(plan.write['governance.md']!.endsWith('\n')).toBe(true)
  })

  it('removes the standard files it did not produce, and nothing else', () => {
    const plan = planWrites(gitCopy())
    expect(plan.remove).toEqual(['applications.json'])
    expect(Object.keys(plan.write).length + plan.remove.length).toBe(STANDARD_FILES.length)
  })
})

describe('buildStandards: the live copy with driver-shaped sections (R38)', () => {
  it('the fixture reads carry what the drivers put in sections: proposal titles, the pool page, Snapshot pages, a members-level name', () => {
    const reads = fixtureReads()
    const sections = JSON.stringify(Object.values(reads).map(r => r.sections))
    for (const s of ['SHOWN-56 Seed the nursery', POOL_PAGE, snapshotLink('test-dao.eth', SNAPSHOT_VOTE), 'SHOWN-54 Ask the token holders', 'WITHHELD-63-xxxxxx', 'WITHHELD-62-xxxxxx']) {
      expect(sections, s).toContain(s)
    }
  })

  it('writes every file, with no leak error: what sections repeat from the same read\'s facts or open is shown', () => {
    const out = liveCopy()
    expect(out.problems.filter(p => /withheld value/.test(p.text))).toEqual([])
    expect(Object.keys(out.files)).toHaveLength(STANDARD_FILES.length)
    expect(planWrites(out).refuse).toBe(false)
    const apps = out.files['applications.json'] as any
    expect(JSON.stringify(apps)).toContain('SHOWN-56 Seed the nursery')
    expect(JSON.stringify(apps)).toContain(POOL_PAGE)
    const proposals = JSON.stringify(out.files['proposals.json'])
    expect(proposals).toContain('SHOWN-54 Ask the token holders')
    expect(proposals).toContain(snapshotLink('test-dao.eth', SNAPSHOT_VOTE))
  })

  it('a members-level name only sections carry stays a secret, and planting it in an output trips the scan', () => {
    const { secrets } = projectPublic(complete(fixtureInput({ reads: fixtureReads() })))
    for (const s of ['WITHHELD-63-xxxxxx', 'WITHHELD-62-xxxxxx (steward-b)', BENEFICIARY]) expect(secrets.has(s), s).toBe(true)
    const out = buildStandards(complete(fixtureInput({ reads: fixtureReads() })), {
      afterProject(pub) {
        const votes = pub.reads.votes!.facts as { proposals: { title: string }[] }
        votes.proposals[0]!.title = 'WITHHELD-63-xxxxxx'   // the hats wearer's members-level name, as a published Snapshot title
      },
    })
    const leaks = out.problems.filter(p => p.level === 'error' && /withheld value/.test(p.text))
    expect(leaks.map(p => p.file)).toEqual(['proposals.json'])
    expect(leaks[0]!.text).not.toContain('WITHHELD-')
    expect(out.files).toEqual({})
  })

  it('a string another kept read\'s facts carry does not clear a section\'s secret: only the same read\'s facts or open do', () => {
    const reads = fixtureReads()
    ;(reads.grants!.facts as Record<string, unknown>).note = 'WITHHELD-63-xxxxxx'   // another System's read carries the name
    const { secrets } = projectPublic(complete(fixtureInput({ reads })))
    expect(secrets.has('WITHHELD-63-xxxxxx')).toBe(true)
  })
})
