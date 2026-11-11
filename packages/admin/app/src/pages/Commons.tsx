import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'wouter'
import { api, type CanonRow, type KnowledgeView, type RunRow } from '../api.ts'
import { PageHead } from '../design/PageHead.tsx'
import { Seg } from '../design/Seg.tsx'
import { Note } from '../design/Note.tsx'
import { Section } from '../design/Section.tsx'
import { Icon } from '../design/Icon.tsx'
import { ButtonLink } from '../design/Button.tsx'
import { StatusMark } from '../design/StatusMark.tsx'
import { Rows, type Column } from '../design/Rows.tsx'
import { DataList } from '../elements/rows/DataList.tsx'
import { DataRow } from '../elements/rows/DataRow.tsx'
import { GatePlate } from '../elements/knowledge/GatePlate.tsx'
import { CanonDataRow, Standline } from '../elements/knowledge/Standline.tsx'
import { kindGlyph, LANE_MARK } from '../elements/knowledge/marks.ts'
import { Publishing } from '../elements/knowledge/PreparedPublication.tsx'
import { announce } from '../parts/live.tsx'
import { useCanWrite, useViewer } from '../viewAs/ViewAs.tsx'
import type { PublishPlan } from '../api.ts'

type View = 'standline' | 'table' | 'list'

/** The row's address: L6's record route, with the id's two segments (spec §2, K-2). */
export const entryHref = (row: { type: string; slug: string }): string => `/c/knowledge/${encodeURIComponent(row.type)}/${encodeURIComponent(row.slug)}`

/** How a run starts: the plan's own nonce is the confirmation (the house's rule for anything that writes and reaches
 *  the network), so the page asks once, names the command, and runs exactly what was shown. */
function useRun() {
  const qc = useQueryClient()
  const [pending, setPending] = useState<{ plan: PublishPlan; nonce: string; cmd: string } | null>(null)
  const [running, setRunning] = useState(false)
  const [said, setSaid] = useState<string | null>(null)
  const ask = async (plan: PublishPlan) => {
    setSaid(null)
    try {
      const reply = await api.plan('knowledge.publish', 'knowledge:commons', {})
      setPending({ plan, nonce: reply.nonce ?? '', cmd: [reply.cmd, ...(reply.args ?? [])].filter(Boolean).join(' ') })
    } catch (err) { setSaid((err as Error).message) }
  }
  const run = async () => {
    if (!pending) return
    setRunning(true)
    try {
      const job = await api.runJob({ nonce: pending.nonce })
      announce('Publishing…')
      // The job runs in the app's own executor; read it to its end, then read the commons again.
      for (let i = 0; i < 60; i++) {
        const now = await api.job(job.id)
        if (['ok', 'failed', 'timed-out', 'cancelled', 'finished-with-surprises', 'interrupted'].includes(now.job.status)) {
          setSaid(now.job.sentence ?? now.job.status)
          break
        }
        await new Promise(r => setTimeout(r, 1000))
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['knowledge'] }),
        qc.invalidateQueries({ queryKey: ['knowledge', 'plan'] }),
      ])
    } catch (err) { setSaid((err as Error).message) } finally { setRunning(false); setPending(null) }
  }
  return { ask, run, pending, running, said, cancel: () => setPending(null) }
}

/** The commons (spec §4.1): the canon as a collection — the gate plate over it, the standline in it, and the things a
 *  steward checks between edits under it: publishing, the peers and the runs. Members read it, so it says no kms term,
 *  file or command (walk W7, D3): the canon's files, the command and what decides in kms's terms are the setup page's.
 *
 *  View as (§5.9, K-7): previewing as Public means the gate's selection — the Published lane alone, counted as the public
 *  counts it, with no plate (its counts name what the public may not see), no publishing, no peers, runs or files; any
 *  preview draws no action (`useCanWrite`). */
