import { Link } from 'wouter'
import type { ChangeView } from '../api.ts'
import { Button } from '../design/Button.tsx'
import { Icon } from '../design/Icon.tsx'
import { KindTile } from '../design/KindTile.tsx'
import { StatusMark } from '../design/StatusMark.tsx'
import { changeKeyHref } from '../hrefs.ts'
import { fmt, opFieldWords, opFields, opKind } from './rows.ts'

/** A value in a line: clipped to two lines, with the whole of it in its title (Review Focus 3). */
const Clip = ({ text, className, struck = false }: { text: string; className: string; struck?: boolean }) => struck
  ? <s className={`${className} clip`} title={text}>{text}</s>
  : <span className={`${className} clip`} title={text}>{text}</span>

/** One staged op in the expanded tray (§5.6): its kind tile, the record by name (a link to it), then a line per
 *  field — `field  old (struck, Mono faint) → new (Mono)` — and a ghost × that unstages the op, named "Remove op:
 *  <field> on <record>". A stale op is an --attn-soft block marked "changed on the trunk", with what the trunk
 *  holds now and Keep mine / Take theirs. `errors` are a refusal's sentences about this op's fields, each under
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
          <Link href={changeKeyHref(op.record)} className="clip" title={record}>{record}</Link>
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
        {stale && (
          <div className="trayop-acts">
            <Button small disabled={busy} onClick={onKeepMine}>Keep mine</Button>
            <Button small disabled={busy} onClick={onTakeTheirs}>Take theirs</Button>
          </div>
        )}
      </div>
      <Button variant="ghost" iconOnly icon="x" label={`Remove op: ${opFieldWords(op)} on ${record}`} disabled={busy} onClick={onRemove} />
    </li>
  )
}
