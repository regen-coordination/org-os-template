import { useQuery } from '@tanstack/react-query'
import { api, type DryRead, type PublishPlan } from '../api.ts'
import { PageHead } from '../design/PageHead.tsx'
import { Note } from '../design/Note.tsx'
import { Section } from '../design/Section.tsx'
import { Icon } from '../design/Icon.tsx'
import { FieldRow, FieldTable } from '../design/FieldRow.tsx'
import { DataList } from '../elements/rows/DataList.tsx'
import { DataRow } from '../elements/rows/DataRow.tsx'
import { KmsDecides } from '../elements/knowledge/GatePlate.tsx'

/** Setting up the commons (spec §4.4). What this page really is, today: **the dry read** — the selection run in
 *  memory, which writes nothing — and the files a run would write. The six decisions themselves live in `kms.yaml`,
 *  and the wizard that would ask them lands with the wizard machine's live step (R-36); this page says so rather than
 *  drawing a wizard that cannot write. */
export default function CommonsSetup() {
  const dry = useQuery({ queryKey: ['knowledge', 'dry'], queryFn: api.knowledgeDryRead })
  const plan = useQuery({ queryKey: ['knowledge', 'plan'], queryFn: api.knowledgePlan })
  const view = useQuery({ queryKey: ['knowledge'], queryFn: api.knowledge })

  return (
    <div className="knowledge-page">
      <PageHead title="Set up the commons" meta={['dry read', 'writes nothing']} />
      <Note state="notYet">
        The six decisions — the canon, which kinds may go public, the plane, the identity, the peers — are
        <span className="mono"> kms.yaml</span>’s. This page runs the same selection <span className="mono">publish</span> uses and
        shows what it finds, before anything is written.
      </Note>

      {/* walk W7, D3: kms's own terms are this page's, not the commons page's */}
      {view.data?.configured && <Section label="What decides"><KmsDecides view={view.data} command={plan.data?.command} /></Section>}

      {dry.isPending && <Note state="loading">Running the selection…</Note>}
      {dry.error && <Note state="error">Couldn’t run the dry read: {(dry.error as Error).message}</Note>}
      {dry.data && <DryReadPanel read={dry.data} />}
      {plan.data && <WhatARunWrites plan={plan.data} />}

      <Section label="The canon">
        {view.data && !view.data.configured
          ? <Note state="empty">{view.data.reason}</Note>
          : (
            <FieldTable label="The canon">
              {(view.data?.files ?? []).map(f => (
                <FieldRow key={f.path} label={f.path}><span>{f.what}</span> <span className="faint">{f.state}</span></FieldRow>
              ))}
            </FieldTable>
          )}
      </Section>
    </div>
  )
}

function DryReadPanel({ read }: { read: DryRead }) {
  return (
    <Section label="The dry read" count={read.counts.selected}>
      <div className="gateplate">
        <div>
          <div className="gp-cap">The selection</div>
          <div className="gp-counts">
            <span className="count"><b>{read.counts.selected}</b><span>would go public</span><span className="w">of {read.counts.canon} in the canon</span></span>
            <span className="count"><b>{read.counts.internal}</b><span>stay internal</span><span className="w">a decision</span></span>
            <span className="count"><b>{read.counts.withheld}</b><span>withheld by a rule</span><span className="w">{read.counts.withheld === 0 ? 'none here' : 'see below'}</span></span>
            <span className="count"><b>{read.counts.awaiting}</b><span>await a review</span><span className="w">a person’s turn</span></span>
          </div>
        </div>
        <div>
          <div className="gp-cap">What it found</div>
          <div className="gp-dec">
            <div><Icon name="info" size="sm" /><span>{read.counts.canon} entries in the canon, {read.counts.selected} in the selection.</span></div>
            {read.broken.map(b => (
              <div key={`${b.type}/${b.entry}/${b.slug}`}><Icon name="alert" size="sm" /><span>{b.entry} → <span className="mono">{b.slug}</span>. {b.fix}</span></div>
            ))}
            {read.withheld.map(w => (
              <div key={w.slug}><Icon name="grip" size="sm" /><span>{w.title}: {w.reason}</span></div>
            ))}
            {read.peers.map(p => (
              <div key={p.name}><Icon name="clock" size="sm" /><span>{p.name}: {p.state}</span></div>
            ))}
          </div>
        </div>
        <div className="gp-plane">
          <div className="gp-cap">What it writes</div>
          <div className="gp-path">nothing</div>
          <span className="faint">{read.writes}</span>
        </div>
      </div>
    </Section>
  )
}

function WhatARunWrites({ plan }: { plan: PublishPlan }) {
  return (
    <Section label="What a run would write">
      <DataList label="What a run would write">
        {plan.calls.map(c => (
          <DataRow key={c.n} kind="file" title={c.what} second={<span className="mono">{c.where}</span>} marks={[]} />
        ))}
      </DataList>
      <Note state="empty">
        +{plan.counts.joins} join · {plan.counts.unchanged} unchanged · {plan.counts.leaves} leave. The run is
        <span className="mono"> {plan.command}</span>; this page never runs it.
      </Note>
    </Section>
  )
}
