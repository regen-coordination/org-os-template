import { useEffect, useId, useState } from 'react'
import { HouseMap } from '../map/HouseMap.tsx'
import { HouseNode } from '../map/HouseNode.tsx'
import { ageText } from '../time.ts'
import type { PortalModel } from './portal.ts'

/** The map plate (§12.3): a raised plate, radius 22, its head "How the DAO is arranged" in Fraunces 24 and "Read from
 *  its own records · 4 min ago" as its eyebrow, then the DAO map in its portal variant: read-only, each node a link to
 *  the section that shows it, with no attention, staged or draft state (C-32). The map lays itself out in the
 *  browser, by its own width; until then — on the server, and in the first draw that takes over the server's HTML —
 *  the plate holds the same nodes as a still list of the same links, so a portal read without script has them too. */
export function MapPlate({ map, now }: { map: PortalModel['map']; now: Date }) {
  const [live, setLive] = useState(false)
  const headId = useId()
  useEffect(() => { setLive(true) }, [])
  const age = ageText(map.readAt, now)
  return (
    <section className="portal-plate" aria-labelledby={headId}>
      <div className="portal-plate-h">
        <h2 className="portal-plate-t" id={headId}>How the DAO is arranged</h2>
        <p className="portal-eyebrow">Read from its own records{age && <> · <time dateTime={map.readAt} title={map.readAt} data-volatile="" suppressHydrationWarning>{age}</time></>}</p>
      </div>
      {live
        ? <HouseMap items={map.items} links={map.links} variant="portal" />
        : (
          <ul className="portal-map-still" aria-label={`${map.items.length} ${map.items.length === 1 ? 'System' : 'Systems'}, as a list`}>
            {map.items.map(d => <li key={d.item.id}><HouseNode data={d} variant="portal" /></li>)}
          </ul>
        )}
    </section>
  )
}