export default function Commons() {
  const view = useQuery({ queryKey: ['knowledge'], queryFn: api.knowledge })
  const run = useRun()
  const [mode, setMode] = useState<View>('standline')
  const [kind, setKind] = useState<string | null>(null)
  const { viewer } = useViewer()
  const canWrite = useCanWrite()
  const asPublic = viewer.as === 'public'
  const data = view.data
  // What this viewer may see: everything, or — as Public — the selection only.
  const lanes: KnowledgeView['lanes'] = useMemo(() => (data?.lanes ?? []).filter(l => !asPublic || l.id === 'published'), [data, asPublic])
  const rows = useMemo(() => lanes.flatMap(l => l.rows), [lanes])
  const kinds = useMemo(() => (data?.kinds ?? [])
    .map(k => ({ ...k, count: rows.filter(r => r.type === k.schema).length }))
    .filter(k => k.count > 0), [data, rows])
  const shown = useMemo(() => (kind ? rows.filter(r => r.type === kind) : rows), [rows, kind])
  const shownLanes: KnowledgeView['lanes'] = useMemo(() => (kind
    ? lanes.map(l => ({ ...l, count: l.rows.filter(r => r.type === kind).length, rows: l.rows.filter(r => r.type === kind) }))
    : lanes), [lanes, kind])

  if (view.isPending) return <div className="knowledge-page"><Note state="loading">Reading the commons…</Note></div>
  if (view.error) return <div className="knowledge-page"><Note state="error">Couldn’t read the commons: {(view.error as Error).message}</Note></div>
  const v = data!

  // Not a kms instance: one sentence, and the way to set one up (spec §4.4's empty state).
  if (!v.configured) {
    return (
      <div className="knowledge-page">
        <PageHead title="Knowledge commons" meta={['not set up here']} />
        <div className="note-block">
          <b>The knowledge commons is not set up here.</b>
          <Note state="empty">{v.reason ?? 'This instance has no knowledge commons yet.'}</Note>
          {canWrite && <ButtonLink primary href="/c/knowledge/setup">Set up the commons</ButtonLink>}
        </div>
      </div>
    )
  }

  const entries = asPublic ? rows.length : v.counts.entries
  return (
    <div className="knowledge-page">
      <PageHead
        title={v.instance ?? 'Knowledge commons'}
        meta={[
          'knowledge commons',
          `${entries} ${entries === 1 ? 'entry' : 'entries'}`,
          `${kinds.length} ${kinds.length === 1 ? 'kind' : 'kinds'}`,
          ...(asPublic ? [] : [
            `${v.counts.sources} ${v.counts.sources === 1 ? 'source' : 'sources'}`,
            `${v.counts.peers} ${v.counts.peers === 1 ? 'peer' : 'peers'}`,
          ]),
        ]}
      >
        {canWrite && <ButtonLink variant="ghost" href="/c/knowledge/setup">Set up the commons</ButtonLink>}
      </PageHead>
      {v.sentence && <p className="meta">{v.sentence}</p>}

      {!asPublic && <GatePlate view={v} />}

      <Section label={asPublic ? 'In the commons' : 'Every entry, by lane'} count={entries}
        end={<Seg label="View" value={mode} onChange={setMode}
          options={[{ value: 'standline', label: 'Standline' }, { value: 'table', label: 'Table' }, { value: 'list', label: 'List' }]}
          icons={{ standline: 'board', table: 'table', list: 'list' }} />}>
        <div className="kn-row kind-chips">
          <span className="seg" role="group" aria-label="Kind">
            <button type="button" aria-pressed={kind === null} onClick={() => setKind(null)}>All {rows.length}</button>
            {kinds.map(k => (
              <button key={k.schema} type="button" aria-pressed={kind === k.schema} onClick={() => setKind(k.schema)}>
                <Icon name={kindGlyph(k.schema)} size="xs" />{k.label} {k.count}
              </button>
            ))}
          </span>
        </div>
        {entries === 0
          ? <div className="note-block"><b>{asPublic ? 'Nothing is in the commons yet.' : 'The commons holds no entries yet.'}</b><Note state="empty">A publishing run makes an entry public once its public use allows it.</Note></div>
          : mode === 'standline'
            ? <Standline view={{ ...v, lanes: shownLanes }} hrefOf={entryHref} />
            : mode === 'table'
              ? <Table rows={shown} />
              : <List rows={shown} />}
      </Section>

      {!asPublic && (
        <>
          <Section label="Publishing">
            <Publishing onRun={canWrite ? run.ask : undefined} detail={false} />
            {run.pending && canWrite && (
              <div className="note-block run-confirm">
                <b>Run this now?</b>
                <Note state="empty">It writes the public pages and the manifest; no commit is made for you. The command it runs is on the setup page.</Note>
                <span className="kn-row">
                  <button className="btn primary" type="button" onClick={run.run} disabled={run.running}>{run.running ? 'Running…' : 'Confirm — run it'}</button>
                  <button className="btn" type="button" onClick={run.cancel} disabled={run.running}>Cancel</button>
                </span>
              </div>
            )}
            {run.said && <Note state="notYet">{run.said}</Note>}
          </Section>

          <Section label="Peers" count={v.peers.length}>
            {v.peers.length === 0
              ? <Note state="empty">No peers, and no connector: nothing is read into this commons from elsewhere.</Note>
              : (
                <DataList label="Peers">
                  {v.peers.map(p => (
                    <DataRow key={p.id} kind="peer" icon={p.state === 'failed' ? 'alert' : 'book'} title={p.name}
                      tone={p.state === 'failed' ? 'attn' : 'plain'}
                      second={<><span>{p.relation}</span><span className="mono">{p.detail}</span></>}
                      trailing={<StatusMark mark={p.state === 'failed' ? 'failed' : p.state === 'aged' ? 'aged' : p.state === 'never' ? 'open' : 'ok'}
                        label={p.state === 'failed' ? `couldn’t read · last good read ${p.ageDays ?? '—'} d ago`
                          : p.state === 'aged' ? `read ${p.ageDays} d ago` : p.state === 'never' ? 'never read' : `read ${p.ageDays ?? 0} d ago`} />}
                      marks={[]} />
                  ))}
                </DataList>
              )}
          </Section>

          <Section label="Runs" count={v.runs.length} end={canWrite ? <ButtonLink small variant="ghost" href="/c/knowledge/setup">See the dry read</ButtonLink> : undefined}>
            {v.runs.length === 0
              ? <Note state="empty">No run has touched the commons yet.</Note>
              : <DataList label="Runs">{v.runs.map(r => <Run key={r.id} run={r} />)}</DataList>}
          </Section>

        </>
      )}
    </div>
  )
}

