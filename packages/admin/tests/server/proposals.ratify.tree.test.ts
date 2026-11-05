import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { removeFixtureRepo } from '../fixtures.ts'
import { makeChangeRepo, git } from '../changes/fixtures.ts'
import { createdText } from '../../server/registry.ts'
import { mergeNoFf, showFile } from '../../server/git.ts'
import { planRatify, applyRatifyMerge, ratify, type RatifyTexts } from '../../server/proposals/ratify.ts'
import { evaluateAll } from '../../lib/evaluate.mjs'
import { resolveRoles } from '../../lib/rules.mjs'
import { revOf, type Proposal } from '../../lib/proposals.mjs'

// The tree-to-be (N1, spec §3.8 step 3). P1's change engine cannot stage an edit of governance.yaml (spec §6, P2-R33),
// so the branch is built here by hand, in a throwaway repository under the temp directory: a single content commit,
// the trunk tip its parent, that adds a rule. Ratify's git layer (planRatify, then applyRatifyMerge) then runs on it.
// Every git command, the test's and the module's, runs in that repository. Members are synthetic.
const MEMBERS = `schema_version: "2.0"
members:
  - { id: ana, name: Ana, kind: person, handles: { git: ["ana@example.test"] } }
  - { id: bruno, name: Bruno, kind: person, handles: { git: ["bruno@example.test"] } }
  - { id: carla, name: Carla, kind: person, handles: { git: ["carla@example.test"] } }
`
const GOV = `schema_version: "2.0"
# the rules of the test org
governance:
  model: "consensus"
  roles:
    maintainer: { members: [bruno] }
    member: { all: true }
  rules:
    - { id: records, applies_to: [records], propose: member, decide: { by: maintainer, method: approve, count: 1 } }
  decisions: []
`
const RULE = '    - { id: ops, applies_to: [operations], propose: member, decide: { by: maintainer, method: approve, count: 1 } }\n'
const DECISIONS_MD = '# Decisions\n\n## Conventions\n\nNewest first.\n\n---\n\n## 2026-10-01 · LD-2026-001 — The first decision\n\n**Status:** active\n'
const ID = 'p-2026-10-18-001'
const NOW = new Date(Math.floor(Date.now() / 1000) * 1000 - 60_000)
const STATEMENT = { title: 'Add an operations rule', decision: 'Operations are approved by a maintainer.', why: 'They need a review.', scope: 'governance' }

let repo: string
afterEach(() => { removeFixtureRepo(repo) })
beforeEach(() => { repo = '' })
const sha = (rev = 'HEAD') => git(repo, `rev-parse ${rev}`).trim()

