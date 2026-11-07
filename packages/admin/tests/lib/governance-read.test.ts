import { describe, it, expect } from 'vitest'
import { readGovernance, yamlDocuments, DEFAULT_MODEL, NO_MODEL } from '../../lib/governance-read.mjs'

// One fixture per shape the 2026-10-16 survey found. Synthetic content.
const WRAPPED = `schema_version: "2.0"
governance:
  model: "consensus"
  description: "Decisions by consent of the members present."
  current_phase: "bootstrap"
  infrastructure:
    safe: "0x1111111111111111111111111111111111111111"
    chain: "eip155:42220"
    hats_tree: null
  decisions:
    - id: "gov-20261001-001"
      title: "Adopt the fixture charter"
      type: "amendment"
      status: "ratified"
      date: "2026-10-01"
  elections: []
`
// The vault hub's way: decisions at the top, no wrapper.
const UNWRAPPED = `schema_version: "2.0"
decisions:
  - id: "fx-2026-001"
    title: "Fundraise first, choose the legal home second"
    date: "2026-08-04"
    status: "adopted"
  - id: "fx-2026-002"
    title: "A preference, not yet put to the council"
    date: "2026-08-05"
    status: "preference-not-ratified"
`
// one instance's way: \`decision_model\`, empty.
const DECISION_MODEL = `schema_version: "2.0"
governance:
  decision_model: ""
  roles: []
  decisions: []
`
// another instance's way: several documents, holding notes beside the record.
const MULTI = `schema_version: "2.0"
---
elections:
  - id: "ELECTION-FX"
    status: "completed"
---
decisions:
  - id: "DR-FX-001"
    title: "Open question"
    status: "open"
    date: null
---
meeting_notes:
  topic: "notes kept beside the record"
`

