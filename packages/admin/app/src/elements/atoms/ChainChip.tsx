import { useId, useState } from 'react'
import { CHAIN_NAMES, TEST_CHAINS, chainName } from './chain.ts'

/** A chain's name as a chip says it: the table's name, "· test" on a test network, or the CAIP-2 id in Mono. */
function ChainText({ caip2 }: { caip2: string }) {
  if (!Object.hasOwn(CHAIN_NAMES, caip2)) return <span className="chain-id">{caip2}</span>
  return <>{TEST_CHAINS.has(caip2) ? `${chainName(caip2)} · test` : chainName(caip2)}</>
}

/** The chains named one by one, as plain chips: what a several-chains chip opens, and the door's treasury list. */
export function ChainList({ chains }: { chains: readonly string[] }) {
  return (
    <span className="chain-list" role="list">
      {chains.map(c => <span key={c} role="listitem" className={TEST_CHAINS.has(c) ? 'chain chain-test' : 'chain'}><ChainText caip2={c} /></span>)}
    </span>
  )
}

/** The chain chip (§7.6): a neutral pill, never a brand's logo or colour. One chain is its name ("Celo") after a
 *  hollow circle; a test network is dashed ("Sepolia · test"); an unknown chain is its CAIP-2 id in Mono.
 *  Several read "7 chains" after three bars, and hover, focus or a tap opens the list of their names (also
 *  the chip's description). `agree` below the count is a disagreement, in clay: "6 of 7 agree". `still` draws
 *  several chains as a plain chip, not a button, their names said after the count for a screen reader: for a chip
 *  inside a link (a Needs you row), where a control of its own is not allowed. */
export function ChainChip({ chains, agree, still = false }: { chains: string[]; agree?: number; still?: boolean }) {
  const [open, setOpen] = useState(false)
  const popId = useId()
  const descId = useId()
  if (chains.length === 0) return null
  const split = agree !== undefined && agree < chains.length
  const glyph = <span className="chain-glyph" aria-hidden="true" />

  if (chains.length === 1) {
    const one = chains[0]!
    const cls = ['chain', TEST_CHAINS.has(one) && 'chain-test', split && 'chain-split'].filter(Boolean).join(' ')
    return <span className={cls}>{glyph}{split ? `${agree} of 1 agree` : <ChainText caip2={one} />}</span>
  }

  const words = split ? `${agree} of ${chains.length} agree` : `${chains.length} chains`
  if (still) {
    return <span className={split ? 'chain chain-split' : 'chain chain-multi'}>{glyph}{words}<span className="sr-only">: {chains.map(chainName).join(', ')}</span></span>
  }
  return (
    <span className="chain-wrap" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" className={split ? 'chain chain-split' : 'chain chain-multi'}
        aria-expanded={open} aria-controls={popId} aria-describedby={descId}
        onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onClick={() => setOpen(true)}
        onKeyDown={e => { if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); setOpen(false) } }}>
        {glyph}{words}
      </button>
      <span id={descId} className="sr-only">{chains.map(chainName).join(', ')}</span>
      <span id={popId} className="chain-pop popover" hidden={!open}><ChainList chains={chains} /></span>
    </span>
  )
}
