import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateRepo, type Problem } from '../../lib/data-validate.mjs'
import { REAL_REPO, BOARDS_YAML } from '../fixtures.ts'

const made: string[] = []
afterEach(() => { for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true }) })

/** A throwaway instance holding these data/ files. */
function instance(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'validate-data-'))
  made.push(dir)
  mkdirSync(join(dir, 'data'))
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, 'data', name), text)
  return dir
}
const errorsOf = (ps: Problem[]) => ps.filter(p => p.level === 'error')
const warningsOf = (ps: Problem[]) => ps.filter(p => p.level === 'warn')
const where = (ps: Problem[]) => ps.map(p => `${p.file} ${p.id ?? ''} ${p.path}`.trim()).sort()

// Every shape the 2026-10-16 fleet survey found in a registry, synthetic values.
const SURVEY: Record<string, string> = {
  'members.yaml': `schema_version: "2.0"
members:
  - id: "github:ana-example"
    name: "Ana Example"
    kind: "person"
    handles:
      github: "ana-example"
      git: ["ana@example.org"]
  - id: "did:fixture:bruno"
    name: "Bruno"
    type: "individual"
    layer: "core"
  - id: "did:bloom:bloom"
    name: "Bloom"
    kind: "organization"
  - id: "fixture:role:source-lead"
    name: "Source lead"
    kind: "role"
    layer: "dao-global"
  - id: "carla"
    name: "Carla"
    email: "carla@example.org"
    roles:
      - org: "Fixture Org"
        role: "steward"
`,
  'projects.yaml': `projects:
  - id: "p1"
    title: "Fixture project"
    status: "Discovery"
    lead: "github:ana-example"
    tags: ["nodes", 2026]
  - id: "p2"
    title: "Led from another instance"
    lead: "did:elsewhere:dana"
`,
  'meetings.yaml': `meetings:
  - id: "m1"
    title: "Council session"
    date: "2026-10-14T16:00:00Z"
    type: "council"
    participants: ["carla", "Dana (guest)"]
    decisions:
      - "Adopt the fixture plan"
      - id: "decision-fixture"
        description: "A decision written as a record"
    action_items:
      - "Carla: send the notes"
      - assignee: "carla"
        task: "Book the room"
  - id: "m1"
    title: "The same id again"
    date: "2026-10-15"
`,
  'funding-opportunities.yaml': `opportunities:
  - id: "f1"
    title: "Rolling grant"
    type: "quadratic_funding"
    status: "researching"
    deadline: "rolling"
`,
  'relationships.yaml': `relationships:
  - partner: "Fixture Partner"
    type: "host-cooperative"
    status: "pending-settlement"
`,
  'sources.yaml': 'sources:\n  - id: "s1"\n    type: "docs-site"\n    status: "indexed-complete"\n',
  'events.yaml': 'events:\n  - id: "e1"\n    type: "work-session"\n    status: "held"\n    related_project: "elsewhere-project"\n',
  'channels.yaml': 'channels:\n  - id: "c1"\n    platform: "github"\n',
  'finances.yaml': 'finances:\n  treasury: []\n  expenses: []\n',
  'governance.yaml': `schema_version: "2.0"
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
`,
  'crm.yaml': 'this: [is not: read\n', // not a registry: never opened
}

describe('validateRepo on the shapes real instances hold', () => {
  it('finds no error in any of them', () => expect(errorsOf(validateRepo(instance(SURVEY)))).toEqual([]))
  it('warns about what people should look at, and only that', () => {
    expect(where(warningsOf(validateRepo(instance(SURVEY))))).toEqual([
      'data/events.yaml e1 related_project', // a project of another instance
      'data/governance.yaml  infrastructure', // deprecated, still read
      'data/meetings.yaml m1 id', // the second m1
      'data/meetings.yaml m1 participants', // "Dana (guest)"
      'data/projects.yaml p2 lead', // a member of another instance
      'data/relationships.yaml #1 id', // no id at all
    ])
  })
  it('never opens a file the registry list does not know', () => {
    expect(validateRepo(instance(SURVEY)).filter(p => p.file.includes('crm'))).toEqual([])
  })
  it('checks an entry with no id for everything else, under its position', () => {
    const ps = validateRepo(instance({ 'relationships.yaml': 'relationships:\n  - partner: "X"\n    since: "not a date"\n' }))
    expect(errorsOf(ps)).toEqual([expect.objectContaining({ file: 'data/relationships.yaml', id: '#1', path: 'since', level: 'error' })])
  })
  it('a flat document (no finances: key) has nothing to check', () => {
    expect(validateRepo(instance({ 'governance.yaml': SURVEY['governance.yaml'], 'finances.yaml': 'schema_version: "2.0"\nbudgets: []\nexpenses: []\n' }))
      .filter(p => p.file === 'data/finances.yaml')).toEqual([])
  })
  it('an instance with no data/ files has one warning: no governance file', () => {
    expect(validateRepo(instance({}))).toEqual([
      { file: 'data/governance.yaml', path: '', level: 'warn', message: 'no governance file; running as solo-maintainer' },
    ])
  })
  it('an empty-string id is no id: warned under its position, never counted as shared', () => {
    const ps = validateRepo(instance({ 'ideas.yaml': 'ideas:\n  - id: ""\n    title: "A"\n  - id: ""\n    title: "B"\n  - id: "i3"\n    title: "C"\n' }))
    expect(where(warningsOf(ps).filter(p => p.file === 'data/ideas.yaml'))).toEqual(['data/ideas.yaml #1 id', 'data/ideas.yaml #2 id'])
    expect(warningsOf(ps).filter(p => /appears \d+ times/.test(p.message))).toEqual([])
  })
  it('a reference never resolves to an entry with no id', () => {
    const ps = validateRepo(instance({
      'members.yaml': 'members:\n  - name: "No id"\n  - id: ""\n    name: "Empty id"\n',
      'projects.yaml': 'projects:\n  - id: "p1"\n    lead: "undefined"\n  - id: "p2"\n    lead: ""\n',
    }))
    expect(where(warningsOf(ps).filter(p => p.file === 'data/projects.yaml'))).toEqual(['data/projects.yaml p1 lead', 'data/projects.yaml p2 lead'])
  })
  it('names the repeated id, how often, and that the platform will not edit it', () => {
    const dup = warningsOf(validateRepo(instance(SURVEY))).find(p => p.file === 'data/meetings.yaml' && p.path === 'id')
    expect(dup?.message).toBe('id `m1` appears 2 times in data/meetings.yaml; the platform will not edit entries with this id')
  })
})

