import { Icon } from '../../design/Icon.tsx'
import { StatusMark } from '../../design/StatusMark.tsx'
import { LANE_MARK } from './marks.ts'
import type { KnowledgeView } from '../../api.ts'

/** N2 · The gate plate (spec §4.1, §5-N2): where the entries stand, what decides, and what is public. The counts are
 *  links to the lane that holds them; a zero is drawn, because on this plate the zeros are the news. Members read it
 *  (walk W7, W8, D3): each count says its reason once, beside its mark, and kms's own terms — the canon, the floor,
 *  publish.gate, the command a run is, the plane's folder — are the setup page's (`KmsDecides`). */
export function GatePlate({ view, onLane }: { view: KnowledgeView; onLane?: (lane: string) => void }) {
  const count = (lane: string, word: string, why: string) => {
    const held = view.lanes.find(l => l.id === lane)
    const n = held?.count ?? 0
    const body = (
      <>
        <b>{n}</b>
        <span>{word}</span>
        <StatusMark mark={LANE_MARK[lane as keyof typeof LANE_MARK].mark} label={why} />
      </>
    )
    return onLane
      ? <a key={lane} href={`#lane-${lane}`} onClick={e => { e.preventDefault(); onLane(lane) }}>{body}</a>
      : <span className="count" key={lane}>{body}</span>
  }
  const plane = view.plane
  return (
    <div className="gateplate">
      <div>
        <div className="gp-cap">Where the entries stand</div>
        <div className="gp-counts">
          {count('published', 'Published', 'in the commons')}
          {count('awaiting', 'Awaiting review', 'a person’s turn')}
          {count('internal', 'Internal only', 'a decision, not a gap')}
          {count('draft', 'Draft', 'nothing half-written')}
        </div>
      </div>
      <div>
        <div className="gp-cap">What decides</div>
        <div className="gp-dec">
          <div><Icon name="layers" size="sm" /><span><b>An entry’s public use</b> decides whether it <em>may</em> be public, by rules the framework sets for every org.</span></div>
          <div><Icon name="grip" size="sm" /><span>{view.rule.module
            ? <><b>This org’s own rule</b> decides what <em>is</em>: it can only narrow that.</>
            : <><b>This org</b> sets no rule of its own, so an entry’s public use alone decides, and no rule withholds anything.</>}</span></div>
          <div><Icon name="arrow-right" size="sm" /><span><b>A publishing run</b> writes the public pages. This app plans it and shows its receipt; it never publishes itself.</span></div>
        </div>
      </div>
      <div className="gp-plane">
        <div className="gp-cap">What is public</div>
        <span className="faint">{plane.lastRun ? `written ${plane.lastRun}` : 'not written yet — no run has published it'}</span>
        <span className="faint">{plane.pages ? 'pages on' : 'pages off'} · {plane.static ? 'static JSON on' : 'static JSON off'} · {plane.atproto ? 'AT Proto' : 'no AT Proto identity'}</span>
      </div>
    </div>
  )
}

/** What decides, in kms's own terms, for the commons setup page (walk W7, D3): the floor, the instance's rule
 *  (`publish.gate`), the command a run is, and the folder the public plane is written to. */
export function KmsDecides({ view, command }: { view: KnowledgeView; command?: string }) {
  return (
    <div className="gp-dec">
      <div><Icon name="layers" size="sm" /><span><b>The floor</b> decides what <em>may</em> be public: maturity and public use, set by the framework. It never asks this instance.</span></div>
      <div><Icon name="grip" size="sm" /><span>{view.rule.module
        ? <><b>Your rule</b> decides what <em>is</em>: <span className="mono">{view.rule.module}</span>. It can only narrow the floor.</>
        : <><b>Your rule</b> decides nothing here: <span className="mono">publish.gate</span> is unset, so the floor decides everything, and nothing is withheld by a rule.</>}</span></div>
      <div><Icon name="arrow-right" size="sm" /><span><b>A run</b> writes it: <span className="mono">{command ?? 'org-os-kms publish --apply'}</span>, into <span className="mono">{view.plane.dir}/</span>. Not this app — this app plans it and shows the receipt.</span></div>
      {view.rule.sentence.length > 0 && <div><Icon name="info" size="sm" /><span className="faint">{view.rule.sentence}</span></div>}
    </div>
  )
}
