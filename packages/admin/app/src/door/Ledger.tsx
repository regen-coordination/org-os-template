import { doorDate, type DoorModel } from './door.ts'

const STATE: Record<DoorModel['decisions'][number]['state'], { word: string; verb: string }> = {
  open: { word: 'Open', verb: 'opened' },
  executed: { word: 'Executed', verb: 'executed' },
  decided: { word: 'Decided', verb: 'decided' },
}

/** The decisions ledger (§12.4, 04): a row each — the id in Mono faint (120px), the title in Fraunces 19 over its
 *  route and date, and the state pill (Open; Executed in moss soft). The door has no page of its own for a decision
 *  yet, so a row is a row, not a link. */
export function Ledger({ decisions }: { decisions: DoorModel['decisions'] }) {
  return (
    <ul className="door-ledger">
      {decisions.map(d => {
        const s = STATE[d.state]
        return (
          <li key={d.id} className="door-row">
            <span className="door-row-id">{d.id}</span>
            <span className="door-row-m">
              <span className="door-row-t">{d.title}</span>
              <span className="door-row-s">{d.route} · {s.verb} {doorDate(d.date)}</span>
            </span>
            <span className={d.state === 'executed' ? 'door-pill is-done' : 'door-pill'}>{s.word}</span>
          </li>
        )
      })}
    </ul>
  )
}

/** The writing ledger (§12.4, 05): each published page's title, a link, and its date. */
export function WritingLedger({ writing }: { writing: DoorModel['writing'] }) {
  return (
    <ul className="door-ledger">
      {writing.map(w => (
        <li key={w.href + w.title} className="door-row door-row-w">
          <a className="door-row-t" href={w.href}>{w.title}</a>
          <time className="door-row-s" dateTime={w.date}>{doorDate(w.date)}</time>
        </li>
      ))}
    </ul>
  )
}
