import { AddressChip } from '../elements/atoms/AddressChip.tsx'
import { Amount } from '../elements/atoms/Amount.tsx'
import { chainName } from '../elements/atoms/chain.ts'
import type { DoorModel } from './door.ts'

/** A grant pool's card (§12.4, 02): radius 18 on --raised; the eyebrow "Grant pool · Celo", the name in Fraunces 24,
 *  the balance as a rounded display figure with its unit in Mono (copying it copies the exact amount), then what it
 *  funds and its address chip. */
export function PoolCard({ pool }: { pool: DoorModel['pools'][number] }) {
  return (
    <article className="door-card door-pool">
      <p className="door-eyebrow">Grant pool · {chainName(pool.chain)}</p>
      <h3 className="door-card-t">{pool.name}</h3>
      <p className="door-fig"><Amount value={pool.balance} unit={pool.unit} decimals={0} /></p>
      <div className="door-pool-r">
        <span className="door-pool-p">{pool.purpose}</span>
        <AddressChip value={pool.address} chain={pool.chain} />
      </div>
    </article>
  )
}
