import { useEffect, useId, useState } from 'react'
import { HouseMap } from '../map/HouseMap.tsx'
import { HouseNode } from '../map/HouseNode.tsx'
import { ageText } from '../time.ts'
import type { DoorModel } from './door.ts'

/** The map plate (§12.3): a raised plate, radius 22, its head "How the DAO is arranged" in Fraunces 24 and "Read from
 *  its own records · 4 min ago" as its eyebrow, then the DAO map in its door variant: read-only, each node a link to
 *  the section that shows it, with no attention, staged or draft state (C-32). The map lays itself out in the
 *  browser, by its own width; until then — on the server, and in the first draw that takes over the server's HTML —
 *  the plate holds the same nodes as a still list of the same links, so a door read without script has them too. */
export function MapPlate({ map, now }: { map: DoorModel['map']; now: Date }) {
  const [live, setLive] = useState(false)
  const headId = useId()
  useEffect(() => { setLive(true) }, [])
  const age = ageText(map.readAt, now)
  return (
    <section className="door-plate" aria-labelledby={headId}>
      <div className="door-plate-h">
        <h2 className="door-plate-t" id={headId}>How the DAO is arranged</h2>
        <p className="door-eyebrow">Read from its own records{age && <> · <time dateTime={map.readAt} title={map.readAt} data-volatile="" suppressHydrationWarning>{age}</time></>}</p>
      </div>
      {live
        ? <HouseMap items={map.items} links={map.links} variant="door" />
        : (
          <ul className="door-map-still" aria-label={`${map.items.length} ${map.items.length === 1 ? 'System' : 'Systems'}, as a list`}>
            {map.items.map(d => <li key={d.item.id}><HouseNode data={d} variant="door" /></li>)}
          </ul>
        )}
    </section>
  )
}
