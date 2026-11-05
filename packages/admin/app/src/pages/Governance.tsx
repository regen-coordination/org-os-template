import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { stringify } from 'yaml'
import { api, type DecisionRow } from '../api.ts'
import { PageHead } from '../design/PageHead.tsx'
import { Section } from '../design/Section.tsx'
import { Empty, EmptyWhen } from '../design/Empty.tsx'
import { Button } from '../design/Button.tsx'
import { Tabs } from '../design/Tabs.tsx'
import { FieldRow, FieldTable } from '../design/FieldRow.tsx'
import { Note } from '../design/Note.tsx'
import { StatusMark, type Mark as MarkName } from '../design/StatusMark.tsx'
import { DataList } from '../elements/rows/DataList.tsx'
import { DataRow } from '../elements/rows/DataRow.tsx'
import { ProposalRow } from '../elements/governance/ProposalRow.tsx'
import { shownFor } from '../elements/governance/seen.ts'
import { useActor } from '../actor.ts'
import { useNow } from '../time.ts'
import { useCanWrite, useViewer } from '../viewAs/ViewAs.tsx'
import { useSyncShare } from './syncShare.tsx'
import { GeneratedBehind } from '../parts/SyncParts.tsx'
import { Skeleton } from '../design/Skeleton.tsx'
import { NO_MODEL } from '../../../lib/governance-read.mjs'

/** "applies to everything · a maintainer proposes · the maintainer decides alone" → its three columns. */
export function ruleCells(sentence: string): [string, string, string] | null {
  const parts = sentence.split(' · ')
  if (parts.length !== 3) return null
  return [parts[0]!.replace(/^applies to /, ''), parts[1]!, parts[2]!]
}

export type GovernancePart = 'proposals' | 'decisions' | 'rules'
/** The three URLs are the three tabs (§14.1, L4-R10): Open, Decided, Rules. */
const TABS: { id: GovernancePart; label: string; href: string }[] = [
  { id: 'proposals', label: 'Open', href: '/governance/proposals' },
  { id: 'decisions', label: 'Decided', href: '/governance/decisions' },
  { id: 'rules', label: 'Rules', href: '/governance/rules' },
]

/** A decision's outcome as a mark (§6.1): F1's group read as the house's marks — ratified is done, open is open, the
 *  three ways a proposal ends without a decision are closed — with the status word as written. A word F1's table does
 *  not hold is shown as written, with no mark. */
const OUTCOME: Record<string, MarkName> = { ratified: 'done', open: 'open', rejected: 'closed', expired: 'closed', withdrawn: 'closed' }
function Outcome({ d }: { d: DecisionRow }) {
  const mark = d.group ? OUTCOME[d.group] : undefined
  const word = d.group && d.group !== d.status.toLowerCase() ? `${d.status} · ${d.group}` : d.status
  return mark ? <StatusMark mark={mark} label={word} /> : <span className="dec-word">{word}</span>
}

function DecisionText({ d }: { d: DecisionRow }) {
  const q = useQuery({ queryKey: ['decision', d.anchor], queryFn: () => api.decision(d.anchor!) })
  return (
    <section className="dec-text" aria-label={`${d.id || 'Decision'}: ${d.title}`}>
      {q.error ? <Note state="error">{q.error.message}</Note>
        : !q.data ? <Note state="loading">Loading the decision…</Note>
          : <pre className="gov-well">{q.data.markdown}</pre>}
    </section>
  )
}

/** Proposals (§14.1): Open · Decided · Rules, the three URLs as tabs with their counts. Open is the open proposals as
 *  proposal rows — the one that waits on you in the attention style, your own approval in moss; Decided is the ledger of
 *  decisions as data rows (the id in Mono, the title, where it is recorded, the outcome mark), then the proposals that
 *  closed; Rules are the rules in force as field rows (what a rule applies to → its sentence) and `governance.yaml` in a
 *  Mono well. The foot line under the head says what the last fetch says, with Sync and Share. Read only. A proposal
 *  the viewer may not see is absent and not counted (E-50). */
