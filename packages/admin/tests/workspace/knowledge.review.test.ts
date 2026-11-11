/** DAO-OS L6 Task 10's review and fix wave (rulings PF-R2 to PF-R6): the house and kms read the canon alike, or the house
 *  does not write it; an edit changes only the entries it names; a proposal is judged again on the ops as they will land;
 *  and a knowledge op is judged by the commons' floor alone. Every test builds a fresh temporary instance (the kms fixture
 *  as its own git repository); members and rules are placeholders. */
import { execSync, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { parse } from 'yaml'
import { canonObjects, canonReadDiffers } from '../../lib/workspace/knowledge.mjs'
import { floorPublishable } from '../../lib/workspace/publishable.mjs'
import { createApp } from '../../server/app.ts'
import { mountProposals } from '../../server/proposals/routes.ts'
import { readLedger, updateEntry } from '../../server/proposals/ledger.ts'
import { recordAt } from '../../server/proposals/branch.ts'
import { baseOf } from '../../server/changes/canonical.ts'
import { revOf } from '../../lib/proposals.mjs'
import { publishes } from '../../lib/change-classes.mjs'
import { classesOf } from '../../server/changes/stage.ts'
import { Levels, MEMBERS as MEMBERS_LEVEL, PUBLIC_VIEWER, gateRecord } from '../../server/visibility/gate.ts'
import { mountKnowledge } from '../../server/knowledge/routes.ts'
import { withRequest } from '../../server/request.ts'
import { prepareEdit } from '../../server/knowledge/write.ts'
import { applyToText } from '../../server/knowledge/canon-text.ts'
import { HttpError } from '../../server/errors.ts'
import { FIXTURE_NOW, makeKmsInstance, type FixtureInstance } from '../server/knowledge/fixture.ts'

const VALIDATOR = fileURLToPath(new URL('../../../../scripts/validate-governance.mjs', import.meta.url))
/** kms's own YAML reader: the js-yaml its loader (packages/org-os-kms/src/planes/kb-loader.mjs) loads the canon with. */
const jsyaml = createRequire(fileURLToPath(new URL('../../../org-os-kms/package.json', import.meta.url)))('js-yaml') as { load: (text: string) => unknown }

let instance: FixtureInstance | null = null
afterEach(() => { instance?.cleanup(); instance = null })

const MEMBERS = `schema_version: "2.0"
members:
  - { id: steward-a, name: Steward A, kind: person, handles: { git: ["steward-a@example.test"] } }
  - { id: steward-b, name: Steward B, kind: person, handles: { git: ["steward-b@example.test"] } }
  - { id: steward-c, name: Steward C, kind: person, handles: { git: ["steward-c@example.test"] } }
`
/** The workspace is direct (no rule names it); a publication needs the maintainer's approval. */
const PUBLISHING = `schema_version: "2.0"
governance:
  model: consensus
  roles:
    maintainer: { members: [steward-a] }
    member: { all: true }
  rules:
    - { id: publishing, applies_to: [publication], propose: member, decide: { by: maintainer, method: approve, count: 1 } }
  decisions: []
`
/** A plain canon: one entry held back, one quiet. */
const PLAIN = `schema_version: "1.0"
entries:
  quiet-claim:
    title: A quiet claim
    type: claim-evidence
    id: id-quiet-claim
    maturity: reviewed
    public_use: internal-only
  held-claim:
    title: A held claim
    type: claim-evidence
    id: id-held-claim
    maturity: held
    public_use: ok-with-caveat
`
/** The reviewer's merge-key canon (C1): kms (js-yaml) merges `<<: *pub` into the entry, so it is publishable there; the
 *  house (yaml 2, merge keys off) reads a key "<<" and no public use. */
const MERGED = `schema_version: "1.0"
defaults: &pub
  public_use: ok-with-caveat
entries:
  merged-claim:
    <<: *pub
    title: A merged claim
    type: claim-evidence
    id: id-merged-claim
    maturity: held
`
const MERGED_REC = 'knowledge:claim-evidence/merged-claim'
const QUIET = 'knowledge:claim-evidence/quiet-claim'

function world(governance: string | null, canon: string, who = 'steward-a'): string {
  instance = makeKmsInstance()
  const dir = instance.dir
  git(dir, 'init -q -b main')
  git(dir, `config user.email ${who}@example.test`)
  git(dir, 'config user.name Test')
  writeFileSync(join(dir, 'data/members.yaml'), MEMBERS)
  if (governance !== null) writeFileSync(join(dir, 'data/governance.yaml'), governance)
  writeFileSync(join(dir, 'data/kb/claim-evidence.yaml'), canon)
  git(dir, 'add -A')
  git(dir, 'commit -qm "fixture: the canon, the members and the rules"')
  return dir
}
const git = (dir: string, cmd: string) => execSync(`git -C "${dir}" ${cmd}`, { stdio: 'pipe' }).toString()
const json = (method: string, body?: unknown) => ({ method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), headers: { 'content-type': 'application/json' } })
async function call(app: Hono, path: string, init?: RequestInit): Promise<{ status: number; body: any }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const res = await app.request(path, init)
  const text = await res.text()
  return { status: res.status, body: text === '' ? null : JSON.parse(text) }
}
const validate = (dir: string) => spawnSync('node', [VALIDATOR, dir, '--strict'], { encoding: 'utf8', env: { ...process.env, CI: '' } })
const findings = (out: string) => out.split('\n').filter(l => /^\s*[✗⚠]/.test(l) && !l.includes('data/governance.yaml rules:'))
const READS_DIFFERENTLY = /data\/kb\/claim-evidence\.yaml uses YAML anchors or merge keys, which the commons reads differently; edit it by hand into plain entries first\./

