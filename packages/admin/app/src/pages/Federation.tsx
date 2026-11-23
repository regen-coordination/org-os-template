import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearch } from 'wouter'
import {
  api, FINAL_STATUSES, type FedHub, type FedInvite, type FedMigrationRow, type FedReceived, type JoinPolicy, type OperationInfo,
  type PlanReply, type Resource,
} from '../api.ts'
import { Button, ButtonLink, buttonClass } from '../design/Button.tsx'
import { ConfirmDialog } from '../design/ConfirmDialog.tsx'
import { FieldRow, FieldTable } from '../design/FieldRow.tsx'
import { Choice, NumberInput, SelectInput, TextInput } from '../design/inputs/index.ts'
import { Note } from '../design/Note.tsx'
import { PageHead } from '../design/PageHead.tsx'
import { Section } from '../design/Section.tsx'
import { Skeleton } from '../design/Skeleton.tsx'
import { StatusMark, type Mark } from '../design/StatusMark.tsx'
import { announce } from '../parts/live.tsx'
import { Refusal } from '../parts/SyncParts.tsx'
import JobLog from '../record/JobLog.tsx'
import { outsideSentence } from '../record/ConfirmBox.tsx'
import { useCanWrite } from '../viewAs/ViewAs.tsx'
import { isPublicUrl } from '../../../lib/federation/peers.mjs'
import {
  atprotoLine, driftFix, driftOrder, hiddenNetworksLine, keptLine, linkWords, listOf, OPEN_FALLBACK, planCounts, POLICIES,
  policySentence, RELATIONS, type Drift, type Sources,
} from './federationWords.ts'

// ── the shapes the cards carry (server/resources/adapters/fleet.ts, federation.ts) ────────────────────────────

interface Net { name: string; hub: string | null; role: string | null }
interface Outgoing {
  id: string; network: string; hub: string; onTrunk: boolean; invited: boolean; where: string | null
  sent: { transport: string; ref: string; at: string } | null
  status: { state: string; reason?: string; at: string } | null
}
type Join = { policy: JoinPolicy; types: string[]; asks: string[]; where: string | null; decision: string | null }
interface SelfFacts {
  did?: string | null; pds?: string | null; drift?: Drift[]; networks?: Net[]; join?: Join | null
  published?: { at: string; created: number; deleted: number } | null; publishBlocked?: { step: number; sentence: string } | null
  publishPlan?: { create: number; delete: number; profile: boolean } | null; kept?: number; outgoing?: Outgoing[]; inbox?: number
  toReply?: { id: string; from: string; outcome: string }[]
}

const norm = (u: unknown): string => (typeof u === 'string' ? u.trim().replace(/\/+$/, '').toLowerCase() : '')
const day = (iso: string): string => iso.slice(0, 10)
const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))
const text = (v: unknown): string => (typeof v === 'string' ? v : '')
const opNamed = (ops: OperationInfo[] | undefined, id: string, preset?: Record<string, unknown>): OperationInfo | undefined =>
  ops?.find(o => o.id === id && (!preset || Object.entries(preset).every(([k, v]) => o.preset?.[k] === v)))

/** The page's operations that change something outside the repository (the rest only read): their confirm says where. */
const CHANGES = new Set(['federation.publish-links', 'federation.send', 'federation.reply'])

const STATE_MARK: Record<string, Mark> = { mutual: 'ok', requested: 'open', claimed: 'needs', left: 'closed', 'not-an-instance': 'stale' }

// ── confirmed operations: plan, the operator confirms its words, then the job with the plan's nonce ──────────

interface Runner {
  start: (op: string, params: Record<string, unknown>, label: string, place: string, after?: () => void) => void
  busyAt: (place: string) => string | undefined
  outcome: (place: string) => ReactNode
  dialog: ReactNode
}

/** The page's one way to reach the network (R16): `api.plan` answers the operation's own summary and a nonce; nothing
 *  runs until the operator confirms that summary; the job is then followed to its end, and the cards are read again. */
