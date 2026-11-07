import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Button, ButtonLink } from '../../design/Button.tsx'
import { Icon, type IconName } from '../../design/Icon.tsx'
import { KindTile, type KindTileTone } from '../../design/KindTile.tsx'
import { Meter } from '../../design/Meter.tsx'
import { Spinner } from '../../design/Spinner.tsx'
import { StatusMark } from '../../design/StatusMark.tsx'
import { announce } from '../../parts/live.tsx'
import { ageText } from '../../time.ts'
import { useCanWrite } from '../../viewAs/ViewAs.tsx'
import { AddressChip } from '../atoms/AddressChip.tsx'
import { Amount } from '../atoms/Amount.tsx'
import { ChainChip } from '../atoms/ChainChip.tsx'
import { ReadAge } from '../atoms/ReadAge.tsx'
import { chainName, exactPlaces, formatAmount, unitsToDecimal } from '../atoms/chain.ts'
import { payloadJson, totalsOf, type PreparedView } from './prepared.ts'

/** The line every prepared card keeps, in every state (§9.6): the house prepares; signers sign elsewhere. */
export const NEVER_SIGNS = 'The Hub never signs. Signers review and sign this in the Safe app.'
const REFUSED = 'Couldn’t copy. Select the payload and copy it.'
/** An amount as the card draws it (L4b-M5, M5-b): exact, every significant decimal, at least the house's 2 places
 *  ("1,271.00", "3,100.125", "0.000000000000000001"), for signers must see what they sign. */
function Exact({ value, unit, size }: { value: string; unit: string; size?: 'body' }) {
  return <Amount value={value} unit={unit} decimals={Math.max(2, exactPlaces(value))} size={size} />
}

/** An account as its chip shows it: a CAIP-10 id is the address with its chain (the chip's title), anything else as given. */
function Account({ value }: { value: string }) {
  const m = /^(.+):(0x[0-9a-fA-F]{40})$/.exec(value)
  return m ? <AddressChip value={m[2]!} chain={m[1]!} /> : <AddressChip value={value} />
}

interface Head { tone: KindTileTone; icon: IconName; title: string; sub: ReactNode; end: ReactNode }

/** The head in each state (§9.6's table): the tile, the title, the line under it, and what trails it. A failed read
 *  of the Safe keeps the state's head, its meter mute, and adds the failed age to the line under the title (beside
 *  the meter it would squeeze the title to a column). */
function headOf(tx: PreparedView, now: Date, prepareAgain: (() => void) | null): Head {
  const head = stateHead(tx, prepareAgain)
  if (!tx.readFailed) return head
  return { ...head, sub: <>{head.sub}<ReadAge state="failed" readAt={tx.failedAge ?? null} now={now} /></> }
}

