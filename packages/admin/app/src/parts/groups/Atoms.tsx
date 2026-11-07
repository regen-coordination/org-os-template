import type { ReactNode } from 'react'
import { StatusMark } from '../../design/StatusMark.tsx'
import { Meter } from '../../design/Meter.tsx'
import { KindTile } from '../../design/KindTile.tsx'
import { Skeleton } from '../../design/Skeleton.tsx'
import { Spinner } from '../../design/Spinner.tsx'
import { AddressChip } from '../../elements/atoms/AddressChip.tsx'
import { ChainChip, ChainList } from '../../elements/atoms/ChainChip.tsx'
import { Amount } from '../../elements/atoms/Amount.tsx'
import { ReadAge } from '../../elements/atoms/ReadAge.tsx'
import { Mention } from '../../elements/atoms/Mention.tsx'
import { Presence } from '../../elements/atoms/Presence.tsx'
import { Identity } from '../../frame/Identity.tsx'
import { RestrictedValue, VisibilityControl, VisibilityMarker } from '../../viewAs/VisibilityMarker.tsx'
import { SAFE, SAFE_CHAINS, fakeAddress } from '../../test/fixtures/house/org.ts'
import { PEOPLE } from '../../test/fixtures/house/people.ts'
import { FIXED_NOW } from '../../test/fixtures/parts.ts'
import { Card, State } from './spec.tsx'

/** Example DAO's two public Gardens pools (spec §17) and the zero address, for the chip's states. */
const POOL_NETWORK = '0x5d0b8119883e462d5f830c50ff2b79d492278a5c'
const POOL_STARTER = '0xeb52c78bc7dc351a6e95e105841023bf8c97f20c'
const ZERO = `0x${'0'.repeat(40)}`
const CELO = 'eip155:42220'
/** A time this many minutes before the fixtures' clock. */
const before = (minutes: number) => new Date(FIXED_NOW.getTime() - minutes * 60_000).toISOString()

/** A fixture person, as presence takes them: handle, the role they are shown by, and whether they are editing. */
function present(handle: string, editing = false) {
  const p = PEOPLE.find(x => x.handle === handle)!
  return { handle: p.handle, role: p.name, editing }
}

/** A row of the status card: two marks, one at each end, as the gallery pairs them. */
function Pair({ children }: { children: ReactNode }) {
  return <div className="pg-state">{children}</div>
}

/** /parts/atoms: what carries a fact, in the gallery's order — the address chip, the chain chip and the amount,
 *  the status marks, the read age, the visibility marker (on the fixture source's hats), the mention and presence,
 *  then the meter; after them the kind tiles and the loading skeletons the other sections are built with.
 *  Presence's "signed-in as" state is the frame's identity, its face alone (A10). People are the §17 roles; balances and
 *  read times are fixture values, read against FIXED_NOW. */