function useRunner(self: Resource | undefined): Runner {
  const qc = useQueryClient()
  const [asking, setAsking] = useState<{ place: string; label: string; plan: PlanReply; outside: string | null; after?: () => void } | null>(null)
  const [planning, setPlanning] = useState<string | null>(null)
  const [refused, setRefused] = useState<{ place: string; text: string } | null>(null)
  const [job, setJob] = useState<{ place: string; id: string; after?: () => void } | null>(null)
  const sending = useRef(false)
  const done = useRef<string | null>(null)
  const followed = useQuery({
    queryKey: ['job', job?.id], queryFn: () => api.job(job!.id), enabled: job !== null,
    refetchInterval: q => (q.state.data && FINAL_STATUSES.includes(q.state.data.job.status) ? false : 1000),
  })
  const ended = followed.data && FINAL_STATUSES.includes(followed.data.job.status) ? followed.data.job : null
  useEffect(() => {
    if (!job || !ended || ended.id !== job.id || done.current === job.id) return
    done.current = job.id
    for (const k of ['resources', 'operations', 'federation', 'jobs']) void qc.invalidateQueries({ queryKey: [k] })
    job.after?.()
  }, [job, ended, qc])

  const start: Runner['start'] = (op, params, label, place, after) => {
    if (!self || planning !== null) return
    setRefused(null); setPlanning(place)
    api.plan(op, self.id, params)
      .then(plan => setAsking({ place, label, plan, after, outside: outsideSentence({ id: op, effect: CHANGES.has(op) ? 'changes' : 'reads', network: true }, params) }),
        (err: unknown) => setRefused({ place, text: message(err) }))
      .finally(() => setPlanning(null))
  }
  const confirm = async () => {
    if (!asking || sending.current) return
    sending.current = true
    const { place, label, plan, after } = asking
    try {
      if (!plan.nonce) throw new Error('This plan carries no confirmation, so nothing was run.')
      const started = await api.runJob({ nonce: plan.nonce })
      setJob({ place, id: started.id, after })
      announce(`${label}: running.`)
    } catch (err) { setRefused({ place, text: message(err) }) } finally { sending.current = false; setAsking(null) }
  }
  const dialog = asking && (
    <ConfirmDialog title={asking.label} confirm="Confirm" onCancel={() => setAsking(null)} onConfirm={() => void confirm()}
      body={<><p>{asking.plan.summary ?? 'It reaches the network and changes no file.'}</p>{asking.outside && <p>{asking.outside}</p>}
        <p className="ops-k">Nothing is sent until you confirm.</p></>} />
  )
  return {
    start, dialog,
    busyAt: place => (planning === place ? 'Planning…' : undefined),
    outcome: place => <>
      {refused?.place === place && <Refusal>{refused.text}</Refusal>}
      {job?.place === place && <JobLog jobId={job.id} />}
    </>,
  }
}

/** A route of this page that writes (stages or commits): busy while it runs, its answer said in place, a refusal as its sentence. */
function useAct() {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const [refused, setRefused] = useState<string | null>(null)
  const act = async <T,>(fn: () => Promise<T>, words: (out: T) => string): Promise<T | null> => {
    if (busy) return null
    setBusy(true); setSaid(null); setRefused(null)
    try {
      const out = await fn()
      const sentence = words(out)
      setSaid(sentence); announce(sentence)
      for (const k of ['resources', 'operations', 'federation', 'changes']) void qc.invalidateQueries({ queryKey: [k] })
      return out
    } catch (err) { setRefused(message(err)); return null } finally { setBusy(false) }
  }
  const shown = <>{said && <p className="fed-said">{said}</p>}{refused && <Refusal>{refused}</Refusal>}</>
  return { act, busy, shown, reset: () => { setSaid(null); setRefused(null) } }
}

const wrote = (out: { staged?: true; commit?: string }, staged: string, committed: string) => (out.staged ? staged : committed)

// ── the page ────────────────────────────────────────────────────────────────────────────────────────────

/** /federation (network N2 Task 13): this instance's networks with both sides' sources, what it has published on
 *  atproto and the one confirmed Publish, bringing its peers onto atproto, asking to join (a node), and taking requests
 *  (a hub): the join policy, invites and received requests. Every network step is a plan the operator confirms (R16);
 *  every write is staged or committed under the instance's own rules. A private peer, or one without a public https
 *  url, is never named here: it is counted (R3, R24). An invite's link is shown once, in the answer that made it. */
export default function Federation() {
  const canWrite = useCanWrite()
  const resources = useQuery({ queryKey: ['resources'], queryFn: api.resources })
  const self = resources.data?.find(r => r.kind === 'instance' && r.facts.self === true)
  const ops = useQuery({ queryKey: ['operations', self?.id], queryFn: () => api.operations(self!.id), enabled: !!self })
  const runner = useRunner(self)
  const head = <PageHead title="Federation" about="Your networks and links. Nothing here reaches the network or atproto until you confirm it." />

  if (resources.isPending) return <>{head}<Skeleton rows={4} shape="row" label="Federation" /></>
  if (resources.error) return <>{head}<Note state="error">{resources.error.message}</Note></>
  if (!self) return <>{head}<Note state="error">This instance's own card couldn't be read.</Note></>

  const facts = self.facts as SelfFacts
  const peers = (resources.data ?? []).filter(r => r.kind === 'instance' && r.facts.self !== true && r.source?.path === 'federation.yaml')
  const requests = (resources.data ?? []).filter(r => r.kind === 'federation-request')
  return (
    <>
      {head}
      <Networks facts={facts} peers={peers} ops={ops.data} runner={runner} canWrite={canWrite} />
      <Published facts={facts} peers={peers} ops={ops.data} runner={runner} canWrite={canWrite} />
      <Migration runner={runner} canWrite={canWrite} />
      {canWrite && <Ask ops={ops.data} runner={runner} />}
      <HubSide facts={facts} requests={requests} ops={ops.data} runner={runner} canWrite={canWrite} />
      {runner.dialog}
    </>
  )
}

interface Shared { ops: OperationInfo[] | undefined; runner: Runner; canWrite: boolean }

// ── Networks ──────────────────────────────────────────────────────────────────────────────────────────────

