import { Button } from '../../design/Button.tsx'
import { FieldRow, FieldTable } from '../../design/FieldRow.tsx'
import { RecordHeader } from '../../elements/records/RecordHeader.tsx'
import { AddressChip } from '../../elements/atoms/AddressChip.tsx'
import { Amount } from '../../elements/atoms/Amount.tsx'
import { ReadAge } from '../../elements/atoms/ReadAge.tsx'
import { DataList } from '../../elements/rows/DataList.tsx'
import { DataRow } from '../../elements/rows/DataRow.tsx'
import { SystemRow } from '../../elements/rows/SystemRow.tsx'
import { systemFacts } from '../../elements/rows/systemState.ts'
import { InspectorView } from '../../inspector/Inspector.tsx'
import { PEOPLE } from '../../test/fixtures/house/people.ts'
import { INSPECTOR_NEIGHBOURS, INSPECTOR_OPS, INSPECTOR_RECORD } from '../../test/fixtures/house/map.ts'
import { GARDEN, LOCAL_STARTER, NETWORK_PROJECTS, SYSTEMS, TREASURY_OWNERS, TREASURY_SYSTEM, minutesBefore } from '../../test/fixtures/house/systems.ts'
import { FIXED_NOW } from '../../test/fixtures/parts.ts'
import { Card } from './spec.tsx'

