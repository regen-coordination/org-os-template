/** Prepared edits: the canon's one write, and why it is not a tray op (R-32).
 *
 *  L6's `file` op does not exist in this branch, and adding an op kind would touch every module that judges `op.op`
 *  (the tray, proposals, receipts, private ops, visibility). So an edit is **prepared** first — nothing written, the
 *  changed fields and the file's new text returned with a base hash — and **applied** second: one file, one commit
 *  with the house's trailers, judged by the house's rules exactly as the tray's Apply is (review fix, 2026-11-04).
 *
 *  The file is edited **in place**: only the lines of the fields an edit sets change (R-43). The `yaml` package's
 *  document API locates them and says what the result must parse to; the text around them is never re-printed, so a
 *  hand-kept canon keeps its comments, its spacing and its list style. kms's own adapter re-serialises with js-yaml
 *  and would lose all three; this module is the only writer of the canon in this package. */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { HttpError } from '../errors.ts'
import { applyToText, asObject, canonRel, checkFields, entryOf, judgeCanonWrite, type EditRequest, type FieldValue } from './canon-text.ts'
import { Refusal } from '../changes/apply.ts'
import { commitDataPaths } from '../git.ts'
import { actorTrailer, commitIdent, isKnown, type Actor, type KnownActor } from '../actor.ts'
import { effectiveRule, hatsActedUnder, readRuleContext, ruleIds } from '../governance/effective.ts'
import { classOf, publishes } from '../../lib/change-classes.mjs'
import { targetsOfPath } from '../../lib/workspace/targets.mjs'
import { readEntry } from './read.ts'
import type { PreparedEdit } from './types.ts'

export { applyToText, checkFields, type EditRequest, type FieldValue } from './canon-text.ts'

/** The canon file a kind lives in, with its text and the hash a prepared edit is pinned to. */
export function canonFile(repo: string, type: string): { rel: string; abs: string; text: string; base: string } {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(type)) throw new HttpError(400, `"${type}" is not a kind kms stores: kinds are lowercase letters, digits and hyphens.`)
  const rel = canonRel(type)
  const abs = join(repo, rel)
  let text: string
  try { text = readFileSync(abs, 'utf8') } catch {
    throw new HttpError(404, `The canon has no file for "${type}" (${rel}). An entry can only be edited where kms stores it.`)
  }
  return { rel, abs, text, base: createHash('sha256').update(text).digest('hex') }
}

/* ── classes and rules ───────────────────────────────────────────────────────────────────────────────────────── */

/** The house's classes for this edit (F1, `schemas/change-classes.json`): the canon file's own class — `workspace`, by
 *  the row L6 gives `data/kb/**` (R-55 foresaw it) — and `publication` beside it when the edit makes the entry publishable
 *  (L5 §9.7's class). Whether it does is lib's `publishes` (L6 §13), the one predicate the tray, a ratify and
 *  validate:governance judge by: the commons' floor, maturity and public use (ruling R-L6-T10-1). kms's own
 *  `isPublishable` also asks the kind (the instance's opt-in and opt-out), so it can only say "not publishing" of an edit
 *  the floor calls publishing, never the reverse; it is not consulted here, so it never makes such an edit direct. */
export function editClasses(type: string, slug: string, before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const own = String(classOf({ path: canonRel(type) }))
  const set = Object.fromEntries(Object.keys({ ...before, ...after }).filter(k => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null))
    .map(k => [k, after[k] ?? null]))
  return publishes({ op: 'update', record: knowledgeRecord(type, slug), set }, before, null) ? [own, 'publication'] : [own]
}

/** The record op a canon edit is in the change engine (L6 Task 10): `knowledge:<type>/<slug>`. */
export const knowledgeRecord = (type: string, slug: string): string => `knowledge:${type}/${slug}`

/** The targets the rules judge this edit at (L6 §3.2), one list per thing it touches, as the tray's `targetsOfOps` gives
 *  them: the canon file's (`data/kb/**` is `workspace:knowledge`, then `workspace`), and `publication` when the edit
 *  makes the entry publishable. So a rule written for `workspace:knowledge` judges a canon edit here as it judges the
 *  same edit staged in the tray (R-56: one judgement for every write in the house). */
export function editTargets(type: string, classes: string[]): string[][] {
  const own = targetsOfPath(canonRel(type), () => null) ?? [String(classOf({ path: canonRel(type) }))]
  return classes.includes('publication') ? [own, ['publication']] : [own]
}

/** What the house's rules say of an edit of `classes` (at `targets`, L6 §3.2) by `actor`: whether it applies directly,
 *  under which rule, and the sentence; when it does not, whether this person may propose it (`proposable`, the tray's own
 *  answer). The tray's own judgement (changes/routes.ts `applyAs`), read without writing. A canon edit is proposed as the
 *  house proposes any change (Task 10, R-L6-T10-3): staged as its record op, then Propose; so the sentence is the house's
 *  ("… Propose it instead."). */
