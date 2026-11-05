import { useRef, useState } from 'react'
import { Seg } from '../../design/Seg.tsx'
import type { Mark } from '../../design/StatusMark.tsx'
import { DataList } from '../../elements/rows/DataList.tsx'
import { DataRow } from '../../elements/rows/DataRow.tsx'
import { useViewToggle, type ListView } from '../../keys/useViewToggle.ts'
import { HouseMap } from '../../map/HouseMap.tsx'
import { HouseNode, factsLine, type MapNodeData, type NodeState } from '../../map/HouseNode.tsx'
import { DOOR_NODES, MAP_ANATOMY, MAP_FLOW, MAP_LINKS, MAP_NODES, MAP_TREASURY } from '../../test/fixtures/house/map.ts'
import { Card } from './spec.tsx'

const noop = () => {}
const MARKS: Partial<Record<NodeState, Mark>> = { needs: 'needs', staged: 'staged', failed: 'failed', aged: 'aged', draft: 'draft' }
const marksOf = (d: MapNodeData): Mark[] => d.states.flatMap(s => (MARKS[s] ? [MARKS[s]!] : []))

/** The members' map with its List twin one key away (`v`, §8.5): the same Systems as data rows. */
function MembersMap() {
  const box = useRef<HTMLDivElement>(null)
  const [view, setView] = useViewToggle('map', box)
  const [selected, setSelected] = useState<string | null>(MAP_TREASURY.id)
  return (
    <div ref={box} className="pg-mapview">
      <Seg<ListView> label="View" value={view} onChange={setView} icons={{ list: 'list', map: 'map' }}
        options={[{ value: 'list', label: 'List' }, { value: 'map', label: 'Map' }]} />
      {view === 'map'
        ? <HouseMap items={MAP_NODES} links={MAP_LINKS} variant="members" selected={selected} onSelect={setSelected} onOpen={noop} onInspect={noop} caption />
        : <DataList label="The DAO’s Systems">{MAP_NODES.map(d => (
          <DataRow key={d.item.id} kind={d.item.kind} title={d.item.name} second={factsLine(d)} marks={marksOf(d)} item={d.item}
            selected={d.item.id === selected} onPreview={noop} />
        ))}</DataList>}
    </div>
  )
}

/** /parts/map (§8, B8): the DAO map as members see it, the Treasury selected (its path moss, the rest dimmed) with the
 *  caption under it; one node in each state; value moving along transaction 18's edges (shot under reduced motion,
 *  so the still path); the map on a phone; and the door's map, read-only. Fixtures. */
export default function MapGroup() {
  return (
    <div className="pg">
      <p className="pg-lede">Systems and roles as nodes, authority as edges, in layers: who decides at the top, the Safe at the centre, what it feeds below, linked Systems to the side. Attention on a node matches Needs you. When a transaction is prepared, value moves along the edges it touches three times, then the path stays moss.</p>
      <Card cap="the DAO map · members · the Treasury selected · v for the list">
        <MembersMap />
      </Card>
      <Card cap="node anatomy · name · kind glyph · one line of facts in Mono · marks">
        <div className="pg-anatomy">
          {MAP_ANATOMY.map(a => <div key={a.state} className="pg-anat"><span className="pg-cap">{a.state}</span><HouseNode data={a.node} /></div>)}
        </div>
      </Card>
      <div className="pg-grid pg-two">
        <Card cap="value moving · transaction 18 prepared · reduced motion: the path at once">
          <HouseMap items={MAP_NODES} links={MAP_LINKS} variant="members" flow={MAP_FLOW} onSelect={noop} onOpen={noop} onInspect={noop} />
        </Card>
        <Card cap="map on a phone · the same layers in three columns">
          <div className="pg-phone-map">
            <HouseMap items={MAP_NODES} links={MAP_LINKS} variant="members" onSelect={noop} onOpen={noop} onInspect={noop} />
          </div>
        </Card>
      </div>
      <Card cap="the door · public records, read-only, each node a link">
        <HouseMap items={DOOR_NODES} links={MAP_LINKS} variant="door" />
      </Card>
    </div>
  )
}
