import { Link } from 'wouter'
import type { ChangeView } from '../api.ts'
import { Button, ButtonLink } from '../design/Button.tsx'
import { Icon } from '../design/Icon.tsx'
import { KindTile } from '../design/KindTile.tsx'
import { StatusMark } from '../design/StatusMark.tsx'
import { changeKeyHref } from '../hrefs.ts'
import { fmt, opFieldWords, opFields, opKind, privateSummary, type PrivateEntryView } from './rows.ts'
import { fileOpHref } from '../workspace/files.ts'

/** T19 review M3 (PF-R84): until Compare draws a diff for a file op (Task 21), a stale one is not kept blind over the trunk. */
export const FILE_KEEP_MINE_WHY = 'Keep mine is not offered for a file edited whole until Compare can show what changed on the trunk: take theirs, then make your edit again on the file as it is now.'

/** A value in a line: clipped to two lines, with the whole of it in its title (Review Focus 3). */
const Clip = ({ text, className, struck = false }: { text: string; className: string; struck?: boolean }) => struck
  ? <s className={`${className} clip`} title={text}>{text}</s>
  : <span className={`${className} clip`} title={text}>{text}</span>

/** One staged op in the expanded tray (§5.6): its kind tile, the record by name (a link to it), then a line per
 *  field — `field  old (struck, Mono faint) → new (Mono)` — and a ghost × that unstages the op, named "Remove op:
 *  <field> on <record>". A stale op is an --attn-soft block marked "changed on the trunk", with what the trunk
 *  holds now and Keep mine / Take theirs (a stale file op: Take theirs and its editor, PF-R84). `errors` are a refusal's sentences about this op's fields, each under
 *  its line; `busy` holds every button while another action runs (one at a time: the tray machine). */
export function TrayOp({ op, record, stale, onRemove, onKeepMine, onTakeTheirs, errors = [], busy = false }: {
  op: ChangeView['ops'][number]; record: string; stale?: { trunk: string }
  onRemove(): void; onKeepMine?(): void; onTakeTheirs?(): void
  errors?: { field: string; message: string }[]; busy?: boolean
}) {
  const fields = opFields(op)
  return (
    <li className={stale ? 'trayop stale' : 'trayop'}>
      <KindTile kind={opKind(op)} tone={stale ? 'attn' : 'plain'} />
      <div className="trayop-b">
        <div className="trayop-t">
          {/* DAO-OS L6 Task 19: a file op opens where it is edited: its page, else the source editor */}
          <Link href={op.op === 'file' ? fileOpHref(op.path) : changeKeyHref(op.record)} className="clip" title={record}>{record}</Link>
          {stale && <StatusMark mark="stale" label="changed on the trunk" />}
        </div>
        {fields.map((f, i) => {
          // a create has no old value, nor a field the entry did not hold: nothing to strike
          const was = op.op !== 'create' && f.was !== undefined
          return (
            <div className="trayop-chg" key={f.field}>
              <span className="trayop-k">{f.field.replace(/^\((.*)\)$/, '$1')}</span>
              {was && <Clip className="trayop-was" text={fmt(f.was)} struck />}
              {was && op.op !== 'delete' && <><Icon name="arrow-right" size="xs" /><span className="sr-only"> becomes </span></>}
              {op.op !== 'delete' && <Clip className="trayop-new" text={fmt(f.now)} />}
              {stale && i === fields.length - 1 && <span className="trayop-trunk">trunk now: {stale.trunk}</span>}
              {errors.filter(e => e.field === f.field).map((e, j) => <span key={j} className="err">{e.message}</span>)}
            </div>
          )
        })}
        {stale && op.op === 'file' && <div className="trayop-chg"><span className="trayop-trunk">{FILE_KEEP_MINE_WHY}</span></div>}
        {stale && (
          <div className="trayop-acts">
            {op.op !== 'file' && <Button small disabled={busy} onClick={onKeepMine}>Keep mine</Button>}
            <Button small disabled={busy} onClick={onTakeTheirs}>Take theirs</Button>
            {op.op === 'file' && <ButtonLink small href={fileOpHref(op.path)}>Open the editor</ButtonLink>}
          </div>
        )}
      </div>
      <Button variant="ghost" iconOnly icon="x" label={`Remove op: ${opFieldWords(op)} on ${record}`} disabled={busy} onClick={onRemove} />
    </li>
  )
}

/** What the tray says under a private entry (L6 Task 21, PF-R111): where it is kept, and how it goes. Unstaging one private
 *  entry is not built (R-L5-14.2): Discard all removes it. */
export const PRIVATE_KEPT = 'Kept in the private store until it is applied or decided, never in a file here. Discard all removes it.'

/** One private entry of the change, as typed (L5 R-L5-14.2): its record and what it does, with no value and no ×. */
export function TrayPrivateOp({ entry }: { entry: PrivateEntryView }) {
  const s = privateSummary(entry.op)
  return (
    <li className="trayop">
      <KindTile kind={entry.op === null ? 'record' : s.record.slice(0, Math.max(0, s.record.indexOf(':')))} tone="plain" />
      <div className="trayop-b">
        <div className="trayop-t"><span className="clip" title={s.record}>{s.record}</span></div>
        <div className="trayop-chg"><span className="trayop-k">{s.what}</span></div>
        <div className="trayop-chg"><span className="trayop-trunk">{PRIVATE_KEPT}</span></div>
      </div>
    </li>
  )
}