function Networks({ facts, peers, ops, runner, canWrite }: Shared & { facts: SelfFacts; peers: Resource[] }) {
  const outgoing = facts.outgoing ?? []
  const rows: { name: string; hub: string; peer: Resource | undefined; out: Outgoing | undefined }[] = []
  let hidden = 0
  const seen = new Set<string>()
  const add = (name: string, hub: string) => {
    const key = `${name}\u0000${norm(hub)}`
    if (seen.has(key)) return
    seen.add(key)
    const peer = peers.find(p => norm(p.facts.url) === norm(hub))
    // A hub kept private, or one without a public https address, is counted, never named (R3).
    if ((peer && peer.facts.public !== true) || !isPublicUrl(hub)) { hidden += 1; return }
    rows.push({ name, hub, peer, out: outgoing.find(o => o.network === name && norm(o.hub) === norm(hub)) })
  }
  for (const n of facts.networks ?? []) if (n.role !== 'hub' && n.hub) add(n.name, n.hub)
  for (const o of outgoing) add(o.network, o.hub)
  const check = opNamed(ops, 'federation.check-links')
  const hiddenLine = hiddenNetworksLine(hidden)
  const hosted = (facts.networks ?? []).filter(n => n.role === 'hub' || !n.hub).map(n => n.name)
  return (
    <Section label="Networks" count={rows.length}
      end={canWrite && check ? <Button small busy={runner.busyAt('networks')} unavailable={check.unavailable ?? undefined}
        onClick={() => runner.start('federation.check-links', {}, 'Check links', 'networks')}>Check links</Button> : undefined}>
      {hosted.length > 0 && <p className="fed-line">{`This instance is the hub of ${hosted.join(', ')}.`}</p>}
      {rows.length === 0 && hosted.length === 0 && <Note state="empty">This instance is in no network yet. Ask to join one below.</Note>}
      {rows.length > 0 && <ul className="fed-list">{rows.map(r => <NetworkRow key={`${r.name}:${r.hub}`} {...r} ops={ops} runner={runner} canWrite={canWrite} />)}</ul>}
      {hiddenLine && <p className="fed-line">{hiddenLine}</p>}
      {runner.outcome('networks')}
    </Section>
  )
}

function NetworkRow({ name, hub, peer, out, ops, runner, canWrite }: Shared & { name: string; hub: string; peer: Resource | undefined; out: Outgoing | undefined }) {
  const { act, busy, shown } = useAct()
  const place = `net:${name}:${hub}`
  const state = (peer?.facts.link as string | undefined) ?? (out ? 'requested' : null)
  const refused = out?.status?.state === 'refused' ? out.status : null
  const words = linkWords(state, refused)
  const mark: Mark = refused ? 'failed' : STATE_MARK[state ?? ''] ?? 'aged'
  const status = out ? opNamed(ops, 'federation.status', { id: out.id }) : undefined
  const fileWithInvite = out?.invited === true && out.sent?.transport === 'file'
  const said = !out ? null
    : !out.onTrunk ? 'Not applied yet: apply your change, then send it.'
    : out.status?.state === 'accepted' ? `Accepted${out.status.reason ? `: ${out.status.reason}` : '.'} Record it, then publish.`
    : out.status?.state === 'refused' ? null
    : out.sent ? `Sent (${out.sent.transport}) ${day(out.sent.at)}. Waiting for their answer.`
    : 'Not sent yet.'
  return (
    <li className="fed-item" aria-label={name}>
      <div className="fed-head">
        <span className="fed-t">{name}</span>
        <span className="fed-k">{peer?.name ?? hub}</span>
        <StatusMark mark={mark} label={words} />
      </div>
      {peer && <p className="fed-line">{atprotoLine(state, peer.facts.sources as Sources | undefined, peer.facts.linkReason as string | null | undefined)}</p>}
      {said && <p className="fed-line">{said}</p>}
      {fileWithInvite && <p className="fed-line">The request file holds your invite: pass it to the hub privately.</p>}
      {canWrite && out && (
        <div className="fed-acts">
          {out.status?.state === 'accepted' && state === 'requested' && (
            <Button small busy={busy ? 'Recording…' : undefined} onClick={() => void act(() => api.federationRecord(out.id), o => o.text)}>Record it</Button>
          )}
          {out.sent && status && (
            <Button small busy={runner.busyAt(place)} unavailable={status.unavailable ?? undefined}
              onClick={() => runner.start('federation.status', { id: out.id }, 'Check the answer', place)}>Check the answer</Button>
          )}
          {fileWithInvite && <a className={buttonClass({ small: true })} href={api.federationRequestFile(out.id)} download>Download the request file</a>}
          {out.onTrunk && <Button small busy={busy ? 'Withdrawing…' : undefined} onClick={() => void act(() => api.federationWithdraw(out.id), o => o.text)}>Withdraw</Button>}
          {!out.onTrunk && <Button small variant="ghost" onClick={() => void act(() => api.federationClear(out.id), () => 'Forgotten.')}>Forget it</Button>}
        </div>
      )}
      {canWrite && out && out.onTrunk && !out.sent && <SendChoices id={out.id} hub={out.hub} ops={ops} runner={runner} place={place} />}
      {shown}
      {runner.outcome(place)}
    </li>
  )
}