export default function Atoms() {
  return (
    <div className="pg">
      <p className="pg-lede">What carries a fact. Addresses, amounts, hashes, nonces and ids are Geist Mono, tabular, with a slashed zero. Every status is a shape and a word; colour only repeats it.</p>
      <div className="pg-grid">
        <Card cap="Address chip · copy on click, CAIP-10 underneath">
          <div className="pg-states">
            <State name="default"><AddressChip value={SAFE} chain={CELO} /></State>
            <State name="hover"><span className="pg-hover"><AddressChip value={POOL_NETWORK} chain={CELO} /></span></State>
            <State name="copied"><AddressChip value={POOL_STARTER} chain={CELO} copied /></State>
            <State name="named"><AddressChip value={SAFE} chain="eip155:1" name="exampledao.eth" /></State>
            <State name="full"><AddressChip value={SAFE} chain={CELO} full /></State>
            <State name="warn"><AddressChip value={ZERO} chain={CELO} warn="Not a contract on Celo" /></State>
          </div>
        </Card>

        <Card cap="Chain chip · neutral, never a logo">
          <div className="pg-states">
            <State name="one"><ChainChip chains={[CELO]} /></State>
            <State name="several"><ChainChip chains={[...SAFE_CHAINS]} /></State>
            <State name="test network"><ChainChip chains={['eip155:11155111']} /></State>
            <State name="disagree"><ChainChip chains={[...SAFE_CHAINS]} agree={6} /></State>
            <State name="list"><ChainList chains={SAFE_CHAINS} /></State>
          </div>
        </Card>

        <Card cap="Amount">
          <div className="pg-states">
            <State name="row"><Amount value="1271" unit="USDGLO" decimals={2} /></State>
            <State name="body"><Amount value="27561390.98" unit="G$" decimals={2} size="body" /></State>
            <State name="outgoing"><Amount value="-1829" unit="USDGLO" decimals={2} /></State>
            <State name="from an old read"><Amount value="3100" unit="USDGLO" decimals={2} aged /></State>
            <State name="not read"><Amount value={null} unit="USDGLO" decimals={2} /></State>
            <State name="large"><Amount value="3100" unit="USDGLO" decimals={0} size="large" /></State>
          </div>
        </Card>

        <Card cap="Status · shape + word">
          <div className="pg-states">
            <Pair><StatusMark mark="needs" /><StatusMark mark="staged" /></Pair>
            <Pair><StatusMark mark="stale" /><StatusMark mark="draft" /></Pair>
            <Pair><StatusMark mark="open" /><StatusMark mark="ok" /></Pair>
            <Pair><StatusMark mark="done" /><StatusMark mark="closed" label="Withdrawn" /></Pair>
            <Pair><StatusMark mark="running" label="Reading…" /><StatusMark mark="failed" /></Pair>
            <Pair><StatusMark mark="aged" /><StatusMark mark="done" label="Executed" /></Pair>
            <Pair><StatusMark mark="selected" /><StatusMark mark="faint" /></Pair>
          </div>
        </Card>

        <Card cap="Read age · fresh, aged, failed">
          <div className="pg-states">
            <State name="unknown"><ReadAge state="unknown" readAt={null} now={FIXED_NOW} /></State>
            <State name="reading"><ReadAge state="reading" readAt={before(4)} now={FIXED_NOW} /></State>
            <State name="fresh"><ReadAge state="fresh" readAt={before(4)} now={FIXED_NOW} /></State>
            <State name="aged"><ReadAge state="aged" readAt={before(38)} now={FIXED_NOW} /></State>
            <State name="failed"><ReadAge state="failed" readAt={before(1)} lastGood={before(120)} now={FIXED_NOW} /></State>
          </div>
        </Card>

        <Card cap="Visibility marker">
          <div className="pg-states">
            <State name="public"><VisibilityMarker value={{ level: 'public' }} /></State>
            <State name="members"><VisibilityMarker value={{ level: 'members' }} /></State>
            <State name="a hat"><VisibilityMarker value={{ level: 'hat', hat: 'ops', name: 'Ops' }} /></State>
            <State name="as control"><VisibilityControl value={{ level: 'members' }} onChoose={() => {}} /></State>
            <State name="widening staged"><VisibilityMarker value={{ level: 'members' }} proposed={{ level: 'public' }} /></State>
            <State name="field"><RestrictedValue hat="Ops" /></State>
          </div>
        </Card>

        <Card cap="Mention">
          <div className="pg-states">
            <State name="person"><Mention kind="person" text="Ops lead" href="/r/member/ops-lead" /></State>
            <State name="you"><Mention kind="you" text="Council steward" href="/r/member/council-steward" /></State>
            <State name="record"><Mention kind="record" recordKind="proposal" text="DR-2026-010" href="/governance/proposals/DR-2026-010" /></State>
            <State name="page"><Mention kind="page" text="How the treasury is run" href="/r/page/how-the-treasury-is-run" /></State>
            <State name="can’t be seen"><Mention restricted="members-only" /></State>
          </div>
        </Card>

        <Card cap="Presence · who else has it open">
          <div className="pg-states">
            <State name="one"><Presence people={[present('ops-lead')]} /></State>
            <State name="editing"><Presence people={[present('steward-a', true)]} /></State>
            <State name="several"><Presence people={['steward-a', 'ops-lead', 'treasury-steward', 'steward-b', 'council-steward'].map(h => present(h))} /></State>
            <State name="signed-in as"><Identity who={{ hatName: 'Council steward', address: fakeAddress(7), hatId: null, hats: [] }} menu={false} /></State>
          </div>
        </Card>

        <Card cap="Meter · approvals and signatures">
          <div className="pg-states">
            <State name="waiting"><Meter done={2} of={4} words="2 of 4 approved" /></State>
            <State name="yours in it"><Meter done={3} of={4} yours={1} words="3 of 4 · you approved" /></State>
            <State name="met"><Meter done={4} of={4} words="4 of 4 signed" /></State>
            <State name="over 12"><Meter done={31} of={50} words="31 of 50 voted" /></State>
          </div>
        </Card>

        <Card cap="Kind tile · row, Needs you, header">
          <div className="pg-states">
            <State name="row"><span className="pg-demo">{['safe', 'hats-tree', 'snapshot-space', 'gardens-community', 'gardens-pool', 'wallet'].map(k => <KindTile key={k} kind={k} />)}</span></State>
            <State name="needs you"><span className="pg-demo"><KindTile kind="proposal" size="needs" tone="attn" /><KindTile kind="hat" size="needs" tone="attn" /><KindTile kind="safe" size="needs" /></span></State>
            <State name="header"><span className="pg-demo"><KindTile kind="safe" size="header" /><KindTile kind="proposal" size="header" /></span></State>
            <State name="attention"><span className="pg-demo"><KindTile kind="hat" tone="attn" /><KindTile kind="gardens-community" tone="attn" /></span></State>
            <State name="done, added"><span className="pg-demo"><KindTile kind="task" tone="moss" /><KindTile kind="page" tone="moss" /></span></State>
          </div>
        </Card>

        <Card cap="Loading · first load only">
          <div className="pg-states">
            <State name="row"><Skeleton rows={2} shape="row" label="Systems" /></State>
            <State name="table row"><Skeleton rows={3} shape="row-1" label="Tasks" /></State>
            <State name="card"><Skeleton rows={1} shape="card" label="the library" /></State>
            <State name="node"><Skeleton rows={1} shape="node" label="the map" /></State>
            <State name="reading"><Spinner label="Reading…" /></State>
          </div>
        </Card>
      </div>
    </div>
  )
}
