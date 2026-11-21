// DAO-OS L6 Task 19: the Sources page (spec §10, §15: `/sources`) — L4c's list view of where the Hub's things come
// from: the instance (its collections, pages and other governed files, its last commit), each System it reads (what its
// driver's read supplies, with the read's age; a failed read "couldn’t read"), each import (its export day and what of
// it you may read). Then the editor table (§11.1, F-L3-3): every governed file's pattern, linked to the editor that
// writes it. Rule 7: only what GET /api/sources sends is drawn — no count, name or hint for anything it leaves out. The
// counts are the server's for you; a preview cannot count them again for someone else, so a preview shows the instance
// alone, with nothing it supplies (ruling PF-R77).
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, type EditorRowView, type Source } from '../api.ts'
import type { IconName } from '../design/Icon.tsx'
import { PageHead } from '../design/PageHead.tsx'
import { Section } from '../design/Section.tsx'
import { dayText, When } from '../elements/atoms/FromMark.tsx'
import { ReadAge } from '../elements/atoms/ReadAge.tsx'
import { DataRow } from '../elements/rows/DataRow.tsx'
import { ListView } from '../elements/views/ListView.tsx'
import { useNow } from '../time.ts'
import { useViewer } from '../viewAs/ViewAs.tsx'
import { editorLink, editorWords } from './files.ts'

export const SOURCES_ABOUT = 'Where what the Hub shows comes from: this instance, each System it reads, and each import.'
export const EDITORS_LABEL = 'Where each governed file is edited'
const KIND_WORD: Record<Source['kind'], string> = { instance: 'Instance', system: 'System', repo: 'Repository', import: 'Import' }
const KIND_ICON: Record<Source['kind'], IconName> = { instance: 'workspace', system: 'systems', repo: 'layers', import: 'doc' }

/** What a source supplies, as its row's second line says it: "projects 12 · pages 3 · other governed files 9". Words,
 *  not links: a run of small inline links in a 13px line is no target a finger can hit (WCAG 2.5.8; the a11y walk at
 *  390), and each collection is opened from Workspace (R-L6-T19-1). */
function supplies(s: Source): string {
  return s.supplies.map(x => (x.count !== undefined ? `${x.what} ${x.count}` : x.what)).join(' · ')
}

/** When the source was last read: an import's export day ("exported 12 Aug"), else the read's age in the house's
 *  words (fresh, aged, "couldn’t read", reading, not read yet). */
function readOf(s: Source, now: Date): ReactNode {
  if (s.kind === 'import') {
    const at = s.read.at
    return at !== null && !Number.isNaN(new Date(at).getTime())
      ? <span className="age">exported{' '}<When iso={at}>{dayText(at, now)}</When></span>
      : null
  }
  return <span data-volatile=""><ReadAge state={s.read.state} readAt={s.read.at} now={now} /></span>
}

function SourceRow({ source: s, now }: { source: Source; now: Date }) {
  const second = [KIND_WORD[s.kind], s.from, supplies(s)].filter((x): x is string => typeof x === 'string' && x !== '').join(' · ')
  return <DataRow kind={s.kind} icon={KIND_ICON[s.kind]} title={s.name} href={s.href} marks={[]} trailing={readOf(s, now)} second={second} />
}

function EditorRow({ row }: { row: EditorRowView }) {
  const second = [editorWords(row.editor), row.class ? `class ${row.class}` : 'no class: by design'].join(' · ')
  // 0.7.1 D6: a row the viewer may not read (the agent layer, for one who does not decide it) links nowhere.
  return <DataRow kind="file" icon="file" title={row.pattern} second={second} href={editorLink(row)} marks={[]} />
}

export default function SourcesPage() {
  const now = useNow(false)
  const { previewing, viewer } = useViewer()
  // T19 review M4: Sources and the editor table are the members' side (GET /api/sources and /api/editors are members'
  // reads), so a preview as the public draws neither and asks for neither — said here, not left to a list's filter.
  const asPublic = viewer.as === 'public'
  const sources = useQuery({ queryKey: ['sources'], queryFn: api.sources, retry: false, enabled: !asPublic })
  const editors = useQuery({ queryKey: ['editors'], queryFn: api.editors, retry: false, staleTime: Number.POSITIVE_INFINITY, enabled: !asPublic })
  // PF-R77: a preview shows the instance alone, supplying nothing — never a count or a name counted for you.
  const rows = asPublic ? [] : (sources.data ?? []).flatMap(s => (!previewing ? [s] : s.kind === 'instance' ? [{ ...s, supplies: [] }] : []))
  return (
    <>
      <PageHead title="Sources" about={SOURCES_ABOUT} />
      <ListView label="Sources" rows={rows} loading={!asPublic && sources.isPending ? 3 : undefined}
        error={sources.error ? sources.error.message : undefined} onRetry={() => void sources.refetch()}
        empty={{ title: 'No sources here.' }} row={s => <SourceRow key={s.id} source={s} now={now} />} />
      <Section label={EDITORS_LABEL}>
        <ListView label={EDITORS_LABEL} rows={asPublic ? [] : editors.data ?? []} loading={!asPublic && editors.isPending ? 4 : undefined}
          error={editors.error ? editors.error.message : undefined} onRetry={() => void editors.refetch()}
          empty={{ title: 'No editors here.' }} row={r => <EditorRow key={r.pattern} row={r} />} />
      </Section>
    </>
  )
}
