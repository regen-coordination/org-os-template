// tests/scripts/fixtures/ledger-write.mjs
//
// Writes to a throwaway repository's ledger with the server's own functions (createEntry, writeEvent, buildBranch,
// replayBranch), so the validator's positive cases are histories the platform itself makes. The server is TypeScript
// that plain `node` cannot strip (a parameter property in server/changes/apply.ts), so the test runs this file with
// `npx tsx`, from packages/admin. It is not a test: `node --test` only picks up `*.test.mjs`.
//
// Usage: tsx ledger-write.mjs '<json>' where the JSON is { repo, steps, owner? } and each step is one of (it prints the
// admin home it made, `ledger-write admin home: <path>`, and removes it when it is done)
//   { open: <entry>, now, email, actor, rule }        createEntry, as Propose does; an op's `base: "@current"` is the
//                                                     record's base as the trunk holds it, the entry's `base: "@head"` HEAD
//   { event: { kind, text?, vote?, of? }, id, now, email, actor, kind? }   writeEvent, through the machine's guards
//   { branch: true, id, now, email, actor }           buildBranch on HEAD, as Propose does after the entry
//   { replay: 'mine' | 'theirs', id, now, email, actor, rule }   replayBranch on HEAD with the author's choice
//   { ratify: true, id, now, email, actor }           ratify, the route's whole path (preflight, branch, plan, merge),
//                                                     with the private store when an earlier step opened it
//   { keep: <PrivateRecord>, now, email, actor }      a record put in the private store (opened under the admin home
//                                                     on first use, removed with it), as the Hub keeps a private one
// An `open` step's `private: [<staged private op>]` is its restricted part, as Propose writes it: a placeholder per op
// appended to the entry's ops (its rev taken again) and its `pending` row in the store; a move's `digest: "@current"` is
// the digest of the record as the store holds it (DAO-OS L6 §12).
//   { close: 'rejected' | 'expired' | 'withdrawn', id, now, email, actor }   close, the route's whole path
//   { merge: { commit, evaluateAt?, drop?, row?, decision?, ledger?, allow? }, id, now, email, actor }   a ratify merge of `commit` (a sha, or
//                                                     '@branch': buildBranch on HEAD) into HEAD by planRatify and
//                                                     applyRatifyMerge, skipping ratify's preflight and its machine: the
//                                                     evaluation is taken at `evaluateAt` (default `now`); `drop` leaves
//                                                     those files out of the plan; `row` is merged into the decision row
//                                                     as written; `decision` replaces the Org-Decision trailer; `ledger`
//                                                     ([from, to]) replaces text in the closed ledger; `decisions` ([from,
//                                                     to]) the same in DECISIONS.md; `allow` adds paths
//                                                     the merge may stage; `files` ([{ path, text }]) adds or replaces
//                                                     texts the merge writes; `moved` sets its Org-Moved trailer
//   { closing: 'reject' | 'expire' | 'withdraw', id, now, email, actor, evaluateAt? }   a closing commit by the server's
//                                                     own texts (planClosing, closedLedgerText), skipping its machine
// `now` is the server's clock and the commit's dates; `email` is the commit's author and committer.
//
// It writes only to a repository under the OS temp dir, by real path, so a link there that leads anywhere else is
// refused too, and only to the root of a repository of its own (a directory inside one would reach the one above): it
// runs with its working directory inside a checkout, and a wrong path must never reach a real one.
//
// The admin server keeps its state, and the worktrees buildBranch checks out, under ORG_OS_ADMIN_HOME, else the
// operator's own ~/.org-os/admin (server/state.ts). The writer always sets its own: a fresh directory under the OS temp
// dir, made here before the server is loaded (whatever the caller's environment says) and removed when it is done.

import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const { repo, steps, owner } = JSON.parse(process.argv[2])
const refuse = (why) => {
  console.error(`ledger-write refuses ${repo}: ${why}`)
  process.exit(2)
}
let real
try { real = realpathSync(repo) } catch { refuse('no such directory.') }
if (!real.startsWith(realpathSync(tmpdir()) + path.sep)) refuse(`it writes only to a repository under the OS temp dir (${tmpdir()}).`)
const top = spawnSync('git', ['-C', real, 'rev-parse', '--show-toplevel'], { encoding: 'utf-8' })
if (top.status !== 0 || top.stdout.trim() !== real) refuse('it is not the root of a git repository of its own.')

