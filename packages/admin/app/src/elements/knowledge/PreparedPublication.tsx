import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type PublishPlan } from '../../api.ts'
import { Note } from '../../design/Note.tsx'
import { Icon } from '../../design/Icon.tsx'
import { KindTile } from '../../design/KindTile.tsx'
import { announce } from '../../parts/live.tsx'
import { useActor } from '../../actor.ts'

/** N3 · The prepared publication (spec §4.3, §5-N3): the prepared-transaction card's shape given publishing's job — a
 *  plan, a payload, and a key the app does not hold. The app plans; `org-os-kms publish --apply` writes; the report
 *  comes back as the receipt in Runs. `detail` false (the commons page, read by members; walk W7, D3): no command, no
 *  folder or file, no raw report — those are the setup page's; the counts, what a run writes in words, and Run it stay. */
export function PreparedPublication({ plan, onRun, detail = true }: { plan: PublishPlan; onRun?: () => void; detail?: boolean }) {
  const [copied, setCopied] = useState(false)
  const sum = plan.counts
  const copy = async () => {
    try { await navigator.clipboard.writeText(plan.command) } catch { /* a clipboard the browser refuses is not a failure of the plan */ }
    setCopied(true)
    announce(`Copied: ${plan.command}`)
    setTimeout(() => setCopied(false), 1600)
  }
  return (
    <div className="publ">
      <div className="publ-head">
        <div className="publ-title">
          <KindTile kind="commons" icon="layers" size="header" />
          <span>
            <span className="kn-row">
              <b>Publication</b>
              <span className="meta">{plan.classes.includes('publication') ? 'publication rule' : 'no rule of its own'}</span>
            </span>
            {detail ? <span className="mono faint">{plan.plane}/ · {plan.ok ? 'planned' : 'refused'}</span> : <span className="faint">{plan.ok ? 'planned' : 'refused'}</span>}
          </span>
        </div>

        <div className="publ-calls">
          {plan.calls.map(c => (
            <div key={c.n} className="publ-call">
              <span className="mono faint">{c.n}</span>
              <span>{c.what}</span>
              {detail && <span className="to">{c.where}</span>}
            </div>
          ))}
        </div>

        <div className="publ-sum">
          +{sum.joins} join the commons · {sum.unchanged} unchanged · {sum.leaves} leave · {sum.withheld} withheld by the rule
          {(sum.awaiting ?? 0) > 0 && (
            <> · <b>{sum.awaiting} of them {sum.awaiting === 1 ? 'awaits' : 'await'} review: the run publishes {sum.awaiting === 1 ? 'it' : 'them'} as {sum.awaiting === 1 ? 'it stands' : 'they stand'}.</b></>
          )}
        </div>

        {detail && <details>
          <summary className="meta">What the run reports back</summary>
          <pre className="mono-well publ-report">{JSON.stringify(plan.report, null, 1)}</pre>
        </details>}
      </div>

      <div className="publ-foot">
        <span className="say">
          <Icon name="key" size="sm" />
          {detail
            ? <span><b>The app never publishes.</b> This plan runs <span className="mono">{plan.command}</span>; the report comes back as the receipt.</span>
            : <span><b>The app never publishes.</b> A run writes the public pages; its report comes back as the receipt in Runs.</span>}
        </span>
        {detail && <button className="btn" type="button" onClick={copy}>{copied ? 'Copied' : 'Copy the command'}</button>}
        {onRun && <button className="btn primary" type="button" onClick={onRun} disabled={!plan.ok}>{plan.ok ? 'Run it' : 'Refused'}</button>}
      </div>
      {plan.refused && <div className="publ-refusal"><Note state="error">{plan.refused}</Note></div>}
    </div>
  )
}

/** The commons page's publishing block: the plan, read when the page opens; the card draws it. */
export function Publishing({ onRun, detail = true }: { onRun?: (plan: PublishPlan) => void; detail?: boolean }) {
  const plan = useQuery({ queryKey: ['knowledge', 'plan'], queryFn: api.knowledgePlan })
  const { known } = useActor()
  return (
    <>
      {plan.isPending && <Note state="loading">Reading the commons…</Note>}
      {plan.error && <Note state="error">Couldn’t prepare a publication: {(plan.error as Error).message}</Note>}
      {plan.data && <PreparedPublication plan={plan.data} detail={detail} onRun={known && onRun ? () => onRun(plan.data!) : undefined} />}
      {!known && plan.data && <Note state="notYet">A reader cannot run a publication. Sign in with a member’s wallet.</Note>}
    </>
  )
}
