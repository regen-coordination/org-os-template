// DAO-OS L6 Task 19: the source editor (spec §11, §15: `/files/*`) — a governed file whole: its path, class and editor
// in L4c's record header and field rows, its text in a Mono well. Where the table names the source editor (§11.1) a
// member may edit the text in place, and Save stages one `file` op into the tray (never a write of its own); the
// server checks it at stage and again at apply, and a refusal is said in the server's words, as an error note. A file
// no file op writes (generated, the ledger, DECISIONS.md, the canon: PF-R1) says the server's sentence and has no Save;
// a file the table gives an editor of its own (a collection's records, a page, a board, the library) is read here and
// links to it (PF-R78). A file the server will not serve (not governed; holding a value not every member may read) is
// its sentence alone: no path's text, class or size. `/files/<folder>/` (and `/files`) is the path field.
import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useLocation } from 'wouter'
import { api, type FileOp } from '../api.ts'
import { useActor } from '../actor.ts'
import { useChanges } from '../changes/useChanges.ts'
import { Button } from '../design/Button.tsx'
import { FieldRow, FieldTable } from '../design/FieldRow.tsx'
import { Note, NoteBlock } from '../design/Note.tsx'
import { PageHead } from '../design/PageHead.tsx'
import { Section } from '../design/Section.tsx'
import { Skeleton } from '../design/Skeleton.tsx'
import { RecordHeader } from '../elements/records/RecordHeader.tsx'
import { announce } from '../parts/live.tsx'
import { refusalErrors } from '../record/useEditor.ts'
import NotFound from '../pages/NotFound.tsx'
import { useCanWrite, useViewer } from '../viewAs/ViewAs.tsx'
import { editorWords, filesHref, NO_FILE_YET, ownEditor, READ_HERE, STAGED_DELETE, STAGED_WHOLE, WRITES_WHOLE, wholeFileRefusal } from './files.ts'

export const FILES_ABOUT = 'Open a governed file by its path in the repository, to read it, or to edit it whole where its editor is the source editor.'
export const STAGED_SAID = (path: string): string => `${path} is staged in your change.`
/** T19 review I3: the file moved on while a draft was open over it. Save still stages against the version the draft began
 *  from, so the tray reads it stale; Reload drops the draft for the file as it is now. */
export const FILE_CHANGED = (path: string): string =>
  `${path} changed since you began editing it. Save keeps your text against the version you began from, and the tray will say it is stale; Reload drops your text for the file as it is now.`

/** The path field: a folder's path to go on from (`/files/memory/`), or none. Open goes to `/files/<path>`. */
function FileOpener({ prefix }: { prefix: string }) {
  const [, navigate] = useLocation()
  const [value, setValue] = useState(prefix)
  const open = (e: FormEvent) => {
    e.preventDefault()
    const path = value.trim().replace(/^(\.\/|\/)+/, '')
    if (path !== '' && !path.endsWith('/')) navigate(filesHref(path))
  }
  return (
    <>
      <PageHead title="Files" about={FILES_ABOUT} />
      <form onSubmit={open}>
        <FieldTable label="Open a file">
          <FieldRow label="Path" htmlFor="files-path">
            <input id="files-path" className="input mono-in" value={value} spellCheck={false} autoComplete="off" onChange={e => setValue(e.target.value)} />
          </FieldRow>
        </FieldTable>
        <div className="rh-acts rp-acts"><Button primary type="submit">Open</Button></div>
      </form>
    </>
  )
}

const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1) || path