const noop = () => {}
const DAY = 86_400_000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** A day this many days from the fixtures' clock (before it when negative), as the header's meta says it: "3 Nov". */
function day(days: number, year = false) {
  const d = new Date(FIXED_NOW.getTime() + days * DAY)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${year ? ` ${d.getUTCFullYear()}` : ''}`
}

/** A fixture person, as presence takes them. */
function present(handle: string) {
  const p = PEOPLE.find(x => x.handle === handle)!
  return { handle: p.handle, role: p.name }
}

/** The Treasury as its record header takes it: systemFacts reads it from its Resource. */
function TreasuryHeader() {
  const f = systemFacts(TREASURY_SYSTEM)
  const address = f.address && 'chip' in f.address ? f.address.chip : undefined
  return <RecordHeader variant="system" kind={f.kind} name={TREASURY_SYSTEM.name} chain={f.chains} address={address} governs={f.governs ?? undefined}
    read={f.read} now={FIXED_NOW} onReadNow={noop} open={f.open ?? undefined} />
}

/** A state's name at a specimen row's end, as the gallery captions them. */
const cap = (name: string) => <span className="pg-cap">{name}</span>

/** /parts/rows: the data row in every state (§9.2) and its first load; the record header — the Treasury Safe as a
 *  System, and an open proposal waiting on this member's approval (its ledger id, G-7) — and the Treasury's field
 *  rows, read, staged, stale, restricted and with a failed read; then the Systems list, one row per house System in
 *  each of its states; then the inspector (B9, §5.10) beside a list, and as the phone's bottom sheet. Values are
 *  fixtures, read against FIXED_NOW. */
export default function Rows() {
  return (
    <div className="pg">
      <p className="pg-lede">The data row is the Hub’s workhorse: hairline-divided inside a raised surface, a kind tile, two lines, trailing facts. A row the viewer may not see is not drawn — no placeholder, no gap, no count.</p>
      <div className="pg-grid pg-two">
        <Card cap="Data row · every state">
          <DataList label="Data row states">
            <DataRow kind="page" title="Onboarding for new local nodes" second="Page · Knowledge · edited 2 d ago" trailing={cap('default')} marks={[]} />
            <DataRow kind="meeting" title={`Council call, ${day(-1)}`} second="Meeting · notes attached" trailing={cap('hover')} marks={[]} className="pg-hover" />
            <DataRow kind="project" title="Local node kit, v2" second="Project · active" trailing={cap('focus')} marks={[]} className="pg-focus" />
            <DataRow kind="safe" title="Treasury" second="Safe · 4 of 8 · 7 chains" trailing={cap('selected')} marks={[]} selected />
            <DataRow kind="safe" title="Treasury" second="4 of 8 · the threshold, staged" was="4 of 9" marks={['staged']} />
            <DataRow kind="hat" title="Treasury signer" second="Hat 13.1.1 · changed on the trunk since you staged" marks={['stale']} />
            <DataRow kind="hat" title="Regional coordinator" second="Hat 13.2.3 · no wearer" marks={['needs']} />
            <DataRow kind="snapshot-space" title="exampledao.eth" second="Snapshot space" marks={['running']} />
            <DataRow kind="proposal" title="Fund the node kit" second={<><span className="mono">p-2026-08-12-001</span> · Withdrawn · {day(-66)}</>} marks={['closed']} />
          </DataList>
          <DataList label="Data rows" loading={2}>{null}</DataList>
        </Card>

        <Card cap="Record header · a System, a proposal">
          <div className="pg-heads">
            <TreasuryHeader />
            <RecordHeader variant="record" kind="proposal" id="p-2026-10-17-001" title="Return the Gardens pools to the treasury"
              state="needs" stateWord="Needs your approval" route="T3 · Council consent" visibility={{ level: 'members' }}
              meta={[`Opened ${day(-19, true)} under the steward hat`, `closes ${day(17)}`]}
              presence={[present('ops-lead'), present('treasury-steward')]}
              primary={<Button primary>Approve</Button>}
              secondary={[<Button key="object">Object</Button>, <Button key="comment" variant="ghost" icon="comment">Comment</Button>]}
              more={[{ type: 'item', label: 'Copy link', icon: 'link', onSelect: noop }, { type: 'item', label: 'Open in Safe', icon: 'external', onSelect: noop }]} />
          </div>
        </Card>

        <Card cap="Field rows · read, staged, stale, restricted, error">
          <FieldTable label="Treasury">
            <FieldRow label="Kind">Safe</FieldRow>
            <FieldRow label="Threshold" staged was="4 of 9"><span className="mono">4 of 8</span></FieldRow>
            <FieldRow label="Owners">
              <span className="pg-demo">{TREASURY_OWNERS.map(a => <AddressChip key={a} value={a} chain="eip155:42220" />)}<span className="faint">+6</span></span>
            </FieldRow>
            <FieldRow label="Section" stale="“treasury”"><span className="mono">organization/treasury</span></FieldRow>
            <FieldRow label="Steward e-mail" restricted={{ hat: 'Ops' }}>{null}</FieldRow>
            <FieldRow label="Balance">
              <span className="pg-demo"><Amount value="3100" unit="USDGLO" decimals={2} aged /><ReadAge state="aged" readAt={minutesBefore(38)} now={FIXED_NOW} /></span>
            </FieldRow>
            <FieldRow label="Pools" error="Couldn’t read the Garden">{null}</FieldRow>
          </FieldTable>
        </Card>
      </div>

      <Card cap="Systems · a list, every state">
        <DataList label="Systems">
          {SYSTEMS.map(r => <SystemRow key={r.id} resource={r} now={FIXED_NOW} proposed={r.id === NETWORK_PROJECTS.id ? 'Return proposed' : undefined} />)}
        </DataList>
      </Card>

      <Card cap="Inspector · beside a list, at 1200 of frame width and over">
        <div className="pg-insp">
          <DataList label="Treasury and pools">
            {[TREASURY_SYSTEM, GARDEN, NETWORK_PROJECTS, LOCAL_STARTER].map(r => (
              <SystemRow key={r.id} resource={r} now={FIXED_NOW} selected={r.id === INSPECTOR_RECORD.id} />
            ))}
          </DataList>
          <InspectorView resource={INSPECTOR_RECORD} neighbours={INSPECTOR_NEIGHBOURS} ops={INSPECTOR_OPS} onClose={noop} form="aside" now={FIXED_NOW} />
        </div>
      </Card>

      <Card cap="Inspector · a bottom sheet on the phone, over the scrim">
        <div className="pg-phone-sheet">
          <InspectorView resource={INSPECTOR_RECORD} neighbours={INSPECTOR_NEIGHBOURS} ops={INSPECTOR_OPS} onClose={noop} form="bottom" inline now={FIXED_NOW} />
        </div>
      </Card>
    </div>
  )
}
