import { ApiError, type ChangeView, type Op, type StageError } from '../api.ts'
import { entryName, same } from '../record/fields.ts'

export interface TrayRow {
  n: number          // the op's index, as the routes address it (0-based)
  record: string     // `<registry>:<id>`
  op: Op['op']
  field: string
  was: unknown
  now: unknown
  stale: boolean
  current: unknown   // the field's value in the file now, for a stale op
  first: boolean     // the op's first row: where Take theirs / Keep mine sit
  alone: boolean     // the op's only row
}

/** One op's changed fields, as its lines draw them: `field  was → now`, and for a stale op the field's value
 *  on the trunk now. A create is one line naming the new record; a delete one line naming what goes. */
export function opFields(op: Op, cur: Record<string, unknown> | null = null): { field: string; was: unknown; now: unknown; current: unknown }[] {
  let fields: { field: string; was: unknown; now: unknown; current: unknown }[]
  // A governed file edited whole (L6 §11.2): one line naming the file; Compare shows the text.
  if (op.op === 'file') return [{ field: op.text === null ? '(file deleted)' : '(whole file)', was: undefined, now: op.text === null ? undefined : op.path, current: undefined }]
  if (op.op === 'update') {
    fields = Object.entries(op.set).map(([f, v]) => ({ field: f, was: op.before?.[f], now: v, current: cur?.[f] }))
  } else if (op.op === 'replace') {
    const keys = [...new Set([...Object.keys(op.before ?? {}), ...Object.keys(op.value)])].filter(k => !same(op.before?.[k], op.value[k]))
    fields = keys.map(k => ({ field: k, was: op.before?.[k], now: op.value[k], current: cur?.[k] }))
  } else if (op.op === 'create') {
    fields = [{ field: '(new record)', was: undefined, now: entryName(op.value) ?? op.value.id, current: undefined }]
  } else {
    fields = [{ field: '(deleted)', was: entryName(op.before) ?? op.record, now: undefined, current: undefined }]
  }
  return fields.length === 0 ? [{ field: '(no change)', was: undefined, now: undefined, current: undefined }] : fields
}

/** One row per changed field, across every op (spec §6.5, Open): the combined diff, and where a refusal's
 *  record and field land. */
export function trayRows(view: ChangeView): TrayRow[] {
  return view.ops.flatMap((op, n) => {
    const stale = view.stale.includes(n)
    const fields = opFields(op, view.current[n] ?? null)
    return fields.map((f, i) => ({ n, record: opRecord(op), op: op.op, stale, ...f, first: i === 0, alone: fields.length === 1 }))
  })
}

/** What an op is about as the tray keys it: its record (`<registry>:<id>`), or a file op's path (L6 §11.2). */
export const opRecord = (op: Op): string => (op.op === 'file' ? op.path : op.record)

/** The record an op is about, by the name its entry carries, else its key (`<registry>:<id>`); a file op by its path. */
export function recordName(op: Op): string {
  if (op.op === 'file') return op.path
  const entry = op.op === 'create' || op.op === 'replace' ? op.value : op.before
  return entryName(op.before) ?? entryName(entry) ?? op.record
}

/** The kind an op's record draws its tile with: the entry's own `kind` (a System's safe, a hat), else its registry. */
export function opKind(op: Op): string {
  if (op.op === 'file') return 'file'
  const entry = op.before ?? (op.op === 'create' || op.op === 'replace' ? op.value : null)
  return typeof entry?.kind === 'string' ? entry.kind : op.record.slice(0, Math.max(0, op.record.indexOf(':')))
}

/** A private entry of a change (L5 R-L5-14.2): its op as typed, read back from the store for the one who staged it; null when
 *  the store could not be read. */
export type PrivateEntryView = NonNullable<ChangeView['private']>[number]

/** The staged entries a change holds: its git ops and its private part (L6 Task 21, PF-R111: a move into the repository is a
 *  change with a private part only, and it is still a change). */
export const heldCount = (view: Pick<ChangeView, 'ops' | 'private'>): number => view.ops.length + (view.private?.length ?? 0)

/** A private entry as the tray says it, in the place of a git op's record and fields: what it touches and what it does. The
 *  stager typed it, so it is shown to them; a value is never drawn, only the fields' names. */
export function privateSummary(op: PrivateEntryView['op']): { record: string; what: string } {
  if (op === null) return { record: 'A private change', what: 'the private store could not be read' }
  switch (op.op) {
    case 'move-to-git': return { record: `${op.collection}:${op.id}`, what: `moved into the repository, at ${op.level}` }
    case 'create-record': return { record: `${op.collection}:${op.id}`, what: 'new record, kept in the private store' }
    case 'update-record': return { record: `${op.collection}:${op.id}`, what: Object.keys(op.set).join(', ') || 'updated' }
    case 'replace-record': return { record: `${op.collection}:${op.id}`, what: 'replaced' }
    case 'delete-record': return { record: `${op.collection}:${op.id}`, what: 'deleted' }
    case 'put-field': return { record: `${op.field.registry}:${op.field.record}`, what: `${op.field.field}, kept at ${op.field.visibility}` }
    case 'delete-field': return { record: `${op.registry}:${op.record}`, what: `${op.field} removed` }
    case 'clear-fields': return { record: `${op.registry}:${op.record}`, what: 'its restricted fields cleared' }
  }
}

/** A private entry in a line (§5.6 collapsed), as `opSummary` says a git op. */
export function privateLine(op: PrivateEntryView['op']): string {
  if (op === null) return 'A private change (the private store could not be read)'
  const s = privateSummary(op)
  return `${s.record} · ${s.what}`
}

