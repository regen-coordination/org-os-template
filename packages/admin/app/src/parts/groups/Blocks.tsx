import { useState, type ReactNode } from 'react'
import { Section } from '../../design/Section.tsx'
import { Button } from '../../design/Button.tsx'
import { Seg } from '../../design/Seg.tsx'
import { Mark } from '../../design/Mark.tsx'
import { Note, type NoteState } from '../../design/Note.tsx'
import { StatusMark } from '../../design/StatusMark.tsx'
import { Menu } from '../../design/Menu.tsx'
import { Tabs } from '../../design/Tabs.tsx'
import { DateInput, NumberInput, SelectInput, TextInput } from '../../design/inputs/index.ts'
import { Scroll } from '../../design/Scroll.tsx'
import { BlockView, blockTypes, type BlockState } from '../../blocks/index.ts'
import { Card } from '../Card.tsx'
import { RuleStatus } from '../RuleStatus.tsx'
import { EventLog } from '../EventLog.tsx'
import { GeneratedBehind, SyncConfirmation, SyncLine, SyncRefusal } from '../SyncParts.tsx'
import { marksOf } from '../marks.ts'
import { PROPOSAL_NOW, RESULTS, eventFixtures, proposalResources, proposalViews } from '../../test/fixtures/proposals.ts'
import { blockFixtures, fixtureCtx, fixtureResources } from '../../test/fixtures/parts.ts'

const NOTES: NoteState[] = ['empty', 'loading', 'error', 'notYet', 'unavailable']
const STATES: BlockState[] = ['loading', 'ready', 'empty', 'error', 'notYet', 'unavailable']
const Row = ({ children }: { children: ReactNode }) => <div className="parts-row">{children}</div>
/** The parts the house still draws from 0.6's set (spec §6): primitives, marks, the record's fields card,
 *  proposals' rule statuses and events, sync, each block type in each state and each block type's contract.
 *  Moved here from PartsPage (ruling L4-R1); the library and the wizard frame moved on to /parts/lib (C4b, E-25).
 *  C10 dropped what no caller draws any more: the card's row, tile, node and chip densities. */
