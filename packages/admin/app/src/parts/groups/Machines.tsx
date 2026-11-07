import type { Machine } from '../../../../lib/machines/run.mjs'
import { change } from '../../../../lib/machines/change.mjs'
import { proposal } from '../../../../lib/machines/proposal.mjs'
import { job } from '../../../../lib/machines/job.mjs'
import { reading } from '../../../../lib/machines/reading.mjs'
import { board } from '../../../../lib/machines/board.mjs'
import { wizard } from '../../../../lib/machines/wizard.mjs'
import { editor } from '../../machines/editor.ts'
import { block } from '../../machines/block.ts'
import { arrange } from '../../machines/arrange.ts'
import { drop } from '../../machines/drop.ts'
import { panels } from '../../machines/panels.ts'
import { tray } from '../../machines/tray.ts'
import { palette } from '../../machines/palette.ts'
import { libraryEntry } from '../../machines/libraryEntry.ts'
import { propose } from '../../machines/propose.ts'
import { Section } from '../../design/Section.tsx'
import { MachineDiagram } from '../MachineDiagram.tsx'

const MACHINES: Machine[] = [change, proposal, job, reading, board, editor, block, arrange, drop, panels, tray, palette, libraryEntry, propose, wizard]

/** Every state machine, drawn (0.6's machine diagrams, kept on /parts; spec §14.2). */
export default function Machines() {
  return (
    <>
      <Section label="Machines">
        {MACHINES.map(m => <div key={m.id} className="parts-machine"><h3 className="pg-cap">{m.id}</h3><MachineDiagram machine={m} /></div>)}
      </Section>
    </>
  )
}