describe('PF-R2: a canon kms reads differently is not the house\'s to write (C1)', () => {
  it('the entry page refuses an edit to an entry of a file with a merge key, in the house\'s words', async () => {
    const dir = world(null, MERGED)
    const before = readFileSync(join(dir, 'data/kb/claim-evidence.yaml'), 'utf8')
    const refused = prepareEdit(dir, 'claim-evidence', 'merged-claim', { fields: { maturity: 'reviewed' } }, { now: FIXTURE_NOW })
    await expect(refused).rejects.toMatchObject({ status: 409 })
    await expect(refused).rejects.toThrow(READS_DIFFERENTLY)
    await expect(refused).rejects.toThrow(/Nothing was written\.$/)
    // The entry page's route, mounted as the knowledge routes' own test mounts it.
    const page = new Hono()
    page.onError((err, c) => c.json({ error: err.message }, ((err as { status?: number }).status ?? 500) as 500))
    page.use('/api/*', withRequest({ repo: dir, hosted: false, membership: null }))
    mountKnowledge(page, { repo: dir, now: () => FIXTURE_NOW })
    const prepared = await call(page, '/api/knowledge/entry/claim-evidence/merged-claim/prepare', json('POST', { fields: { maturity: 'reviewed' } }))
    expect(prepared.status).toBe(409)
    expect(prepared.body.error).toMatch(READS_DIFFERENTLY)
    expect(readFileSync(join(dir, 'data/kb/claim-evidence.yaml'), 'utf8')).toBe(before)
  })

  it('the tray refuses to stage it, and nothing is staged', async () => {
    const dir = world(null, MERGED)
    const app = createApp(dir)
    const staged = await call(app, '/api/changes/ops', json('POST', { ops: [{ op: 'update', record: MERGED_REC, set: { maturity: 'reviewed' } }] }))
    expect(staged.status, JSON.stringify(staged.body)).toBe(422)
    expect(staged.body.errors[0].message).toMatch(READS_DIFFERENTLY)
    expect(staged.body.errors[0].message).toMatch(/Nothing was staged\.$/)
    expect((await call(app, '/api/changes')).body.ops).toEqual([])
  })

  it('a file that gains a merge key after the edit was staged is refused at Apply, and nothing is written', async () => {
    const dir = world(null, PLAIN)
    const app = createApp(dir)
    expect((await call(app, '/api/changes/ops', json('POST', { ops: [{ op: 'update', record: QUIET, set: { title: 'A quieter claim' } }] }))).status).toBe(200)
    // Another entry of the file gains the merge key, so the staged op is not stale: the file is what is refused.
    const anchored = PLAIN.replace('entries:\n', 'defaults: &pub\n  public_use: ok-with-caveat\nentries:\n').replace('    public_use: ok-with-caveat\n', '    <<: *pub\n')
    writeFileSync(join(dir, 'data/kb/claim-evidence.yaml'), anchored)
    git(dir, 'commit -qam "knowledge: tidy by hand"')
    const head = git(dir, 'rev-parse HEAD')
    const applied = await call(app, '/api/changes/apply', json('POST', {}))
    expect(applied.status, JSON.stringify(applied.body)).toBe(422)
    expect(JSON.stringify(applied.body)).toMatch(/uses YAML anchors or merge keys/)
    expect(git(dir, 'rev-parse HEAD')).toBe(head)
    expect(readFileSync(join(dir, 'data/kb/claim-evidence.yaml'), 'utf8')).toBe(anchored)
  })

  it('validate:governance --strict fails a plain commit that brings in a merge key, without a publication decision', () => {
    const dir = world(PUBLISHING, PLAIN, 'steward-b')
    // The reviewer's mergecommit case: the entry's own public use replaced by the merge key, which kms reads as publishable.
    writeFileSync(join(dir, 'data/kb/claim-evidence.yaml'),
      PLAIN.replace('entries:\n', 'defaults: &pub\n  public_use: ok-with-caveat\nentries:\n').replace('    public_use: internal-only\n', '    <<: *pub\n'))
    git(dir, 'commit -qam "knowledge: tidy the quiet claim"')
    const r = validate(dir)
    expect(r.status, r.stdout).toBe(1)
    expect(findings(r.stdout).some(l => /tidy the quiet claim.*publication: /.test(l)), r.stdout).toBe(true)
  })

  it('drift: whenever yaml 2 (the house) and js-yaml (kms) read a canon text differently, the house refuses to write it', () => {
    const merged = (key: string) => `defaults: &pub\n  public_use: ok-with-caveat\nentries:\n  a:\n    ${key}: *pub\n    title: A\n    maturity: held\n`
    const texts: Record<string, string> = {
      plain: PLAIN,
      timestamps: 'entries:\n  a:\n    title: A\n    updated: 2026-10-25\n    checked: 2026-10-25T10:00:00Z\n',
      'merge key from a top-level anchor': merged('<<'),
      'merge key from a sibling entry': 'entries:\n  b: &b\n    public_use: ok-with-caveat\n    title: B\n  a:\n    <<: *b\n    title: A\n    maturity: held\n',
      'quoted merge key': merged('"<<"'),
      'alias shared between entries': 'entries:\n  a:\n    title: A\n    public_use: &pu internal-only\n  b:\n    title: B\n    public_use: *pu\n',
      'anchor alone': 'entries:\n  a: &a\n    title: A\n',
      'YAML 1.1 directive': '%YAML 1.1\n---\nentries:\n  a:\n    title: A\n    maturity: no\n    public_use: ok-with-caveat\n',
      'YAML 1.1 directive with a merge key': `%YAML 1.1\n---\n${merged('<<')}`,
      'a set tag': 'entries:\n  a:\n    title: A\n    uses: !!set { x, y }\n',
      'an ordered-map tag': 'entries:\n  a:\n    title: A\n    uses: !!omap [ x: 1 ]\n',
      'a binary tag': 'entries:\n  a:\n    title: A\n    blob: !!binary aGVsbG8=\n',
      'a null entry key': 'entries:\n  a:\n    title: A\n  ~:\n    title: Nothing\n',
      'a date entry key': 'entries:\n  a:\n    title: A\n  2026-01-01:\n    title: New year\n',
      'a list entry key': 'entries:\n  a:\n    title: A\n  ? [x, y]\n  : title: Pair\n',
    }
    // Timestamps are the one known difference that is not a different reading of the canon: js-yaml makes a Date of what
    // yaml 2 keeps as text, and the floor never reads one. Compared as instants, they agree.
    const instant = (v: unknown): unknown => {
      if (v instanceof Date) return `@${v.getTime()}`
      if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}([Tt ]\d{1,2}:\d{2}:\d{2}(\.\d+)?(Z|[-+]\d{2}(:?\d{2})?)?)?$/.test(v)) {
        const t = Date.parse(v.length === 10 ? `${v}T00:00:00Z` : v)
        return Number.isNaN(t) ? v : `@${t}`
      }
      if (Array.isArray(v)) return v.map(instant)
      if (v !== null && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, instant(x)]))
      return v
    }
    const house = (text: string) => { const o = canonObjects(text); return o === null ? null : JSON.stringify(instant(Object.fromEntries(o))) }
    const kms = (text: string) => {
      let doc: unknown
      try { doc = jsyaml.load(text) } catch { return 'kms refuses to load it' }
      const entries = (doc as { entries?: Record<string, unknown> } | null)?.entries
      return entries === undefined || entries === null ? null : JSON.stringify(instant(Object.fromEntries(Object.entries(entries).filter(([, v]) => v !== null && typeof v === 'object' && !Array.isArray(v)))))
    }
    const refuses = (text: string): boolean => {
      try { applyToText(text, 'claim-evidence', 'a', { title: 'Edited' }); return false } catch (err) {
        if (err instanceof HttpError && err.status === 409 && /which the commons reads differently/.test(err.message)) return true
        throw err
      }
    }
    const disagreeing: string[] = []
    for (const [name, text] of Object.entries(texts)) {
      if (house(text) === kms(text)) continue
      disagreeing.push(name)
      expect(canonReadDiffers(text), name).not.toBeNull()
      expect(refuses(text), name).toBe(true)
    }
    // The corpus does hold disagreements (so the loop above judged something), and a plain canon is written as before.
    expect(disagreeing.length).toBeGreaterThanOrEqual(8)
    expect(disagreeing).not.toContain('plain')
    expect(disagreeing).not.toContain('timestamps')
    expect(canonReadDiffers(PLAIN)).toBeNull()
    expect(refuses(PLAIN.replace('quiet-claim', 'a'))).toBe(false)
  })

  it('kms reads the reviewer\'s merge-key entry as publishable, and the house as not: the reason the house stays out', () => {
    const k = (jsyaml.load(MERGED) as { entries: Record<string, Record<string, unknown>> }).entries['merged-claim']!
    const h = Object.fromEntries(canonObjects(MERGED)!)['merged-claim']!
    expect(k.public_use).toBe('ok-with-caveat')
    expect(h.public_use).toBeUndefined()
    expect(floorPublishable({ ...k, maturity: 'reviewed' })).toBe(true)
    expect(floorPublishable({ ...h, maturity: 'reviewed' })).toBe(false)
    expect(parse(MERGED)).toBeTruthy()
  })
})

