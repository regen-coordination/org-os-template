import { useId } from 'react'
import { StatusMark, type Mark } from '../../design/StatusMark.tsx'
import { Amount } from '../atoms/Amount.tsx'
import { FLOW_PLACES, bandWidths, flowAmount, flowSentence, type Flow } from './fundflow.ts'

/** The chart's geometry, in its own user units (the viewBox scales it to the container). */
const W = 980, PAD = 24, GAP = 26
const NODE = { w: 210, h: 52, r: 10 }, SAFE = { w: 180, h: 76, r: 12 }
const X = { from: 20, safe: 400, to: 750 }
/** How far apart the bands meet the Safe's side. */
const SPREAD = 14
/** The most characters a node's name (Sans 13) and amount (Mono 11) draw inside its 210-wide box; past them the text
 *  ends in "…", the whole of it in the node's <title> (and the chart's sentence). A clip to the box holds the rest. */
export const NAME_MAX = 24, AMOUNT_MAX = 26
/** The same for the Safe's name (Display 17) in its 180-wide box (final M-5); the whole name is in the Safe's <title>. */
export const SAFE_NAME_MAX = 16
const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

const MARK: Record<Flow['status'], { mark: Mark; label: string }> = {
  executed: { mark: 'done', label: 'Executed' }, proposed: { mark: 'draft', label: 'Proposed' }, prepared: { mark: 'staged', label: 'Prepared' },
}

/** Where value went in a window (§9.8): sources at the start → the Safe in the centre → destinations at the end, joined
 *  by cubic bands whose width follows each flow's share of value moved (bandWidths: SVG `stroke-width`, data, not CSS);
 *  proposed and prepared bands are moss at .5, executed neutral. Nodes are 52px boxes with the name and the amount; a
 *  flow that is not to or from the Safe is said in the sentence and the list only. It is an `img` whose `<title>` is
 *  the whole sentence; under 600px of its container it is a list of "From → To · amount · status" rows. */
export function FundFlow({ flows, safe, window }: { flows: Flow[]; safe: string; window: string }) {
  const titleId = useId()
  const widths = bandWidths(flows)
  const each = flows.map((flow, i) => ({ flow, width: widths[i]! }))
  const ins = each.filter(e => e.flow.to === safe && e.flow.from !== safe)
  const outs = each.filter(e => e.flow.from === safe && e.flow.to !== safe)
  const rows = Math.max(ins.length, outs.length, 1)
  const H = Math.max(2 * PAD + rows * NODE.h + (rows - 1) * GAP, 2 * PAD + SAFE.h)
  const safeY = (H - SAFE.h) / 2, safeMid = H / 2
  const tops = (n: number) => { const total = n * NODE.h + (n - 1) * GAP; return Array.from({ length: n }, (_, i) => (H - total) / 2 + i * (NODE.h + GAP)) }
  const meet = (i: number, n: number) => safeMid + (i - (n - 1) / 2) * SPREAD
  const band = (x1: number, y1: number, x2: number, y2: number) => { const m = (x1 + x2) / 2; return `M${x1} ${y1} C${m} ${y1} ${m} ${y2} ${x2} ${y2}` }
  const cls = (f: Flow) => (f.status === 'executed' ? 'ff-band' : 'ff-band ff-band-on')
  const label = (f: Flow) => `${flowAmount(f)}${f.status === 'executed' ? '' : ` · ${f.status}`}`
  const node = (key: string, x: number, y: number, name: string, amount: string) => (
    <g key={key}>
      <title>{`${name}: ${amount}`}</title>
      <clipPath id={`${titleId}-${key}`}><rect x={x} y={y} width={NODE.w} height={NODE.h} rx={NODE.r} /></clipPath>
      <rect className="ff-nd" x={x} y={y} width={NODE.w} height={NODE.h} rx={NODE.r} />
      <g clipPath={`url(#${titleId}-${key})`}>
        <text className="ff-t" x={x + 18} y={y + 22}>{cut(name, NAME_MAX)}</text>
        <text className="ff-m" x={x + 18} y={y + 40}>{cut(amount, AMOUNT_MAX)}</text>
      </g>
    </g>
  )
  const inTops = tops(ins.length), outTops = tops(outs.length)

  return (
    <div className="ff">
      <svg className="ff-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={titleId}>
        <title id={titleId}>{flowSentence(flows, window)}</title>
        {ins.map((e, i) => <path key={`b-in-${i}`} className={cls(e.flow)} d={band(X.from + NODE.w, inTops[i]! + NODE.h / 2, X.safe, meet(i, ins.length))} strokeWidth={e.width} />)}
        {outs.map((e, i) => <path key={`b-out-${i}`} className={cls(e.flow)} d={band(X.safe + SAFE.w, meet(i, outs.length), X.to, outTops[i]! + NODE.h / 2)} strokeWidth={e.width} />)}
        {ins.map((e, i) => node(`n-in-${i}`, X.from, inTops[i]!, e.flow.from, label(e.flow)))}
        <g>
          <title>{`Safe: ${safe}`}</title>
          <clipPath id={`${titleId}-safe`}><rect x={X.safe} y={safeY} width={SAFE.w} height={SAFE.h} rx={SAFE.r} /></clipPath>
          <rect className="ff-nd ff-safe" x={X.safe} y={safeY} width={SAFE.w} height={SAFE.h} rx={SAFE.r} />
          <g clipPath={`url(#${titleId}-safe)`}>
            <text className="ff-e" x={X.safe + 18} y={safeY + 30}>SAFE</text>
            <text className="ff-sn" x={X.safe + 18} y={safeY + 54}>{cut(safe, SAFE_NAME_MAX)}</text>
          </g>
        </g>
        {outs.map((e, i) => node(`n-out-${i}`, X.to, outTops[i]!, e.flow.to, label(e.flow)))}
      </svg>
      <ul className="ff-list" aria-label={`Fund flow, ${window}`}>
        {flows.map((f, i) => (
          <li key={i} className="ff-row">
            <span className="ff-path">{f.from} → {f.to}</span>{' · '}<Amount value={f.value} unit={f.unit} decimals={FLOW_PLACES} />{' · '}
            <StatusMark mark={MARK[f.status].mark} label={MARK[f.status].label} />
          </li>
        ))}
      </ul>
    </div>
  )
}
