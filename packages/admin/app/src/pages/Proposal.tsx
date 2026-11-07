import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'wouter'
import { api, type ChangeView, type PrepareResult, type ProposalCheck, type ProposalDetail, type Resource } from '../api.ts'
import { readOnlySentence, useActor } from '../actor.ts'
import { PageHead } from '../design/PageHead.tsx'
import { Section } from '../design/Section.tsx'
import { Button, ButtonLink } from '../design/Button.tsx'
import { Empty } from '../design/Empty.tsx'
import { Icon } from '../design/Icon.tsx'
import { Note } from '../design/Note.tsx'
import { FieldRow, FieldTable } from '../design/FieldRow.tsx'
import { Choice, SelectInput, TextInput } from '../design/inputs/index.ts'
import type { Mark } from '../machines.ts'
import { RecordHeader } from '../elements/records/RecordHeader.tsx'
import { PreparedTx } from '../elements/governance/PreparedTx.tsx'
import { Timeline } from '../elements/governance/Timeline.tsx'
import { timelineOf } from '../elements/governance/timeline.ts'
import { alsoSkipped, preparedFromProposal, type PreparedView } from '../elements/governance/prepared.ts'
import { isRestricted, RESTRICTED_NOTE, shownFor } from '../elements/governance/seen.ts'
import { closingText } from '../elements/needs/needs.ts'
import { attachedSystem } from '../blocks/prepared.tsx'
import { proposalResource } from '../blocks/proposals.tsx'
import { useEntryOfResources } from '../blocks/entries.ts'
import { MiniMap } from '../record/MiniMap.tsx'
import { RuleStatus } from '../parts/RuleStatus.tsx'
import { EventLog } from '../parts/EventLog.tsx'
import { Refusal } from '../parts/SyncParts.tsx'
import { fmt, trayRows, type TrayRow } from '../changes/rows.ts'
import { changeKeyHref, changeKeyOf } from '../hrefs.ts'
import { useResources } from '../queries.ts'
import { ago, useNow } from '../time.ts'
import { useCanWrite, useViewer, useVisibilitySource, viewerWord } from '../viewAs/ViewAs.tsx'
import { liveEvents, methodOf, type LedgerEvent } from '../../../lib/proposals.mjs'
import { sentence } from '../../../lib/machines/run.mjs'
import { proposal as machine } from '../../../lib/machines/proposal.mjs'
import { PageLoading } from '../frame/PageLoading.tsx'
import { Skeleton } from '../design/Skeleton.tsx'
import { useRecordNames } from '../record/refNames.ts'

// The proposal page (§14.1; 0.6 P2 spec §3.14 for what it does): the record header (id, state, route, visibility, title,
// meta, the one primary for this viewer), then the rationale, Decision rule, System (the prepared-transaction cards,
// Check now, Prepare and Attach), Changes (field change rows, the diff in a well), Events (a comment thread's list) and
// Actions; beside them the aside: the proposal's path, its route and what it touches, and the small map. What may be
// done is the server's: an action is enabled when it is in the view's `can`, and a disabled one says the view's
// `cannot` sentence. The page computes nothing it sends: Ratify posts an empty body, and the server decides. While
// previewing, no action is drawn (C-23); a proposal the previewed viewer may not see is not shown (E-50).

const CLOSED = ['ratified', 'rejected', 'withdrawn', 'expired']
const sentenceCase = (s: string) => (s === '' ? s : s[0]!.toUpperCase() + s.slice(1))
const period = (s: string) => s.replace(/[.\s]+$/, '') + '.'
const sameId = (a: unknown, b: unknown) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase()
type Ref = { system?: string; id?: string; chain?: string }
const refOf = (e: LedgerEvent | undefined): Ref | null => (e && typeof e.ref === 'object' && e.ref !== null ? (e.ref as Ref) : null)
/** A prepared transaction a signer can act on now: the header's primary is then Open in Safe. */
const SIGNABLE: ReadonlySet<PreparedView['state']> = new Set(['unsigned', 'partly-signed', 'ready'])

/** A proposal's page, fresh for each proposal: an open form or a message belongs to one proposal only. */
export default function ProposalPage({ id }: { id: string }) {
  return <ProposalBody key={id} id={id} />
}

function ProposalBody({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['proposal', id], queryFn: () => api.proposal(id) })
  const { actor, error } = useActor()
  const resources = useResources()
  const { viewer, sees } = useViewer()
  const now = useNow(false)
  // Who you are decides which actions are enabled, so the page waits for it too: no button enabling late.
  if (q.isPending || (actor === null && error === null)) return <PageLoading shape="row-1" rows={6} />
  if (q.error) return <><PageHead title={id} meta={['proposal']} /><Refusal>{q.error.message}</Refusal></>
  // A preview shows what the previewed viewer would be shown (E-50, rule 8): nothing of a proposal they may not see, and
  // one about data they may not read in its restricted form.
  if (viewer.as !== 'you' && resources.isPending) return <PageLoading shape="row-1" rows={6} />
  const shown = shownFor(q.data, resources.data, viewer, sees)
  if (shown === null) return <><PageHead title={id} meta={['proposal']} /><Empty>{`Previewing as ${viewerWord(viewer)}, this proposal is not shown.`}</Empty></>
  return <Loaded view={shown} now={now} resources={resources.data} />
}

