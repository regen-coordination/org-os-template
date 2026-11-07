import { Icon } from '../../design/Icon.tsx'
import { Note, NoteBlock } from '../../design/Note.tsx'
import { Skeleton } from '../../design/Skeleton.tsx'
import { useViewer } from '../../viewAs/ViewAs.tsx'
import { AttentionItem } from './AttentionItem.tsx'
import { orderNeeds, type NeedItem } from './needs.ts'

/** Needs you (§9.4): one row per thing waiting on this member, in its order — overdue, waiting on you by deadline,
 *  failed reads, waiting on others — in a raised surface, a hairline between rows. `items` null is the first load
 *  (two skeleton rows); `error` is a note with Try again; nothing left is "Nothing waits on you." and the Systems
 *  line (`systemsLine`, "9 Systems read 4 min ago, none failing.") centred in a dashed block. An item the viewer
 *  may not see is not drawn, and leaves no gap (§6.3). */
export function NeedsList({ items, error, onRetry, systemsLine, now }: {
  items: NeedItem[] | null; error?: string; onRetry?(): void; systemsLine: string; now: Date
}) {
  const { visible } = useViewer()
  if (error !== undefined) {
    return <Note state="error" action={onRetry && <button type="button" onClick={onRetry}>Try again</button>}>{error}</Note>
  }
  if (items === null) return <div className="needs"><Skeleton rows={2} shape="needs" label="Needs you" /></div>
  const shown = orderNeeds(visible(items), now)
  if (shown.length === 0) {
    return (
      <div className="needs-empty">
        <NoteBlock title="Nothing waits on you." line={systemsLine} action={<span className="needs-empty-g"><Icon name="check" size="lg" /></span>} />
      </div>
    )
  }
  return (
    <div className="needs">
      <ul className="needs-ul" role="list" aria-label="Needs you">
        {shown.map(item => <li key={item.id} className="need-li"><AttentionItem item={item} now={now} /></li>)}
      </ul>
    </div>
  )
}