/** The trunk: members, a governance file, DECISIONS.md, and an open proposal bruno has approved. Answers its tip. */
function trunk(statement: boolean): string {
  repo = makeChangeRepo(GOV)
  writeFileSync(join(repo, 'data', 'members.yaml'), MEMBERS)
  writeFileSync(join(repo, 'DECISIONS.md'), DECISIONS_MD)
  writeFileSync(join(repo, 'other.txt'), 'other\n')
  const rev = revOf([])
  const at = NOW.toISOString().replace('.000Z', 'Z')
  const entry = {
    id: ID, title: 'Add an operations rule', author: 'ana', classes: ['governance'],
    rules: [{ id: 'records', applies_to: ['records'], propose: 'member', decide: { by: 'maintainer', method: 'approve', count: 1 } }],
    state: 'open', opened: at, rev, base: null, branch: `proposal/${ID}`, ops: [],
    ...(statement ? { statement: STATEMENT } : {}),
    events: [{ id: 'e-approve-01', at, by: 'bruno', kind: 'approve', rev }], closed: null,
  }
  writeFileSync(join(repo, 'data', 'proposals.yaml'), createdText('proposals: []\n', 'proposals', entry))
  git(repo, 'add -A'); git(repo, 'commit -qm "fixture: the trunk"')
  return sha()
}
/** The branch, by hand: one commit whose parent is `from`, adding RULE to governance.yaml; `proposal/<id>` set to it. */
function branchOn(from: string): string {
  git(repo, `checkout -q --detach ${from}`)
  const path = join(repo, 'data', 'governance.yaml')
  const text = readFileSync(path, 'utf8')
  const after = text.indexOf('\n', text.indexOf('- { id: records')) + 1
  writeFileSync(path, text.slice(0, after) + RULE + text.slice(after))
  git(repo, `commit -qam "proposal ${ID}: an operations rule"`)
  const c = sha()
  git(repo, `update-ref refs/heads/proposal/${ID} ${c}`)
  git(repo, 'checkout -q main')
  return c
}
/** The texts of three files at `rev`. */
async function textsAt(rev: string, statement: boolean): Promise<RatifyTexts> {
  return {
    proposals: await showFile(repo, rev, 'data/proposals.yaml'),
    governance: await showFile(repo, rev, 'data/governance.yaml'),
    decisions: statement ? await showFile(repo, rev, 'DECISIONS.md') : null,
  }
}
function plan(texts: RatifyTexts) {
  const proposal = (parse(texts.proposals).proposals as Proposal[]).find(p => p.id === ID)!
  const book = resolveRoles(parse(texts.governance).governance, parse(MEMBERS).members)
  const evaluation = evaluateAll({ proposal, book, now: NOW })
  expect(evaluation.state).toBe('met')
  const planned = planRatify({ id: ID, actor: 'bruno', now: NOW, evaluation, texts })
  if (!planned.ok) throw new Error(planned.reason)
  return planned.plan
}
const rulesAt = (rev: string) => (parse(git(repo, `show ${rev}:data/governance.yaml`)).governance.rules as { id: string }[]).map(r => r.id)
const decisionsAt = (rev: string) => (parse(git(repo, `show ${rev}:data/governance.yaml`)).governance.decisions ?? []) as { proposal: string }[]
const names = (a: string, b: string) => git(repo, `diff --name-only ${a} ${b}`).trim().split('\n').sort()