/** The ways to send one request: each transport the server lists, the ones that can't be used greyed with their sentence. */
function SendChoices({ id, hub, ops, runner, place }: { id: string; hub: string; ops: OperationInfo[] | undefined; runner: Runner; place: string }) {
  const ways = useQuery({ queryKey: ['federation', 'transports', hub, id], queryFn: () => api.federationTransports(hub, id) })
  if (ways.error) return <Refusal>{ways.error.message}</Refusal>
  if (!ways.data) return null
  return (
    <ul className="ops" aria-label="Ways to send">
      {ways.data.map(t => {
        const why = t.unavailable ?? opNamed(ops, 'federation.send', { id, transport: t.id })?.unavailable ?? null
        return (
          <li key={t.id} className="ops-i">
            <Button small busy={runner.busyAt(place)} unavailable={why ?? undefined}
              onClick={() => runner.start('federation.send', { id, transport: t.id }, t.label, place)}>{t.label}</Button>
            {why && <span className="ops-why">{why}</span>}
          </li>
        )
      })}
    </ul>
  )
}

// ── Published links ───────────────────────────────────────────────────────────────────────────────────────

function Published({ facts, peers, ops, runner, canWrite }: Shared & { facts: SelfFacts; peers: Resource[] }) {
  const publish = opNamed(ops, 'federation.publish-links')
  const why = publish ? publish.unavailable : null
  const label = publish?.label ?? 'Publish links'
  const start = () => runner.start('federation.publish-links', {}, label, 'publish')
  // Our records no peer accounts for come first, unnamed (their subject is a DID, never drawn); then each peer's lines,
  // named only when the peer is public. Ours are fixed by the one Publish below; theirs only by asking them.
  const lines = driftOrder([
    ...(facts.drift ?? []).map(d => ({ side: d.side, text: d.text, urgent: d.urgent, name: null as string | null })),
    ...peers.flatMap(p => ((p.facts.drift as Drift[] | undefined) ?? []).map(d => ({ side: d.side, text: d.text, urgent: d.urgent, name: p.facts.public === true ? p.name : null }))),
  ])
  const kept = keptLine(facts.kept ?? 0)
  return (
    <Section label="Published links">
      <FieldTable label="This instance on atproto">
        <FieldRow label="DID">{facts.did ? <span className="mono">{facts.did}</span> : "Set this instance's DID first."}</FieldRow>
        <FieldRow label="PDS">{facts.pds ? <span className="mono">{facts.pds}</span> : 'Not read yet: check the links.'}</FieldRow>
        <FieldRow label="To publish">{facts.publishPlan ? planCounts(facts.publishPlan) : facts.publishBlocked?.sentence ?? "Can't be worked out yet."}</FieldRow>
        <FieldRow label="Last published">{facts.published ? `${day(facts.published.at)}: ${facts.published.created} published, ${facts.published.deleted} withdrawn.` : 'Never.'}</FieldRow>
      </FieldTable>
      {kept && <p className="fed-line">{kept}</p>}
      {lines.length > 0 && (
        <ul className="fed-drift" aria-label="Drift">
          {lines.map((d, i) => {
            const fix = driftFix(d)
            return (
              <li key={i} className={d.urgent ? 'fed-urgent' : undefined}>
                <span className="fed-drift-t">{d.name ? `${d.name}: ${d.text}` : d.text}</span>
                <span className="ops-k">{'say' in fix ? fix.say : 'Publish fixes it.'}</span>
              </li>
            )
          })}
        </ul>
      )}
      {canWrite && publish && (
        <div className="fed-acts fed-foot">
          <Button primary busy={runner.busyAt('publish')} unavailable={why ?? undefined} onClick={start}>{label}</Button>
          {why ? <span className="ops-why">{why}</span> : <span className="ops-k">Shows what it will write, and writes only once you confirm.</span>}
        </div>
      )}
      {runner.outcome('publish')}
    </Section>
  )
}

// ── Bring your peers onto atproto ─────────────────────────────────────────────────────────────────────────

function Migration({ runner, canWrite }: { runner: Runner; canWrite: boolean }) {
  const read = useQuery({ queryKey: ['federation', 'migration'], queryFn: api.federationMigration })
  const [dids, setDids] = useState<Record<number, string>>({})
  const [links, setLinks] = useState<Record<number, string>>({})
  const { act, busy, shown, reset } = useAct()
  const data = read.data
  if (!data || 'problem' in data) return null
  const rows = data.rows
  if (!rows.some(r => !r.publishable)) return null
  // Only what the operator changed is sent, and only `did` and `link`: the server builds the edit (Task 12).
  const sets = rows.flatMap(r => {
    const did = (dids[r.index] ?? '').trim()
    const link = links[r.index] ?? ''
    if (did === '' && link === '') return []
    return [{ index: r.index, ...(did !== '' ? { did } : {}), ...(link !== '' ? { link } : {}) }]
  })
  const stage = () => void act(() => api.federationMigrate(sets), o => [wrote(o, 'Staged. Review it in Changes.', 'Saved.'), ...(o.notes ?? [])].join(' '))
    .then(out => { if (out) { setDids({}); setLinks({}) } })
  return (
    <Section label="Bring your peers onto atproto" count={rows.filter(r => !r.publishable).length}>
      <p className="fed-line">Give each public peer its DID and say how it is linked. This stages a change; publishing stays a separate step.</p>
      <ul className="fed-list">
        {rows.map(r => <MigrationItem key={r.index} row={r} did={dids[r.index] ?? ''} link={links[r.index] ?? ''} runner={runner} canWrite={canWrite}
          onDid={v => { reset(); setDids(s => ({ ...s, [r.index]: v })) }} onLink={v => { reset(); setLinks(s => ({ ...s, [r.index]: v })) }} />)}
      </ul>
      {canWrite && (
        <div className="fed-acts fed-foot">
          <Button primary busy={busy ? 'Staging…' : undefined} unavailable={sets.length === 0 ? 'Change a row first.' : undefined} onClick={stage}>Stage</Button>
        </div>
      )}
      {shown}
    </Section>
  )
}

