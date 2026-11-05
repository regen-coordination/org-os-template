import type { ProposalView } from '../api.ts'
import { inWords } from '../../../lib/evaluate.mjs'
import { Meter } from '../design/Meter.tsx'
import { StatusMark, type Mark } from '../design/StatusMark.tsx'
import { ruleMeter } from '../elements/governance/timeline.ts'

type Result = ProposalView['evaluation']['parts'][number]['evaluation']
export type RuleState = 'met' | 'waiting' | 'held' | 'failed' | 'expired'

/** What a rule's result is called on screen: held when it still waits and someone objects. */
export function ruleStatus(r: Pick<Result, 'state' | 'tally'>): RuleState {
  if (r.state === 'pending') return (r.tally.objecting?.length ?? 0) > 0 ? 'held' : 'waiting'
  return r.state
}

/** A status in words: the mark's word in sentence case (L4-R12), and the house mark that shows it (§6.1) — met is
 *  done, waiting open, held by an objection the clay needs mark, failed the clay bar, expired the faint closed bar.
 *  The rule's group keeps 0.6's name ("waiting: two maintainers approve"), which the proposal page's tests read. */
const WORD: Record<RuleState, string> = { met: 'Met', waiting: 'Waiting', held: 'Held by an objection', failed: 'Failed', expired: 'Expired' }
const NAME: Record<RuleState, string> = { met: 'met', waiting: 'waiting', held: 'held by an objection', failed: 'failed', expired: 'expired' }
const MARK: Record<RuleState, Mark> = { met: 'done', waiting: 'open', held: 'needs', failed: 'failed', expired: 'closed' }

/** The tally as parts of a line, named: who is for, against, abstaining or objecting, and how many are needed. */
function tallyParts(t: Result['tally']): string[] {
  const names = (label: string, list?: string[]) => (list && list.length > 0 ? [`${label} ${list.join(', ')}`] : [])
  return [...names('for', t.for), ...names('against', t.against), ...names('abstain', t.abstain), ...names('objecting', t.objecting),
    ...(t.needed === undefined ? [] : [`${t.needed} needed`])]
}

/** One rule of a proposal (spec §3.14, §14.2 "rule sentence + meter"): its sentence, then the house mark and word
 *  (met, waiting, held by an objection, failed, expired: a shape and a word, never colour alone), the meter and its
 *  words, and what is missing; under them the tally by name and the clock. Drawn from governance.css. `partial`: a
 *  deciding role's wearer list was not read whole, and the tally says so (DAO-OS L5 spec §7.3). */
export function RuleStatus({ sentence, result, now, partial = false }: { sentence: string; result: Result; now: Date; partial?: boolean }) {
  const status = ruleStatus(result)
  const parts = [...tallyParts(result.tally), ...(partial ? ['wearer list partial'] : [])]
  const meter = ruleMeter(result.tally, null)
  const left = result.closesAt === null ? null : Date.parse(result.closesAt) - now.getTime()
  return (
    <li className={`rst rst-${status}`}>
      <div role="group" aria-label={`${NAME[status]}: ${sentence}`}>
        <p className="rst-s">{sentence}</p>
        <p className="rst-m">
          <StatusMark mark={MARK[status]} label={WORD[status]} />
          {meter && <Meter {...meter} />}
          {result.missing !== '' && <span className="rst-x">{result.missing}</span>}
        </p>
        {(parts.length > 0 || left !== null) && (
          <p className="rst-meta">
            {parts.length > 0 && <span className="rst-tally">{parts.map((p, i) => <span key={p}>{i > 0 && ' · '}<span>{p}</span></span>)}</span>}
            {left !== null && <time className="rst-clock" dateTime={result.closesAt!}>{left > 0 ? `closes in ${inWords(left)}` : 'closing now'}</time>}
          </p>
        )}
      </div>
    </li>
  )
}