function FileEditor({ path }: { path: string }) {
  // T19 review I2: the files are the members' side (GET /api/files is a members' read), so a preview as the public is
  // absent, as PagePage draws a page the previewed viewer may not see: the not-found page, nothing asked of the server.
  const { viewer } = useViewer()
  const asPublic = viewer.as === 'public'
  // T19 review I3: read again on every open (staleTime 0), and after Apply, Keep mine / Take theirs and the file events.
  const q = useQuery({ queryKey: ['file', path], queryFn: () => api.file(path), retry: false, enabled: !asPublic, staleTime: 0 })
  const changes = useChanges()
  const canWrite = useCanWrite()
  const { known } = useActor()
  const [draft, setDraft] = useState<string | null>(null)
  // The file's version when the draft began (T19 review I3): what Save stages against, so a file that moved on since reads
  // stale in the tray instead of being written over. With no draft, the page follows the file as it is read.
  const [began, setBegan] = useState<string | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const staged = (changes.view?.ops ?? []).find((o): o is FileOp => o.op === 'file' && o.path === path)

  if (asPublic) return <NotFound />
  if (q.isPending) {
    return <><RecordHeader variant="record" kind="file" id={path} title={baseName(path)} meta={[]} /><Skeleton rows={6} shape="row-1" label={path} /></>
  }
  // Not governed (404), a value kept from some members (403), a path that is not plain (400): the server's sentence.
  if (q.error) return <><PageHead title={baseName(path)} /><NoteBlock title={q.error.message} /></>

  const f = q.data
  const refused = wholeFileRefusal(f.editor)
  const whole = refused === null && WRITES_WHOLE.has(f.editor)
  const writable = whole && canWrite && known
  const own = ownEditor(path, f.editor)
  // The text the well starts from: your staged text, else the file's; a draft once you type.
  const startText = staged ? staged.text ?? '' : f.text ?? ''
  const text = draft ?? startText
  const dirty = draft !== null && draft !== startText
  const changed = draft !== null && !staged && began !== f.base
  const edit = (value: string) => { if (draft === null) setBegan(f.base); setDraft(value) }
  const reload = () => { setDraft(null); setBegan(null); setErrors([]); void q.refetch() }

  const save = async () => {
    if (!writable || !dirty || busy) return
    setBusy(true)
    setErrors([])
    try {
      // a restage keeps the version the edit started from, so a file changed since reads stale in the tray
      await changes.stage([{ op: 'file', path, text, base: staged ? staged.base : draft !== null ? began : f.base }])
      setDraft(null)
      setBegan(null)
      announce(STAGED_SAID(path))
    } catch (err) {
      const said = refusalErrors(err, path).map(e => e.message)
      setErrors(said)
      announce(`Not staged: ${said.join(' ')}`)
    } finally {
      setBusy(false)
    }
  }

  const primary = writable
    ? <Button primary disabled={!dirty} busy={busy ? 'Staging…' : undefined} onClick={() => void save()}>Save to changes</Button>
    : undefined
  const meta = [editorWords(f.editor), f.class ? `class ${f.class}` : 'no class: by design']
  return (
    <>
      <RecordHeader variant="record" kind="file" id={path} title={baseName(path)} meta={meta}
        state={staged ? 'staged' : undefined} stateWord={staged ? 'Staged' : undefined} primary={primary} />
      <FieldTable label="File">
        <FieldRow label="Path"><code>{path}</code></FieldRow>
        <FieldRow label="Class">{f.class || 'none: by design'}</FieldRow>
        <FieldRow label="Editor">{editorWords(f.editor)}{own && <>{' · '}<Link href={own.href}>{own.label}</Link></>}</FieldRow>
      </FieldTable>
      {refused !== null && <Note state="unavailable">{refused}</Note>}
      {refused === null && !whole && <Note state="unavailable">{READ_HERE(path, f.editor)}</Note>}
      {staged && <Note state="notYet">{staged.text === null ? STAGED_DELETE : STAGED_WHOLE}</Note>}
      <Section label="Source" note={path}>
        {writable
          ? (
            <FieldTable label="Source">
              <FieldRow label="text" htmlFor="f-file" error={errors.length > 0 ? errors.join(' ') : undefined}
                help={changed ? <>{FILE_CHANGED(path)}{' '}<Button small onClick={reload}>Reload</Button></> : undefined}>
                <textarea id="f-file" className="input mono-in rp-yaml" spellCheck={false} value={text}
                  aria-invalid={errors.length > 0 ? true : undefined}
                  aria-describedby={[changed ? 'f-file-help' : null, errors.length > 0 ? 'f-file-err' : null].filter(Boolean).join(' ') || undefined}
                  rows={Math.max(8, text.split('\n').length + 1)} onChange={e => edit(e.target.value)} />
              </FieldRow>
            </FieldTable>
          )
          : f.text === null
          ? <Note state="empty">{NO_FILE_YET(path)}</Note>
          : <pre className="mono-well" aria-label={path}>{f.text}</pre>}
      </Section>
    </>
  )
}

/** `/files/<path>`: the file; `/files`, or a folder's path ending in `/`, the path field. */
export default function FilePage({ path }: { path: string }) {
  if (path === '' || path.endsWith('/')) return <FileOpener key={path} prefix={path} />
  return <FileEditor key={path} path={path} />
}
