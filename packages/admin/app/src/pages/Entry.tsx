import { useMemo, useState, type MouseEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, type CheckRow, type EntryView, type RefRow } from '../api.ts'
import { Seg } from '../design/Seg.tsx'
import { Note } from '../design/Note.tsx'
import { Section } from '../design/Section.tsx'
import { Icon } from '../design/Icon.tsx'
import { KindTile } from '../design/KindTile.tsx'
import { StatusMark } from '../design/StatusMark.tsx'
import { FieldRow, FieldTable } from '../design/FieldRow.tsx'
import { RecordHeader } from '../elements/records/RecordHeader.tsx'
import { DataList } from '../elements/rows/DataList.tsx'
import { DataRow } from '../elements/rows/DataRow.tsx'
import { announce } from '../parts/live.tsx'
import { usePanel } from '../parts/panels.tsx'
import { suggestTitle } from '../changes/ProposePanel.tsx'
import { useChanges } from '../changes/useChanges.ts'
import { useActor } from '../actor.ts'
import { useCanWrite, useViewer } from '../viewAs/ViewAs.tsx'
import { glyphIcon, kindGlyph, LANE_MARK, markOf } from '../elements/knowledge/marks.ts'

type Face = 'record' | 'public'

/** One entry (spec §4.2), on the house's elements: the record header (§9.1), field rows (§9.3) for the fields, the
 *  checks, the provenance and the paths a publication writes, and data rows (§9.2) for the references — all on the
 *  Record face; and one control away, the Public face: the object the commons shows.
 *
 *  Each field edit is staged in the member's change as the entry's record op (the walk's I10, review G7; L6 Task 10):
 *  a second field joins the first, a reload keeps both, and what reads "Staged" is drawn from the tray, never from this
 *  page's own state. The page's card shows the entry's op; while it is the change's only op the card offers the tray's
 *  own Apply (when the house's rules let this person apply it alone) or Propose (the house's Propose panel), and
 *  Discard takes the entry's op out. Beside other staged edits, the change is applied or proposed whole from the tray.
 *
 *  View as (§5.9): previewing as Public draws the Public face only — an entry the commons does not show has none, just
 *  the reason (K-7); any preview draws no write action (`useCanWrite`). */