function MigrationItem({ row, did, link, runner, canWrite, onDid, onLink }:
  { row: FedMigrationRow; did: string; link: string; runner: Runner; canWrite: boolean; onDid: (v: string) => void; onLink: (v: string) => void }) {
  const place = `mig:${row.index}`
  const suggested = row.didSource === 'their federation.json' ? row.did : null
  const target = did.trim() !== '' ? did.trim() : suggested
  const lookUp = () => {
    if (!target) return
    runner.start('federation.check-links', target.startsWith('did:') ? { did: target } : { handle: target }, 'Look it up', place)
  }
  const shownRelation = row.relationSource === 'link' ? row.relation ?? 'none' : row.relation
  const relation = RELATIONS.find(x => x.value === shownRelation)?.label
  return (
    <li className="fed-item" aria-label={row.name}>
      <div className="fed-head">
        <span className="fed-t">{row.name}</span>
        <StatusMark mark={row.publishable ? 'ok' : 'needs'} label={row.publishable ? 'Publishable' : row.why ?? 'Not publishable'} />
      </div>
      {row.didSource === 'federation.yaml' && row.did && <p className="fed-line">DID: <span className="mono">{row.did}</span></p>}
      {suggested && <p className="fed-line">Suggested: <span className="mono">{suggested}</span> (from their federation.json).</p>}
      {row.did && !row.didVerified && row.binding && <p className="fed-line">{row.binding}</p>}
      {relation && <p className="fed-line">Linked as: {relation}{row.relationSource === 'derived' ? ' (worked out)' : ''}.</p>}
      {canWrite && (
        <div className="fed-acts">
          <label className="fed-field-l" htmlFor={`mig-did-${row.index}`}>DID or handle</label>
          <TextInput common={{ id: `mig-did-${row.index}`, placeholder: 'did:plc:… or a handle' }} prose={false} readOnly={false}
            value={did} onChange={v => onDid(text(v))} />
          <Button small busy={runner.busyAt(place)} unavailable={target ? undefined : 'Type a DID or a handle first.'} onClick={lookUp}>Look it up</Button>
          {suggested && row.didVerified && did !== suggested && <Button small onClick={() => onDid(suggested)}>Use it</Button>}
          <label className="fed-field-l" htmlFor={`mig-link-${row.index}`}>How it is linked</label>
          <SelectInput common={{ id: `mig-link-${row.index}` }} options={RELATIONS.map(x => x.value)}
            labels={Object.fromEntries(RELATIONS.map(x => [x.value, x.label]))} value={link} onChange={v => onLink(text(v))} />
        </div>
      )}
      {runner.outcome(place)}
    </li>
  )
}

// ── Ask to join a network ─────────────────────────────────────────────────────────────────────────────────