describe('ratify computes from the tree-to-be, never from HEAD (N1)', () => {
  it('(a) a branch that adds a rule: the merge commit holds the rule and the decision row; the diff is the ledger files and nothing else', async () => {
    const T = trunk(false)
    const C = branchOn(T)
    const merge = await applyRatifyMerge(repo, { trunk: T, commit: C, plan: plan(await textsAt(C, false)) })
    expect(merge).toBe(sha())
    expect(git(repo, 'rev-list --parents -1 HEAD').trim().split(' ')).toEqual([merge, T, C])
    expect(rulesAt('HEAD')).toEqual(['records', 'ops'])
    expect(decisionsAt('HEAD')).toMatchObject([{ proposal: ID, outcome: 'ratified', status: 'ratified' }])
    expect(rulesAt('HEAD^2')).toEqual(['records', 'ops'])
    expect(names('HEAD^1', 'HEAD')).toEqual(['data/governance.yaml', 'data/proposals.yaml'])
    expect(git(repo, 'status --porcelain --untracked-files=no')).toBe('')
  })

  it('(b) the same when the trunk moved after the branch was built (other.txt and another line of governance.yaml), the branch rebuilt first; with a statement, DECISIONS.md too', async () => {
    const T0 = trunk(true)
    branchOn(T0) // built, then the trunk moves
    writeFileSync(join(repo, 'other.txt'), 'other, edited on the trunk\n')
    const gov = join(repo, 'data', 'governance.yaml')
    writeFileSync(gov, readFileSync(gov, 'utf8').replace('# the rules of the test org', '# the rules of the test org, edited on the trunk'))
    git(repo, 'commit -qam "trunk: other.txt and a comment line of governance.yaml"')
    const T = sha()
    const C = branchOn(T) // rebuilt on the new tip
    expect(sha(`${C}^`)).toBe(T)
    await applyRatifyMerge(repo, { trunk: T, commit: C, plan: plan(await textsAt(C, true)) })
    expect(rulesAt('HEAD')).toEqual(['records', 'ops'])
    expect(decisionsAt('HEAD')).toHaveLength(1)
    expect(git(repo, 'show HEAD:data/governance.yaml')).toContain('# the rules of the test org, edited on the trunk')
    expect(git(repo, 'show HEAD:other.txt')).toBe('other, edited on the trunk\n')
    expect(names('HEAD^1', 'HEAD')).toEqual(['DECISIONS.md', 'data/governance.yaml', 'data/proposals.yaml'])
    expect(git(repo, 'show HEAD:DECISIONS.md')).toContain('LD-2026-002 — Add an operations rule')
  })

  it('(e) the whole ratify, its branch built by hand on the trunk tip: the merge commit keeps the rule the branch adds', async () => {
    const T = trunk(true)
    git(repo, 'config user.email bruno@example.test')
    let built = 0
    const build = async (_r: string, _p: unknown, from: string) => { built++; return { tip: branchOn(from), from, moved: true } }
    const result = await ratify(repo, { id: 'bruno', name: 'Bruno', kind: 'person' }, ID, { startBranch: 'main', build })
    expect(built).toBe(1)
    expect(result.commit).toBe(sha())
    expect(sha('HEAD^1')).toBe(T)
    expect(rulesAt('HEAD')).toEqual(['records', 'ops'])
    expect(decisionsAt('HEAD')).toMatchObject([{ proposal: ID, outcome: 'ratified' }])
    expect(names('HEAD^1', 'HEAD')).toEqual(['DECISIONS.md', 'data/governance.yaml', 'data/proposals.yaml'])
  })

  it('fix 4: a rule snapshot with no method gives no decision row: planRatify refuses in words rather than guess one', async () => {
    trunk(false)
    const texts = await textsAt('HEAD', false)
    const proposal = (parse(texts.proposals).proposals as Proposal[]).find(p => p.id === ID)!
    const book = resolveRoles(parse(texts.governance).governance, parse(MEMBERS).members)
    const evaluation = evaluateAll({ proposal, book, now: NOW })
    const noMethod = createdText('proposals: []\n', 'proposals', { ...proposal, rules: [{ ...proposal.rules[0]!, decide: { by: 'maintainer', count: 1 } }] } as never)
    const planned = planRatify({ id: ID, actor: 'bruno', now: NOW, evaluation, texts: { ...texts, proposals: noMethod } })
    expect(planned).toEqual({ ok: false, reason: expect.stringMatching(/name no method.*decision row/) })
  })

  it('(c) negative control, proof N1.A: the second draft’s texts (from HEAD, written after the merge) lose the rule, which stays only in the second parent', async () => {
    const T = trunk(false)
    const C = branchOn(T)
    await applyRatifyMerge(repo, { trunk: T, commit: C, plan: plan(await textsAt('HEAD', false)) })
    expect(rulesAt('HEAD')).toEqual(['records']) // the ratification recorded without the change it ratified
    expect(decisionsAt('HEAD')).toHaveLength(1)
    expect(rulesAt('HEAD^2')).toEqual(['records', 'ops'])
  })

  it('(d) after the merge, each of the three files in the working tree is git show <C>:<file>, byte for byte (the step-5 invariant)', async () => {
    const T = trunk(true)
    const C = branchOn(T)
    const seen: Record<string, boolean> = {}
    await applyRatifyMerge(repo, { trunk: T, commit: C, plan: plan(await textsAt(C, true)) }, {
      merge: async (r, rev) => {
        const started = await mergeNoFf(r, rev)
        for (const f of ['data/proposals.yaml', 'data/governance.yaml', 'DECISIONS.md']) {
          seen[f] = readFileSync(join(r, f)).equals(Buffer.from(await showFile(r, C, f), 'utf8'))
        }
        return started
      },
    })
    expect(seen).toEqual({ 'data/proposals.yaml': true, 'data/governance.yaml': true, 'DECISIONS.md': true })
  })

  it('(d) a working file that differs from C’s blob (a forced line-ending conversion) aborts in words, and the merge is undone', async () => {
    const T = trunk(false)
    const C = branchOn(T)
    writeFileSync(join(repo, '.git', 'info', 'attributes'), 'data/governance.yaml text eol=crlf\n')
    const p = plan(await textsAt(C, false))
    await expect(applyRatifyMerge(repo, { trunk: T, commit: C, plan: p })).rejects.toMatchObject({
      body: { code: 'TREE_DIFFERS', error: expect.stringMatching(/data\/governance\.yaml.*differs from the branch.*line endings.*git merge --abort/) },
    })
    expect(existsSync(join(repo, '.git', 'MERGE_HEAD'))).toBe(false)
    expect(sha()).toBe(T)
    expect(git(repo, 'status --porcelain --untracked-files=no')).toBe('')
  })
})