describe('validateRepo errors', () => {
  it('a governance.yaml of several YAML documents is the one error, with its repair', () => {
    const ps = validateRepo(instance({ ...SURVEY, 'governance.yaml': 'schema_version: "2.0"\n---\ndecisions:\n  - id: "d1"\n---\nnotes: {}\n' }))
    expect(errorsOf(ps)).toEqual([{
      file: 'data/governance.yaml', path: '', level: 'error',
      message: expect.stringMatching(/^holds 3 YAML documents.*Merge them into one document under `governance:` by hand/),
    }])
  })
  it('several YAML documents in any other registry is an error too', () => {
    expect(errorsOf(validateRepo(instance({ 'ideas.yaml': 'ideas: []\n---\nmore: 1\n' })))).toEqual([
      expect.objectContaining({ file: 'data/ideas.yaml', message: expect.stringMatching(/^holds 2 YAML documents/) }),
    ])
  })
  it('a file the YAML library cannot read', () => {
    expect(errorsOf(validateRepo(instance({ 'projects.yaml': 'projects:\n  - id: [\n' })))).toEqual([
      expect.objectContaining({ file: 'data/projects.yaml', path: '', message: expect.stringMatching(/^is not valid YAML: /) }),
    ])
  })
  it('a collection that is not a list, and an entry that is not a mapping', () => {
    expect(where(errorsOf(validateRepo(instance({
      'members.yaml': 'members:\n  ana:\n    name: "Ana"\n',
      'ideas.yaml': 'ideas:\n  - "just a sentence"\n',
    }))))).toEqual(['data/ideas.yaml #1', 'data/members.yaml  members'])
  })
  it('a System without what its kind needs; an unknown kind only warns', () => {
    const ps = validateRepo(instance({
      'systems.yaml': `schema_version: "1.0"
systems:
  - id: "treasury-safe"
    kind: "safe"
    name: "Treasury"
  - id: "notes"
    kind: "notion-db"
    name: "Notes"
    url: "https://notion.example/x"
`,
    }))
    expect(where(errorsOf(ps))).toEqual(['data/systems.yaml treasury-safe address', 'data/systems.yaml treasury-safe chain'])
    expect(where(warningsOf(ps).filter(p => p.file === 'data/systems.yaml'))).toEqual(['data/systems.yaml notes kind'])
  })
})

describe('validateRepo on this repository', () => {
  it('finds no error in the framework\'s own data/ (CI runs validate:data on it)', () => {
    expect(errorsOf(validateRepo(REAL_REPO))).toEqual([])
  })
})

describe('validateRepo: boards (P4 §5.1)', () => {
  it('names a bad board in data/boards.yaml, and passes a good one', () => {
    const good = errorsOf(validateRepo(instance({ 'boards.yaml': BOARDS_YAML }))).filter(p => p.file === 'data/boards.yaml')
    expect(good).toEqual([])
    const bad = instance({ 'boards.yaml': BOARDS_YAML.replace('span: 8', 'span: 9') })
    expect(errorsOf(validateRepo(bad)).filter(p => p.file === 'data/boards.yaml'))
      .toEqual([expect.objectContaining({ id: 'treasury', path: 'blocks', message: 'board "treasury": block "hello" overlaps block "open-projects" in row 1' })])
  })
})