describe('readGovernance', () => {
  it('reads the governance: wrapper', () => {
    const r = readGovernance(WRAPPED)
    expect(r.shape).toBe('wrapped')
    expect(r.problems).toEqual([])
    expect(r.governance).toMatchObject({ model: 'consensus', current_phase: 'bootstrap' })
    expect((r.governance!.decisions as unknown[]).length).toBe(1)
  })
  it('reads a flat file as if it were wrapped, without schema_version, as solo-maintainer when it names no model', () => {
    const r = readGovernance(UNWRAPPED)
    expect(r.shape).toBe('unwrapped')
    expect(Object.keys(r.governance!).sort()).toEqual(['decisions', 'model'])
    expect(r.governance!.model).toBe('solo-maintainer')
    expect(r.problems).toEqual([NO_MODEL])
    expect((r.governance!.decisions as { status: string }[]).map(d => d.status)).toEqual(['adopted', 'preference-not-ratified'])
  })
  it('reads an empty decision_model as no model, so as solo-maintainer', () => {
    const r = readGovernance(DECISION_MODEL)
    expect(r.shape).toBe('decision_model')
    expect(r.governance).toEqual({ roles: [], decisions: [], model: 'solo-maintainer' })
    expect(r.problems).toEqual([NO_MODEL])
  })
  it('reads a wrapper with no model, or an empty one, as solo-maintainer, and says so', () => {
    expect(DEFAULT_MODEL).toBe('solo-maintainer')
    for (const text of ['governance:\n  decisions: []\n', 'governance:\n  model: null\n', 'governance:\n  model: ""\n']) {
      const r = readGovernance(text)
      expect(r.shape).toBe('wrapped')
      expect(r.governance!.model).toBe('solo-maintainer')
      expect(r.problems).toEqual([NO_MODEL])
    }
  })
  it('reads decision_model as model', () => {
    const r = readGovernance('governance:\n  decision_model: "consensus"\n  roles: []\n')
    expect(r).toEqual({ governance: { model: 'consensus', roles: [] }, shape: 'decision_model', problems: [], modelImplied: false })
  })
  it('does not read a file of several YAML documents, and says what to do', () => {
    const r = readGovernance(MULTI)
    expect(r.governance).toBeNull()
    expect(r.shape).toBe('multi-document')
    expect(r.problems).toHaveLength(1)
    expect(r.problems[0]).toMatch(/^holds 4 YAML documents/)
    expect(r.problems[0]).toMatch(/Merge them into one document under `governance:` by hand/)
  })
  it('a --- that opens the file, or ends it with nothing after, starts no document', () => {
    expect(readGovernance(`---\n${WRAPPED}`).shape).toBe('wrapped')
    expect(readGovernance(`${WRAPPED}---\n`).shape).toBe('wrapped')
    expect(readGovernance(`${WRAPPED}---\n# a closing comment\n`).shape).toBe('wrapped')
  })
  it('an absent, empty or governance-less file is missing, and read as solo-maintainer', () => {
    const solo = { governance: { model: 'solo-maintainer' }, shape: 'missing', problems: [NO_MODEL], modelImplied: true }
    expect(readGovernance(null)).toEqual(solo)
    expect(readGovernance('')).toEqual(solo)
    expect(readGovernance('# nothing yet\nschema_version: "2.0"\n')).toEqual(solo)
  })
  it('a file that is not read gets no default: multi-document and unparseable stay null', () => {
    expect(readGovernance(MULTI).governance).toBeNull()
    expect(readGovernance('- a\n').governance).toBeNull()
  })
  it('a file the YAML library cannot read, or whose top is not a mapping, is unparseable', () => {
    expect(readGovernance('governance:\n  model: [\n')).toMatchObject({ governance: null, shape: 'unparseable', problems: [expect.stringMatching(/^is not valid YAML: /)] })
    expect(readGovernance('- a\n- b\n').shape).toBe('unparseable')
    expect(readGovernance('governance: [1, 2]\n').shape).toBe('unparseable')
  })
  it('a flat file of only keys it does not read is missing, and names them', () => {
    const r = readGovernance('schema_version: "2.0"\nelections: []\nroles: {}\ncurrent_phase: "bootstrap"\ninfrastructure:\n  safe: null\n')
    expect(r.shape).toBe('missing')
    expect(r.governance).toEqual({ model: 'solo-maintainer' })
    expect(r.problems).toEqual([
      'has `elections`, `roles`, `current_phase`, `infrastructure` at its top level, and no `governance:`, `model` or `decisions`: ' +
        'none of them is read. Put them under `governance:`.',
      NO_MODEL,
    ])
  })
  it('keys beside the wrapper are named, and not read', () => {
    const r = readGovernance('governance:\n  model: "consensus"\ndecisions: []\n')
    expect(r.shape).toBe('wrapped')
    expect(r.governance).toEqual({ model: 'consensus' })
    expect(r.problems).toEqual(['has `decisions` beside `governance:`; only the `governance:` block is read'])
  })
})

describe('NO_MODEL and modelImplied', () => {
  it('NO_MODEL is the sentence a defaulted model is reported in', () => {
    expect(NO_MODEL).toBe('no governance model declared; running as solo-maintainer')
  })
  it('is true when the model was defaulted, in every shape that can default', () => {
    expect(readGovernance(null).modelImplied).toBe(true) // missing
    expect(readGovernance('governance:\n  decisions: []\n').modelImplied).toBe(true) // wrapped
    expect(readGovernance(UNWRAPPED).modelImplied).toBe(true) // unwrapped
    expect(readGovernance(DECISION_MODEL).modelImplied).toBe(true) // decision_model, empty
  })
  it('is false when the file states the model', () => {
    expect(readGovernance(WRAPPED).modelImplied).toBe(false)
    expect(readGovernance('model: "consensus"\ndecisions: []\n')).toMatchObject({ shape: 'unwrapped', modelImplied: false })
    expect(readGovernance('governance:\n  decision_model: "consensus"\n').modelImplied).toBe(false)
  })
  it('is false when the file is not read, so no model was defaulted', () => {
    expect(readGovernance(MULTI)).toMatchObject({ shape: 'multi-document', modelImplied: false })
    expect(readGovernance('- a\n')).toMatchObject({ shape: 'unparseable', modelImplied: false })
  })
})

describe('yamlDocuments', () => {
  it('keeps only the documents that hold something', () => {
    expect(yamlDocuments('---\na: 1\n---\n')).toEqual([{ value: { a: 1 } }])
    expect(yamlDocuments('a: 1\n---\nb: 2\n')).toEqual([{ value: { a: 1 } }, { value: { b: 2 } }])
    expect(yamlDocuments('')).toEqual([])
  })
})
