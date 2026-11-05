import { ComposeCanvas } from '../../elements/compose/ComposeCanvas.tsx'
import { MiniMap } from '../../record/MiniMap.tsx'
import {
  COMPOSE_CHAIN, COMPOSE_EDGES, COMPOSE_NODES, COMPOSE_SHELF, INSPECTOR_NEIGHBOURS, INSPECTOR_RECORD, MINI_NEIGHBOURS, MINI_RECORD,
} from '../../test/fixtures/house/map.ts'
import { Card } from './spec.tsx'

const noop = () => {}

/** /parts/map-compose (§8.6, §8.7; B9): the small map on a record page — the open proposal and seven Systems it
 *  touches, so the seventh is "+1 on the map" — and in the inspector; then the compose canvas, a test DAO on Sepolia
 *  with the Signers selected (its four handles, its inspector) and a link that cannot sign for a Safe. The map's
 *  record could not hold them under 150 KiB (B4-a), so they are a group of their own (ruling B9-1). Fixtures. */
export default function MapCompose() {
  return (
    <div className="pg">
      <p className="pg-lede">Every record page carries a small map: the record and what it touches, one hop out, on a fixed template. The compose canvas is the map, editable: what is placed is a draft with its deployment order until it is read back, and every action stages a change — nothing writes.</p>
      <div className="pg-grid pg-two">
        <Card cap="small map · a record page · the record and up to six neighbours, one hop">
          <MiniMap centre={MINI_RECORD} neighbours={MINI_NEIGHBOURS} />
        </Card>
        <Card cap="small map · in the inspector · 188 tall">
          <div className="pg-mini-insp"><MiniMap centre={INSPECTOR_RECORD} neighbours={INSPECTOR_NEIGHBOURS} size="inspector" /></div>
        </Card>
      </div>
      <Card cap="compose canvas · the Signers selected · a link that cannot sign for a Safe">
        <ComposeCanvas shelf={COMPOSE_SHELF} nodes={COMPOSE_NODES} edges={COMPOSE_EDGES} chain={COMPOSE_CHAIN} onStage={noop} selected="signers" />
      </Card>
    </div>
  )
}