export function ruleOf(repo: string, actor: Actor, classes: string[], targets?: string[][]): { direct: boolean; rule: string | null; sentence: string; proposable?: boolean } {
  const ctx = readRuleContext(repo, actor)
  const judged = effectiveRule(ctx, classes, targets)
  if (judged.direct && isKnown(actor)) {
    const ids = ruleIds(ctx, classes, targets).map(id => `${id}/direct`).join(',')
    return { direct: true, rule: ids, sentence: `Applies directly, in one commit, under ${ids}.` }
  }
  return { direct: false, rule: null, sentence: judged.sentence, proposable: judged.proposable === true && isKnown(actor) }
}

/** The changes an edit makes, old and new, for the card's rows. */
function changesOf(before: Record<string, unknown>, fields: Record<string, FieldValue>) {
  return Object.entries(fields).map(([field, after]) => ({ field, before: before[field] ?? null, after }))
}

/** Prepare an edit. Nothing is written: `applyEdit` is the only writer, and the base it needs is in this answer, with
 *  what the rules will say of it for `actor` (a reader: not direct). */
export async function prepareEdit(repo: string, type: string, slug: string, request: EditRequest, opts: { now?: string } = {},
  actor: Actor = { unknown: '' }): Promise<PreparedEdit> {
  const fields = checkFields(asObject(request.fields))
  await readEntry(repo, type, slug, opts) // the entry must be the canon's, and this says so in the app's own words
  const file = canonFile(repo, type)
  const before = entryOf(file.text, type, slug)
  const text = applyToText(file.text, type, slug, fields)
  const after = entryOf(text, type, slug)
  const classes = editClasses(type, slug, before, after)
  return {
    type, slug, file: file.rel, base: file.base, record: knowledgeRecord(type, slug),
    changes: changesOf(before, fields),
    classes,
    rule: ruleOf(repo, actor, classes, editTargets(type, classes)),
    text,
  }
}

export interface ApplyResult { commit: string | null; changed: boolean; classes: string[]; sentence: string }

/** Apply a prepared edit: refuse if the file moved under it, refuse what the house's rules do not let this actor apply
 *  alone, write it, one commit with the house's trailers (Org-Actor, Org-Rule, Org-Change, Org-Hat) and the house's
 *  authorship for a signed-in actor — the tray's Apply, for one file. Callers hold the repository's write lock. */
export async function applyEdit(repo: string, type: string, slug: string, request: EditRequest, actor: KnownActor): Promise<ApplyResult> {
  const fields = checkFields(asObject(request.fields))
  if (typeof request.base !== 'string' || request.base === '') {
    throw new HttpError(400, 'An apply names the base its prepare answered: prepare the edit first, then apply it. Nothing was written.')
  }
  const file = canonFile(repo, type)
  if (request.base !== file.base) {
    throw new HttpError(409, `${file.rel} has changed since this edit was prepared. Nothing was written: read what it holds now, and prepare the edit again.`)
  }
  const before = entryOf(file.text, type, slug)
  // Only what the entry does not already hold: a field set to its own value changes no file, and staging it would put
  // a row in the card that Apply cannot write.
  const differs = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)
  const real = Object.fromEntries(Object.entries(fields).filter(([field, value]) => differs(before[field], value))) as Record<string, FieldValue>
  if (Object.keys(real).length === 0) {
    return { commit: null, changed: false, classes: [String(classOf({ path: file.rel }))], sentence: 'Nothing to write: the entry already holds these values.' }
  }
  const text = applyToText(file.text, type, slug, real)
  const after = entryOf(text, type, slug)
  const classes = editClasses(type, slug, before, after)
  // The whole file, before against after (PF-R3): no other entry moves, and nothing becomes publishable undecided.
  judgeCanonWrite(file.text, text, type, new Set([slug]), classes.includes('publication'))
  // The rules, before anything is written (R-45): a publication is decided by the org's rule for it, never assumed.
  const targets = editTargets(type, classes)
  const judged = ruleOf(repo, actor, classes, targets)
  if (!judged.direct || judged.rule === null) {
    const sentence = `Not saved: ${judged.sentence} Nothing was written.`
    throw new Refusal(403, { reason: sentence, error: sentence })
  }
  const hat = hatsActedUnder(readRuleContext(repo, actor), classes, targets).join(', ')
  const entry = await readEntry(repo, type, slug)
  writeFileSync(file.abs, text)
  const message = `knowledge: ${entry.row.title} (${type}/${slug})`
  try {
    const commit = await commitDataPaths(repo, [file.rel], message, {
      actor: actorTrailer(actor),
      rule: judged.rule,
      change: `kms-admin:${type}/${slug}`,
      ...(hat !== '' ? { hat } : {}),
    }, { ident: commitIdent(actor) })
    return { commit, changed: true, classes, sentence: `Saved. It changed ${file.rel}; one commit, under ${judged.rule}.` }
  } catch (err) {
    // Put the file back: a refused commit must not leave the entry changed on disk.
    writeFileSync(file.abs, file.text)
    throw new HttpError(503, `Not saved: ${err instanceof Error ? err.message : String(err)}. ${file.rel} was put back.`)
  }
}