/** The head's state mark: needs you while it waits on you; stale; done once ratified; closed (dimmed) once it ended
 *  otherwise; else open. Its word is the machine's state, in sentence case. */
function stateOf(v: ProposalDetail): { mark: Mark; word: string } {
  const word = sentenceCase(String(v.derived))
  if (v.derived === 'ratified') return { mark: 'done', word: 'Ratified' }
  if (CLOSED.includes(v.derived)) return { mark: 'closed', word }
  if (v.derived === 'stale') return { mark: 'stale', word }
  return v.needsYou ? { mark: 'needs', word: `Needs you · ${word}` } : { mark: 'open', word }
}

/** The line under the rules: what holds the proposal, or that it can be ratified, or how it closed. */
/** Whether the overall line would only say again what the one rule's line says: one rule, waiting, on the same words
 *  (walk 2026-11-04). The line stays, empty, so what it says next is announced. */
function repeatsRule(v: ProposalDetail): boolean {
  const parts = v.evaluation.parts
  if (v.state !== 'open' || v.derived === 'stale' || parts.length !== 1) return false
  if (v.evaluation.state === 'met' || v.evaluation.state === 'failed' || v.evaluation.state === 'expired') return false
  if ((v.evaluation as { blocked?: string }).blocked === 'unmeetable') return false
  return parts[0]!.evaluation.missing === v.evaluation.missing
}

function overall(v: ProposalDetail): string {
  if (v.state !== 'open' || v.derived === 'stale') return sentence(machine, v.derived)
  const missing = v.evaluation.missing
  switch (v.evaluation.state) {
    case 'met': return 'Ready to ratify.'
    case 'failed': return period(`Its rule failed: ${missing}`)
    case 'expired': return period(`Its time ran out: ${missing}`)
    default: return (v.evaluation as { blocked?: string }).blocked === 'unmeetable' ? period(sentenceCase(missing)) : period(`Waiting: ${missing}`)
  }
}

type Where = 'actions' | 'system' | 'changes'
/** One write; true when it went through. `kind` names the action running, for its busy label. */
/** Why the primary waits while another write of this page is in flight. */
const WAIT = 'Wait: the last action is still being sent.'

type Run = (where: Where, fn: () => Promise<string | null>, more?: string[][], kind?: string) => Promise<boolean>

