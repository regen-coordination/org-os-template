/** A prepared edit and its apply: nothing written until Apply, one commit with the house's trailers, the file's
 *  comments intact, and a stale base refused. The temp instance is a git repository, because an apply is a commit. */
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { applyEdit, applyToText, prepareEdit } from '../../../server/knowledge/write.ts'
import type { KnownActor } from '../../../server/actor.ts'
import { createApp } from '../../../server/app.ts'
import { applyOps } from '../../../server/changes/apply.ts'
import { FIXTURE_NOW, makeKmsInstance, type FixtureInstance } from './fixture.ts'

let instance: FixtureInstance | null = null
/** A member resolved from git's identity: under the solo default (no governance file), a person decides alone. The canon
 *  is class `workspace` since L6 (R-55), whose implied rule admits a member of data/members.yaml: the repo holds them. */
const STEWARD: KnownActor = { id: 'steward-a', name: 'Steward A', kind: 'person' }
afterEach(() => { instance?.cleanup(); instance = null })

/** The fixture instance as a git repository: an apply commits, so one must exist. */
function asRepo(i: FixtureInstance): FixtureInstance {
  const git = (cmd: string) => execSync(`git -C "${i.dir}" ${cmd}`, { stdio: 'pipe' })
  git('init -q -b main')
  git('config user.email test@local')
  git('config user.name Test')
  writeFileSync(join(i.dir, 'data/members.yaml'), MEMBERS)
  // A comment in the file, so the test can prove the document API kept it.
  const file = join(i.dir, 'data/kb/encyclopedia-entry.yaml')
  writeFileSync(file, `# A canon kept by hand: this comment must survive an edit.\nschema_version: "1.0"\n\nentries:\n${readFileSync(file, 'utf8').split('entries:')[1]}`)
  git('add -A')
  git('commit -q -m "the canon as it was"')
  return i
}

describe('prepareEdit — nothing written, the change answered', () => {
  it('answers the changed field, its old value, and the base the file must still match', async () => {
    instance = makeKmsInstance()
    const before = instance.snapshot()
    const edit = await prepareEdit(instance.dir, 'encyclopedia-entry', 'living-mulch', { fields: { audience: 'Field crews · volunteer growers' } }, { now: FIXTURE_NOW })
    expect(edit.changes).toEqual([{ field: 'audience', before: 'Field crews', after: 'Field crews · volunteer growers' }])
    expect(edit.file).toBe('data/kb/encyclopedia-entry.yaml')
    expect(edit.base).toMatch(/^[0-9a-f]{64}$/)
    expect(edit.classes).toEqual(['workspace'])
    expect(edit.text).toContain('Field crews · volunteer growers')
    expect(instance.snapshot()).toEqual(before)
  })

  it('calls a move into the publishable set a publication, not a workspace edit', async () => {
    instance = makeKmsInstance()
    const edit = await prepareEdit(instance.dir, 'claim-evidence', 'seed-swap-notes',
      { fields: { maturity: 'reviewed', public_use: 'reviewed-for-guidance' } }, { now: FIXTURE_NOW })
    expect(edit.classes).toEqual(['workspace', 'publication'])
  })

  it('refuses the entry’s identity, a bad field name, and an empty edit, each in one sentence', async () => {
    instance = makeKmsInstance()
    await expect(prepareEdit(instance.dir, 'encyclopedia-entry', 'living-mulch', { fields: { id: 'x' } })).rejects.toThrow(/identity/)
    await expect(prepareEdit(instance.dir, 'encyclopedia-entry', 'living-mulch', { fields: { 'Bad Field': 'x' } })).rejects.toThrow(/not a field name/)
    await expect(prepareEdit(instance.dir, 'encyclopedia-entry', 'living-mulch', { fields: {} })).rejects.toThrow(/Nothing to change/)
  })

  it('refuses an entry the canon does not hold', async () => {
    instance = makeKmsInstance()
    await expect(prepareEdit(instance.dir, 'encyclopedia-entry', 'nope', { fields: { audience: 'x' } })).rejects.toThrow(/No entry encyclopedia-entry\/nope/)
  })
})