/** An invite as pasted: the whole link, or only its token. */
const tokenOf = (v: string): string => { const m = /#invite=([^&\s]+)/.exec(v); return (m ? m[1]! : v).trim() }

function Ask({ ops, runner }: { ops: OperationInfo[] | undefined; runner: Runner }) {
  const search = useSearch()
  const qc = useQueryClient()
  const [address, setAddress] = useState('')
  const [looked, setLooked] = useState<string | null>(null)
  const [network, setNetwork] = useState('')
  const [invite, setInvite] = useState('')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [asked, setAsked] = useState<{ id: string; hub: string } | null>(null)
  const { act, busy, shown, reset } = useAct()

  // The launcher's link (Task 14) lands here: ?hub=&network= fill the form, and #invite= fills the invite and is cleared
  // from the address bar at once. Nothing runs by itself: looking the hub up stays the operator's confirmed step.
  useEffect(() => {
    const q = new URLSearchParams(search)
    const hub = q.get('hub')?.trim() ?? ''
    const net = q.get('network')?.trim() ?? ''
    const hash = window.location.hash
    const token = /^#invite=(.+)$/.exec(hash)?.[1]
    if (hash) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
    if (hub) { setAddress(hub); setLooked(hub) }
    if (net) setNetwork(net)
    if (token) { try { setInvite(decodeURIComponent(token)) } catch { setInvite(token) } }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // What the last confirmed look-up left in the cache: a read, never a fetch of the hub.
  const cached = useQuery({ queryKey: ['federation', 'hub', looked], queryFn: () => api.federationHub(looked!), enabled: looked !== null })
  const current = looked !== null && norm(looked) === norm(address)
  const hub: FedHub | null = current && cached.data && 'hub' in cached.data ? cached.data.hub : null
  const problem = current && cached.data && 'problem' in cached.data ? cached.data.problem : null
  const join = hub?.join ?? null
  // R17: no join block is closed, and `open` without its decision works as open-with-approval.
  const policy: JoinPolicy | null = !hub ? null : !join ? 'closed' : join.policy === 'open' && !join.decision ? 'open-with-approval' : join.policy
  const asks = join?.asks ?? []
  const check = opNamed(ops, 'federation.check-links')
  const why = !hub ? 'Look it up first.'
    : policy === 'closed' ? "This network isn't taking requests."
    : network.trim() === '' ? 'Say which network.'
    : asks.some(a => (answers[a] ?? '').trim() === '') ? 'Answer every question first.'
    : policy === 'invite' && tokenOf(invite) === '' ? 'Add your invite.'
    : null
  const lookUp = () => {
    const a = address.trim()
    if (!a) return
    runner.start('federation.check-links', { address: a }, 'Look it up', 'ask', () => { setLooked(a); void qc.invalidateQueries({ queryKey: ['federation', 'hub'] }) })
  }
  const ask = () => {
    if (why || !hub) return
    const hubAddress = address.trim()
    const token = tokenOf(invite)
    void act(() => api.federationAsk({ hub: hubAddress, network: network.trim(), answers: Object.fromEntries(asks.map(a => [a, (answers[a] ?? '').trim()])),
      ...(policy === 'invite' && token ? { invite: token } : {}) }), o => wrote(o, 'Staged. Apply your change, then send it.', 'Done. Send it below.'))
      .then(out => { if (out) setAsked({ id: out.id, hub: hubAddress }) })
  }
  const showInvite = policy === 'invite' || (!hub && invite !== '')
  return (
    <Section label="Ask to join a network">
      <FieldTable label="Ask to join a network">
        <FieldRow label="The hub's address" htmlFor="fed-hub" help={hub ? `${hub.name} (${hub.type}). ${policySentence(policy)}` : undefined}>
          <TextInput common={{ id: 'fed-hub', placeholder: 'https://…' }} prose={false} readOnly={false} value={address}
            onChange={v => { reset(); setAsked(null); setAddress(text(v)) }} />
          {check && <Button small busy={runner.busyAt('ask')} unavailable={address.trim() === '' ? "Type the hub's address first." : check.unavailable ?? undefined} onClick={lookUp}>Look it up</Button>}
        </FieldRow>
        <FieldRow label="The network" htmlFor="fed-network" help={hub && hub.networks.length > 0 ? `Its networks: ${hub.networks.join(', ')}.` : undefined}>
          <TextInput common={{ id: 'fed-network' }} prose={false} readOnly={false} value={network} onChange={v => setNetwork(text(v))} />
        </FieldRow>
        {showInvite && (
          <FieldRow label="Invite link" htmlFor="fed-invite">
            <TextInput common={{ id: 'fed-invite' }} prose={false} readOnly={false} value={invite} onChange={v => setInvite(text(v))} />
          </FieldRow>
        )}
        {asks.map((a, i) => (
          <FieldRow key={a} label={a} htmlFor={`fed-ask-${i}`}>
            <TextInput common={{ id: `fed-ask-${i}`, 'aria-required': true }} prose={false} readOnly={false} value={answers[a] ?? ''}
              onChange={v => setAnswers(s => ({ ...s, [a]: text(v) }))} />
          </FieldRow>
        ))}
      </FieldTable>
      {problem && <Note state="notYet">{problem}</Note>}
      <div className="fed-acts fed-foot">
        <Button primary busy={busy ? 'Asking…' : undefined} unavailable={why ?? undefined} onClick={ask}>Ask</Button>
        {why ? <span className="ops-why">{why}</span> : <span className="ops-k">Stages your side of the link. Nothing is sent yet.</span>}
      </div>
      {shown}
      {asked && <SendChoices id={asked.id} hub={asked.hub} ops={ops} runner={runner} place="ask" />}
      {runner.outcome('ask')}
    </Section>
  )
}

// ── taking requests (a hub) ───────────────────────────────────────────────────────────────────────────────

function HubSide({ facts, requests, ops, runner, canWrite }: Shared & { facts: SelfFacts; requests: Resource[] }) {
  const [taking, setTaking] = useState(false)
  if (!facts.join && !taking) {
    if (!canWrite) return null
    return (
      <Section label="Take requests">
        <p className="fed-line">This instance takes no join requests now. A hub sets a join policy to take them.</p>
        <div className="fed-acts"><Button onClick={() => setTaking(true)}>Take requests</Button></div>
      </Section>
    )
  }
  return (
    <>
      {canWrite && <JoinPolicyForm join={facts.join ?? null} />}
      {canWrite && <Invites networks={(facts.networks ?? []).filter(n => n.role === 'hub' || !n.hub).map(n => n.name)} />}
      <Requests facts={facts} requests={requests} ops={ops} runner={runner} canWrite={canWrite} />
    </>
  )
}

function JoinPolicyForm({ join }: { join: Join | null }) {
  const governance = useQuery({ queryKey: ['governance'], queryFn: api.governance })
  const [policy, setPolicy] = useState<JoinPolicy>(join?.policy ?? 'open-with-approval')
  const [decision, setDecision] = useState(join?.decision ?? '')
  const [types, setTypes] = useState((join?.types ?? []).join(', '))
  const [asks, setAsks] = useState((join?.asks ?? []).join(', '))
  const [where, setWhere] = useState(join?.where ?? '')
  const { act, busy, shown, reset } = useAct()
  const decisions = (governance.data?.decisions ?? []).filter(d => d.id)
  const stage = () => void act(() => api.federationJoin({
    policy, ...(policy === 'open' ? { decision: decision || null } : {}), types: listOf(types), asks: listOf(asks), where: where.trim() || null,
  }), o => wrote(o, 'Staged. Review it in Changes.', 'Saved.'))
  const touched = (fn: () => void) => { reset(); fn() }
  return (
    <Section label="Join policy">
      <div className="fed-form">
        <div className="fed-choices" role="radiogroup" aria-label="Who may join">
          {POLICIES.map(p => <Choice key={p.value} type="card" name="fed-policy" checked={policy === p.value} label={p.label} hint={p.hint}
            onChange={() => touched(() => setPolicy(p.value))} />)}
        </div>
        <FieldTable label="Join policy">
          {policy === 'open' && (
            <FieldRow label="The decision that agreed to it" htmlFor="fed-decision" help={decision ? undefined : OPEN_FALLBACK}>
              <SelectInput common={{ id: 'fed-decision' }} options={decisions.map(d => d.id)} labels={Object.fromEntries(decisions.map(d => [d.id, `${d.id}: ${d.title}`]))}
                value={decision} onChange={v => touched(() => setDecision(text(v)))} />
            </FieldRow>
          )}
          <FieldRow label="Who may ask" htmlFor="fed-types" help="Instance types, separated by commas. Empty means any type.">
            <TextInput common={{ id: 'fed-types' }} prose={false} readOnly={false} value={types} onChange={v => touched(() => setTypes(text(v)))} />
          </FieldRow>
          <FieldRow label="What a request has to say" htmlFor="fed-asks" help="Questions, separated by commas.">
            <TextInput common={{ id: 'fed-asks' }} prose={false} readOnly={false} value={asks} onChange={v => touched(() => setAsks(text(v)))} />
          </FieldRow>
          <FieldRow label="Where requests go" htmlFor="fed-where" help="A public https address, such as the hub's GitHub repo.">
            <TextInput common={{ id: 'fed-where', placeholder: 'https://github.com/…' }} prose={false} readOnly={false} value={where} onChange={v => touched(() => setWhere(text(v)))} />
          </FieldRow>
        </FieldTable>
        <div className="fed-acts">
          <Button primary busy={busy ? 'Staging…' : undefined} onClick={stage}>Stage</Button>
          <span className="ops-k">One change to federation.yaml, under your own rules.</span>
        </div>
      </div>
      {shown}
    </Section>
  )
}

function Invites({ networks }: { networks: string[] }) {
  const [name, setName] = useState('')
  const [type, setType] = useState('')
  const [network, setNetwork] = useState(networks[0] ?? '')
  const [days, setDays] = useState<number>(30)
  // The answer that holds the link lives here only: never in the query cache, storage or the address, so a reload loses it.
  const [made, setMade] = useState<(FedInvite & { network: string }) | null>(null)
  const { act, busy, shown, reset } = useAct()
  const why = name.trim() === '' ? 'Give their name first.' : type.trim() === '' ? 'Give their type first.' : network === '' ? 'Choose the network first.' : null
  const make = () => {
    if (why) return
    const chosen = network
    void act(() => api.federationInvite({ name: name.trim(), type: type.trim(), network: chosen, days }), () => 'Invite made.')
      .then(out => { if (out) { setMade({ ...out, network: chosen }); setName(''); setType('') } })
  }
  if (made) {
    return (
      <Section label="Invites">
        <div className="fed-form">
          <p className="fed-said">{made.text}</p>
          <code className="mono-well fed-link">{made.link}</code>
          <p className="fed-line">For the network {made.network}.</p>
          <p className="fed-line">Good through the end of {made.expires} (UTC).</p>
          {made.staged && <p className="fed-line">It works only once your change is applied.</p>}
          <div className="fed-acts">
            <Button small onClick={() => { void navigator.clipboard?.writeText(made.link).then(() => announce('Copied.'), () => undefined) }}>Copy</Button>
            <Button small variant="ghost" onClick={() => { setMade(null); reset() }}>Done</Button>
          </div>
        </div>
      </Section>
    )
  }
  return (
    <Section label="Invites">
      <div className="fed-form">
        <FieldTable label="Make an invite">
          <FieldRow label="Their name" htmlFor="fed-inv-name"><TextInput common={{ id: 'fed-inv-name' }} prose={false} readOnly={false} value={name} onChange={v => setName(text(v))} /></FieldRow>
          <FieldRow label="Their type" htmlFor="fed-inv-type"><TextInput common={{ id: 'fed-inv-type', placeholder: 'LocalNode' }} prose={false} readOnly={false} value={type} onChange={v => setType(text(v))} /></FieldRow>
          <FieldRow label="For the network" htmlFor="fed-inv-net"><SelectInput common={{ id: 'fed-inv-net' }} options={networks} value={network} onChange={v => setNetwork(text(v))} /></FieldRow>
          <FieldRow label="Good for (days)" htmlFor="fed-inv-days"><NumberInput common={{ id: 'fed-inv-days' }} value={days} onChange={v => setDays(typeof v === 'number' && v > 0 ? v : 30)} /></FieldRow>
        </FieldTable>
        <div className="fed-acts">
          <Button primary busy={busy ? 'Making…' : undefined} unavailable={why ?? undefined} onClick={make}>Make an invite</Button>
          <span className="ops-k">Its link is shown once. Only its hash is kept.</span>
        </div>
      </div>
      {shown}
    </Section>
  )
}

/** A file's text (FileReader: every browser, and jsdom, has it), as the Import sheet reads one. */
function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result ?? ''))
    r.onerror = () => reject(r.error ?? new Error('the file could not be read'))
    r.readAsText(file)
  })
}