/** The reviewer's replay2 world (I2): the canon is raised (the maintainer approves), a publication needs the whole council. */
const RAISED = `schema_version: "2.0"
governance:
  model: consensus
  roles:
    maintainer: { members: [steward-a] }
    council: { members: [steward-a, steward-b, steward-c] }
    member: { all: true }
  rules:
    - { id: canon, applies_to: [workspace], propose: member, decide: { by: maintainer, method: approve, count: 1, self_approve: true } }
    - { id: publishing, applies_to: [publication], propose: member, decide: { by: council, method: approve, count: 3, self_approve: true } }
  decisions: []
`
const HELD = `schema_version: "1.0"
entries:
  quiet-claim:
    title: A quiet claim
    type: claim-evidence
    id: id-quiet-claim
    maturity: held
    public_use: internal-only
`

/** steward-b proposes maturity: reviewed on a held, internal-only entry (not publishing: opened for workspace); then the
 *  trunk moves the entry's public use into the floor's list while it is still held (not publishing on its own). Replayed
 *  as it is, or as Keep mine or Take theirs leave it, the op now makes the entry publishable. */
async function movedUnder(move = true) {
  const dir = world(RAISED, HELD, 'steward-b')
  let at = Math.floor(Date.now() / 1000) * 1000 - 600_000
  const now = () => new Date(at)
  const tick = () => { at += 60_000 }
  const app = createApp(dir, (a, ctx) => mountProposals(a, { repo: dir, withLock: ctx.withLock, startBranch: 'main', now }))
  expect((await call(app, '/api/changes/ops', json('POST', { ops: [{ op: 'update', record: QUIET, set: { maturity: 'reviewed' } }] }))).status).toBe(200)
  const proposed = await call(app, '/api/proposals', json('POST', { title: 'Mark the quiet claim reviewed' }))
  expect(proposed.status, JSON.stringify(proposed.body)).toBe(201)
  const id = String(proposed.body.id)
  expect(readLedger(dir).entries.find(p => String(p.id) === id)!.classes).toEqual(['workspace'])
  tick()
  if (!move) return { dir, app, id, tick, now }
  writeFileSync(join(dir, 'data/kb/claim-evidence.yaml'), HELD.replace('public_use: internal-only', 'public_use: ok-with-caveat'))
  git(dir, 'config user.email steward-a@example.test')
  git(dir, 'commit -qam "knowledge: public use" --trailer "Org-Actor: steward-a" --trailer "Org-Rule: canon/direct"')
  git(dir, 'config user.email steward-b@example.test')
  tick()
  return { dir, app, id, tick, now }
}