function Loaded({ view: v, now, resources }: { view: ProposalDetail; now: Date; resources: Resource[] | undefined }) {
  const qc = useQueryClient()
  const { actor, known } = useActor()
  const canWrite = useCanWrite()
  const { sees } = useViewer()
  const source = useVisibilitySource()
  const id = String(v.id)
  const open = v.state === 'open'
  const restricted = isRestricted(v)
  const me = actor && 'id' in actor ? actor.id : null
  const [running, setRunning] = useState<string | null>(null)
  const busy = running !== null
  const [failure, setFailure] = useState<{ where: Where; text: string } | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const reread = (more: string[][] = []) => {
    for (const queryKey of [['proposal', id], ['proposals'], ['resources'], ['graph'], ['generated'], ...more]) void qc.invalidateQueries({ queryKey })
  }
  /** One write at a time; its refusal is the server's sentence, said where the action is. */
  const run: Run = async (where, fn, more = [], kind = where) => {
    if (busy) return false
    setRunning(kind); setFailure(null); setDone(null)
    try {
      setDone(await fn())
      reread(more)
      return true
    } catch (err) {
      setFailure({ where, text: err instanceof Error ? err.message : String(err) })
      return false
    } finally { setRunning(null) }
  }
  // An action that closes the proposal takes its own button away: focus goes to what it said.
  const said = useRef<HTMLParagraphElement>(null)
  const closes = (ok: boolean) => { if (ok) said.current?.focus() }
  const allowed = (kind: string) => known && v.can.includes(kind)
  /** Why `kind` cannot be sent now: who you are, or the server's sentence. */
  // The machine's sentences are written to follow a colon ("its rule is not met yet"); beside a button each is a sentence.
  const why = (kind: string): string => (!known && actor ? readOnlySentence(actor) ?? ''
    : period(sentenceCase(v.cannot?.[kind] ?? `The server does not offer ${kind} to you now`)))
  const confirmed = (text: string) => window.confirm(text)

  const withdraw = () => {
    if (busy || !confirmed(`Withdraw proposal ${id}? It closes for good; its branch is kept.`)) return
    void run('actions', async () => { await api.proposalEvent(id, { kind: 'withdraw' }); return 'Withdrawn.' }, [], 'withdraw').then(closes)
  }
  const approve = () => void run('actions', async () => { await api.proposalEvent(id, { kind: 'approve' }); return 'Approved.' }, [], 'approve')
  // Asked only when it can be sent: a write in flight (an Approve whose answer has not come back, while the watcher's
  // refetch already shows the rule met) would drop the Ratify after its confirm, so none is asked then (C8 fix I-2).
  const ratify = () => {
    if (busy || !confirmed(`Ratify proposal ${id}? Its changes are merged into the trunk, and it is recorded as decided.`)) return
    void run('actions', async () => {
      const r = await api.ratify(id)
      return r.commit ? `Ratified as commit ${r.commit.slice(0, 7)}.` : 'Ratified.'
    }, [['registry'], ['resource'], ['registries'], ['governance'], ['boards']], 'ratify').then(closes)
  }
  const failed = (where: Where) => failure?.where === where && <Refusal>{failure.text}</Refusal>
  const blocked = open && (v.evaluation as { blocked?: string }).blocked === 'unmeetable'
  const systems = v.evaluation.parts.some(p => methodOf(p.rule) === 'system')
  const events = v.events as LedgerEvent[]

  // The Safe the current attach names: its cards are drawn only for a viewer who may see that System (E-54).
  const safeId = attachedSystem(v)
  const safe = safeId === null ? undefined : resources?.find(r => r.id === safeId)
  const safeSeen = safeId === null || sees(safe ?? {})
  const cards = safeSeen ? preparedFromProposal(v, safe) : []
  const steps = timelineOf(v, cards, me)
  const signable = cards.find(tx => SIGNABLE.has(tx.state) && tx.openHref !== '')
  // The one primary for this viewer now (§9.1): Ratify once the rules are met; Approve while an approval rule waits;
  // else Open in Safe while a prepared transaction waits on signers. Approve keeps its place while it cannot be sent, its
  // reason beside it, so focus stays on it when the reason comes or goes (E-57).
  const approving = v.evaluation.parts.some(p => methodOf(p.rule) === 'approve' && p.evaluation.state !== 'met')
  // While any write runs the primary is held, not only while its own does: the next one waits for this one's answer.
  const held = (kind: string): string | undefined => (!allowed(kind) ? why(kind) : busy && running !== kind ? WAIT : undefined)
  const primary: ReactNode = !open ? undefined
    : v.evaluation.state === 'met'
      ? <Button primary unavailable={held('ratify')} busy={running === 'ratify' ? 'Ratifying…' : undefined} onClick={ratify}>Ratify</Button>
      : approving && (allowed('approve') || v.cannot?.approve !== undefined)
        ? <Button primary unavailable={held('approve')} busy={running === 'approve' ? 'Approving…' : undefined} onClick={approve}>Approve</Button>
        : signable ? <ButtonLink href={signable.openHref} external primary>Open in Safe</ButtonLink> : undefined
  const own = resources?.find(r => r.id === `proposal:${id}`)
  const closes_ = open && v.evaluation.closesAt ? closingText(v.evaluation.closesAt, now) : null
  const branch = `${String(v.branch ?? `proposal/${id}`)}${open && v.branchState === 'missing' ? ' (not built yet)' : ''}`
  const state = stateOf(v)
  const rationale = typeof (v as { rationale?: unknown }).rationale === 'string' ? String((v as { rationale?: unknown }).rationale).trim() : ''

  return (
    <>
      <RecordHeader variant="record" kind="proposal" id={id} title={String(v.title)} state={state.mark} stateWord={state.word}
        route={v.rules[0]?.sentence} visibility={source.visibilityOf(own ?? v)} now={now}
        // `opened 3 min ago` is a function of now too (R9): marked, so the route shots mask it instead of depending on
        // the page clock sitting behind the seeded proposal's own time. The phrase stays one meta item, as it was.
        meta={[<span key="o"><span data-volatile="">{`opened ${ago(String(v.opened), now)}`}</span>{` by ${String(v.author)}`}</span>,
          ...(closes_ ? [<span key="c" className={closes_.late ? 'att' : undefined} data-volatile="">{closes_.text}</span>] : []), branch]}
        primary={primary} />

      <div className="pp">
        <div className="pp-main">
          {restricted
            ? <p className="note pp-restricted" role="note"><Icon name="lock" size="sm" /><span className="note-t">{v.note ?? RESTRICTED_NOTE}</span></p>
            : rationale !== '' && <section className="pp-body" aria-label="Rationale"><p className="pp-prose">{rationale}</p></section>}

          <Section label="Decision rule" note={v.evaluation.parts.length === 1 ? '1 rule' : `${v.evaluation.parts.length} rules, every one must be met`}>
            <ul className="rst-list" aria-label="Rules">
              {/* a rule's clock that is the proposal's own deadline is not said again: the header says it (walk 2026-11-04) */}
              {v.evaluation.parts.map((p, i) => <RuleStatus key={i} sentence={v.rules[i]?.sentence ?? String(p.rule.id)} now={now}
                partial={v.partial === true && (v.partialRules?.includes(String(p.rule.id)) ?? true)}
                result={closes_ && p.evaluation.closesAt === v.evaluation.closesAt ? { ...p.evaluation, closesAt: null } : p.evaluation} />)}
            </ul>
            <p className={`pp-overall${blocked || v.evaluation.state === 'failed' ? ' att' : ''}`} role="status">{repeatsRule(v) ? '' : overall(v)}</p>
            {canWrite && blocked && v.author === me && (
              <p className="pp-btns">
                <Button disabled={busy || !allowed('withdraw')} describedby={!allowed('withdraw') ? 'pr-withdraw-why' : undefined} onClick={withdraw}>Withdraw</Button>
                {!allowed('withdraw') && <span className="meta pp-why" id="pr-withdraw-why">{why('withdraw')}</span>}
              </p>
            )}
          </Section>

          {(systems || cards.length > 0) && safeSeen && (
            <SystemPart view={v} now={now} known={known} busy={busy} run={run} allowed={allowed} why={why} failed={failed('system')} cards={cards} safe={safe}
              openPrimary={!(canWrite && primary !== undefined)} />
          )}

          {!restricted && <Changes view={v} busy={busy} onChoose={choose => void run('changes', async () => { await api.replay(id, choose); return null })} failed={failed('changes')} />}

          <Section label="Events" note={events.length === 1 ? '1 event' : `${events.length} events`}>
            <EventLog key={id} events={events} rev={String(v.rev)} now={now} />
          </Section>

          {canWrite && (
            <Section label="Actions">
              {open
                ? <Actions view={v} busy={busy} allowed={allowed} why={why} run={run} withdraw={withdraw} me={me}
                  onLoaded={change => qc.setQueryData(['changes'], change)} closes={closes} confirmed={confirmed} />
                : <Empty>{`Nothing more can be done here: the proposal is ${v.derived}.`}</Empty>}
              {failed('actions')}
              {/* Rendered empty first, so what an action says is announced when it is said. */}
              <p role="status" tabIndex={-1} ref={said} className="pp-said">{done ?? ''}</p>
            </Section>
          )}
        </div>

        <aside className="pp-aside" aria-label="About this proposal">
          <Timeline steps={steps} label="Path" />
          <FieldTable label="Route and touches">
            <FieldRow label={v.rules.length === 1 ? 'Route' : 'Routes'}>{v.rules.map(r => r.sentence).join(' · ') || '—'}</FieldRow>
            {!restricted && <FieldRow label="Touches"><Touches view={v} /></FieldRow>}
          </FieldTable>
          {!restricted && resources !== undefined && <SmallMap view={v} own={own} resources={resources} />}
        </aside>
      </div>
    </>
  )
}

