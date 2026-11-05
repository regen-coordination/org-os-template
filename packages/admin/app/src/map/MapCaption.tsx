import { KindTile } from '../design/KindTile.tsx'
import { kindWord } from '../elements/records/RecordHeader.tsx'
import { factsLine, type MapNodeData } from './HouseNode.tsx'

/** The caption under the map (§8.5, the prototype's): the selected node's kind tile, its name, its kind and facts in
 *  Mono, and one plain sentence about it; with none, it says how to get one. Not a live region (C11 I-2): the node a
 *  selection lands on says the same words when it takes focus — its name holds the kind, the facts and what it needs,
 *  its description its relations — so the caption is for the eye, and the page keeps its one polite region. */
export function MapCaption({ node, sentence }: { node: MapNodeData | null; sentence: string }) {
  return (
    <div className="hcap">
      {node === null ? 'Select a node to read about it here.' : <>
        <KindTile kind={node.item.kind} />
        <div className="hcap-b">
          <b>{node.item.name}</b> <span className="hcap-f">{[kindWord(node.item.kind), factsLine(node)].filter(Boolean).join(' · ')}</span>
          <p>{sentence}</p>
        </div>
      </>}
    </div>
  )
}