describe('PF-R4: a proposal is judged again on its ops as they will land (I2)', () => {
  for (const choose of ['mine', 'theirs'] as const) {
    it(`a replay with ${choose === 'mine' ? 'Keep mine' : 'Take theirs'} that now publishes is refused CLASSES, in revise's words, and nothing is written`, async () => {
      const { dir, app, id } = await movedUnder()
      const head = git(dir, 'rev-parse HEAD')
      const before = readLedger(dir).entries.find(p => String(p.id) === id)!
      const replayed = await call(app, `/api/proposals/${id}/replay`, json('POST', { choose }))
      expect(replayed.status, JSON.stringify(replayed.body)).toBe(409)
      expect(replayed.body.code).toBe('CLASSES')
      expect(replayed.body.error).toMatch(/^Not replayed: the op on knowledge:claim-evidence\/quiet-claim is of the class publication, and proposal .* was opened for workspace, under rule "canon"\./)
      expect(replayed.body.error).toMatch(/Nothing was written\.$/)
      expect(git(dir, 'rev-parse HEAD')).toBe(head)
      expect(readLedger(dir).entries.find(p => String(p.id) === id)!.rev).toBe(before.rev)
    })
  }

  it('a ratify refuses a proposal whose ledger holds ops re-based before this check (an older server\'s Keep mine)', async () => {
    const { dir, app, id, tick, now } = await movedUnder()
    // What a replay with Keep mine wrote before PF-R4: the op re-based on the trunk's record, the classes left as opened.
    const entry = readLedger(dir).entries.find(p => String(p.id) === id)!
    const current = await recordAt(dir, 'HEAD', QUIET)
    const ops = [{ op: 'update', record: QUIET, set: { maturity: 'reviewed' }, base: baseOf(current) }]
    const rev = revOf(ops)
    await updateEntry(dir, id, { fields: { ops, rev, base: git(dir, 'rev-parse HEAD').trim() }, event: { kind: 'revise', rev, ops } as never },
      { actor: entry.author, rule: 'canon/approve' }, { now })
    git(dir, 'config user.email steward-a@example.test'); tick()
    expect((await call(app, `/api/proposals/${id}/events`, json('POST', { kind: 'approve' }))).status).toBe(200)
    tick()
    const head = git(dir, 'rev-parse HEAD')
    const ratified = await call(app, `/api/proposals/${id}/ratify`, json('POST', {}))
    expect(ratified.status, JSON.stringify(ratified.body)).toBe(409)
    expect(ratified.body.code).toBe('CLASSES')
    expect(ratified.body.error).toMatch(/^Not ratified: the op on knowledge:claim-evidence\/quiet-claim is of the class publication/)
    expect(git(dir, 'rev-parse HEAD')).toBe(head)
    expect(floorPublishable(Object.fromEntries(canonObjects(readFileSync(join(dir, 'data/kb/claim-evidence.yaml'), 'utf8'))!)['quiet-claim'])).toBe(false)
  })
})