export default function Entry({ type, slug }: { type: string; slug: string }) {
  const qc = useQueryClient()
  const entry = useQuery({ queryKey: ['knowledge', 'entry', type, slug], queryFn: () => api.knowledgeEntry(type, slug) })
  const [chosen, setFace] = useState<Face>('record')
  const ch = useChanges()
  const [applying, setApplying] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const right = usePanel('right')
  const { known } = useActor()
  const { viewer } = useViewer()
  const canWrite = useCanWrite()
  const asPublic = viewer.as === 'public'
  const face: Face = asPublic ? 'public' : chosen
  const editable = known && canWrite

  if (entry.isPending) return <div className="knowledge-page"><Note state="loading">Reading the entry…</Note></div>
  if (entry.error) return <div className="knowledge-page"><Note state="error">Couldn’t read this entry: {(entry.error as Error).message}</Note></div>
  const e = entry.data!
  // The entry's op in the member's change (G7): what reads "Staged", drawn from the tray.
  const record = `knowledge:${type}/${slug}`
  const view = ch.view
  const at = view ? view.ops.findIndex(o => o.op !== 'file' && o.record === record) : -1
  const op = at >= 0 ? view!.ops[at]! : null
  const changes = op && op.op === 'update'
    ? Object.entries(op.set).map(([field, after]) => ({ field, before: op.before?.[field] ?? null, after }))
    : []
  const alone = view !== null && op !== null && view.ops.length === 1 && !(view.private?.length)
  const stale = view !== null && at >= 0 && view.stale.includes(at)
  const said = (err: unknown) => (err instanceof ApiError && err.errors.length > 0 ? err.errors.map(x => x.message).join(' ') : (err as Error).message)

  // A field edit: staged at once, as the entry's record op (the tray folds a second field into the first).
  const stageField = async (fields: Record<string, unknown>) => {
    setRefusal(null)
    try {
      await ch.stage([{ op: 'update', record, set: fields }])
      announce(`Staged ${Object.keys(fields).join(', ')}. Nothing is written until your change is applied or proposed.`)
    } catch (err) {
      setRefusal(said(err))
    }
  }

  const act = async (fn: () => Promise<void>) => {
    setApplying(true)
    setRefusal(null)
    try { await fn() } catch (err) { setRefusal(said(err)) } finally { setApplying(false) }
  }
  // The tray's own Apply, while the entry's op is the change's only op.
  const apply = () => act(async () => {
    const done = await ch.apply()
    announce(`Applied as commit ${done.commit.slice(0, 7)}.`)
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['knowledge', 'entry', type, slug] }),
      qc.invalidateQueries({ queryKey: ['knowledge'] }),
    ])
  })
  const discard = () => act(async () => { if (at >= 0) await ch.unstage(at) })
  // Propose (Task 10): the house's Propose panel over the tray's change.
  const propose = (ev: MouseEvent<HTMLButtonElement>) => {
    // L6 carries K10: the proposal's title starts from the entry's title.
    suggestTitle(qc, record, `Update ${e.row.title}`)
    right.open('propose', ev.currentTarget)
  }

  const row = e.row
  const lane = LANE_MARK[row.lane]
  // The public preview reads the public face's title; an entry the commons does not show is named, never described.
  return (
    <div className="knowledge-page">
      <RecordHeader
        variant="record" kind={row.type} id={row.id} title={asPublic ? e.publicFace.title : row.title}
        state={asPublic ? undefined : lane.mark} stateWord={asPublic ? undefined : lane.word}
        visibility={row.lane === 'published' ? { level: 'public' } : { level: 'members' }}
        meta={asPublic ? [] : [
          `${row.type} · entry`,
          ...(row.mark ? [<StatusMark key="m" mark={markOf(row.mark.shape)} label={row.mark.word} />] : []),
          row.why,
          ...(row.updated ? [`updated ${row.updated}`] : []),
          ...(row.peer ? [`from ${row.peer}`] : []),
        ]}
      />
      {!asPublic && (
        <div className="entry-faces">
          <Seg<Face> label="Face" value={face} onChange={setFace}
            options={[{ value: 'record', label: 'Record' }, { value: 'public', label: 'Public face' }]} />
        </div>
      )}

      {face === 'public'
        ? <PublicFace face={e.publicFace} />
        : (
          <div className="entry-cols">
            <div className="stack">
              <Section label="Fields">
                <FieldRows entry={e} editable={editable} staged={changes} onStage={stageField} />
              </Section>
              <Section label="The entry">
                {e.body.length === 0
                  ? <Note state="empty">This entry has no body fields in the projection's order.</Note>
                  : e.body.map(b => (
                    <div key={b.field} className="prose face-block">
                      <h3>{b.label}</h3>
                      <p>{b.text}</p>
                    </div>
                  ))}
              </Section>
              {changes.length > 0 && editable && view && (
                <Section label="Your change" count={changes.length}>
                  <div className="pbrand">
                    <div className="op">
                      <KindTile kind={row.type} icon={kindGlyph(row.type)} />
                      <div>
                        <div className="t">{row.title}</div>
                        {changes.map(c => (
                          <div className="chg" key={c.field}>
                            <span className="k">{c.field}</span>
                            <span className="was"><span className="sr-only">was </span><s>{String(c.before ?? '—')}</s></span>
                            <Icon name="arrow-right" size="xs" />
                            <span className="new">{String(c.after ?? '—')}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="kn-row">
                      <span className="faint">
                        {alone
                          ? <>
                            {view.classes.includes('publication') && 'This edit makes the entry publishable: the publication rule decides it. '}
                            {stale ? 'This entry changed on the trunk since: choose what stands in your change.' : view.rule.sentence}
                          </>
                          : 'Staged in your change beside other edits: apply or propose the change whole from the tray.'}
                      </span>
                      <span className="kn-row">
                        <button className="btn" type="button" onClick={() => void discard()} disabled={applying}>Discard</button>
                        {alone && !stale && view.rule.direct && (
                          <button className="btn primary" type="button" onClick={() => void apply()} disabled={applying}>{applying ? 'Applying…' : 'Apply'}</button>
                        )}
                        {alone && !stale && !view.rule.direct && view.rule.proposable === true && (
                          <button className="btn primary" type="button" onClick={ev => propose(ev)} disabled={applying}>Propose</button>
                        )}
                      </span>
                    </div>
                  </div>
                </Section>
              )}
              {refusal && <Note state="error">{refusal}</Note>}
            </div>

            <aside className="entry-aside">
              <Section label="Checks" count={e.checks.length}>
                <FieldTable label="Checks">
                  {e.checks.map(c => <Check key={c.field} row={c} />)}
                </FieldTable>
              </Section>
              <Section label="References" count={e.references.length}>
                {e.references.length === 0
                  ? <Note state="empty">This entry refers to nothing.</Note>
                  : (
                    <DataList label="References">
                      {e.references.map(r => <Reference key={`${r.slug}-${r.broken}`} row={r} />)}
                    </DataList>
                  )}
              </Section>
              <Section label="Provenance">
                <FieldTable label="Provenance">
                  {e.provenance.length === 0
                    ? <FieldRow label="—"><span className="faint">nothing recorded</span></FieldRow>
                    : e.provenance.map(p => (
                      <FieldRow key={p.field} label={p.field}>
                        <span className={p.published ? undefined : 'faint'}>{p.value ?? '—'}</span>
                        {!p.published && <> <span className="meta">not published</span></>}
                      </FieldRow>
                    ))}
                </FieldTable>
              </Section>
              <Section label="Where it goes">
                <FieldTable label="Where it goes">
                  {e.goes.map(g => <FieldRow key={g.label} label={g.label}><span className="mono">{g.value}</span></FieldRow>)}
                </FieldTable>
              </Section>
            </aside>
          </div>
        )}
    </div>
  )
}

/** One field the entry's op in the tray sets: its value before and the staged one. */
interface StagedField { field: string; before: unknown; after: unknown }

/** The entry's fields as the house's field rows (§9.3): Enter or blur stages the field; Escape closes without it. A
 *  staged field (the tray's) is the house's staged row — the moss bar, the old value struck, the staged mark. */
function FieldRows({ entry, editable, staged: rows, onStage }: { entry: EntryView; editable: boolean; staged: StagedField[]; onStage: (fields: Record<string, unknown>) => void }) {
  const [open, setOpen] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const staged = useMemo(() => new Map(rows.map(c => [c.field, c])), [rows])
  const onPrepare = onStage
  return (
    <FieldTable label="Fields">
      {entry.fields.map(f => {
        const change = staged.get(f.field)
        const id = `kf-${f.field}`
        const long = f.value.length > 70
        if (open === f.field) {
          const done = (value: string) => { if (value !== f.value) onPrepare({ [f.field]: value }); setOpen(null) }
          return (
            <FieldRow key={f.field} label={f.label} htmlFor={id}>
              {long
                ? <textarea id={id} className="input" aria-label={f.label} autoFocus defaultValue={draft} rows={3}
                    onKeyDown={ev => { if (ev.key === 'Escape') setOpen(null); if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { onPrepare({ [f.field]: ev.currentTarget.value }); setOpen(null) } }}
                    onBlur={ev => done(ev.target.value)} />
                : <input id={id} className="input" aria-label={f.label} autoFocus defaultValue={draft}
                    onKeyDown={ev => { if (ev.key === 'Escape') setOpen(null); if (ev.key === 'Enter') { onPrepare({ [f.field]: ev.currentTarget.value }); setOpen(null) } }}
                    onBlur={ev => done(ev.target.value)} />}
            </FieldRow>
          )
        }
        return (
          <FieldRow key={f.field} label={f.label} staged={change !== undefined} was={change ? String(change.before ?? '—') : undefined}>
            <span className={f.field === 'public_use' || f.field === 'maturity' ? 'mono' : undefined}>{change ? String(change.after ?? '—') : f.value}</span>
            {editable && !change && (
              <button className="btn ghost sm" type="button" onClick={() => { setDraft(f.value); setOpen(f.field) }} aria-label={`Edit ${f.label}`}>
                <Icon name="pencil" size="xs" />
              </button>
            )}
          </FieldRow>
        )
      })}
    </FieldTable>
  )
}

/** N5 · A check: a field row whose value is the house's mark in its own word, then the value and the fix. */
function Check({ row }: { row: CheckRow }) {
  return (
    <FieldRow label={row.field}>
      <StatusMark mark={markOf(row.mark.shape)} label={row.mark.word} />
      {/* the value runs inline (.fields-v): its parts are set apart in the text, not only by the layout */}
      {row.value.toLowerCase() !== row.mark.word.toLowerCase() && <> · <span className="mono">{row.value}</span></>}
      {row.note && <> · <span className="faint">{row.note}</span></>}
    </FieldRow>
  )
}

/** A reference as a house data row: the target's kind tile, title and mark. A reference to nothing is clay with its
 *  fix; one to an internal entry carries the lock — both on the Record face only (KI rule 2). */
function Reference({ row }: { row: RefRow }) {
  return (
    <DataRow
      kind="entry" icon={row.broken ? 'link' : glyphIcon(row.glyph)} title={row.title} tone={row.broken ? 'attn' : 'plain'}
      second={<>
        <span>{row.kind}</span>
        {row.peer && <span className="mono">from {row.peer} ↗</span>}
        {row.internal && <span className="vis vis-field"><Icon name="lock" size="xs" />internal only — absent from the commons</span>}
        {row.broken && <span>No entry with this name. Fix the reference or publish the entry.</span>}
      </>}
      trailing={row.mark && !row.broken ? <StatusMark mark={markOf(row.mark.shape)} label={row.mark.word} /> : undefined}
      marks={row.broken ? ['needs'] : []}
    />
  )
}

/** The public face: the projected object, drawn as the commons draws it (spec §4.2, K-8). Not editable, and it says
 *  why when the entry is not in the commons at all — with none of its words (the server sends none). */
function PublicFace({ face }: { face: EntryView['publicFace'] }) {
  return (
    <div className="public-face">
      <div className="band">
        <Icon name="globe" size="sm" />
        <span><b>Public face.</b> This is what the commons shows. Nothing here is editable.</span>
      </div>
      {!face.published
        ? <Note state="notYet">{face.reason ?? 'This entry is not in the commons yet.'}</Note>
        : (
          <>
            <div className="face-meta">
              <div className="faint mono">{face.atUri ?? 'no record yet'}</div>
              <h2 className="pf-title">{face.title}</h2>
              {face.lead && <p className="lead">{face.lead}</p>}
            </div>
            <div className="prose">
              {face.body.map(b => (
                <div key={b.field} className="face-block">
                  <h3>{b.label}</h3>
                  <p>{b.text}</p>
                </div>
              ))}
            </div>
            {face.related.length > 0 && (
              <Section label="Related" count={face.related.length}>
                <DataList label="Related">
                  {face.related.map(r => <Reference key={r.slug} row={r} />)}
                </DataList>
              </Section>
            )}
            {face.about.length > 0 && (
              <Section label="About this entry">
                <FieldTable label="About this entry">
                  {face.about.map(([label, value]) => (
                    <FieldRow key={label} label={label}><span className={label === 'Record' ? 'mono' : undefined}>{value}</span></FieldRow>
                  ))}
                </FieldTable>
              </Section>
            )}
            {face.cite && <p className="faint">How to cite: {face.cite}</p>}
          </>
        )}
    </div>
  )
}