describe('applyEdit — one file, one commit, the comments kept', () => {
  it('writes the field, keeps the file’s comment, and makes one commit with the house’s trailers', async () => {
    instance = asRepo(makeKmsInstance())
    const edit = await prepareEdit(instance.dir, 'encyclopedia-entry', 'living-mulch', { fields: { audience: 'Field crews · volunteer growers' } }, { now: FIXTURE_NOW })
    const applied = await applyEdit(instance.dir, 'encyclopedia-entry', 'living-mulch', { fields: { audience: 'Field crews · volunteer growers' }, base: edit.base }, STEWARD)
    expect(applied.changed).toBe(true)
    expect(applied.classes).toEqual(['workspace'])
    expect(applied.sentence).toContain('one commit')
    const text = readFileSync(join(instance.dir, 'data/kb/encyclopedia-entry.yaml'), 'utf8')
    expect(text).toContain('# A canon kept by hand: this comment must survive an edit.')
    expect(text).toContain('Field crews · volunteer growers')
    const log = execSync(`git -C "${instance.dir}" log -1 --format=%B`).toString()
    expect(log).toContain('knowledge: Living mulch (encyclopedia-entry/living-mulch)')
    // The rule the house judged it by, not a name of the lane's own: the workspace's implied rule here (L6 §3.4).
    expect(log).toContain('Org-Rule: workspace/direct')
    expect(log).toContain('Org-Actor: steward-a')
    // One commit for the edit, and nothing left uncommitted.
    expect(execSync(`git -C "${instance.dir}" status --porcelain`).toString().trim()).toBe('')
  })

  it('refuses a stale base and writes nothing at all', async () => {
    instance = asRepo(makeKmsInstance())
    const file = join(instance.dir, 'data/kb/encyclopedia-entry.yaml')
    const stale = await prepareEdit(instance.dir, 'encyclopedia-entry', 'living-mulch', { fields: { audience: 'A' } }, { now: FIXTURE_NOW })
    // Someone else edits the file after the prepare.
    writeFileSync(file, readFileSync(file, 'utf8').replace('Checked this season', 'Checked last season'))
    const moved = readFileSync(file, 'utf8')
    await expect(applyEdit(instance.dir, 'encyclopedia-entry', 'living-mulch', { fields: { audience: 'A' }, base: stale.base }, STEWARD))
      .rejects.toThrow(/has changed since this edit was prepared/)
    expect(readFileSync(file, 'utf8')).toBe(moved)
  })

  it('says so, and writes nothing, when the entry already holds the values', async () => {
    instance = asRepo(makeKmsInstance())
    const edit = await prepareEdit(instance.dir, 'encyclopedia-entry', 'living-mulch', { fields: { audience: 'Field crews' } }, { now: FIXTURE_NOW })
    const applied = await applyEdit(instance.dir, 'encyclopedia-entry', 'living-mulch', { fields: { audience: 'Field crews' }, base: edit.base }, STEWARD)
    expect(applied).toMatchObject({ changed: false, commit: null })
    expect(applied.sentence).toContain('Nothing to write')
  })

  it('clears a field with null, and the key is gone rather than empty', async () => {
    instance = asRepo(makeKmsInstance())
    const edit = await prepareEdit(instance.dir, 'encyclopedia-entry', 'living-mulch', { fields: { currentness: null } }, { now: FIXTURE_NOW })
    await applyEdit(instance.dir, 'encyclopedia-entry', 'living-mulch', { fields: { currentness: null }, base: edit.base }, STEWARD)
    const text = readFileSync(join(instance.dir, 'data/kb/encyclopedia-entry.yaml'), 'utf8')
    expect(text).not.toContain('currentness')
  })
})

/* ── Review fixes (2026-11-04): R-43 kept to its word, and the apply judged by the house's rules (R-45) ────────────── */

