import { useId, useState, type ReactNode } from 'react'
import { Link } from 'wouter'
import { Button, ButtonLink } from './Button.tsx'
import { FieldRow, FieldTable } from './FieldRow.tsx'
import { Note } from './Note.tsx'
import { announce } from '../parts/live.tsx'
import { RestrictedValue } from '../viewAs/VisibilityMarker.tsx'
import type { SectionWords } from '../sections.ts'

/** The plate (design pass, spec 2026-11-04 §1): what an empty place says in place of one faint line — what goes here,
 *  what it will look like, and the next step this viewer can take. One frame, one variant for each reason a place
 *  can be empty. Its heading sits under the page's h1 (a lone block, `level` 2) or under its block's own head (3).
 *  Words come from the section table, so every instance's sections explain themselves. */

export type PlateLevel = 2 | 3

function Heading({ level, children }: { level: PlateLevel; children: ReactNode }) {
  const H = level === 2 ? 'h2' : 'h3'
  return <H className="plate-t">{children}</H>
}

function Frame({ kind, level, tag, title, children, acts, aside }:
  { kind: string; level: PlateLevel; tag?: string; title: string; children?: ReactNode; acts?: ReactNode; aside?: ReactNode }) {
  return (
    <div className="plate" data-plate={kind}>
      <div className={aside ? 'plate-in plate-wide' : 'plate-in'}>
        <div className="plate-main">
          {tag && <p className="plate-tag">{tag}</p>}
          <Heading level={level}>{title}</Heading>
          {children}
          {acts && <div className="plate-acts">{acts}</div>}
        </div>
        {aside}
      </div>
    </div>
  )
}

const IMPORT_STEP = { title: 'Or bring a list you already keep', line: 'Paste rows from a sheet, or drop a CSV. You’ll see them before anything is saved.' }

/** The greyed example of the filled list: marked "example" where it is seen and hidden from assistive tech, so it is
 *  never read as data. */
function Example({ rows }: { rows: SectionWords['example'] }) {
  return (
    <div className="plate-ex" aria-hidden="true">
      <div className="plate-ex-h"><span>What it will look like</span><span className="plate-ex-tag">example</span></div>
      {rows.slice(0, 3).map(r => (
        <div className="plate-ex-r" key={r[0]}><span className="plate-ex-1">{r[0]}</span><span className="plate-ex-2">{r[1]}</span><span className="plate-ex-3">{r[2]}</span></div>
      ))}
    </div>
  )
}

/** Empty, and you can add: why it is worth filling, at most three first steps, the actions, the example and where the
 *  list is kept. *Import from a sheet* is drawn only when there is an import to open (`onImport`). */
export function AddPlate({ words, file, addHref, onImport, level }:
  { words: SectionWords; file: string; addHref: string; onImport?: () => void; level: PlateLevel }) {
  const [good, setGood] = useState(false)
  const goodId = useId()
  const steps = [{ title: 'Add the first one by hand', line: words.first }, ...(onImport ? [IMPORT_STEP] : []), ...(words.then ? [words.then] : [])].slice(0, 3)
  const first = words.example[0]
  return (
    <Frame kind="add" level={level} tag="Nothing tracked yet" title={words.lead}
      acts={<>
        <ButtonLink primary icon="plus" href={addHref}>Add the first {words.noun}</ButtonLink>
        {onImport && <Button onClick={onImport}>Import from a sheet</Button>}
        <Button variant="ghost" expanded={good} controls={good ? goodId : undefined} onClick={() => setGood(g => !g)}>What a good entry looks like</Button>
      </>}
      aside={<div className="plate-side"><Example rows={words.example} />
        <p className="plate-foot">Kept in <code>{file}</code>. Edit it here, or in the file. Both land as a staged change.</p></div>}>
      <p className="plate-l">{words.why}</p>
      <ol className="plate-steps">
        {steps.map((s, i) => (
          <li key={s.title}><span className="plate-n" aria-hidden="true">{i + 1}</span><span className="plate-s"><span className="plate-s-t">{s.title}</span><span className="plate-s-l">{s.line}</span></span></li>
        ))}
      </ol>
      {good && first && (
        <div className="plate-good" id={goodId}>
          <p className="plate-good-t">An example, not a record:</p>
          <FieldTable label="A good entry">
            {words.columns.map((c, i) => <FieldRow key={c} label={c}>{first[i]}</FieldRow>)}
          </FieldTable>
        </div>
      )}
    </Frame>
  )
}