// `owner` (the calling test's pid) names the directory, so a test that checks its own are removed does not see another
// test file's writers, which `node --test` runs at the same time.
const adminHome = mkdtempSync(path.join(tmpdir(), `ledger-write-admin-${Number.isInteger(owner) ? `${owner}-` : ''}`))
process.env.ORG_OS_ADMIN_HOME = adminHome
// The caller reads this line and checks that exact directory is gone once the writer has finished.
console.log(`ledger-write admin home: ${adminHome}`)

const { createEntry, readLedger } = await import('../../../packages/admin/server/proposals/ledger.ts')
const { writeEvent } = await import('../../../packages/admin/server/proposals/events.ts')
const { buildBranch, replayBranch } = await import('../../../packages/admin/server/proposals/branch.ts')
const { readRegistry } = await import('../../../packages/admin/server/registry.ts')
const { baseOf } = await import('../../../packages/admin/server/changes/canonical.ts')
const { resolveRev } = await import('../../../packages/admin/server/git.ts')
const { parseRecord } = await import('../../../packages/admin/lib/ops.mjs')
const { ratify, planRatify, planClosing, applyRatifyMerge } = await import('../../../packages/admin/server/proposals/ratify.ts')
const { close } = await import('../../../packages/admin/server/proposals/close.ts')
const { machineContext } = await import('../../../packages/admin/server/proposals/events.ts')
const { closedLedgerText } = await import('../../../packages/admin/server/proposals/ledger.ts')
const { showFile, restageDataPaths, commitDataPaths } = await import('../../../packages/admin/server/git.ts')
const { evaluateAll } = await import('../../../packages/admin/lib/evaluate.mjs')
const { eventId, methodOf } = await import('../../../packages/admin/lib/proposals.mjs')
const { insertDecisionRow } = await import('../../../packages/admin/lib/decision-write.mjs')
const { openPrivateStore } = await import('../../../packages/admin/server/private/store.ts')
const { pendingPart } = await import('../../../packages/admin/server/private/proposals.ts')
const { moveDigest } = await import('../../../packages/admin/server/private/ops.ts')
const { revOf } = await import('../../../packages/admin/lib/proposals.mjs')

/** The private store, opened under the admin home on first use (DAO-OS L5 §10): never the operator's, removed with it. */
let store = null
const privateStore = async () => (store ??= await openPrivateStore(repo, { dir: path.join(adminHome, 'private') }))