/** A canon kept by hand, in the shapes a person writes and a re-serialiser would "tidy". */
const HAND_KEPT = `# The canon's encyclopedia — kept by hand.
schema_version: 1.0
entries:
  # first entry
  living-mulch:
    title: Living mulch   # the title
    public_use: reviewed-for-guidance
    updated: 2026-10-20
    tags:
    - soil
    - "water"
    flow: [a, b]
    summary: >
      A cover crop kept growing between rows, written long enough that a printer might want to fold it somewhere.
    known_tensions:
      - Competes with young seedlings.  # inside a list
    notes: keep this

  rotational-grazing:
    title: 'Rotational grazing'
    tags:
    - grass
# trailing comment
`

const changedLines = (a: string, b: string): number[] => {
  const x = a.split('\n'), y = b.split('\n')
  const out: number[] = []
  for (let i = 0; i < Math.max(x.length, y.length); i++) if (x[i] !== y[i]) out.push(i + 1)
  return out
}

describe('the canon writer changes the lines of the fields it sets, and no other (R-43)', () => {
  it('a scalar set in place keeps every other line byte for byte, the inline comment included', () => {
    const out = applyToText(HAND_KEPT, 'encyclopedia-entry', 'living-mulch', { public_use: 'internal-only' })
    expect(changedLines(HAND_KEPT, out)).toEqual([7])
    expect(out.split('\n')[6]).toBe('    public_use: internal-only')
  })

  it('a scalar with an inline comment keeps the comment where it was', () => {
    const out = applyToText(HAND_KEPT, 'encyclopedia-entry', 'living-mulch', { title: 'Living mulches' })
    expect(changedLines(HAND_KEPT, out)).toEqual([6])
    expect(out.split('\n')[5]).toBe('    title: Living mulches   # the title')
  })

  it('a list replaced, a field added and a field cleared touch only their own lines', () => {
    const out = applyToText(HAND_KEPT, 'encyclopedia-entry', 'living-mulch', { tags: ['soil', 'shade'], audience: 'Field crews', notes: null })
    const before = HAND_KEPT.split('\n'), after = out.split('\n')
    // Everything outside living-mulch's tags, notes and the new audience line is the same text.
    for (const keep of ['# The canon\'s encyclopedia — kept by hand.', '    title: Living mulch   # the title', '    flow: [a, b]',
      '      - Competes with young seedlings.  # inside a list', "    title: 'Rotational grazing'", '    - grass', '# trailing comment']) {
      expect(after).toContain(keep)
    }
    expect(after.filter(l => l.trim() === '- grass')).toHaveLength(before.filter(l => l.trim() === '- grass').length)
    expect(out).not.toContain('notes: keep this')
    expect(out).toContain('    audience: Field crews\n')
    expect(out).toMatch(/ {4}tags:\n {6}- soil\n {6}- shade\n/)
  })

  it('refuses, writing nothing, an edit that could only be made by dropping a comment', () => {
    // known_tensions holds a comment inside its list: replacing the list would lose it.
    expect(() => applyToText(HAND_KEPT, 'encyclopedia-entry', 'living-mulch', { known_tensions: 'One line now.' }))
      .toThrow(/comment/)
  })

  it('keeps the comments and the untouched lines through a real apply, in one commit', async () => {
    instance = asRepo(makeKmsInstance())
    const file = join(instance.dir, 'data/kb/encyclopedia-entry.yaml')
    writeFileSync(file, HAND_KEPT)
    execSync(`git -C "${instance.dir}" commit -qam "hand-kept"`)
    const edit = await prepareEdit(instance.dir, 'encyclopedia-entry', 'living-mulch', { fields: { public_use: 'internal-only' } }, { now: FIXTURE_NOW })
    await applyEdit(instance.dir, 'encyclopedia-entry', 'living-mulch', { fields: { public_use: 'internal-only' }, base: edit.base }, STEWARD)
    const diff = execSync(`git -C "${instance.dir}" show --format= --unified=0 HEAD`).toString()
    expect(diff.split('\n').filter(l => /^[-+][^-+]/.test(l))).toEqual(['-    public_use: reviewed-for-guidance', '+    public_use: internal-only'])
  })
})

/** Written rules: the steward decides the canon (class `workspace` since L6) alone, but a publication needs the council's
 *  approval. */