// ── DAO-OS L6 Task 16b (R-L6-SUGGEST) ── a `file` op (L6 §11.2) names a path, not a record; a page's edit is drawn with
// Compare. Used at four marked lines below: Touches, SmallMap, the Changes heading, and Compare under a page's op.
// (Ported to L4c by C11, fix round 1, from cfe5986: Touches read `op.record`, which a `file` op has not. L6's `opRecord`
// lives in its changes/rows.ts with the `file` op type; here it is read off the op as given. L6's PageCompare needs the
// detail's `compare` and pages.css, which arrive with L6, so it is not ported.)

/** Where an op's key links: a record to its page; a page's path (`pages/<id>.md`) to the page; another file nowhere. */
const touchHref = (k: string): string | null =>
  k.includes(':') ? changeKeyHref(k) : /^pages\/[^/]+\.md$/.test(k) ? `/p/${encodeURIComponent(k.slice('pages/'.length, -'.md'.length))}` : null

/** An op's key, linked where it has a page, else named. */
function KeyLink({ k }: { k: string }) {
  const href = touchHref(k)
  // a record's key is named by the record, as its page heads it (walk 2026-11-04); a file op's path stays the path
  const m = /^([^:/]+):(.+)$/.exec(k)
  const { nameOf } = useRecordNames(m ? [m[1]!] : [])
  const named = m ? nameOf(m[1]!, m[2]!) : k
  const words = m && named === m[2] ? k : named
  return href ? <Link href={href} className="brk">{words}</Link> : <span className="brk">{words}</span>
}

/** An op's key: a record's `<registry>:<id>`, or a `file` op's path (L6's `opRecord`). */
const opRecord = (op: { op: string; record?: string; path?: string }): string => (op.op === 'file' ? String(op.path) : String(op.record))
// ── end DAO-OS L6 Task 16b

/** The records a proposal's ops touch, each linked, in the order the ops name them. */
function Touches({ view: v }: { view: ProposalDetail }) {
  const keys = [...new Set(((v.ops as unknown as { op: string; record?: string; path?: string }[]) ?? []).map(opRecord))] // L6 Task 16b: opRecord
  if (keys.length === 0) return <>Nothing</>
  return <>{keys.map((k, i) => <span key={k}>{i > 0 && ', '}<KeyLink k={k} /></span>)}</> // L6 Task 16b: KeyLink
}

