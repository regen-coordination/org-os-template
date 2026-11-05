import { describe, it, expect, afterEach } from 'vitest'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { removeFixtureRepo } from '../fixtures.ts'
import { makeChangeRepo, git, CONSENSUS } from '../changes/fixtures.ts'
import { NO_MODEL } from '../../lib/governance-read.mjs'
import { loadSchema } from '../../server/schema.ts'
import { createApp } from '../../server/app.ts'
import { KNOWN_MODELS } from '../../server/governance/read.ts'
import { DECISIONS } from './fixtures.ts'

let repo: string
afterEach(() => removeFixtureRepo(repo))
const SOLO_WITH_DECISION = `schema_version: "2.0"
governance:
  model: "solo-maintainer"
  description: "One steward"
  decisions:
    - id: "gov-001"
      title: "Adopt the platform"
      date: "2026-10-14"
      status: "ratified"
`
const governance = async () => (await createApp(repo).request('/api/governance')).json()
const SOLO_SENTENCE = 'applies to everything · a maintainer proposes · the maintainer decides alone'

describe('GET /api/governance', () => {
  it('the model, the solo rule, decisions from both places newest first, and the problems', async () => {
    repo = makeChangeRepo(SOLO_WITH_DECISION)
    writeFileSync(join(repo, 'DECISIONS.md'), DECISIONS)
    const view = await governance()
    expect(view.model).toBe('solo-maintainer')
    expect(view.description).toBe('One steward')
    expect(view.rules).toEqual([{ direct: true, sentence: SOLO_SENTENCE, source: 'implied by model: solo-maintainer' }])
    expect(view.decisions.map((d: { date: string; where: string; id: string }) => `${d.date} ${d.where} ${d.id}`)).toEqual([
      '2026-10-16 DECISIONS.md LD-2026-035',
      '2026-10-14 governance.yaml gov-001',
      '2026-10-12 DECISIONS.md ',
      '2026-08-21 DECISIONS.md ',
      '2026-08-21 DECISIONS.md ',
    ])
    expect(view.decisions[1]).toEqual({ date: '2026-10-14', id: 'gov-001', title: 'Adopt the platform', status: 'ratified', group: 'ratified', where: 'governance.yaml' })
    expect(view.decisions[0]).toMatchObject({ anchor: '2026-10-16-ld-2026-035', status: 'active', group: 'ratified' }) // F1: active → ratified
    // The fixture has two people (steward-a, ana) under the solo model.
    expect(view.problems).toContainEqual(expect.stringMatching(/solo-maintainer.*2 people/))
  })

  it('a consensus model: its rule sentence, and nothing is direct', async () => {
    repo = makeChangeRepo(CONSENSUS)
    const view = await governance()
    expect(view.model).toBe('consensus')
    expect(view.rules).toEqual([{ direct: false, sentence: 'applies to everything · decided by consensus; no rule is written, so nothing can be proposed', source: 'model: consensus' }])
  })

  it('written rules are listed one by one, as sentences; direct says whether the method is direct', async () => {
    repo = makeChangeRepo(`governance:
  model: solo-maintainer
  rules:
    - id: r-records
      applies_to: [records, projects]
      propose: member
      decide: { by: steward, method: vote }
`)
    expect((await governance()).rules).toEqual([{ direct: false, source: 'data/governance.yaml rules: r-records',
      sentence: 'applies to records, projects · member proposes · needs a vote of the steward' }])
  })

  it('no governance file: the solo default, with the problem line, and no model shown as declared', async () => {
    repo = makeChangeRepo(null)
    const view = await governance()
    expect(view.model).toBeNull()
    expect(view.rules).toEqual([{ direct: true, sentence: SOLO_SENTENCE, source: NO_MODEL }])
    expect(view.problems).toContain(NO_MODEL)
  })

  // walk fix 10, review I-2: the reader words a problem without its subject; the view gives it the file, and keeps
  // NO_MODEL in its own words (it is a default, not a fault)
  it('says a problem of the file with the file as its subject, and NO_MODEL as it is', async () => {
    repo = makeChangeRepo('governance:\n  model: [solo\n')
    const broken = await governance()
    expect(broken.problems[0]).toMatch(/^data\/governance\.yaml is not valid YAML: /)
    writeFileSync(join(repo, 'data', 'governance.yaml'), 'governance:\n  decisions: []\n')
    const unnamed = await governance()
    expect(unnamed.problems).toContain(NO_MODEL)
    expect(unnamed.problems.filter((p: string) => p.includes(NO_MODEL))).toEqual([NO_MODEL])
  })

  it('a governance file that names no model is the solo default too', async () => {
    repo = makeChangeRepo('governance:\n  decisions: []\n')
    const view = await governance()
    expect(view.model).toBeNull()
    expect(view.rules).toEqual([{ direct: true, sentence: SOLO_SENTENCE, source: NO_MODEL }])
    expect(view.problems).toContainEqual(expect.stringMatching(/2 people/))
  })

  it('a governance file of several documents shows as a problem', async () => {
    repo = makeChangeRepo('governance:\n  model: consensus\n---\nnotes: x\n')
    const view = await governance()
    expect(view.model).toBeNull()
    expect(view.problems).toContainEqual(expect.stringMatching(/2 YAML documents/))
    expect(view.rules).toEqual([])
  })

  it('a model the framework does not know is a problem', async () => {
    repo = makeChangeRepo('governance:\n  model: "benevolent-dictator"\n')
    const view = await governance()
    expect(view.model).toBe('benevolent-dictator')
    expect(view.problems).toContainEqual(expect.stringMatching(/"benevolent-dictator"/))
  })

  it('the known models are the schema\'s enum, not a second list', () => {
    const schema = loadSchema('governance') as unknown as { properties: { model: { enum: string[] } } }
    expect(KNOWN_MODELS).toEqual(schema.properties.model.enum)
  })

  it('GET /api/governance/decisions/:anchor answers the section as Markdown; an unknown anchor is 404', async () => {
    repo = makeChangeRepo()
    writeFileSync(join(repo, 'DECISIONS.md'), DECISIONS)
    const app = createApp(repo)
    const res = await app.request('/api/governance/decisions/2026-08-21-external-validation-milestone')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ markdown: '## 2026-08-21 — External-validation milestone\n\n**Status**: withdrawn' })
    const missing = await app.request('/api/governance/decisions/nope')
    expect(missing.status).toBe(404)
    expect((await missing.json()).error).toMatch(/No decision "nope" in DECISIONS\.md/)
  })

  it('never writes', async () => {
    repo = makeChangeRepo(SOLO_WITH_DECISION)
    await governance()
    expect(git(repo, 'status --porcelain')).toBe('')
  })
})