function stateHead(tx: PreparedView, prepareAgain: (() => void) | null): Head {
  const safe = /\bsafe$/i.test(tx.safe.name) ? tx.safe.name : `${tx.safe.name} Safe`
  const nonce = <span className="mono">nonce {tx.nonce}</span>
  const where = <>{safe} · {nonce}</>
  const chip = tx.safe.chain ? <ChainChip chains={[tx.safe.chain]} /> : null
  const words = tx.of > 0 ? `${tx.signed} of ${tx.of} signed` : tx.signed > 0 ? `${tx.signed} signed` : 'Not signed yet'
  const counted = tx.of > 0 ? <Meter done={tx.signed} of={tx.of} yours={tx.yours} words={words} /> : <span className="meter-l">{words}</span>
  const meter = tx.readFailed ? <span className="ptx-mute">{counted}</span> : counted
  const plain = { tone: 'plain' as const, icon: 'layers' as const }
  const clay = { tone: 'attn' as const, icon: 'alert' as const }
  switch (tx.state) {
    case 'preparing':
      return { ...plain, title: 'Preparing', sub: <><Spinner />Reading the nonce from the Safe…</>, end: null }
    case 'ready':
      return { ...plain, title: 'Ready to execute', sub: `${words} · any signer can execute it in the Safe`, end: <>{chip}<StatusMark mark="open" label="Not executed" /></> }
    case 'executed':
      return tx.outcome?.failed
        ? { ...clay, title: 'Executed and read back', sub: <>{nonce} · the transaction failed</>, end: <>{chip}<StatusMark mark="failed" label="Failed" /></> }
        : { tone: 'moss', icon: 'check', title: 'Executed and read back', sub: <>{nonce} · matched what was prepared</>, end: <>{chip}<StatusMark mark="done" label="Done" /></> }
    case 'mismatch':
      return { ...clay, title: 'Not what was prepared', sub: where, end: chip }
    case 'replaced':
      return { ...clay, title: `Nonce ${tx.nonce} was used by another transaction`, sub: 'Nothing from this proposal ran.',
        end: <>{chip}{prepareAgain && <Button small onClick={prepareAgain}>Prepare again</Button>}</> }
    case 'stale':
      return { tone: 'attn', icon: 'clock', title: 'The proposal changed after this was prepared',
        sub: tx.rev ? `Rev ${tx.rev.current} is current; this payload is from rev ${tx.rev.prepared}.` : 'This payload is from an earlier revision.',
        end: <>{chip}<StatusMark mark="stale" label="Stale" /></> }
    default:
      return { ...plain, title: 'Prepared transaction', sub: where, end: <>{chip}{meter}</> }
  }
}

/** The strip after read back (§9.6): moss for an execution that matched, with its block, its age and the transaction
 *  hash; clay for one that failed on chain, or for what differs from what was prepared. */
function Outcome({ tx, now }: { tx: PreparedView; now: Date }) {
  const o = tx.outcome
  if (!o) return null
  const chain = chainName(tx.safe.chain)
  if (tx.state === 'mismatch') {
    return <div className="ptx-out ptx-out-bad"><span className="ptx-out-t"><Icon name="alert" size="sm" /><span>{o.differs?.filter(Boolean).join(' ') || 'Not what was prepared.'}</span></span></div>
  }
  if (tx.state !== 'executed') return null
  if (o.failed) {
    return <div className="ptx-out ptx-out-bad"><span className="ptx-out-t"><Icon name="alert" size="sm" /><span>{`Executed on ${chain}, and the transaction failed. Nothing it would have moved has moved.`}</span></span></div>
  }
  const age = o.readAt ? ageText(o.readAt, now) : ''
  return (
    <div className="ptx-out">
      <span className="ptx-out-t"><Icon name="check" size="sm" /><span>Executed on {chain}{o.block && <> · block <span className="mono">{formatAmount(o.block, 0)}</span></>}{age && ` · read back ${age}`}</span></span>
      {o.txHash && <AddressChip value={o.txHash} />}
    </div>
  )
}

/** The prepared-transaction card (§9.6): a raised card, its own `prepared` container. The head (the state's tile,
 *  title and line; the chain chip and the signatures, or the state's mark), the numbered calls ("from <chip> to
 *  <chip>", the amount at the end), the total in a sunken strip, the payload in a closed `<details>`, and the foot,
 *  which in every state says that the Hub never signs, with Copy payload and Open in Safe ↗ — but not while the
 *  nonce is being read, nor for a payload that was replaced or is stale. The outcome strip comes after read back.
 *  Prepare again (replaced) is a write: drawn only with `onPrepareAgain`, and not while previewing. `brief` draws the
 *  head, its strip and the never-signs line alone: /parts' other states (a specimen form, not for a page). `openPrimary`
 *  false draws Open in Safe as secondary: a page whose header already carries the one primary (§7.1, C7 I-3). */