const entryOf = id => readLedger(repo).entries.find(e => String(e.id) === id)
const person = step => ({ id: step.actor, name: step.actor, kind: step.kind ?? 'person' })
/** The evaluation the server would make, with the book it reads, at `evaluateAt` or else `now`. */
const evaluated = (step, entry) => {
  const { context } = machineContext(repo, person(step), entry, new Date(step.now))
  return evaluateAll({ proposal: entry, book: context.book, now: new Date(step.evaluateAt ?? step.merge?.evaluateAt ?? step.now) })
}
const ruleTrailer = entry => entry.rules.map(r => `${r.id}/${methodOf(r)}`).join(',')
try {
for (const step of steps) {
  Object.assign(process.env, {
    GIT_AUTHOR_NAME: step.actor, GIT_AUTHOR_EMAIL: step.email, GIT_AUTHOR_DATE: step.now,
    GIT_COMMITTER_NAME: step.actor, GIT_COMMITTER_EMAIL: step.email, GIT_COMMITTER_DATE: step.now,
  })
  const now = () => new Date(step.now)
  const head = await resolveRev(repo, 'HEAD')
  if (step.open) {
    const ops = step.open.ops.map(op => {
      if (op.base !== '@current') return op
      const { registry, id } = parseRecord(op.record)
      return { ...op, base: baseOf(readRegistry(repo, registry).entries.find(e => String(e.id) === id) ?? null) }
    })
    const entry = { ...step.open, ops, base: step.open.base === '@head' ? head : step.open.base }
    let rows = []
    if (step.private) {
      const kept = await privateStore()
      const staged = step.private.map(op => (op.op === 'move-to-git' && op.digest === '@current' ? { ...op, digest: moveDigest(kept.record(op.collection, op.id)) } : op))
      const part = pendingPart(entry.id, staged)
      rows = part.rows
      entry.ops = [...entry.ops, ...part.placeholders]
      entry.rev = revOf(entry.ops)
    }
    await createEntry(repo, entry, { actor: step.actor, rule: step.rule }, { now })
    if (rows.length > 0) await store.tx(w => { for (const row of rows) w.putPending(row) })
  } else if (step.branch) {
    await buildBranch(repo, entryOf(step.id), head)
  } else if (step.replay) {
    await replayBranch(repo, entryOf(step.id), head, { actor: step.actor, rule: step.rule }, { now, choose: step.replay })
  } else if (step.keep) {
    await (await privateStore()).putRecord(step.keep, step.actor, null)
  } else if (step.ratify) {
    await ratify(repo, person(step), step.id, { now, ...(store ? { privateStore: () => store } : {}) })
  } else if (step.close) {
    await close(repo, person(step), step.id, step.close, { now })
  } else if (step.merge) {
    const entry = entryOf(step.id)
    if (step.merge.commit === '@branch') await buildBranch(repo, entry, head)
    const commit = step.merge.commit === '@branch' ? await resolveRev(repo, `refs/heads/proposal/${step.id}`) : step.merge.commit
    const statement = entry.statement !== undefined && entry.statement !== null
    const texts = {
      proposals: await showFile(repo, commit, 'data/proposals.yaml'),
      governance: await showFile(repo, commit, 'data/governance.yaml'),
      decisions: statement ? await showFile(repo, commit, 'DECISIONS.md') : null,
    }
    const planned = planRatify({ id: step.id, actor: step.actor, now: now(), evaluation: evaluated(step, entry), texts })
    if (!planned.ok) throw new Error(planned.reason)
    const plan = planned.plan
    if (step.merge.row) {
      const governance = insertDecisionRow(texts.governance, { ...plan.decision, ...step.merge.row })
      if (!governance.ok) throw new Error(governance.reason)
      plan.files = plan.files.map(f => (f.path === 'data/governance.yaml' ? { ...f, text: governance.text } : f))
    }
    if (step.merge.drop) plan.files = plan.files.filter(f => !step.merge.drop.includes(f.path))
    if (step.merge.decision) plan.trailers = { ...plan.trailers, decision: step.merge.decision }
    if (step.merge.ledger) {
      const [from, to] = step.merge.ledger
      plan.files = plan.files.map(f => (f.path === 'data/proposals.yaml' ? { ...f, text: f.text.replace(from, to) } : f))
    }
    if (step.merge.decisions) {
      const [from, to] = step.merge.decisions
      plan.files = plan.files.map(f => (f.path === 'DECISIONS.md' ? { ...f, text: f.text.replace(from, to) } : f))
    }
    if (step.merge.allow) plan.allowed = [...plan.allowed, ...step.merge.allow]
    if (step.merge.files) plan.files = [...plan.files.filter(f => !step.merge.files.some(x => x.path === f.path)), ...step.merge.files]
    if (step.merge.moved) plan.trailers = { ...plan.trailers, moved: step.merge.moved }
    await applyRatifyMerge(repo, { trunk: head, commit, plan })
  } else if (step.closing) {
    const entry = entryOf(step.id)
    const proposals = await showFile(repo, 'HEAD', 'data/proposals.yaml')
    let files, trailers
    if (step.closing === 'withdraw') {
      const at = now().toISOString().replace(/\.\d{3}Z$/, 'Z')
      const event = { id: eventId(now()), at, by: step.actor, kind: 'withdraw' }
      files = [{ path: 'data/proposals.yaml', text: closedLedgerText(proposals, step.id, { state: 'withdrawn', closed: { at, by: step.actor, decision: null } }, event) }]
      trailers = { actor: step.actor, rule: ruleTrailer(entry), proposal: step.id }
    } else {
      const governance = await showFile(repo, 'HEAD', 'data/governance.yaml')
      const planned = planClosing({ entry, proposals, governance, evaluation: evaluated(step, entry), actor: step.actor, now: now(), kind: step.closing })
      if (!planned.ok) throw new Error(planned.reason)
      files = [{ path: 'data/proposals.yaml', text: planned.ledger }, { path: 'data/governance.yaml', text: planned.governance }]
      trailers = { actor: step.actor, rule: ruleTrailer(entry), proposal: step.id, decision: planned.decision.id }
    }
    for (const f of files) {
      writeFileSync(path.join(repo, f.path), f.text)
      await restageDataPaths(repo, [f.path])
    }
    await commitDataPaths(repo, files.map(f => f.path), `proposals: ${step.closing} ${step.id} — ${entry.title}`, trailers)
  } else {
    await writeEvent(repo, person(step), step.id, step.event, { now })
  }
}
} finally {
  try { store?.close() } catch { /* removed below either way */ }
  rmSync(adminHome, { recursive: true, force: true })
}