/** You can't add (read-only, or previewing as someone else): who keeps the list, and *Who decides?*. `suggest` is
 *  the slot L6's *Suggest* fills; nothing draws it on L4c. */
export function CannotPlate({ nouns, level, suggest }: { nouns: string; level: PlateLevel; suggest?: ReactNode }) {
  return (
    <Frame kind="cannot" level={level} title={`No ${nouns} yet`}
      acts={<>{suggest}<ButtonLink variant="ghost" href="/governance/rules">Who decides?</ButtonLink></>}>
      <p className="plate-l">Members who can write keep this list. Who decides? shows whose say a change to it needs.</p>
    </Frame>
  )
}

/** Filtered to nothing: what the filters hid and how many, so an empty filter never reads as empty data. */
export function FilteredPlate({ nouns, filters, hidden, onClear, level }:
  { nouns: string; filters: string; hidden: string; onClear?: () => void; level: PlateLevel }) {
  return (
    <Frame kind="filtered" level={level} title={`No ${nouns} match “${filters}”`}
      acts={onClear && <Button onClick={onClear}>Clear filters</Button>}>
      {hidden && <p className="plate-l">{hidden}</p>}
    </Frame>
  )
}

/** Everything is restricted for this viewer: a count and the hat that may read them, never a name (D-12). */
export function RestrictedPlate({ count, nouns, noun, hat, level }:
  { count: number; nouns: string; noun: string; hat: string | null; level: PlateLevel }) {
  const what = count === 1 ? noun : nouns
  return (
    <Frame kind="restricted" level={level} title={`${count} ${what} you can’t see`}
      acts={<ButtonLink variant="ghost" href="/roles">Ask for access</ButtonLink>}>
      <p className="plate-l">{hat === null
        ? `${count === 1 ? 'It is' : 'They are'} kept to readers you are not among. Roles shows who holds what.`
        : <>{count === 1 ? 'It’s' : 'They’re'} marked <RestrictedValue hat={hat} />. {hat === 'Members' ? 'Members' : `People wearing the ${hat} hat`} can open {count === 1 ? 'it' : 'them'}.</>}</p>
    </Frame>
  )
}

/** A file the server could not read (walk R-6): the file, the line and the reason when the server gives them, and a
 *  copy of them for whoever fixes it. The reason is an error note, said once through the page's polite region. */
export function BrokenPlate({ title, file, line, reason, level }:
  { title: string; file: string; line?: number; reason: string; level: PlateLevel }) {
  const where = line !== undefined ? `Line ${line} of ${file}` : file
  const copy = async () => {
    const text = `${file}${line !== undefined ? `, line ${line}` : ''}: ${reason}`
    try {
      await navigator.clipboard.writeText(text)
      announce('Copied for a fix.')
    } catch {
      announce('Copying isn’t available here: select the words instead.')
    }
  }
  return (
    <Frame kind="broken" level={level} title={`${title} can’t be read`}
      acts={<Button small onClick={() => void copy()}>Copy for a fix</Button>}>
      <Note state="error"><code>{where}</code>: {reason}</Note>
    </Frame>
  )
}

/** A System section with nothing connected: what connecting gives, "Read only" where the Hub only reads it, and
 *  *Connect* for a member who can (else *Who decides?*). */
export function ConnectPlate({ connect, href, level }:
  { connect: NonNullable<SectionWords['connect']>; href?: string; level: PlateLevel }) {
  return (
    <Frame kind="connect" level={level} title={connect.title}
      acts={<>
        {href ? <ButtonLink primary icon="plus" href={href}>{connect.action}</ButtonLink> : <ButtonLink variant="ghost" href="/governance/rules">Who decides?</ButtonLink>}
        <Link href="/systems" className="plate-a">Other systems</Link>
      </>}>
      <p className="plate-l">{connect.gives}{connect.readOnly && ' Read only: the Hub never signs.'}</p>
    </Frame>
  )
}