export function PreparedTx({ tx, now, onPrepareAgain, brief = false, openPrimary = true }:
  { tx: PreparedView; now: Date; onPrepareAgain?: () => void; brief?: boolean; openPrimary?: boolean }) {
  const titleId = useId()
  const canWrite = useCanWrite()
  const [refused, setRefused] = useState(false)
  const shown = useRef<HTMLPreElement>(null)
  useEffect(() => {
    if (!refused || !shown.current) return
    try { window.getSelection()?.selectAllChildren(shown.current) } catch { /* nothing selectable: the JSON is still shown */ }
  }, [refused])

  const head = headOf(tx, now, canWrite && onPrepareAgain ? onPrepareAgain : null)
  const foot = <span className="ptx-never"><Icon name="key" size="sm" />{NEVER_SIGNS}</span>
  const top = (
    <>
      <div className="ptx-h">
        <KindTile kind="safe" tone={head.tone} icon={head.icon} />
        <div className="ptx-main"><div className="ptx-t" id={titleId}>{head.title}</div><div className="ptx-s">{head.sub}</div></div>
        <div className="ptx-end">{head.end}</div>
      </div>
      <Outcome tx={tx} now={now} />
    </>
  )
  if (brief) return <section className="ptx ptx-brief" aria-labelledby={titleId}>{top}<div className="ptx-foot">{foot}</div></section>

  async function copy() {
    const json = payloadJson(tx)
    try {
      const board = typeof navigator === 'undefined' ? undefined : navigator.clipboard
      if (!board?.writeText) throw new Error('no clipboard here')
      await board.writeText(json)
    } catch {
      setRefused(true)
      announce(REFUSED)
      return
    }
    setRefused(false)
    announce('Copied the payload.')
  }

  const p = tx.payload
  const totals = totalsOf(tx.calls)
  const acts = tx.state !== 'preparing' && tx.state !== 'replaced' && tx.state !== 'stale'
  return (
    <section className="ptx" aria-labelledby={titleId}>
      {top}
      {tx.calls.length === 0 ? <p className="ptx-none">No calls</p> : (
        <ol className="ptx-calls">
          {tx.calls.map((c, i) => (
            <li key={i} className="ptx-call">
              <span className="ptx-n" aria-hidden="true">{i + 1}</span>
              <div className="ptx-cm">
                <div className="ptx-ct">{c.title}</div>
                <div className="ptx-cs">{c.from ? <>from <Account value={c.from} />{' '}</> : null}to <Account value={c.to} /></div>
              </div>
              {c.amount && <Exact value={unitsToDecimal(c.amount.raw, c.amount.decimals)} unit={c.amount.unit} size="body" />}
            </li>
          ))}
        </ol>
      )}
      {tx.calls.length > 0 && totals.length > 0 && (
        <div className="ptx-total">
          <span className="ptx-total-w">{tx.total}</span>
          <span className="ptx-sums">{totals.map(t => <Exact key={`${t.unit}-${t.decimals}`} value={t.value} unit={t.unit} />)}</span>
        </div>
      )}
      {tx.state !== 'preparing' && (
        <details className="ptx-payload">
          <summary><Icon name="chevron-right" size="sm" />Payload</summary>
          <dl className="ptx-well">
            <dt>to</dt><dd>{p.to}{p.toName && <span className="faint"> ({p.toName})</span>}</dd>
            <dt>value</dt><dd>{p.value}</dd>
            <dt>operation</dt><dd>{p.operation} · {p.operation === 1 ? 'delegatecall' : 'call'}</dd>
            {p.data !== undefined ? <><dt>data</dt><dd>{p.data}</dd></> : <><dt>data hash</dt><dd>{p.dataHash ?? ''}</dd></>}
            <dt>safeTxHash</dt><dd>{p.safeTxHash}</dd>
          </dl>
        </details>
      )}
      <div className="ptx-foot">
        {foot}
        {acts && (
          <span className="ptx-acts">
            <Button variant="ghost" onClick={() => { void copy() }}>Copy payload</Button>
            {tx.openHref && <ButtonLink href={tx.openHref} external primary={openPrimary}>Open in Safe</ButtonLink>}
          </span>
        )}
      </div>
      {refused && <pre ref={shown} className="ptx-sel">{payloadJson(tx)}</pre>}
    </section>
  )
}