/** The small map (§8.6): the proposal, and the records its ops touch that the resources hold. Its names come from
 *  their file entries, as the inspector's do: the gate's `restricted` marker lives there, so a name the viewer is not
 *  admitted to reads "<hat> only". Until those are read the map is not drawn at all, so a restricted name never
 *  flashes raw first. */
function SmallMap({ view: v, own, resources }: { view: ProposalDetail; own: Resource | undefined; resources: Resource[] }) {
  const keys = new Set(((v.ops as unknown as { op: string; record?: string; path?: string }[]) ?? []).map(opRecord)) // L6 Task 16b: opRecord
  const near = resources.filter(r => { const k = changeKeyOf(r); return k !== null && keys.has(k) })
  const centre = own ?? proposalResource(v)
  const entries = useEntryOfResources([centre, ...near])
  if (entries.pending) return <Skeleton rows={3} shape="node" label="the map" />
  return <MiniMap centre={centre} neighbours={near} entryOf={entries.entryOf} />
}

/** Changes (§14.1): one field change row per changed field (`was` struck → `now`), grouped by the record its op changes,
 *  each record linked; a stale op's rows in clay with what the trunk holds now, and the author's Keep mine / Take
 *  theirs; the commit's diff in a Mono well on request. */
function Changes({ view: v, busy, onChoose, failed }: { view: ProposalDetail; busy: boolean; onChoose: (c: 'mine' | 'theirs') => void; failed: ReactNode }) {
  const canWrite = useCanWrite()
  const [diff, setDiff] = useState(false)
  const id = String(v.id)
  const open = v.state === 'open'
  // The old value is the entry as the trunk holds it, while the op still stands on it; a closed proposal's is not known.
  const ops = (v.ops as unknown as ChangeView['ops']).map((op, i) => ({ ...op, before: open && !v.stale.includes(i) ? (v.current[i] ?? null) : null }))
  const rows = trayRows({ ops, stale: v.stale, current: v.current } as ChangeView)
  const byOp = new Map<number, TrayRow[]>()
  for (const r of rows) byOp.set(r.n, [...(byOp.get(r.n) ?? []), r])
  const chooses = canWrite && open && v.derived === 'stale' && v.can.includes('replay')
  const emptyDiff = v.state === 'ratified'
    ? `No diff to show: proposal ${id} is ratified, so its changes are on the trunk and its branch adds nothing to it.`
    : `No diff to show: proposal/${id} changes nothing against the trunk.`
  return (
    <Section label="Changes" note={rows.length === 1 ? '1 field' : `${rows.length} fields`}>
      {[...byOp.entries()].map(([n, fields]) => (
        <div key={n} className="pp-op">
          <h3 className="pp-rec"><KeyLink k={opRecord(ops[n]!)} />{/* L6 Task 16b: KeyLink (here the op's key: this branch's trayRows reads op.record) */}
            <span className="pp-opk">{fields[0]!.op}</span></h3>
          <FieldTable label={`Changes to ${opRecord(ops[n]!)}`}>
            {fields.map(row => (
              <FieldRow key={row.field} label={row.field} stale={row.stale ? fmt(row.current) : undefined}>
                {row.op !== 'create' && row.was !== undefined && <span className="was"><span className="sr-only">was </span><s className="wrap">{fmt(row.was)}</s></span>}
                {row.op !== 'create' && row.was !== undefined && row.now !== undefined && <span className="pp-to" aria-hidden="true">→</span>}
                {row.now !== undefined && <span className="wrap">{fmt(row.now)}</span>}
              </FieldRow>
            ))}
          </FieldTable>
        </div>
      ))}
      {open && v.stale.length > 0 && (chooses ? (
        <>
          <p className="att pp-stale" id="prop-stale-why">A record these ops change was changed on the trunk since. Keep mine keeps your values on top of it, and approvals stand;
            Take theirs drops the fields the trunk changed, and approvals clear. The choice is for every op marked here.</p>
          <p className="pp-btns">
            <Button disabled={busy} describedby="prop-stale-why" onClick={() => onChoose('mine')}>Keep mine</Button>
            <Button disabled={busy} describedby="prop-stale-why" onClick={() => onChoose('theirs')}>Take theirs</Button>
          </p>
        </>
      ) : <p className="att pp-stale">A record these ops change was changed on the trunk since; its author chooses what stands.</p>)}
      {failed}
      <p className="pp-btns"><Button expanded={diff} onClick={() => setDiff(d => !d)}>{diff ? 'Hide the diff' : 'Show the diff'}</Button></p>
      {diff && (v.diff === null
        ? <Empty>{v.note ?? 'There is no diff to show.'}</Empty>
        : v.diff === ''
          ? <Empty>{emptyDiff}</Empty>
          : <figure className="pp-diff" aria-labelledby="prop-diff-cap"><figcaption className="meta" id="prop-diff-cap">{`git diff <trunk>...proposal/${id}`}</figcaption><pre className="gov-well">{v.diff}</pre></figure>)}
    </Section>
  )
}

