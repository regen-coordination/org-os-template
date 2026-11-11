import { portalDate, type PortalModel } from './portal.ts'

const STATE: Record<PortalModel['decisions'][number]['state'], { word: string; verb: string }> = {
  open: { word: 'Open', verb: 'opened' },
  executed: { word: 'Executed', verb: 'executed' },
  decided: { word: 'Decided', verb: 'decided' },
}

/** The decisions ledger (§12.4, 04): a row each — the id in Mono faint (120px), the title in Fraunces 19 over its
 *  route and date, and the state pill (Open; Executed in moss soft). The portal has no page of its own for a decision
 *  yet, so a row is a row, not a link. */
export function Ledger({ decisions }: { decisions: PortalModel['decisions'] }) {
  return (
    <ul className="portal-ledger">
      {decisions.map(d => {
        const s = STATE[d.state]
        return (
          <li key={d.id} className="portal-row">
            <span className="portal-row-id">{d.id}</span>
            <span className="portal-row-m">
              <span className="portal-row-t">{d.title}</span>
              <span className="portal-row-s">{d.route} · {s.verb} {portalDate(d.date)}</span>
            </span>
            <span className={d.state === 'executed' ? 'portal-pill is-done' : 'portal-pill'}>{s.word}</span>
          </li>
        )
      })}
    </ul>
  )
}

/** The writing ledger (§12.4, 05): each published page's title, a link, and its date. */
export function WritingLedger({ writing }: { writing: PortalModel['writing'] }) {
  return (
    <ul className="portal-ledger">
      {writing.map(w => (
        <li key={w.href + w.title} className="portal-row portal-row-w">
          <a className="portal-row-t" href={w.href}>{w.title}</a>
          <time className="portal-row-s" dateTime={w.date}>{portalDate(w.date)}</time>
        </li>
      ))}
    </ul>
  )
}
