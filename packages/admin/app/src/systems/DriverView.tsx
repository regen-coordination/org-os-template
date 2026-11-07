import type { ReactNode } from 'react'
import type { DriverRead, DriverSection, Resource } from '../api.ts'
import { Section } from '../design/Section.tsx'
import { Note } from '../design/Note.tsx'
import { StatusMark } from '../design/StatusMark.tsx'
import { FieldRow, FieldTable } from '../design/FieldRow.tsx'
import { TableView, type Column } from '../elements/views/TableView.tsx'
import { AddressChip } from '../elements/atoms/AddressChip.tsx'
import { ReadAge } from '../elements/atoms/ReadAge.tsx'
import { readStateOf } from '../elements/atoms/FromMark.tsx'
import { isAddress, shortAddress } from '../elements/atoms/chain.ts'

/** Only http(s) addresses from an outside system become links. */
export const safeHref = (href: string | null | undefined): string | null => (href && /^https?:\/\//i.test(href) ? href : null)

/** The driver's last read, from the resource's facts (contract: facts.driver: DriverRead). */
export function driverOf(r: Resource): DriverRead | null {
  const d = r.facts.driver as Partial<DriverRead> | undefined
  return d && typeof d === 'object' && typeof d.ok === 'boolean' && Array.isArray(d.sections) ? (d as DriverRead) : null
}

/** An account a row is about (L2's row `refs`): a CAIP-10 id, `eip155:42220:0x…` with a 40-hex address. A hat ref
 *  (its id is 32 bytes) is not an account and gets no chip: the row already names the hat. */
interface Account { id: string; chain: string; address: string }
function accountOf(ref: string): Account | null {
  const at = ref.lastIndexOf(':')
  const chain = ref.slice(0, at), address = ref.slice(at + 1)
  return at > 0 && /^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$/.test(chain) && isAddress(address) ? { id: ref, chain, address } : null
}

/** One row as the house draws it: its cells, its accounts, and the System's own visibility and facts, so a preview
 *  judges the row as it judges the System it was read from (CC-14). */
interface RowView {
  key: string; cells: string[]; attention?: 'warn' | 'alert'; accounts: Account[]
  facts: Resource['facts']; visibility?: unknown
}

/** The account a cell shows: the whole address, or its short form (`0x6AFF…343a`), in any case. */
const shownAccount = (cell: string, accounts: Account[]): Account | undefined =>
  accounts.find(a => a.address.toLowerCase() === cell.toLowerCase() || shortAddress(a.address).toLowerCase() === cell.toLowerCase())
/** The row's accounts no cell shows: their chips go at the row's end. */
const loose = (row: RowView): Account[] => row.accounts.filter(a => !row.cells.some(c => shownAccount(c, [a]) === a))

const numeric = (c: string) => /\d/.test(c) && /^[\d.,\s+−-]+$/.test(c)

/** The driver's own short ages ("4 min", "30 h", "12 d": server/systems/safe.ts `ago`), which the server computes
 *  from the real clock: a cell that is one moves every day, so it is marked for the route shots to mask, as `time`
 *  and every other `[data-volatile]` are. */
const AGE = /^\d+ (min|h|d)$/

/** A cell: an account as its address chip (the plain address copied, its CAIP-10 id in the title — never an explorer
 *  link), else the text, clipped with the whole of it in the title. Text is only ever text. */
function Cell({ text, row, mono = false }: { text: string; row: RowView; mono?: boolean }) {
  const account = shownAccount(text, row.accounts)
  if (account) return <AddressChip value={account.address} chain={account.chain} />
  return <span className={mono ? 'clip mono' : 'clip'} title={text} data-volatile={AGE.test(text) ? '' : undefined}>{text}</span>
}
const Chips = ({ accounts }: { accounts: Account[] }) => <>{accounts.map(a => <AddressChip key={a.id} value={a.address} chain={a.chain} />)}</>

/** A row with attention carries its mark in words (§6.1): what waits on someone is "Needs you"; a warning (a chain
 *  that disagrees or failed, an empty hat) is "Needs a look". */
function AttentionMark({ level }: { level: 'warn' | 'alert' }) {
  return level === 'alert' ? <StatusMark mark="needs" /> : <StatusMark mark="failed" label="Needs a look" />
}

/** A section of label and value pairs (each row two cells, the first a name, not an address) reads as field rows. */
const isPairs = (rows: RowView[]) => rows.every(r => r.cells.length === 2 && !shownAccount(r.cells[0]!, r.accounts) && !isAddress(r.cells[0]!))

function PairsSection({ title, rows }: { title: string; rows: RowView[] }) {
  return (
    <FieldTable label={title}>
      {rows.map(r => (
        <FieldRow key={r.key} label={r.cells[0]!}>
          <Cell text={r.cells[1]!} row={r} mono={numeric(r.cells[1]!)} />
          <Chips accounts={loose(r)} />
          {r.attention && <AttentionMark level={r.attention} />}
        </FieldRow>
      ))}
    </FieldTable>
  )
}

function TableSection({ title, rows }: { title: string; rows: RowView[] }) {
  const width = Math.max(...rows.map(r => r.cells.length))
  const cols: Column<RowView>[] = Array.from({ length: width }, (_, i) => {
    const filled = rows.map(r => r.cells[i] ?? '').filter(c => c !== '')
    const nums = i > 0 && filled.length > 0 && filled.every(numeric)
    // A driver's section names no columns: its rows are cells and nothing else (DriverSection), so there is no field
    // name to give one. The table draws no head (`head={false}`), so no column is announced by a made-up name.
    return { key: `c${i}`, label: '', mono: nums, right: nums, card: i === 0 ? 'title' : 'meta',
      cell: r => (r.cells[i] === undefined || r.cells[i] === '' ? '' : <Cell text={r.cells[i]!} row={r} mono={nums} />) } as Column<RowView>
  })
  if (rows.some(r => loose(r).length > 0)) cols.push({ key: 'refs', label: '', card: 'meta', cell: r => <Chips accounts={loose(r)} /> })
  if (rows.some(r => r.attention)) cols.push({ key: 'state', label: '', card: 'status', cell: r => (r.attention ? <AttentionMark level={r.attention} /> : '') })
  return <TableView label={title} rows={rows} columns={cols} rowKey={r => r.key} head={false} empty={{ title: 'Nothing here.' }} />
}

/** One section of the read: its title and note in the section head, the read's age at its end; then its rows as field
 *  rows or a table, or one line when it has none. */
function DriverSectionView({ section, index, resource, read, now }: { section: DriverSection; index: number; resource: Resource; read: DriverRead; now: Date }) {
  const rows: RowView[] = section.rows.map((r, i) => ({
    key: `${index}:${i}`, cells: r.cells.map(String), attention: r.attention, accounts: (r.refs ?? []).map(accountOf).filter((a): a is Account => a !== null),
    facts: resource.facts, visibility: (resource as { visibility?: unknown }).visibility,
  }))
  const age = <ReadAge state={readStateOf(read)} readAt={read.readAt} lastGood={read.ok ? undefined : read.readAt} now={now} />
  let body: ReactNode
  if (rows.length === 0) body = <Note state="empty">Nothing here.</Note>
  else body = isPairs(rows) ? <PairsSection title={section.title} rows={rows} /> : <TableSection title={section.title} rows={rows} />
  return <Section label={section.title} note={section.note} end={age}>{body}</Section>
}

/** What a System's driver read (§14.2 `systems/DriverView`): each section as field rows or a table, with its read age;
 *  a row's accounts as address chips; a row with attention carrying its mark. Nothing here links out: the System's
 *  own "Open in …" (its record header, its block's foot) is the only way to it. A link System, which has nothing read
 *  but its address, shows that address in Mono and, when its driver says it may be, embedded without privileges. A
 *  failed read is a note — "Couldn’t read: <why>" — and the last good read stays under it, its age failed. */
export function DriverView({ resource, now = new Date() }: { resource: Resource; now?: Date }) {
  const read = driverOf(resource)
  if (!read) return <Note state="notYet">Nothing has read this system yet: its driver reports here once it does.</Note>
  const href = safeHref(read.open?.url)
  return (
    <div className="drv">
      {/* a note, not an alert (E-67): the read is a state of the System, shown where it is read, not an event to announce */}
      {!read.ok && <Note state="error">Couldn’t read: {read.error ?? 'the driver gave no reason'}</Note>}
      {read.ok && read.sections.length === 0 && href && (
        <Section label="Link" note={read.open?.embeddable ? 'embedded below' : undefined}>
          <p className="drv-link"><span className="mono">{href}</span></p>
          {read.open?.embeddable && <iframe className="drv-embed" title={`${resource.name}, embedded`} src={href} sandbox="allow-scripts" referrerPolicy="no-referrer" />}
        </Section>
      )}
      {read.sections.map((s, i) => <DriverSectionView key={`${s.title}:${i}`} section={s} index={i} resource={resource} read={read} now={now} />)}
      {read.ok && read.sections.length === 0 && !href && <Note state="empty">This system’s driver shows nothing more.</Note>}
    </div>
  )
}