/** The actions of an open proposal but the header's primary, in the spec's order. Replay shows only when offered, and
 *  never for a stale proposal (its author's choice is under Changes). The vote is a radio group. */
function Actions({ view: v, busy, allowed, why, run, withdraw, me, onLoaded, closes, confirmed }: {
  view: ProposalDetail; busy: boolean; allowed: (k: string) => boolean; why: (k: string) => string; run: Run
  withdraw: () => void; me: string | null; onLoaded: (c: ChangeView) => void; closes: (ok: boolean) => void; confirmed: (t: string) => boolean
}) {
  const id = String(v.id)
  const [writing, setWriting] = useState<'object' | 'comment' | null>(null)
  const [text, setText] = useState('')
  const [ballot, setBallot] = useState<string | null>(null)
  // What is missing before a form sends, said under its field (validated on send, never by a disabled button).
  const [missing, setMissing] = useState<{ field: string; text: string } | null>(null)
  const event = (input: Parameters<typeof api.proposalEvent>[1], said: string | null = null) => run('actions', async () => { await api.proposalEvent(id, input); return said }, [], input.kind)
  const mine = liveEvents(v as never).filter(e => e.by === me && e.kind !== 'retract').at(-1)
  const disabledWhy = (kind: string) => (!allowed(kind) ? `pa-${kind}-why` : undefined)
  const note = (kind: string) => !allowed(kind) && <span className="meta pp-why" id={`pa-${kind}-why`}>{why(kind)}</span>
  const NOUN: Record<string, string> = { approve: 'approval', object: 'objection', vote: 'vote', comment: 'comment', attach: 'attached transaction' }
  /** One action: its button, why it is held when it is, or what it does (`hint`) when that is not plain from its name. */
  const act = (kind: string, label: string, onClick: () => void, hint?: string) => (
    <li key={kind}>
      <Button disabled={busy || !allowed(kind)} describedby={disabledWhy(kind) ?? (hint ? `pa-${kind}-hint` : undefined)} onClick={() => { setMissing(null); onClick() }}>{label}</Button>
      {note(kind)}
      {allowed(kind) && hint && <span className="meta pp-why" id={`pa-${kind}-hint`}>{hint}</span>}
    </li>
  )
  const write = (kind: 'object' | 'comment') => {
    const body = text.trim()
    if (body === '') {
      setMissing({ field: kind, text: kind === 'object' ? 'Say what harm it does before you send the objection.' : 'Write the comment before you send it.' })
      document.getElementById(`pa-${kind}-text`)?.focus()
      return
    }
    setMissing(null)
    void event({ kind, text: body }).then(ok => {
      if (!ok) return // the refusal shows, and what was written stays
      setText(''); setWriting(null); setFocusBack(`pa-${kind}`)
    })
  }
  const sendVote = () => {
    if (ballot === null) {
      setMissing({ field: 'vote', text: 'Choose yes, no or abstain first.' })
      document.querySelector<HTMLInputElement>('input[name="pa-vote"]')?.focus()
      return
    }
    setMissing(null)
    void event({ kind: 'vote', vote: ballot }, 'Vote sent.')
  }
  // The form that sent is gone: focus returns to its opener once the opener is enabled again.
  const [focusBack, setFocusBack] = useState<string | null>(null)
  useEffect(() => {
    if (focusBack === null || busy) return
    document.getElementById(focusBack)?.focus()
    setFocusBack(null)
  }, [focusBack, busy])
  const missingFor = (field: string) => (missing?.field === field ? missing.text : undefined)
  const form = (kind: 'object' | 'comment', label: string, send: string) => (
    <li key={kind}>
      <Button disabled={busy || !allowed(kind)} describedby={disabledWhy(kind)} expanded={writing === kind} id={`pa-${kind}`}
        onClick={() => { setWriting(w => (w === kind ? null : kind)); setText(''); setMissing(null) }}>{kind === 'object' ? 'Object…' : 'Comment…'}</Button>
      {note(kind)}
      {writing === kind && allowed(kind) && (
        <div className="pp-form">
          <FieldTable label={label}>
            <FieldRow label={label} htmlFor={`pa-${kind}-text`}>
              <TextInput common={{ id: `pa-${kind}-text` }} prose readOnly={false} value={text} error={missingFor(kind)}
                onChange={t => { setText(String(t ?? '')); setMissing(null) }} />
            </FieldRow>
          </FieldTable>
          <p className="pp-btns"><Button primary disabled={busy} onClick={() => write(kind)}>{send}</Button></p>
        </div>
      )}
    </li>
  )
  const closing = (kind: 'reject' | 'expire', label: string, outcome: 'rejected' | 'expired', ask: string) =>
    act(kind, label, () => { if (confirmed(ask)) void run('actions', async () => { await api.closeProposal(id, outcome); return `Closed as ${outcome}.` }, [], kind).then(closes) })
  const voteOk = allowed('vote')
  return (
    <ul className="pp-acts">
      {form('object', 'Your objection', 'Send objection')}
      <li key="vote">
        <fieldset className="pp-vote" role="radiogroup" aria-labelledby="pa-vote-l" aria-describedby={disabledWhy('vote') ?? (missingFor('vote') ? 'pa-vote-err' : undefined)}>
          <legend id="pa-vote-l" className="pp-vote-l">Vote</legend>
          {['yes', 'no', 'abstain'].map(choice => (
            <Choice key={choice} type="radio" name="pa-vote" label={choice} disabled={!voteOk || busy} checked={ballot === choice} onChange={() => { setBallot(choice); setMissing(null) }} />
          ))}
        </fieldset>
        <Button disabled={busy || !voteOk} describedby={disabledWhy('vote')} onClick={sendVote}>Send vote</Button>
        {note('vote')}
        {missingFor('vote') && <span className="err-msg" id="pa-vote-err"><Icon name="alert" size="xs" />{missingFor('vote')}</span>}
      </li>
      {form('comment', 'Your comment', 'Send comment')}
      {act('retract', 'Retract', () => { if (mine) void event({ kind: 'retract', of: String(mine.id) }, 'Taken back.') },
        mine ? `Takes back your ${NOUN[mine.kind] ?? mine.kind}, written ${ago(mine.at, new Date())}.` : undefined)}
      {act('withdraw', 'Withdraw', withdraw)}
      {act('revise', 'Revise', () => void run('actions', async () => {
        onLoaded(await api.loadProposal(id))
        return 'Its ops are in your Changes tray: change them there, then press Update proposal.'
      }, [], 'revise'))}
      {v.derived !== 'stale' && v.can.includes('replay') && act('replay', 'Replay', () => void run('actions', async () => {
        // commit null: the branch already stood on the trunk's tip, and nothing was written
        const r = await api.replay(id)
        return r.commit ? 'Replayed on the trunk.' : 'Already on the trunk: nothing to replay.'
      }, [], 'replay'))}
      {closing('reject', 'Close as rejected', 'rejected', `Close proposal ${id} as rejected? It closes for good; its branch is kept.`)}
      {closing('expire', 'Close as expired', 'expired', `Close proposal ${id} as expired? It closes for good; its branch is kept.`)}
    </ul>
  )
}

