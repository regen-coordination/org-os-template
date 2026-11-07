import { PreparedTx } from '../../elements/governance/PreparedTx.tsx'
import { ProposalRow } from '../../elements/governance/ProposalRow.tsx'
import { Timeline } from '../../elements/governance/Timeline.tsx'
import { timelineOf, type Step } from '../../elements/governance/timeline.ts'
import { DataList } from '../../elements/rows/DataList.tsx'
import {
  ACTOR, ADD_SIGNER, PREPARED_IN, PREPARED_RETURN, PROPOSAL_ROWS, RECORDS_RATIFIED, RETURN_DECIDED, RULE_RESULTS,
} from '../../test/fixtures/house/governance.ts'
import { FIXED_NOW } from '../../test/fixtures/parts.ts'
import type { LedgerEvent } from '../../../../lib/proposals.mjs'
import { EventLog } from '../EventLog.tsx'
import { RuleStatus } from '../RuleStatus.tsx'
import { Card } from './spec.tsx'

const noop = () => {}
/** The card's other states, in §9.6's order, the failed execution (brief B5) after the one that matched. */
const OTHERS = ['preparing', 'unsigned', 'ready', 'executed', 'executed-failed', 'mismatch', 'replaced', 'stale', 'read-failed']

/** The pools' return, as the gallery draws its path: approved (yours among them), decided, prepared, signing now. */
const PATH = timelineOf(RETURN_DECIDED, [PREPARED_RETURN], ACTOR)
const step = (steps: Step[], id: Step['id']) => steps.find(s => s.id === id)!
/** The step states the path does not show: your approval while others' wait, a replaced nonce, no transaction. */
const OTHER_STEPS = [
  step(timelineOf(ADD_SIGNER, [], ACTOR), 'approvals'),
  step(timelineOf(RETURN_DECIDED, [PREPARED_IN.replaced!], ACTOR), 'read-back'),
  step(timelineOf(RECORDS_RATIFIED, [], ACTOR), 'prepared'),
]

/** /parts/gov (§9.5–9.8): the prepared-transaction card (B5) — partly signed in full (two calls, the total, the closed
 *  payload, the foot), then its other states as the gallery draws them, the head and its strip; then (B4) the proposal
 *  timeline with its other step states and its compact form, the proposal rows, the rule statuses and the events.
 *  The role tree and the fund flow (B6) are the gallery section's second screen, /parts/gov-roles (GovRoles.tsx): one
 *  record could not hold the whole section within 150 KiB (ruling B4-a). Fixtures, read against FIXED_NOW. */
export default function Gov() {
  return (
    <div className="pg">
      <p className="pg-lede">The prepared-transaction card says, always, that the Hub never signs: it prepares the payload, and signers review and sign it in the Safe app.</p>
      <div className="pg-grid pg-two">
        <Card cap="prepared transaction · partly signed">
          <PreparedTx tx={PREPARED_RETURN} now={FIXED_NOW} />
        </Card>
        <Card cap="prepared transaction · other states">
          {OTHERS.map(s => <PreparedTx key={s} tx={PREPARED_IN[s]!} now={FIXED_NOW} onPrepareAgain={noop} brief />)}
        </Card>
        <Card cap="proposal timeline · each step’s states">
          <Timeline steps={PATH} label={`Path of ${String(RETURN_DECIDED.id)}`} />
          <h3 className="pg-cap">other step states</h3>
          <Timeline steps={OTHER_STEPS} label="Other step states" />
          <h3 className="pg-cap">compact · in rows and on the door</h3>
          <Timeline steps={PATH} compact />
        </Card>
        <Card cap="proposal rows">
          <DataList label="Proposals">{PROPOSAL_ROWS.map(v => <ProposalRow key={String(v.id)} view={v} now={FIXED_NOW} />)}</DataList>
        </Card>
        <Card cap="rule status">
          <ul className="rst-list" aria-label="Rules">
            {RULE_RESULTS.map(r => <RuleStatus key={`${r.sentence}-${r.result.state}`} sentence={r.sentence} result={r.result} now={FIXED_NOW} />)}
          </ul>
        </Card>
        <Card cap="proposal events">
          <EventLog events={RETURN_DECIDED.events as LedgerEvent[]} rev={String(RETURN_DECIDED.rev)} now={FIXED_NOW} />
        </Card>
      </div>
    </div>
  )
}
