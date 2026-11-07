import type { JSX } from 'react'
import { GROUPS } from './list.ts'
import { NotDrawn } from './NotDrawn.tsx'
import Tokens from './Tokens.tsx'
import Controls from './Controls.tsx'
import Atoms from './Atoms.tsx'
import Frame from './Frame.tsx'
import TrayGroup from './Tray.tsx'
import Blocks from './Blocks.tsx'
import Machines from './Machines.tsx'
import Rows from './Rows.tsx'
import Needs from './Needs.tsx'
import Views from './Views.tsx'
import Gov from './Gov.tsx'
import GovRoles from './GovRoles.tsx'
import MapGroup from './Map.tsx'
import MapCompose from './MapCompose.tsx'
import Door from './Door.tsx'
import Lib from './Lib.tsx'
import Work from './Work.tsx'

export interface PartsGroup { id: string; label: string; Component: () => JSX.Element }

/** Each drawn group's component; a group not drawn yet is the "Not drawn yet." note. */
const DRAWN: Record<string, () => JSX.Element> = { tokens: Tokens, frame: Frame, controls: Controls, atoms: Atoms, rows: Rows, needs: Needs, views: Views, map: MapGroup, 'map-compose': MapCompose, gov: Gov, 'gov-roles': GovRoles, work: Work, lib: Lib, tray: TrayGroup, door: Door, blocks: Blocks, machines: Machines }

/** /parts by section (ruling L4-R1): the gallery's groups in its order, then 0.6's blocks and machines. */
export const PARTS_GROUPS: readonly PartsGroup[] = GROUPS.map(g => ({ id: g.id, label: g.label, Component: DRAWN[g.id] ?? NotDrawn }))

export { NotDrawn }