/** The fields an op touches, as words: what its × names ("Remove op: threshold on Treasury"). */
export function opFieldWords(op: Op): string {
  return opFields(op).map(f => f.field.replace(/^\((.*)\)$/, '$1')).join(', ')
}

/** The last op in a line (§5.6 collapsed): its record, then the one field and its new value, or the fields. */
export function opSummary(op: Op): string {
  const fields = opFields(op)
  const one = fields.length === 1 ? fields[0]! : null
  const what = op.op === 'file' ? (op.text === null ? 'deleted' : 'edited whole') : op.op === 'create' ? 'new record' : op.op === 'delete' ? 'deleted'
    : one ? `${one.field}: ${fmt(one.now)}` : fields.map(f => f.field).join(', ')
  return `${recordName(op)} · ${what}`
}

/** What a stale op's fields hold on the trunk now: the value alone for one field, else `field: value` each. */
export function trunkNow(op: Op, cur: Record<string, unknown> | null): string {
  const fields = opFields(op, cur)
  return fields.length === 1 ? fmt(fields[0]!.current) : fields.map(f => `${f.field}: ${fmt(f.current)}`).join(' · ')
}

/** The rule that decides a change, as the tray says it: the server's sentence as written; a direct one after
 *  "Saves directly", as the approved gallery says it ("Saves directly · the maintainer decides alone"). */
export function ruleWords(rule: ChangeView['rule']): string {
  return rule.direct ? `Saves directly · ${rule.sentence}` : rule.sentence
}

/** "1 staged op", "3 staged ops": the tray's count, and what the live region says when it moves. The same word as the
 *  expanded head ("2 ops · 1 record") and the stale line count it by (walk M1, PF-R260). */
export function stagedWords(n: number): string {
  return `${n} staged op${n === 1 ? '' : 's'}`
}

/** "1 op changed on the trunk — choose what stands": the stale tray's line (§5.6). */
export function staleWords(n: number): string {
  return `${n} op${n === 1 ? '' : 's'} changed on the trunk — choose what stands`
}

/** The Propose panel's line when some ops are stale (the walk's G6): they are not proposed, and stay. */
export function staleStays(n: number): string {
  return `${n === 1 ? 'One op changed' : `${n} ops changed`} on the trunk, so ${n === 1 ? 'it is' : 'they are'} not proposed: ${n === 1 ? 'it stays' : 'they stay'} in your tray. The rest is proposed.`
}

/** A value in the diff: '—' for nothing, lists in brackets, objects as JSON. */
export function fmt(v: unknown): string {
  if (v === undefined) return '—'
  if (v === null) return 'null'
  if (typeof v === 'string') return v
  if (Array.isArray(v) && v.every(x => typeof x !== 'object' || x === null)) return `[${v.map(String).join(', ')}]`
  return JSON.stringify(v)
}

/** What the tray was doing when the server refused: each has its own verb (ruling C5). The × is
 *  `unstage`, whether it unstages the op or stages a field back. */
export type TrayAction = 'apply' | 'unstage' | 'rebase' | 'discard'
const VERB: Record<TrayAction, string> = { apply: 'Not applied', unstage: 'Not removed', rebase: 'Not resolved', discard: 'Not discarded' }

/** `message` is the first line, `lines` any more; both are shown in --attn. */
export interface ApplyOutcome { message: string; lines: string[]; refresh: boolean; rowErrors: StageError[] }

/** What a refusal means for the tray, branching on its `code` (contract, "Refusals and driver
 *  context"): the sentence to show in --attn, whether to re-read the change, and the errors that
 *  belong on rows. Server sentences are shown as written. With `rows`, a 422 error no row shows
 *  (a field of a create, a field the op did not touch) becomes a line naming its record and field;
 *  an error about a whole op (field '') is always a line. */
export function applyOutcome(err: unknown, action: TrayAction = 'apply', rows?: TrayRow[]): ApplyOutcome {
  const out = (message: string, refresh = false, lines: string[] = [], rowErrors: StageError[] = []): ApplyOutcome => ({ message, lines, refresh, rowErrors })
  if (!(err instanceof ApiError)) return out(err instanceof Error ? err.message : String(err))
  if (err.status === 403) return out(typeof err.body.reason === 'string' ? err.body.reason : err.message)
  if (err.code === 'STALE') return out(err.message, true) // ruling C19: the server's sentence, then re-read so the stale rows show
  if (err.code === 'DIRTY') {
    const paths = Array.isArray(err.body.paths) ? err.body.paths.map(String) : []
    return out(err.message, false, paths.length > 0 ? [`Files: ${paths.join(', ')}`] : [])
  }
  if (err.code === 'EMPTY') return out(err.message, true)
  // Another tab took the op, or what is left no longer stands: the change as the server holds it.
  const reread = action === 'unstage' || action === 'rebase'
  if (err.status === 404) return out(err.message, reread)
  if (err.status === 422 && err.errors.length > 0) {
    const verb = VERB[action]
    const onRow = (e: StageError) => e.field !== '' && (!rows || rows.some(r => r.record === e.record && r.field === e.field))
    const rowErrors = err.errors.filter(onRow)
    const lines = err.errors.filter(e => !onRow(e))
      .map(e => (e.field === '' ? e.message : `${verb}: ${e.record ?? ''} · ${e.field}: ${e.message}`))
    if (rowErrors.length === 0) return out(lines[0]!, reread, lines.slice(1))
    const n = rowErrors.length
    return out(`${verb}: ${n} field${n === 1 ? ' is' : 's are'} refused; the marked row${n === 1 ? ' says' : 's say'} why.`, reread, lines, rowErrors)
  }
  return out(err.message)
}