function Requests({ facts, requests, ops, runner, canWrite }: Shared & { facts: SelfFacts; requests: Resource[] }) {
  const { act, busy, shown } = useAct()
  const poll = opNamed(ops, 'federation.poll')
  const inbox = facts.inbox ?? 0
  const sentences = (got: FedReceived[]) => (got.length === 0 ? 'Nothing was waiting.' : got.map(g => g.sentence).join(' '))
  return (
    <Section label="Requests" count={requests.length} end={<ButtonLink small variant="ghost" href="/b/federation-requests">Open the requests board</ButtonLink>}>
      {canWrite && (
        <div className="fed-acts">
          {poll && <Button small busy={runner.busyAt('requests')} unavailable={poll.unavailable ?? undefined}
            onClick={() => runner.start('federation.poll', {}, 'Check for requests', 'requests')}>Check for requests</Button>}
          {inbox > 0 && <Button small busy={busy ? 'Receiving…' : undefined} onClick={() => void act(() => api.federationReceive(), sentences)}>{`Receive them (${inbox})`}</Button>}
          <label className={`${buttonClass({ small: true })} fed-import`}>Import a request
            <input className="sr-only" type="file" accept=".yaml,.yml,.json,text/yaml,application/json" onChange={e => {
              const file = e.target.files?.[0]
              if (file) void act(async () => api.federationReceive(await readText(file)), sentences)
              e.target.value = ''
            }} />
          </label>
        </div>
      )}
      {canWrite && poll?.unavailable && <p className="fed-line">{poll.unavailable}</p>}
      {shown}
      {runner.outcome('requests')}
      {requests.length === 0
        ? <Note state="empty">No requests yet.</Note>
        : <ul className="fed-list">{requests.map(r => <RequestRow key={r.id} r={r} toReply={(facts.toReply ?? []).some(t => `federation-request:${t.id}` === r.id)} runner={runner} canWrite={canWrite} />)}</ul>}
    </Section>
  )
}

