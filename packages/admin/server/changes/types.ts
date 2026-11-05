import type { StagedPrivateOp } from '../private/ops.ts'

/** The change engine's shapes (docs/superpowers/specs/2026-10-16-org-os-0.6-platform-architecture-design.md
 *  §4.3, Change). The client re-exports them through app/src/api.ts. */
export type StageOp =
  | { op: 'update'; record: string; set: Record<string, unknown> }          // record = '<registry>:<id>'
  | { op: 'create'; record: string; value: Record<string, unknown> }
  | { op: 'delete'; record: string }
  | { op: 'replace'; record: string; value: Record<string, unknown> }        // whole-entry, from the source toggle
export type Op = StageOp & { base: string | null; before: Record<string, unknown> | null } // base = sha256 of canonical YAML of the entry at stage time; null for create
/** `revises` is the proposal the change was loaded from by *Revise* (0.6 P2 spec §3.4): the tray's primary action is then
 *  Update proposal. It goes with the change, and is gone when the change is. */
/** An op on private data as the change file keeps it (L5 spec §10.2, §10.3): a placeholder for the op the private
 *  store's `staged` table holds (`ref` is `stg-<seq>`), and the class it is judged under, so a restricted value is in
 *  one place on disk. `publication`: the op widens a private record's level (§9.7, R-L5-16.8). */
export interface PrivatePlaceholder { op: 'private'; ref: string; class: string; publication?: true }
/** `private`: the placeholders of the change's ops on private data, beside its git `ops` (L5 Task 14). */
export interface Change { id: string; actor: string; created: string; updated: string; ops: Op[]; revises?: string; private?: PrivatePlaceholder[] }
/** `proposable` is carried by a summary that is not direct: whether this actor can open a proposal for the change (0.6 P2). */
export interface RuleSummary { direct: boolean; sentence: string; source: string; proposable?: boolean }
/** Where an actor's change stands (lib/machines/change.mjs), derived from it and never stored. */
export type ChangeState = 'empty' | 'staged' | 'stale' | 'applying'
/** One op on private data in the tray of the person who staged it: its placeholder's ref and class, and the op itself
 *  as they typed it (null when the private store cannot be read). */
export interface PrivateEntry { ref: string; class: string; op: StagedPrivateOp | null }
export interface ChangeView extends Omit<Change, 'private'> { classes: string[]; rule: RuleSummary; stale: number[]; current: (Record<string, unknown> | null)[]; state: ChangeState; private?: PrivateEntry[] }
export interface DecisionRow { date: string; id: string; title: string; status: string; group: string | null; where: 'governance.yaml' | 'DECISIONS.md'; anchor?: string }
export interface GovernanceView { model: string | null; description: string | null; rules: RuleSummary[]; decisions: DecisionRow[]; problems: string[] }

/** One error of a staged op, the body of the change routes' 422. `field` is '' when the op as a
 *  whole is refused. (A name this plan adds; the contract writes its shape inline.) */
export interface RecordError { record: string; field: string; message: string }