const RULED = `schema_version: "2.0"
governance:
  model: consensus
  roles:
    maintainer: { members: [steward-a] }
    member: { all: true }
  rules:
    - { id: canon, applies_to: [workspace], propose: member, decide: { by: maintainer, method: direct } }
    - { id: publishing, applies_to: [publication], propose: member, decide: { by: maintainer, method: approve, count: 1 } }
  decisions: []
`
const MEMBERS = `schema_version: "2.0"
members:
  - { id: steward-a, name: Steward A, kind: person, handles: { git: test@local } }
`

function ruled(i: FixtureInstance): FixtureInstance {
  writeFileSync(join(i.dir, 'data/governance.yaml'), RULED)
  writeFileSync(join(i.dir, 'data/members.yaml'), MEMBERS)
  execSync(`git -C "${i.dir}" add -A && git -C "${i.dir}" commit -qm rules`)
  return i
}

describe('an apply is judged by the house’s rules, as the tray’s is (R-45)', () => {
  it('applies a canon edit the rule lets the steward decide alone, naming that rule', async () => {
    instance = ruled(asRepo(makeKmsInstance()))
    const edit = await prepareEdit(instance.dir, 'encyclopedia-entry', 'living-mulch', { fields: { audience: 'Growers' } }, { now: FIXTURE_NOW }, STEWARD)
    expect(edit.rule).toMatchObject({ direct: true })
    const applied = await applyEdit(instance.dir, 'encyclopedia-entry', 'living-mulch', { fields: { audience: 'Growers' }, base: edit.base }, STEWARD)
    expect(applied.changed).toBe(true)
    expect(execSync(`git -C "${instance.dir}" log -1 --format=%B`).toString()).toContain('Org-Rule: canon/direct')
  })

  it('refuses a publication-classed edit the org’s publication rule does not let the steward decide alone, and writes nothing', async () => {
    instance = ruled(asRepo(makeKmsInstance()))
    const file = join(instance.dir, 'data/kb/claim-evidence.yaml')
    const was = readFileSync(file, 'utf8')
    const head = execSync(`git -C "${instance.dir}" rev-parse HEAD`).toString()
    const fields = { maturity: 'reviewed', public_use: 'reviewed-for-guidance' }
    const edit = await prepareEdit(instance.dir, 'claim-evidence', 'seed-swap-notes', { fields }, { now: FIXTURE_NOW }, STEWARD)
    expect(edit.classes).toEqual(['workspace', 'publication'])
    expect(edit.rule).toMatchObject({ direct: false })
    await expect(applyEdit(instance.dir, 'claim-evidence', 'seed-swap-notes', { fields, base: edit.base }, STEWARD))
      .rejects.toMatchObject({ status: 403 })
    expect(readFileSync(file, 'utf8')).toBe(was)
    expect(execSync(`git -C "${instance.dir}" rev-parse HEAD`).toString()).toBe(head)
  })

  it('is judged at the canon’s own target, workspace:knowledge, as the tray judges data/kb/** (L6 §3.2, R-56)', async () => {
    instance = asRepo(makeKmsInstance())
    writeFileSync(join(instance.dir, 'data/governance.yaml'), RULED.replace(
      '    - { id: canon, applies_to: [workspace], propose: member, decide: { by: maintainer, method: direct } }\n',
      '    - { id: knowledge, applies_to: ["workspace:knowledge"], propose: member, decide: { by: maintainer, method: approve, count: 1 } }\n'))
    execSync(`git -C "${instance.dir}" add -A && git -C "${instance.dir}" commit -qm rules`)
    const file = join(instance.dir, 'data/kb/encyclopedia-entry.yaml')
    const was = readFileSync(file, 'utf8')
    const edit = await prepareEdit(instance.dir, 'encyclopedia-entry', 'living-mulch', { fields: { audience: 'Growers' } }, { now: FIXTURE_NOW }, STEWARD)
    expect(edit.rule).toMatchObject({ direct: false })
    await expect(applyEdit(instance.dir, 'encyclopedia-entry', 'living-mulch', { fields: { audience: 'Growers' }, base: edit.base }, STEWARD))
      .rejects.toMatchObject({ status: 403 })
    expect(readFileSync(file, 'utf8')).toBe(was)
  })

  it('refuses an apply that names no base: the stale check is not optional', async () => {
    instance = asRepo(makeKmsInstance())
    await expect(applyEdit(instance.dir, 'encyclopedia-entry', 'living-mulch', { fields: { audience: 'A' } }, STEWARD))
      .rejects.toThrow(/prepare/)
  })
})

