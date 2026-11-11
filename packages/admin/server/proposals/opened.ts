// packages/admin/server/proposals/opened.ts
//
// What a proposal's ops may need, judged against what it was opened for (0.6 P2 spec §3.4 "Revising"; ruling PF-R4, DAO-OS
// L6 Task 10's review I2). A proposal is decided by the rules of the classes it was opened for (its `classes` and its
// snapshot `rules`); ops that need another class (a publication the opening did not see) cannot be decided by them.
// Revise judged this; a replay that re-bases the ops on a moved trunk (Keep mine, Take theirs) and a ratify that builds
// them on the trunk's tip now judge it too, on the ops as they will land, each read against the trunk they land on. So
// a change that has become a publication since it was opened (the trunk moved its record into the floor's reach; a
// visibility default loosened under it) is refused, and its author revises it or proposes it again under the right rules.

import { Refusal } from '../changes/apply.ts'
import { classesOf, targetsOfOps } from '../changes/stage.ts'
import type { StageOp } from '../changes/types.ts'
import { readRuleContext } from '../governance/effective.ts'
import { WORKSPACE } from '../../lib/change-classes.mjs'
import { WORKSPACE_DIRECT, effectiveRules, isWorkspaceTarget, rulesForClasses, workspaceRuleFor } from '../../lib/rules.mjs'
import type { Proposal } from '../../lib/proposals.mjs'

/** What an op is named by in a sentence: its record, or a file op's path (L6 §11.2). */
export const opName = (op: { op: string; record?: unknown; path?: unknown }): string => String(op.op === 'file' ? op.path : op.record)

export interface OpenedWords {
  /** "Not revised", "Not replayed", "Not ratified": opens the refusal. */
  not: string
  /** What the author does instead, the refusal's last sentence before "Nothing was written.". */
  instead: string
}

/** Revise's own words (P2 spec §3.4). */
export const REVISE_WORDS: OpenedWords = { not: 'Not revised', instead: 'A revision keeps to the classes its rules decide; propose the rest on its own.' }

/** A replay's and a ratify's (PF-R4): the trunk moved under the proposal, and its ops now need a decision it was not opened for. */
export const LANDING = 'As the trunk stands now, its change needs a decision it was not opened for: revise it to what it was opened for, or withdraw it and propose the rest on its own.'

/**
 * Refuse, 409 `CLASSES`, ops (each judged against the record it was staged against, or will land on: its `before`) that
 * need a class proposal `entry` was not opened for, or that no rule of its snapshot covers; `privateClasses` are its
 * restricted part's. With `live`, a workspace op that a rule raises now and the proposal was not opened under is refused
 * too (L6 §3.2): Revise judges that, as a revision is the author's new content; a replay and a ratify are decided under
 * the rules the proposal was opened under (its snapshot), so they judge its classes only.
 */
export function refuseOutsideOpened(repo: string, entry: Proposal, ops: StageOp[], privateClasses: string[], words: OpenedWords, live = false): void {
  const id = String(entry.id)
  const nothing = 'Nothing was written.'
  const classes = [...new Set([...classesOf(ops, repo), ...privateClasses])]
  const opened = (entry.classes ?? []).map(String)
  const covered = rulesForClasses(entry.rules, classes)
  for (const cls of classes) {
    // The workspace is always covered (workspace/direct at worst); which rule its ops fall under is judged by target below.
    if (opened.includes(cls) && (cls === WORKSPACE || covered.find(c => c.class === cls)?.rule)) continue
    const op = ops.find(o => classesOf([o], repo).includes(cls))
    throw new Refusal(409, { code: 'CLASSES', error: `${words.not}: ${op ? `the op on ${opName(op)}` : 'its restricted part'} is of the class ${cls}, and proposal ${id} was opened for ${opened.join(', ') || 'no class'}, ` +
      `under ${entry.rules.map(r => `rule "${r.id}"`).join(' and ')}. ${words.instead} ${nothing}` })
  }
  if (live) refuseRaisedTargets(repo, entry, ops, words)
}

/** Refuse, 409 `CLASSES`, a restricted part that falls, at its own targets (`lists`, server/private/targets.ts) read against
 *  data/governance.yaml as it is, under a workspace rule proposal `entry` was not opened under (Task 15 review I-1): Revise's
 *  live judgement of its private part, and a ratify's, as a move's (PF-R13). Its op is never named. */
export function refuseRaisedPrivate(repo: string, entry: Proposal, lists: string[][], words: OpenedWords): void {
  const governance = readRuleContext(repo, { unknown: '' }).governance
  const rules = governance === null ? [] : effectiveRules(governance).rules
  for (const targets of lists) {
    if (!isWorkspaceTarget(targets[0])) continue
    const rule = workspaceRuleFor(rules, targets)
    if (rule === WORKSPACE_DIRECT || entry.rules.some(r => r.id === rule.id)) continue
    throw new Refusal(409, { code: 'CLASSES', error: `${words.not}: its restricted part falls under rule "${rule.id}", and proposal ${String(entry.id)} was opened under ` +
      `${entry.rules.map(r => `rule "${r.id}"`).join(' and ') || 'no rule'}. ${words.instead} Nothing was written.` })
  }
}

/** Refuse, 409 `CLASSES`, a workspace op that a rule raises now (by its targets, against data/governance.yaml as it is) and
 *  proposal `entry` was not opened under (L6 §3.2): Revise's live judgement, and a ratify's of the moves it plans
 *  (Task 11 review I-2: where a move lands is read at ratify, so it is judged there). */
export function refuseRaisedTargets(repo: string, entry: Proposal, ops: StageOp[], words: OpenedWords): void {
  const id = String(entry.id)
  const nothing = 'Nothing was written.'
  // L6 §3.2: a workspace op that a rule raises now, and the proposal was not opened under, is not revised into it.
  const governance = readRuleContext(repo, { unknown: '' }).governance
  const rules = governance === null ? [] : effectiveRules(governance).rules
  for (const op of ops) {
    for (const targets of targetsOfOps([op], repo)) {
      if (!isWorkspaceTarget(targets[0])) continue
      const rule = workspaceRuleFor(rules, targets)
      if (rule === WORKSPACE_DIRECT || entry.rules.some(r => r.id === rule.id)) continue
      throw new Refusal(409, { code: 'CLASSES', error: `${words.not}: the op on ${opName(op)} falls under rule "${rule.id}", and proposal ${id} was opened under ` +
        `${entry.rules.map(r => `rule "${r.id}"`).join(' and ') || 'no rule'}. A revision keeps to the rules it was opened under; propose the rest on its own. ${nothing}` })
    }
  }
}