export default function Governance({ part }: { part: string }) {
  const g = useQuery({ queryKey: ['governance'], queryFn: api.governance })
  const proposals = useQuery({ queryKey: ['proposals'], queryFn: api.proposals })
  const { viewer, sees } = useViewer()
  // only a preview judges the records a proposal's ops touch (E-50): you are shown what the server gave you
  const resources = useQuery({ queryKey: ['resources'], queryFn: api.resources, enabled: viewer.as !== 'you' })
  const canWrite = useCanWrite()
  const { actor } = useActor()
  const now = useNow(false)
  const [source, setSource] = useState(false)
  const doc = useQuery({ queryKey: ['registry', 'governance'], queryFn: () => api.registry('governance'), enabled: source, retry: false })
  const [open, setOpen] = useState<string | null>(null)
  const sync = useSyncShare()
  const generated = useQuery({ queryKey: ['generated'], queryFn: api.generated, retry: false, staleTime: 30_000, refetchOnWindowFocus: false })
  const tab = TABS.find(t => t.id === part)?.id ?? 'proposals'
  const me = actor && 'id' in actor ? actor.id : null
  const shown = (proposals.data ?? []).flatMap(p => { const v = shownFor(p, resources.data, viewer, sees); return v ? [v] : [] })
  const openOnes = shown.filter(p => p.state === 'open')
  const closedOnes = shown.filter(p => p.state !== 'open')
  const counted = proposals.data !== undefined
  const v = g.data
  // Previewed as Public, the page shows what the door would, failing closed (L4-R13, R-L5-13.3): never the problems,
  // DECISIONS.md's rows or governance.yaml's decisions, nor the source well; the model, the description and the rules
  // only when the governance document itself is a record Public sees (none is listed, so none is shown).
  const asPublic = viewer.as === 'public'
  const docShown = !asPublic || (resources.data?.some(r => r.source?.registry === 'governance' && sees(r)) ?? false)
  const decisions = v && !asPublic ? [...v.decisions].sort((a, b) => b.date.localeCompare(a.date)) : []
  const rules = v && docShown ? v.rules : []
  // The tabs are the section's navigation: drawn while governance is read, or cannot be, each count once it is known.
  // Decided counts what it lists: the decisions and the closed proposals (review M-2).
  const tabs = TABS.map(t => ({ ...t,
    count: t.id === 'proposals' ? (counted ? openOnes.length : undefined)
      : v === undefined ? undefined
        : t.id === 'decisions' ? (counted ? decisions.length + closedOnes.length : undefined)
          : docShown ? rules.length : undefined }))
  const head = (meta: string[] = []) => (
    <>
      <PageHead title="Proposals" meta={meta} />
      {canWrite && sync.head}
    </>
  )
  const shownDecision = decisions.find(d => d.anchor !== undefined && d.anchor === open)

  // One shape in every state, so the tab bar is not drawn anew (and a focused tab not lost) when governance arrives.
  return (
    <>
      {head(v && docShown ? [`model: ${v.model ?? 'none set'}`, 'data/governance.yaml'] : [])}
      {v && canWrite && sync.panel}
      {v && !asPublic && generated.data?.behind && <GeneratedBehind />}
      {/* a fault of the file is a house error note, worded by the server with its subject (walk 2026-11-04); NO_MODEL
          is the solo default, not a fault: a quiet line in its own words (review I-2) */}
      {!asPublic && v?.problems.map((p, i) => (p === NO_MODEL
        ? <p key={i} className="board-note">{p}</p>
        : <Note key={i} state="error">{p}</Note>))}
      {docShown && v?.description && <p className="lede">{v.description}</p>}
      <Tabs label="Proposals" tabs={tabs} value={tab} onChange={() => {}} />
      {g.error ? <Note state="error">{g.error.message}</Note> : !v ? <Skeleton rows={4} shape="row" label={TABS.find(t => t.id === tab)!.label} /> : (
      <div className="gov-panel" role="tabpanel" aria-label={TABS.find(t => t.id === tab)!.label} id={`gov-${tab}`}>
        {tab === 'proposals' && (
          <Section label="Proposals">
            {proposals.error ? <Note state="error">{proposals.error.message}</Note>
              : !counted ? <DataList label="Open proposals" loading={2}>{null}</DataList>
                : openOnes.length === 0
                  ? <Empty>None open. Under the rule in force every change applies directly; a proposal opens when a rule asks for someone else's say.</Empty>
                  : <DataList label="Open proposals">{openOnes.map(p => <ProposalRow key={String(p.id)} view={p} now={now} actor={me} />)}</DataList>}
          </Section>
        )}

        {tab === 'decisions' && (
          <>
            <Section label="Decisions" note="newest first">
              {asPublic ? <Empty>Previewing as Public, no decision is shown.</Empty>
                : decisions.length === 0 ? <EmptyWhen query={g}>No decisions recorded yet.</EmptyWhen> : (
                <DataList label="Decisions">
                  {decisions.map((d, i) => (
                    <DataRow key={d.anchor ?? `${d.where}:${i}`} kind="decision" title={d.title} marks={[]}
                      second={<>{d.id && <span className="prow-id">{d.id}</span>}<span className="prow-route">{d.where}</span>{d.date && <span>{d.date}</span>}</>}
                      trailing={<>
                        <Outcome d={d} />
                        {d.anchor && <Button small variant="ghost" expanded={open === d.anchor} label={`Read ${d.title}`}
                          onClick={() => setOpen(open === d.anchor ? null : d.anchor!)}>{open === d.anchor ? 'Hide' : 'Read'}</Button>}
                      </>} />
                  ))}
                </DataList>
              )}
              {shownDecision && <DecisionText key={shownDecision.anchor} d={shownDecision} />}
            </Section>
            <Section label="Closed proposals">
              {proposals.error ? <Note state="error">{proposals.error.message}</Note>
                : !counted ? <DataList label="Closed proposals" loading={2}>{null}</DataList>
                  : closedOnes.length === 0 ? <Empty>None closed yet.</Empty>
                    : <DataList label="Closed proposals">{closedOnes.map(p => <ProposalRow key={String(p.id)} view={p} now={now} actor={me} />)}</DataList>}
            </Section>
          </>
        )}

        {tab === 'rules' && (
          <Section label="Rules" note={docShown ? `${rules.length} in force` : undefined}>
            {!docShown ? <Empty>Previewing as Public, the rules in force are not shown.</Empty>
              : rules.length === 0 ? <EmptyWhen query={g}>No rules are in force, and none can be implied from the model.</EmptyWhen> : (
              <FieldTable label="Rules in force">
                {rules.map((r, i) => {
                  const cells = ruleCells(r.sentence)
                  return (
                    <FieldRow key={i} label={cells ? cells[0] : `Rule ${i + 1}`}>
                      <span className="rule-s">{cells ? `${cells[1]} · ${cells[2]}` : r.sentence}</span>
                      <span className="rule-src">{r.source}</span>
                    </FieldRow>
                  )
                })}
              </FieldTable>
            )}
            {!asPublic && <p className="gov-src">
              <Button expanded={source} onClick={() => setSource(s => !s)}>{source ? 'Hide governance.yaml' : 'Show governance.yaml'}</Button>
            </p>}
            {!asPublic && source && (doc.error ? <Note state="error">{doc.error.message}</Note>
              : <pre className="gov-well" aria-label="governance.yaml">{doc.data ? stringify(doc.data.document ?? {}) : 'Loading…'}</pre>)}
          </Section>
        )}
      </div>)}
    </>
  )
}