/** Review C-1, ruling PF-R1: the canon is edited on its entry page in the commons, where publishing is judged (Q-1). A
 *  `file` op on data/kb/ would be judged at the canon's own targets only, never by kms's floor, so a canon text that makes
 *  an entry publishable could apply under the workspace rule and the next publish run would publish it. It is refused at
 *  staging, and again at apply, so it can never come back direct. */
describe('the canon is written from its entry page only (review C-1, PF-R1)', () => {
  const CANON = 'The knowledge canon is edited on its entry page in the commons, where publishing is judged.'
  const post = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

  it('refuses a data/kb file op at staging, naming the entry page, and stages nothing', async () => {
    instance = ruled(asRepo(makeKmsInstance()))
    const fields = { maturity: 'reviewed', public_use: 'reviewed-for-guidance' }
    const edit = await prepareEdit(instance.dir, 'claim-evidence', 'seed-swap-notes', { fields }, { now: FIXTURE_NOW }, STEWARD)
    // The entry page holds this edit for the publication rule …
    expect(edit.rule).toMatchObject({ direct: false })
    // … and the tray must not be a way around it.
    const app = createApp(instance.dir)
    const res = await app.request('/api/changes/ops', post({ ops: [{ op: 'file', path: edit.file, text: edit.text }] }))
    expect(res.status).toBe(422)
    const { errors } = await res.json() as { errors: { record: string; message: string }[] }
    expect(errors).toEqual([{ record: edit.file, field: 'path', message: expect.stringContaining(CANON) }])
    expect((await (await app.request('/api/changes')).json() as { ops: unknown[] }).ops).toEqual([])
  })

  it('refuses a non-publishing canon text too: the path is refused, whatever the text', async () => {
    instance = ruled(asRepo(makeKmsInstance()))
    const edit = await prepareEdit(instance.dir, 'encyclopedia-entry', 'living-mulch', { fields: { audience: 'Growers' } }, { now: FIXTURE_NOW }, STEWARD)
    expect(edit.rule).toMatchObject({ direct: true }) // the entry page applies it, under canon/direct
    const res = await createApp(instance.dir).request('/api/changes/ops', post({ ops: [{ op: 'file', path: edit.file, text: edit.text }] }))
    expect(res.status).toBe(422)
    expect(JSON.stringify(await res.json())).toContain(CANON)
  })

  it('refuses one at apply as well, writing nothing: a file op staged before this ruling never applies', async () => {
    instance = ruled(asRepo(makeKmsInstance()))
    const fields = { maturity: 'reviewed', public_use: 'reviewed-for-guidance' }
    const edit = await prepareEdit(instance.dir, 'claim-evidence', 'seed-swap-notes', { fields }, { now: FIXTURE_NOW }, STEWARD)
    const file = join(instance.dir, edit.file)
    const was = readFileSync(file, 'utf8')
    const head = execSync(`git -C "${instance.dir}" rev-parse HEAD`).toString()
    await expect(applyOps(instance.dir, [{ op: 'file', path: edit.file, text: edit.text, base: null }],
      { message: 'x', trailers: { actor: 'steward-a', change: 'chg_test', rule: 'canon/direct' } }))
      .rejects.toMatchObject({ status: 422, errors: [{ record: edit.file, field: 'path', message: expect.stringContaining(CANON) }] })
    expect(readFileSync(file, 'utf8')).toBe(was)
    expect(execSync(`git -C "${instance.dir}" rev-parse HEAD`).toString()).toBe(head)
  })
})