describe('M1: Revise judges a knowledge op as Stage does', () => {
  it('a delete, a whole-entry replace, the entry\'s identity and a bad field name are refused at Revise, and nothing is revised', async () => {
    const { dir, app, id } = await movedUnder(false)
    const entry = readLedger(dir).entries.find(p => String(p.id) === id)!
    const base = (entry.ops[0] as { base: string }).base
    for (const op of [
      { op: 'delete', record: QUIET, base },
      { op: 'replace', record: QUIET, base, value: { title: 'Whole', maturity: 'reviewed', public_use: 'internal-only' } },
      { op: 'update', record: QUIET, base, set: { type: 'resource', maturity: 'raw' } },
      { op: 'update', record: QUIET, base, set: { 'Bad Field': 1 } },
    ]) {
      const revised = await call(app, `/api/proposals/${id}/revise`, json('POST', { ops: [op] }))
      expect(revised.status, `${JSON.stringify(op)} → ${JSON.stringify(revised.body)}`).toBe(422)
    }
    expect(readLedger(dir).entries.find(p => String(p.id) === id)!.rev).toBe(entry.rev)
  })
})

describe('M2 (PF-R5): a knowledge op is judged by the commons\' floor, not by the house\'s visibility', () => {
  const QUIET_VISIBLE = `schema_version: "1.0"
entries:
  quiet-claim:
    title: A quiet claim
    type: claim-evidence
    id: id-quiet-claim
    maturity: raw
    public_use: internal-only
    visibility: members
`
  it('the reviewer\'s judge case answers alike in the tray, on the entry page and in validate:governance', async () => {
    const dir = world(null, QUIET_VISIBLE)
    writeFileSync(join(dir, 'data/visibility.yaml'), 'visibility:\n  collections:\n    knowledge: { default: public }\n')
    git(dir, 'add -A'); git(dir, 'commit -qm "visibility: knowledge public"')
    const set = { visibility: null }
    // The tray's classes: the floor alone, so removing a house visibility from a canon entry is no publication.
    expect(classesOf([{ op: 'update', record: QUIET, set } as never], dir)).toEqual(['workspace'])
    expect(publishes({ op: 'update', record: QUIET, set }, { maturity: 'raw', public_use: 'internal-only', visibility: 'members' }, { collections: { knowledge: { default: 'public' } } } as never)).toBe(false)
    // validate:governance's reading of the same edit as a commit of the file.
    expect(publishes({ op: 'file', path: 'data/kb/claim-evidence.yaml', text: QUIET_VISIBLE.replace('    visibility: members\n', ''), base: null }, QUIET_VISIBLE, { collections: { knowledge: { default: 'public' } } } as never)).toBe(false)
    // And `visibility` is not a knowledge entry's field to write, on the entry page or in the tray.
    await expect(prepareEdit(dir, 'claim-evidence', 'quiet-claim', { fields: set }, { now: FIXTURE_NOW })).rejects.toMatchObject({ status: 422 })
    const staged = await call(createApp(dir), '/api/changes/ops', json('POST', { ops: [{ op: 'update', record: QUIET, set: { visibility: 'public' } }] }))
    expect(staged.status, JSON.stringify(staged.body)).toBe(422)
    expect(staged.body.errors[0].field).toBe('visibility')
  })
})

describe('M3 (PF-R6): a proposal touching the canon is never shown to the public by its op', () => {
  it('knowledge and proposals public by default, an entry held back by hand: the public sees no knowledge op', () => {
    const dir = world(null, PLAIN)
    const config = { collections: { knowledge: { default: 'public' as const, fields: {} }, proposals: { default: 'public' as const, fields: {} } }, defaults: {} }
    const entry = {
      id: 'p-1', title: 'Edit a quiet claim', rev: 'r1', events: [],
      ops: [{ op: 'update', record: QUIET, set: { title: 'INTERNAL-ONLY TITLE' } }],
    }
    const levels = new Levels(dir, config as never)
    expect(levels.proposal(entry)).toEqual(MEMBERS_LEVEL)
    expect(gateRecord(PUBLIC_VIEWER, 'proposals', entry, config as never, levels.proposal(entry))).toBeNull()
  })
})
