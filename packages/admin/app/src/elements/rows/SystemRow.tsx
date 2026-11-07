import type { DriverRead, Resource } from '../../api.ts'
import { Icon } from '../../design/Icon.tsx'
import { StatusMark } from '../../design/StatusMark.tsx'
import { ageText } from '../../time.ts'
import { AddressChip } from '../atoms/AddressChip.tsx'
import { ChainChip } from '../atoms/ChainChip.tsx'
import { ReadAge } from '../atoms/ReadAge.tsx'
import { kindWord } from '../records/RecordHeader.tsx'
import { DataRow } from './DataRow.tsx'
import { systemFacts, systemState } from './systemState.ts'

/** The read age in a Systems row's 84px column: the age alone, as the gallery draws it ("4 min ago"; an old read
 *  after the clock, mute; a failed read's last good age after the alert glyph, clay), the words the full read age
 *  says ("read", "couldn’t read · last") kept for a screen reader, since the state column says the rest. Reading
 *  and not read yet are ReadAge's own. */
function RowAge({ read, now }: { read: DriverRead | null; now: Date }) {
  const state = read === null ? 'unknown' : read.state ?? (read.ok ? 'fresh' : 'failed')
  const iso = read?.readAt ?? null
  const text = iso === null ? '' : ageText(iso, now)
  if (iso === null || text === '' || (state !== 'fresh' && state !== 'aged' && state !== 'failed')) {
    return <ReadAge state={state} readAt={iso} lastGood={read && !read.ok ? iso : null} now={now} />
  }
  const cls = state === 'failed' ? 'age age-failed' : state === 'aged' ? 'age age-aged' : 'age'
  return (
    <time className={cls} dateTime={iso} title={iso}>
      {state === 'failed' ? <Icon name="alert" size="xs" /> : state === 'aged' ? <Icon name="clock" size="xs" /> : null}
      <span className="sr-only">{state === 'failed' ? 'couldn’t read · last ' : 'read '}</span>{text}
    </time>
  )
}

/** A System in a list (§9.2): kind tile · name and kind · chain chip · address (a chip, the Mono id `42220 / 13`,
 *  or the host `snapshot.box`) · one state mark ("1 to sign", "Couldn’t read", "Return proposed" …) · the read
 *  age, end-aligned. Under 760px of its list the chain moves into the second line and the address and the age
 *  drop (rows.css): they are on the record page. `proposed` is the words of a change proposed against it. A link
 *  is not read, so it has no age. Not drawn for a viewer who may not see the System. Its chips are still (E-36): no
 *  control of their own, so the row is one tab stop; `href` makes the row a link to the record, and `onPreview` is
 *  Space on it (the inspector, at the row). */
export function SystemRow({ resource, now, proposed, selected = false, href, onPreview }:
  { resource: Resource; now: Date; proposed?: string; selected?: boolean; href?: string; onPreview?(): void }) {
  const f = systemFacts(resource)
  const state = systemState(resource, { proposed })
  const chain = <ChainChip chains={f.chains} agree={f.agree} still />
  const address = f.address === null ? null
    : 'chip' in f.address ? <AddressChip value={f.address.chip} chain={f.chains.length === 1 ? f.chains[0] : undefined} still />
    : <span className="mono sysrow-id">{'mono' in f.address ? f.address.mono : f.address.host}</span>
  const age = f.kind === 'link' ? <span className="age" aria-hidden="true">—</span> : <RowAge read={f.read} now={now} />
  return (
    <DataRow kind={f.kind} title={resource.name} item={resource} selected={selected} marks={[]} tone={state.mark === 'needs' ? 'attn' : 'plain'}
      href={href} onPreview={onPreview}
      className="sysrow" second={<>{kindWord(f.kind)}<span className="sysrow-k">{chain}</span></>}
      trailing={<>
        <span className="sysrow-chain">{chain}</span>
        <span className="sysrow-addr">{address}</span>
        <span className="sysrow-state"><StatusMark mark={state.mark} label={state.words} /></span>
        <span className="sysrow-age">{age}</span>
      </>} />
  )
}