/** One run, as a house data row, with the house's own sentence and what it changed (spec §4.5). */
function Run({ run }: { run: RunRow }) {
  const done = run.status === 'ok'
  const failed = ['failed', 'timed-out', 'finished-with-surprises', 'interrupted'].includes(run.status)
  return (
    <DataRow kind="run" icon={failed ? 'alert' : 'arrow-right'} title={run.label} tone={failed ? 'attn' : 'plain'}
      second={<><span>{run.sentence}</span>{run.changed.length > 0 && <span className="faint">{run.changed.length === 1 ? '1 place changed' : `${run.changed.length} places changed`}</span>}</>}
      trailing={<StatusMark mark={done ? 'done' : failed ? 'failed' : 'open'} label={run.status} />}
      marks={[]} />
  )
}

/** The same rows as the house's table (L4 §10.2): Title · Kind · Lane · Maturity · Public use · Updated. */
const COLUMNS: Column<CanonRow>[] = [
  { key: 'title', label: 'Title', cell: r => <Link href={entryHref(r)}>{r.title}</Link>, sort: r => r.title },
  { key: 'kind', label: 'Kind', cell: r => r.type, sort: r => r.type },
  { key: 'lane', label: 'Lane', cell: r => LANE_MARK[r.lane].word, sort: r => r.lane },
  { key: 'maturity', label: 'Maturity', cell: r => r.maturity ?? '—', sort: r => r.maturity ?? '' },
  { key: 'public', label: 'Public use', cell: r => r.publicUse ?? '—', sort: r => r.publicUse ?? '' },
  { key: 'updated', label: 'Updated', cell: r => r.updated ?? '—', sort: r => r.updated ?? '', mono: true, right: true },
]
function Table({ rows }: { rows: CanonRow[] }) {
  return <Rows label="Every entry" rows={rows} columns={COLUMNS} rowKey={r => r.id} />
}

/** The same rows as the house's data rows (L4 §9.2). */
function List({ rows }: { rows: CanonRow[] }) {
  return <DataList label="Every entry">{rows.map(r => <CanonDataRow key={r.id} row={r} href={entryHref(r)} />)}</DataList>
}