const OUTCOME_MARK: Record<string, Mark> = { held: 'needs', proposed: 'open', requested: 'open', accepted: 'ok', refused: 'closed' }
const OUTCOME_WORD: Record<string, string> = { held: 'Waiting for your decision', proposed: 'Under decision', requested: 'Not received yet', accepted: 'Accepted', refused: 'Refused' }

function RequestRow({ r, toReply, runner, canWrite }: { r: Resource; toReply: boolean; runner: Runner; canWrite: boolean }) {
  const { act, busy, shown } = useAct()
  const [reason, setReason] = useState('')
  const f = r.facts as { from?: string; network?: string; received?: string; outcome?: string; sentence?: string; answers?: Record<string, string> }
  const id = r.id.replace(/^federation-request:/, '')
  const outcome = f.outcome ?? 'requested'
  const place = `req:${id}`
  const who = f.from || r.name
  // Answers are the board's own: capped and stripped where the adapter read them (Task 10), never the raw request.
  const answers = Object.entries(f.answers ?? {})
  return (
    <li className="fed-item" aria-label={who}>
      <div className="fed-head">
        <span className="fed-t">{who}</span>
        <span className="fed-k">{[f.network, f.received].filter(Boolean).join(' · ')}</span>
        <StatusMark mark={OUTCOME_MARK[outcome] ?? 'open'} label={OUTCOME_WORD[outcome] ?? outcome} />
      </div>
      {f.sentence && <p className="fed-line">{f.sentence}</p>}
      {answers.map(([k, v]) => <p key={k} className="fed-line">{`${k}: ${v}`}</p>)}
      {canWrite && outcome === 'held' && (
        <div className="fed-acts">
          <Button small busy={busy ? 'Deciding…' : undefined} onClick={() => void act(() => api.federationDecide(id, true), o => o.sentence)}>Accept</Button>
          <TextInput common={{ id: `fed-why-${id}`, 'aria-label': 'Why you refuse', placeholder: 'Why you refuse' }} prose={false} readOnly={false}
            value={reason} onChange={v => setReason(text(v))} />
          <Button small unavailable={reason.trim() === '' ? 'Say why you refuse first.' : undefined}
            onClick={() => { if (reason.trim()) void act(() => api.federationDecide(id, false, reason.trim()), o => o.sentence) }}>Refuse</Button>
        </div>
      )}
      {canWrite && toReply && (
        <div className="fed-acts">
          <Button small busy={runner.busyAt(place)} onClick={() => runner.start('federation.reply', { id }, 'Tell them the outcome', place)}>Tell them the outcome</Button>
        </div>
      )}
      {shown}
      {runner.outcome(place)}
    </li>
  )
}
