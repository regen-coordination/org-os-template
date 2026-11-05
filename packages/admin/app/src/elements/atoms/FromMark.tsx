import type { DriverRead } from '../../../../server/systems/driver.ts'
import { ageText } from '../../time.ts'
import { ReadAge, type ReadingState } from './ReadAge.tsx'
import type { From } from './from.ts'

export type { From }

/** A read's state as the read age says it: none yet is unknown; otherwise the reader's own state, or, from an older
 *  reader that did not set one, fresh when it read and failed when it did not. */
export function readStateOf(read: DriverRead | null): ReadingState {
  if (read === null) return 'unknown'
  return read.state ?? (read.ok ? 'fresh' : 'failed')
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const readable = (iso: string | null | undefined): string | null =>
  typeof iso === 'string' && !Number.isNaN(new Date(iso).getTime()) ? iso : null

/** A day as the house writes a date: "12 Aug", with its year only when that is not `now`'s ("12 Aug 2025"). */
function dayText(iso: string, now: Date): string {
  const d = new Date(iso)
  const day = `${d.getDate()} ${MONTHS[d.getMonth()]}`
  return d.getFullYear() === now.getFullYear() ? day : `${day} ${d.getFullYear()}`
}

/** The time a thing was read or exported, in a `<time>` with the full ISO in its title. It is volatile: route shots
 *  mask it (L4-R8). */
function When({ iso, children }: { iso: string; children: string }) {
  return <time dateTime={iso} title={iso} data-volatile="">{children}</time>
}

/** Where this came from (E-1, Q70; R-L6-FM), in a meta line, 12 faint: "from data/projects.yaml · read 2 min ago",
 *  "from <repo> · read 2 min ago" (the file after the repository when one is named), "from <System name>" and the
 *  read's age (a failed read says so, with the last good age), or "from Notion · exported 12 Aug" (an import has no
 *  read age). With no time to name, the source alone. */
export function FromMark({ from, now }: { from: From; now: Date }) {
  if ('system' in from) {
    const read = from.read
    return (
      <span className="from">from {from.system}{' · '}
        <span data-volatile="">
          <ReadAge state={readStateOf(read)} readAt={read?.readAt ?? null} lastGood={read && !read.ok ? read.readAt : null} now={now} />
        </span>
      </span>
    )
  }
  if ('import' in from) {
    const at = readable(from.exportedAt)
    return <span className="from">from {from.import}{at && <>{' · exported '}<When iso={at}>{dayText(at, now)}</When></>}</span>
  }
  const source = 'repo' in from ? (from.file ? `${from.repo} · ${from.file}` : from.repo) : from.file
  const at = readable(from.readAt)
  return <span className="from">from {source}{at && <>{' · '}<When iso={at}>{`read ${ageText(at, now)}`}</When></>}</span>
}