const NOTHING = 'Nothing is attached to read yet.'
const OUTCOME: Record<string, string> = { pending: 'pending', executed: 'executed', failed: 'failed', mismatch: 'a different transaction' }
const OPERATIONS = ['0 · call', '1 · delegate call'] as const

/** What Prepare transaction gave, as the card draws it (§9.6): unsigned, on the Safe the rule waits on, the payload a
 *  signer checks, and the Safe app's link. */
function preparedOf(p: PrepareResult, title: string, safe: Resource | undefined, system: string): PreparedView {
  const ref = p.ref as Ref
  return {
    state: 'unsigned', safe: { name: safe?.name ?? system, address: '', chain: ref.chain ?? '' }, nonce: p.payload.nonce, signed: 0, of: 0,
    calls: [{ title, from: '', to: String(p.payload.to) }], total: 'Total',
    payload: { to: String(p.payload.to), value: String(p.payload.value), operation: p.payload.operation === 1 ? 1 : 0, data: String(p.payload.data ?? '0x'), safeTxHash: p.safeTxHash },
    openHref: p.appLink,
  }
}

/** System (§14.1, spec §3.11): the prepared-transaction cards when a Safe transaction is attached (one per chain, and a
 *  warning for a chain the ledger holds unreadably, E-53); the transaction attached for the current version, the last
 *  reading and its age, Check now; and Prepare transaction (read only) with its card, Open in Safe ↗ and Attach. */
