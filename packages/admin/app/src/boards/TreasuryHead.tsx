import type { ReactNode } from 'react'
import { PageHead } from '../design/PageHead.tsx'
import { RecordHeader } from '../elements/records/RecordHeader.tsx'
import { systemFacts } from '../elements/rows/systemState.ts'
import { useMainSafe } from '../blocks/balances.tsx'

/** Treasury's head (§14.1): the main Safe's System header — its kind tile, "Safe · System", its name, chains,
 *  address, signers and read age, the from mark of its read (E-47), Open in Safe — or, with no Safe the viewer may see,
 *  the board's own title. `title` is the board's name; `children` its actions (Arrange). */
export function TreasuryHead({ title, now, meta, children }: { title: string; now: Date; meta: string[]; children?: ReactNode }) {
  const { safe } = useMainSafe()
  if (!safe) return <PageHead title={title} meta={meta}>{children}</PageHead>
  const f = systemFacts(safe)
  const address = f.address && 'chip' in f.address ? f.address.chip : undefined
  return (
    <>
      <RecordHeader variant="system" kind={f.kind} name={safe.name} chain={f.chains} address={address} governs={f.governs ?? undefined}
        read={f.read} now={now} open={f.open ?? undefined} from={{ system: safe.name, read: f.read }} />
      {meta.length > 0 && <p className="board-note">{meta.join(' · ')}</p>}
      {children && <div className="rh-acts">{children}</div>}
    </>
  )
}
