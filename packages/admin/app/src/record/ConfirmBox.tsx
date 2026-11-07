import { useEffect, useRef, useState } from 'react'
import { api, ApiError, type FieldError, type JobRecord, type OperationInfo, type PlanReply, type Resource } from '../api.ts'
import { ConfirmDialog } from '../design/ConfirmDialog.tsx'
import { FieldRow, FieldTable } from '../design/FieldRow.tsx'
import { SelectInput, TextInput, type Common } from '../design/inputs/index.ts'
import { Refusal } from '../parts/SyncParts.tsx'

/** An argument as a shell would need it written: bare when safe, else in single quotes. Only for
 *  showing; nothing here is ever given to a shell. */
export const quoteArg = (arg: string): string => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`)
export const commandLine = (plan: PlanReply): string =>
  plan.inProcess ? 'inside the server (reads only)' : [plan.cmd ?? '', ...plan.args].map(quoteArg).join(' ')

/** The confirm dialog for an operation (§14.2 `record/ConfirmBox`, E-66): a modal `ConfirmDialog` named for what
 *  runs. Its body: what the operation does (reads or changes, and the network), the parameters to fill in as field
 *  rows of the house's inputs, then the exact command in a Mono well, what it may write and its time limit. Its one
 *  primary is the next step — Show the command, then Run. The server checks the nonce; this dialog is how the
 *  operator sees what that nonce stands for. A refusal is an error note in the dialog, said once. */
export default function ConfirmBox({ op, resource, onDone, onCancel }:
  { op: OperationInfo; resource: Resource; onDone: (job: JobRecord) => void; onCancel: () => void }) {
  const fields = op.preset ? [] : Object.entries(op.params.properties ?? {})
  const [params, setParams] = useState<Record<string, unknown>>(op.preset ?? {})
  const [plan, setPlan] = useState<PlanReply | null>(null)
  const [errors, setErrors] = useState<FieldError[]>([])
  const [error, setError] = useState<string | null>(null)
  // One request at a time: while a plan or a run is out the primary reads busy and swallows a press (M-6); the ref
  // also holds off a second press in the same tick, before the state has drawn.
  const busy = useRef(false)
  const [pending, setPending] = useState<'plan' | 'run' | null>(null)

  const fail = (err: unknown) => {
    if (err instanceof ApiError && err.errors.length) setErrors(err.errors)
    else setError(err instanceof Error ? err.message : String(err))
  }
  const show = async () => {
    if (busy.current) return
    busy.current = true; setPending('plan'); setErrors([]); setError(null)
    try { setPlan(await api.plan(op.id, resource.id, params)) } catch (err) { fail(err) } finally { busy.current = false; setPending(null) }
  }
  const run = async () => {
    if (!plan || busy.current) return
    busy.current = true; setPending('run'); setError(null)
    try { onDone(await api.runJob(plan.nonce ? { nonce: plan.nonce } : { op: op.id, resource: resource.id, params })) }
    catch (err) { fail(err); setPlan(null) } finally { busy.current = false; setPending(null) }
  }
  useEffect(() => { if (fields.length === 0) void show() }, []) // nothing to fill in: show the command at once
  // The select and the textarea keep '' when emptied; the one-line text field drops its key, as 0.6's did.
  const put = (key: string, value: unknown) => setParams(s => ({ ...s, [key]: value ?? '' }))
  const putText = (key: string, value: unknown) => setParams(s => { const next = { ...s }; if (value === null || value === '') delete next[key]; else next[key] = value; return next })
  const required = new Set(op.params.required ?? [])
  const errorOf = (key: string) => errors.filter(x => x.field === key).map(x => x.message).join(' ') || undefined

  const body = (
    <>
      <p className="ops-k">{op.effect}{op.network ? ' · network' : ''}</p>
      {!plan && fields.length > 0 && (
        <FieldTable label="Parameters">
          {fields.map(([key, p]) => {
            const id = `p-${key}`
            const err = errorOf(key)
            const common: Common = { id, 'aria-invalid': err !== undefined || undefined, 'aria-describedby': err !== undefined ? `${id}-err` : undefined,
              'aria-required': required.has(key) || undefined }
            return (
              <FieldRow key={key} label={key} htmlFor={id} error={err}>
                {p.enum
                  ? <SelectInput common={common} options={p.enum} value={params[key] ?? ''} onChange={v => put(key, v)} />
                  : <TextInput common={common} prose={(p.maxLength ?? 0) > 200} value={params[key] ?? ''} readOnly={false}
                      onChange={v => ((p.maxLength ?? 0) > 200 ? put(key, v) : putText(key, v))} />}
                {required.has(key) && <span className="ops-k">required</span>}
              </FieldRow>
            )
          })}
        </FieldTable>
      )}
      {errors.filter(x => !fields.some(([k]) => k === x.field)).map((x, i) => <Refusal key={i}>{x.message}</Refusal>)}
      {error && <Refusal>{error}</Refusal>}
      {plan && <>
        <code className="mono-well">{commandLine(plan)}</code>
        <p className="ops-k">{plan.writes.length ? `may write ${plan.writes.join(', ')}` : 'writes nothing'} · timeout {Math.round(plan.timeoutMs / 1000)} s</p>
      </>}
    </>
  )
  // A refused run clears the plan; with nothing to fill in, planning again is the only way back to Run.
  const next = plan ? 'Run' : fields.length > 0 ? 'Show the command' : 'Show the command again'
  return <ConfirmDialog title={op.label} body={body} confirm={next} busy={pending === 'plan' ? 'Showing the command…' : pending === 'run' ? 'Running…' : undefined}
    onConfirm={() => void (plan ? run() : show())} onCancel={onCancel} />
}