function SystemPart({ view: v, now, known, busy, run, allowed, why, failed, cards, safe, openPrimary }: {
  view: ProposalDetail; now: Date; known: boolean; busy: boolean; run: Run; allowed: (k: string) => boolean; why: (k: string) => string; failed: ReactNode
  cards: PreparedView[]; safe: Resource | undefined
  /** False when the record header carries the page's one primary: the cards' Open in Safe is then secondary (§7.1). */
  openPrimary: boolean
}) {
  const canWrite = useCanWrite()
  const id = String(v.id)
  const open = v.state === 'open'
  const live = liveEvents(v as never)
  const attach = live.filter(e => e.kind === 'attach' && e.rev === v.rev).at(-1)
  const ref = refOf(attach)
  const last = attach ? live.filter(e => e.kind === 'system' && e.rev === v.rev && sameId(refOf(e)?.id, ref?.id)).at(-1) : undefined
  const [check, setCheck] = useState<ProposalCheck | null>(null)
  const [tx, setTx] = useState({ to: '', value: '', data: '', operation: OPERATIONS[0] as string })
  const [prepared, setPrepared] = useState<PrepareResult | null>(null)
  const system = refOf(last)?.system ?? ref?.system ?? String(v.evaluation.parts.find(p => methodOf(p.rule) === 'system')?.rule.decide?.system ?? 'the system')
  // Check now and Prepare are enabled from the server's view: `check` (POST …/check's guards) and `can` (attach), so
  // Prepare is offered to one who may attach what it gives.
  const checkWhy = !known ? why('check') : v.check === true ? null : period(sentenceCase(String(v.check ?? NOTHING)))
  const prepareWhy = allowed('attach') ? null : why('attach')
  const outcome = String(last?.outcome ?? '')
  const skipped = alsoSkipped(v)
  return (
    <Section label="System" note={system}>
      {cards.length > 0 && <div className="pp-cards">{cards.map(c => <PreparedTx key={`${c.safe.chain}:${c.nonce}`} tx={c} now={now} openPrimary={openPrimary} />)}</div>}
      {skipped > 0 && (
        <p className="note pp-warn"><Icon name="alert" size="sm" />
          <span className="note-t">{`${skipped} of this change’s chains could not be read from the ledger and are not shown.`}</span></p>
      )}
      {ref
        ? <p>Transaction <code className="wrap">{ref.id}</code> on {ref.system}, attached by {attach!.by} {ago(attach!.at, now)}.</p>
        : <Empty>No transaction is attached yet. Prepare it below, have a signer put it in the Safe, then attach it.</Empty>}
      {ref && (last
        ? <p className={outcome === 'mismatch' ? 'att' : undefined}>{`${system} read ${OUTCOME[outcome] ?? outcome}, ${ago(last.at, now)}${typeof last.text === 'string' && last.text ? `: ${last.text}` : ''}`}</p>
        : <p className="meta">Not read yet: Check now reads it.</p>)}
      {outcome === 'mismatch' && <p>It cannot decide this proposal as it stands: withdraw the proposal and propose again, or revise it and attach a new transaction.</p>}
      {canWrite && open && (
        <p className="pp-btns">
          <Button disabled={busy || checkWhy !== null} describedby={checkWhy !== null ? 'ps-check-why' : undefined}
            onClick={() => void run('system', async () => { setCheck(await api.checkProposal(id)); return null }, [], 'check')}>Check now</Button>
          {checkWhy !== null && <span className="meta pp-why" id="ps-check-why">{checkWhy}</span>}
        </p>
      )}
      {/* Rendered empty first, so a reading is announced when it arrives. */}
      <p className={check?.attention ? 'att' : 'meta'} role="status">{check ? check.attention?.text ?? (check.reading === null ? NOTHING : check.appended ? 'Read: the new reading is recorded.' : 'Read: nothing changed.') : ''}</p>
      {canWrite && open && (
        <div className="pp-form">
          <FieldTable label="Prepare transaction">
            <FieldRow label="to" htmlFor="ps-to"><TextInput common={{ id: 'ps-to' }} mono prose={false} readOnly={false} value={tx.to} onChange={t => setTx({ ...tx, to: String(t ?? '') })} /></FieldRow>
            <FieldRow label="value" htmlFor="ps-value"><TextInput common={{ id: 'ps-value' }} mono prose={false} readOnly={false} value={tx.value} onChange={t => setTx({ ...tx, value: String(t ?? '') })} /></FieldRow>
            <FieldRow label="data" htmlFor="ps-data"><TextInput common={{ id: 'ps-data' }} mono prose={false} readOnly={false} value={tx.data} onChange={t => setTx({ ...tx, data: String(t ?? '') })} /></FieldRow>
            <FieldRow label="operation" htmlFor="ps-op">
              <SelectInput common={{ id: 'ps-op' }} options={OPERATIONS} value={tx.operation} onChange={o => setTx({ ...tx, operation: String(o ?? OPERATIONS[0]) })} />
            </FieldRow>
          </FieldTable>
          <p className="pp-btns">
            <Button disabled={busy || prepareWhy !== null} describedby={prepareWhy !== null ? 'ps-prepare-why' : undefined} onClick={() => void run('system', async () => {
              setPrepared(await api.prepareProposal(id, { to: tx.to.trim(), value: tx.value.trim(), data: tx.data.trim() || '0x', operation: tx.operation.startsWith('1') ? 1 : 0 }))
              return null
            }, [], 'prepare')}>Prepare transaction</Button>
            {prepareWhy !== null && <span className="meta pp-why" id="ps-prepare-why">{prepareWhy}</span>}
          </p>
          <p className="meta">Prepare reads the Safe and sends nothing. A signer puts the transaction in the Safe app; then attach it here.</p>
        </div>
      )}
      {canWrite && prepared && (
        <div className="pp-form">
          <PreparedTx tx={preparedOf(prepared, String(v.title), safe, system)} now={now} openPrimary={openPrimary} />
          <p className="pp-btns">
            <Button disabled={busy || !allowed('attach')} describedby={!allowed('attach') ? 'ps-attach-why' : undefined}
              onClick={() => void run('system', async () => { await api.proposalEvent(id, { kind: 'attach', ref: prepared.ref }); return null }, [], 'attach')}>Attach</Button>
            {!allowed('attach') && <span className="meta pp-why" id="ps-attach-why">{why('attach')}</span>}
          </p>
        </div>
      )}
      {failed}
    </Section>
  )
}