export default function Blocks() {
  const [seg, setSeg] = useState<'list' | 'map'>('list')
  const [tab, setTab] = useState<'a' | 'b'>('a')
  return (
    <>
      <Section label="Primitives">
        <Row><Button>Button</Button><Button primary>Primary</Button><Button disabled>Disabled</Button>
          <Seg label="View" value={seg} onChange={setSeg} options={[{ value: 'list', label: 'List' }, { value: 'map', label: 'Map' }]} />
          <Menu label="More actions"><Button>Delete</Button></Menu>
          <Tabs label="Tabs" value={tab} onChange={setTab} tabs={[{ id: 'a', label: 'First' }, { id: 'b', label: 'Second' }]} /></Row>
        <Row><Mark level="warn">a warning</Mark><Mark level="alert">an alert</Mark></Row>
        {NOTES.map(s => <Note key={s} state={s}>{`Note · ${s}`}</Note>)}
        <Row>
          <label className="parts-in">text <TextInput common={{ id: 'p-t' }} prose={false} value="a value" readOnly={false} onChange={() => {}} /></label>
          <label className="parts-in">number <NumberInput common={{ id: 'p-n' }} value={3} onChange={() => {}} /></label>
          <label className="parts-in">date <DateInput common={{ id: 'p-d' }} value="2026-10-17" onChange={() => {}} onProblem={() => {}} /></label>
          <label className="parts-in">select <SelectInput common={{ id: 'p-s' }} options={['idea', 'active', 'done']} value="active" onChange={() => {}} /></label>
        </Row>
      </Section>
      <Section label="Marks">
        <Row>{(['needs', 'staged', 'stale', 'running', 'failed', 'aged', 'done', 'selected', 'faint'] as const).map(m => <StatusMark key={m} mark={m} />)}</Row>
      </Section>
      <Section label="Cards">
        <div className="parts-dens">
          <h3 className="pg-cap">a record's fields, its marks said above them</h3>
          <Row>{fixtureResources.slice(0, 3).map(r => <Card key={r.id} record={r} marks={marksOf(r, fixtureCtx.marks)} />)}</Row>
        </div>
      </Section>
      <Section label="Proposals">
        <h3 className="pg-cap">rules: met, waiting (approvals, a window), held by an objection, failed, expired</h3>
        <ul className="rst-list" aria-label="Rule statuses">
          <RuleStatus sentence="two maintainers approve" result={RESULTS.met} now={PROPOSAL_NOW} />
          <RuleStatus sentence="two maintainers approve" result={RESULTS.waiting} now={PROPOSAL_NOW} />
          <RuleStatus sentence="a maintainer decides unless a member objects within 3 days" result={RESULTS.window} now={PROPOSAL_NOW} />
          <RuleStatus sentence="a maintainer decides unless a member objects within 3 days" result={RESULTS.held} now={PROPOSAL_NOW} />
          <RuleStatus sentence="members vote; two thirds of the votes for or against decide" result={RESULTS.failed} now={PROPOSAL_NOW} />
          <RuleStatus sentence="two maintainers approve" result={RESULTS.expired} now={PROPOSAL_NOW} />
        </ul>
        <h3 className="pg-cap">events: every kind, an objection with its argument</h3>
        <EventLog events={eventFixtures} rev="a1b2c3d4e5f6" now={PROPOSAL_NOW} />
        <div className="parts-dens">
          <h3 className="pg-cap">cards: open and waiting on you, stale, closed</h3>
          <Row>{[0, 3, 4].map(i => proposalResources[i]!).map(r => <Card key={r.id} record={r} marks={marksOf(r, fixtureCtx.marks)} />)}</Row>
        </div>
        <p className="meta">{proposalViews.length} proposals in fixtures: approving, objecting, voting, stale, ratified, rejected, withdrawn, expired.</p>
      </Section>
      <Section label="Sync and Share">
        <h3 className="pg-cap">the foot line, Sync's confirm dialog, a refusal, and generated files behind the data</h3>
        <SyncLine sentence="2 commits not shared · 1 new from the remote" />
        <SyncConfirmation inline summary="fetch origin: it downloads, it changes no file" onConfirm={() => {}} onCancel={() => {}} />
        <SyncRefusal>Not synced: both sides changed `data/governance.yaml`; resolve it with git, then Sync again. Nothing was changed.</SyncRefusal>
        <GeneratedBehind />
      </Section>
      <Section label="Block states">
        {blockTypes().filter(d => blockFixtures[d.type]).map(def => (
          <div key={def.type} className="parts-blocks">
            <h3 className="pg-cap">{def.label}</h3>
            <div className="parts-grid">
              {STATES.map(s => <BlockView key={s} def={def} cfg={blockFixtures[def.type]!.cfg} id={`${def.type}-${s}`} data={blockFixtures[def.type]!.states[s]} ctx={fixtureCtx} />)}
            </div>
          </div>
        ))}
      </Section>
      <Section label="Block contracts">
        <Scroll label="Block contracts"><table className="rows" aria-label="Block contracts">
          <thead><tr><th scope="col">type</th><th scope="col">settings</th><th scope="col">actions</th><th scope="col">needs</th></tr></thead>
          <tbody>{blockTypes().filter(d => blockFixtures[d.type]).map(d => (
            <tr key={d.type}><td className="n">{d.type}</td><td>{d.config.map(c => `${c.key} (${c.input})`).join(', ')}</td>
              <td className="n">{Object.keys(d.actions ?? {}).join(', ')}</td><td className="n">{d.needs ?? ''}</td></tr>
          ))}</tbody>
        </table></Scroll>
      </Section>
    </>
  )
}
