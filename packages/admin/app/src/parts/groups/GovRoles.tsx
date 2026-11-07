import { FundFlow } from '../../elements/governance/FundFlow.tsx'
import { RoleTree } from '../../elements/governance/RoleTree.tsx'
import type { RoleNode } from '../../elements/governance/roles.ts'
import { DEEP_TREE, FLOWS, FLOW_SAFE, FLOW_WINDOW, MIXED_FLOWS, ROLE_TREE, ROLE_TREE_OPEN } from '../../test/fixtures/house/governance.ts'
import { Card } from './spec.tsx'

const noop = () => {}
const everyId = (nodes: RoleNode[]): string[] => nodes.flatMap(n => [n.id, ...everyId(n.children)])

/** /parts/gov-roles (§9.7–9.8, B6): the gallery's "gov" section, its second screen — one record could not hold the
 *  whole section within 150 KiB (ruling B4-a). The role tree as tree #13 reads (two empty hats, yours, wearers who made
 *  theirs public, address chips, Local nodes closed) and six levels deep (200 wearers, a hat with no name); then the
 *  fund flow full width, in one unit and in two (under 600px of it, its list). Fixtures. */
export default function GovRoles() {
  return (
    <div className="pg">
      <p className="pg-lede">Wearers are a count or an address unless the person made theirs public. The fund flow’s bands follow each flow’s share of the value moved.</p>
      <div className="pg-grid pg-two">
        <Card cap="role tree · Hats tree #13 · arrows move, → opens, ← closes">
          <RoleTree nodes={ROLE_TREE} defaultOpen={ROLE_TREE_OPEN} label="Hats tree 13" onOpen={noop} onInspect={noop} />
        </Card>
        <Card cap="role tree · six levels deep, 200 wearers, a hat with no name">
          <RoleTree nodes={DEEP_TREE} defaultOpen={everyId(DEEP_TREE)} label="Hats tree 14" onOpen={noop} onInspect={noop} />
        </Card>
      </div>
      <Card cap="fund flow · last 90 days · band width follows each flow’s share of value moved">
        <FundFlow flows={FLOWS} safe={FLOW_SAFE} window={FLOW_WINDOW} />
      </Card>
      <Card cap="fund flow · two units in the window: equal bands, each amount labelled">
        <FundFlow flows={MIXED_FLOWS} safe={FLOW_SAFE} window={FLOW_WINDOW} />
      </Card>
    </div>
  )
}
