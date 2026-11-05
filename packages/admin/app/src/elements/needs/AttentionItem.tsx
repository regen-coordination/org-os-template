import { Link } from 'wouter'
import { Icon, type IconName } from '../../design/Icon.tsx'
import { KindTile } from '../../design/KindTile.tsx'
import { Meter } from '../../design/Meter.tsx'
import { ChainChip } from '../atoms/ChainChip.tsx'
import { trailingText, type NeedItem, type NeedKind } from './needs.ts'

/** The glyph on a waiting item's clay tile, by what it waits on (§9.4). */
const GLYPH: Record<NeedKind, IconName> = {
  proposal: 'proposal', signature: 'pen', 'empty-hat': 'hat', 'failed-read': 'alert', 'chains-disagree': 'safe', overdue: 'clock',
}

/** One Needs you item (§9.4): a 72px row, one link — the 32px tile (clay with the need's glyph while it waits on you;
 *  neutral with a check once you acted), the title (14/500, two lines at most), the meta line (the id in Mono, the
 *  route or the chains, the meter and its words, the context) and the trailing words: the deadline ("Closes in 5
 *  days", clay once past), the link-out ("Open in Safe", a new tab, said in its name) or "Look". */
export function AttentionItem({ item, now }: { item: NeedItem; now: Date }) {
  const others = item.youActed === true
  const trailing = trailingText(item, now)
  const words = trailing.text.replace(/ [↗→]$/, '')
  const arrow: IconName | null = item.external ? 'external' : trailing.late || others ? null : 'arrow-right'
  const meta = item.ref !== undefined || item.route !== undefined || (item.chains?.length ?? 0) > 0 || item.meter !== undefined || item.context !== undefined
  const body = (
    <>
      {others
        ? <KindTile kind={item.kind} size="needs" icon="check" />
        : <KindTile kind={item.kind} size="needs" tone="attn" icon={GLYPH[item.kind]} />}
      <span className="need-main">
        <span className="need-t">{item.title}</span>
        {meta && (
          <span className="need-s">
            {item.ref !== undefined && <span className="mono">{item.ref}</span>}
            {item.route !== undefined && <span>{item.route}</span>}
            {item.chains && <ChainChip chains={item.chains} agree={item.agree} still />}
            {item.meter && <Meter done={item.meter.done} of={item.meter.of} yours={item.meter.yours} words={item.meter.words} />}
            {item.context !== undefined && <span className={item.kind === 'failed-read' ? 'need-ctx need-failed' : 'need-ctx'}>{item.context}</span>}
          </span>
        )}
      </span>
      <span className={trailing.late ? 'need-end need-late' : 'need-end'} data-volatile={trailing.when ? '' : undefined}>
        {words}{arrow && <Icon name={arrow} size="sm" />}
        {item.external && <span className="sr-only"> (opens the Safe app in a new tab)</span>}
      </span>
    </>
  )
  const cls = others ? 'need need-others' : 'need'
  return item.external
    ? <a className={cls} href={item.href} target="_blank" rel="noopener noreferrer">{body}</a>
    : <Link className={cls} href={item.href}>{body}</Link>
}
