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

const BARE_DAY = /^(\d{4})-(\d{2})-(\d{2})$/

/** A day as the house writes a date: "12 Aug", with its year only when that is not `now`'s ("12 Aug 2025"). A bare day
 *  (`2026-08-12`, an export's) is that day where it is drawn, never UTC midnight read west of UTC as the day before
 *  (DAO-OS L6 Tasks 13–14 review M6). Exported for the Sources page's import rows (L6 Task 19). */
export function dayText(iso: string, now: Date): string {
  const bare = BARE_DAY.exec(iso)
  const d = bare ? new Date(Number(bare[1]), Number(bare[2]) - 1, Number(bare[3])) : new Date(iso)
  const day = `${d.getDate()} ${MONTHS[d.getMonth()]}`
  return d.getFullYear() === now.getFullYear() ? day : `${day} ${d.getFullYear()}`
}

/** The time a thing was read or exported, in a `<time>` with the full ISO in its title. It is volatile: route shots
 *  mask it (L4-R8). */
export function When({ iso, children }: { iso: string; children: string }) {
  return <time dateTime={iso} title={iso} data-volatile="">{children}</time>
}

/** Where this came from (E-1, Q70; R-L6-FM), in a meta line, 12 faint: "from the repository · read 2 min ago" (a file of
 *  this repository: its path is never said, walk W3, D3), "from <repo> · read 2 min ago", "from <System name>" and the
 *  read's age (a failed read says so, with the last good age), "from Notion · exported 12 Aug" (an import has no
 *  read age), or "from <the org> · read 2 min ago" (the instance: a page, a record the private store keeps). With
 *  no time to name, the source alone. */
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
  // walk W3, D3: a file is never named on a member's page: a file of this repository is "the repository", another's its repository
  const source = 'instance' in from ? from.instance : 'repo' in from ? from.repo : 'the repository'
  const at = readable(from.readAt)
  return <span className="from">from {source}{at && <>{' · '}<When iso={at}>{`read ${ageText(at, now)}`}</When></>}</span>
}
