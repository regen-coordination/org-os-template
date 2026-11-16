import { useEffect, useId, useRef, useState } from 'react'
import type { DeployStep } from '../../api.ts'
import { Button, ButtonLink } from '../../design/Button.tsx'
import { Icon } from '../../design/Icon.tsx'
import { KindTile } from '../../design/KindTile.tsx'
import { announce } from '../../parts/live.tsx'
import { safeHref } from '../../systems/DriverView.tsx'
import { AddressChip } from '../atoms/AddressChip.tsx'
import { Amount } from '../atoms/Amount.tsx'
import { ChainChip } from '../atoms/ChainChip.tsx'
import { exactPlaces, nativeUnit, shortAddress, unitsToDecimal } from '../atoms/chain.ts'

/** The line an account step always says (L7-D5, L4c's "the Hub never signs"): an account step is run by whoever runs
 *  the deployment, from their own wallet; the Hub connects to no wallet. */
export const SIGN_IT_YOURSELF = 'Sign this from your own wallet. The Hub never signs.'
const REFUSED = 'Couldn’t copy. Select the data and copy it.'
/** Who signs step 9 (Register the daoURI): its resolver refuses any other account (M-3). /deploy's row says it too. */
export const ENS_OWNER = 'The ENS name’s owner, from their own wallet'
/** Who signs an account step, from the step (M-3): step 9 the name's owner, any other any account. */
export const accountSigner = (step: DeployStep): string =>
  step.id === 'registration:daouri' ? ENS_OWNER : 'Any account signs it, from its own wallet'

/** The account-step card (DAO-OS L7 Task 18, spec §8.2–§8.3): a deployment step any account signs from its own wallet
 *  (create the Safe, mint the top hat, deploy the gate, register the signers, register the daoURI). The prepared
 *  card's frame (`ptx`, PreparedTx): the wallet tile, the step's title and who signs it, the chain chip; its one call
 *  in words with the `to` chip and what it moves; the unsigned transaction in a Mono well (the chain and its id, `to`,
 *  the value in base units, the data); and the foot, which always says that the Hub never signs, with Copy data and
 *  Open <to> on the explorer ↗ (secondary: the page's one primary is Read back). A step with no call (one that waits,
 *  the Snapshot space's settings) draws nothing. Copying is the person's own; nothing is sent or staged. */
export function AccountStep({ step }: { step: DeployStep }) {
  const titleId = useId()
  const [refused, setRefused] = useState(false)
  const shown = useRef<HTMLPreElement>(null)
  useEffect(() => {
    if (!refused || !shown.current) return
    try { window.getSelection()?.selectAllChildren(shown.current) } catch { /* nothing selectable: the data is still shown */ }
  }, [refused])
  const call = step.step?.call
  if (!call) return null

  const to = call.to.split(':').at(-1) ?? call.to
  const chainId = call.chain.split(':').at(-1) ?? ''
  const moves = /^\d+$/.test(call.value) && BigInt(call.value) > 0n
  const amount = moves ? unitsToDecimal(call.value, 18) : null
  const explorer = safeHref(step.link)

  async function copy() {
    try {
      const board = typeof navigator === 'undefined' ? undefined : navigator.clipboard
      if (!board?.writeText) throw new Error('no clipboard here')
      await board.writeText(call!.data)
    } catch {
      setRefused(true)
      announce(REFUSED)
      return
    }
    setRefused(false)
    announce('Copied the data.')
  }

  return (
    <section className="ptx" aria-labelledby={titleId}>
      <div className="ptx-h">
        <KindTile kind="wallet" />
        <div className="ptx-main">
          <div className="ptx-t" id={titleId}>{step.title}</div>
          <div className="ptx-s">{accountSigner(step)}</div>
        </div>
        <div className="ptx-end"><ChainChip chains={[call.chain]} /></div>
      </div>
      <ol className="ptx-calls">
        <li className="ptx-call">
          <span className="ptx-n" aria-hidden="true">1</span>
          <div className="ptx-cm">
            <div className="ptx-ct">{call.summary}</div>
            <div className="ptx-cs">to <AddressChip value={to} chain={call.chain} /></div>
          </div>
          {amount && <Amount value={amount} unit={nativeUnit(call.chain)} decimals={Math.max(2, exactPlaces(amount))} size="body" />}
        </li>
      </ol>
      <dl className="ptx-well">
        <dt>chain</dt><dd>{call.chain} · chain id {chainId}</dd>
        <dt>to</dt><dd>{to}</dd>
        <dt>value</dt><dd>{call.value}</dd>
        <dt>data</dt><dd>{call.data}</dd>
      </dl>
      <div className="ptx-foot">
        <span className="ptx-never"><Icon name="key" size="sm" />{SIGN_IT_YOURSELF}</span>
        <span className="ptx-acts">
          <Button variant="ghost" onClick={() => { void copy() }}>Copy data</Button>
          {explorer && <ButtonLink href={explorer} external>Open {shortAddress(to)} on the explorer</ButtonLink>}
        </span>
      </div>
      {refused && <pre ref={shown} className="ptx-sel">{call.data}</pre>}
    </section>
  )
}
