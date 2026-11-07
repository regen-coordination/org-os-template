import { useId, useState, type ReactNode } from 'react'
import { EntryCard } from '../../library/EntryCard.tsx'
import { EntryPreview } from '../../library/EntryPreview.tsx'
import { RemovalView } from '../../library/Removal.tsx'
import { WizardFrame, type WizardFrameProps, type WizardView } from '../../wizards/WizardFrame.tsx'
import { Choice } from '../../design/inputs/index.ts'
import { ButtonLink } from '../../design/Button.tsx'
import { councilPreview, hatsPreview, RECEIPTS, removal, SHELF } from '../../test/fixtures/library.ts'
import { Card } from './spec.tsx'

const noop = () => {}
const NOOP = { onAdd: async () => {}, onRemove: noop }
const previewing = (title: string) => ({ state: 'previewing', text: `Previewing ${title}. Nothing changes until it is added.` })

/** The compose wizard's screen as the gallery draws it (§11.3): a decision of the DAO template's wizard, which L7
 *  builds; the frame is the same one every wizard draws in. */
const COMPOSE: WizardFrameProps = {
  title: 'Compose a DAO', steps: ['Template', 'Network', 'Signers', 'Votes'], view: 'step', index: 2, count: { at: 3, of: 5 },
  heading: 'Who signs for the treasury?', ask: 'Signers are whoever wears the hat you choose. You can change wearers later without touching the Safe.',
  writes: <><span className="mono">systems.yaml · roles.signers (not deployed)</span><span className="mono">governance.yaml · roles.signers ← hat</span></>,
  status: 'Step 3 of 4, then the review. Nothing is written yet.',
  actions: { cancel: { label: 'Save and leave', onClick: noop }, back: { label: 'Back', onClick: noop }, next: { label: 'Continue', onClick: noop } },
}

function Signers() {
  const [on, setOn] = useState<'hat' | 'fixed'>('hat')
  const name = useId() // each specimen is its own radio group
  return (
    <fieldset className="wiz-doors">
      <legend className="sr-only">Who signs for the treasury?</legend>
      <Choice type="card" name={name} checked={on === 'hat'} onChange={() => setOn('hat')} label="A new “Signers” hat" hint="Three wearers to start · Hats Signer Gate links it to the Safe" />
      <Choice type="card" name={name} checked={on === 'fixed'} onChange={() => setOn('fixed')} label="Fixed addresses" hint="Owners set on the Safe directly; changing them is a transaction" />
    </fieldset>
  )
}

/** 0.6's claim-handle wizard in each state its machine has (moved here from /parts/blocks, E-25). */
const CLAIM_STEPS = ['Which member are you?']
const CLAIM: { view: WizardView; heading: string; ask?: string; writes: string; status: string; refusal?: string; body?: ReactNode; lines?: WizardFrameProps['lines'];
  actions: { back?: string; cancel?: string; next?: string } }[] = [
  { view: 'intro', heading: 'Claim your handle', ask: 'No member holds your address yet. Pick the member that is you.', writes: 'Nothing. You see the exact line before anything is written.',
    status: 'Not started. Nothing is written until you confirm the last step.', actions: { cancel: 'Close', next: 'Start' } },
  { view: 'step', heading: 'Which member are you?', ask: 'Pick the member that is you. Only members who hold no git address yet are listed.', writes: 'Nothing yet. The next screen shows the exact line.',
    status: 'Step 1 of 1, then the review. Nothing is written yet.', refusal: 'Choose who you are first.',
    body: <fieldset className="wiz-doors"><legend className="sr-only">Members</legend>
      <Choice type="card" name="pg-who" checked onChange={noop} label="Steward A" hint="steward-a · holds no git address" />
      <Choice type="card" name="pg-who" checked={false} onChange={noop} label="Steward B" hint="contributor · holds no git address" /></fieldset>,
    actions: { cancel: 'Save and leave', back: 'Back', next: 'Continue' } },
  { view: 'review', heading: 'Check the line', ask: 'This is the line that will be written.', writes: 'One line in data/members.yaml, and one commit that records it.',
    status: 'Review. This is exactly what will be written. Nothing is written until you confirm.',
    body: <pre className="wiz-log"><b>File</b> data/members.yaml{'\n'}+       git: steward-a@example.org{'\n'}<b>Commit</b> admin(members): claim the git handle for steward-a</pre>,
    actions: { cancel: 'Save and leave', back: 'Back', next: 'This is me' } },
  { view: 'running', heading: 'Writing', writes: 'One line in data/members.yaml, and one commit that records it.', status: 'Writing.', actions: {},
    lines: [{ text: 'Checked: the line is the one you reviewed', done: true }, { text: 'Writing data/members.yaml and its commit…' }] },
  { view: 'done', heading: 'You are Steward A', ask: 'The rule bootstrap/claim decided it. This page is editable now.', writes: 'Written: data/members.yaml, in commit abcdef1.', status: 'Done.', actions: {},
    body: <><pre className="wiz-log"><b>Undo</b> git revert abcdef1</pre><div className="wiz-acts"><ButtonLink href="/parts/lib" primary>Open your boards</ButtonLink></div></> },
  { view: 'failed', heading: 'Nothing was written', writes: 'One line in data/members.yaml, and one commit that records it.', status: 'Not done. Look at what it says, then review it again.',
    refusal: 'Something changed since you reviewed this: data/members.yaml changed. Nothing was written. Prepare it again.', actions: { cancel: 'Save and leave', back: 'Back to review' } },
  { view: 'closed', heading: 'Closed', ask: 'Your answers are kept as a draft. Nothing was written.', writes: 'Nothing.', status: 'Closed. Your answers are kept as a draft; nothing was written.', actions: {} },
]
const act = (label?: string) => (label ? { label, onClick: noop } : undefined)

/** /parts/lib (§11.1–§11.3): the shelf's cards in each state (not added, added and open, needing a Garden, built in);
 *  the DAO template's preview, two columns, its taken id in clay; the receipt after an add, and what removing it would
 *  do; the wizard's steps — a screen, running, done, failed, and the narrow screen — and 0.6's claim-handle wizard in
 *  every state its machine has. Words from fixtures (E-23); nothing is requested. */
export default function Lib() {
  return (
    <div className="pg">
      <p className="pg-lede">An entry card says what it is, what it adds and whether the org has what it needs. Preview writes nothing. A wizard asks one decision per screen and says what each screen writes; nothing is written before the review is confirmed.</p>
      <div className="lib-grid" role="group" aria-label="Entry cards">
        {SHELF.map((e, i) => <EntryCard key={e.id} entry={e} selected={i === 1} />)}
      </div>
      <EntryPreview entry={SHELF[0]!} preview={councilPreview()} machine={previewing(SHELF[0]!.title)} {...NOOP} />
      <div className="pg-grid pg-two">
        <Card cap="after the add: the receipt">
          <EntryPreview entry={SHELF[1]!} preview={hatsPreview({ reaches: [], decided: [], refusal: null })} receipts={RECEIPTS} machine={previewing(SHELF[1]!.title)} {...NOOP} />
        </Card>
        <Card cap="remove: what it would delete">
          <RemovalView r={removal({ records: [{ record: 'boards:test-desk', state: 'edited', referrers: [] }, { record: 'systems:test-link', state: 'as added', referrers: [] }] })}
            onRemove={noop} onBack={noop} />
        </Card>
      </div>
      <h2 className="pg-sub">Wizard steps <span>step · running · done · failed</span></h2>
      <div className="pg-grid pg-two">
        <WizardFrame {...COMPOSE}><Signers /></WizardFrame>
        <div className="pg-side-col">
          <Card cap="running">
            <WizardFrame {...COMPOSE} label="Compose a DAO: running" view="running" count={{ at: 5, of: 5 }} heading="Staging the change" ask={undefined} actions={{}}
              writes={<span className="mono">6 records in one change</span>} lines={[{ text: 'Checked against the schema', done: true }, { text: 'Staging 6 records…' }]} />
          </Card>
          <Card cap="done">
            <WizardFrame {...COMPOSE} label="Compose a DAO: done" view="done" heading="Staged as one change" ask="Council consent decides it. Deployment comes after: 5 prepared transactions."
              writes={<span className="mono">6 records in one change</span>} actions={{}}>
              <div className="wiz-acts"><ButtonLink href="/parts/lib" primary small>Propose</ButtonLink><ButtonLink href="/parts/lib" small>Open the canvas</ButtonLink></div>
            </WizardFrame>
          </Card>
          <Card cap="failed">
            <WizardFrame {...COMPOSE} label="Compose a DAO: failed" view="failed" count={{ at: 5, of: 5 }} heading="Nothing was written" ask={undefined}
              refusal="systems.yaml has uncommitted edits. Commit or discard them, then try again." writes={<span className="mono">Nothing</span>}
              actions={{ next: { label: 'Try again', onClick: noop }, back: { label: 'Back to review', onClick: noop } }} />
          </Card>
          <div className="pg-phone-wiz" role="group" aria-label="A wizard screen under 560px">
            <WizardFrame {...COMPOSE} label="Compose a DAO: narrow"><Signers /></WizardFrame>
          </div>
        </div>
      </div>
      <h2 className="pg-sub">Claim your handle <span>0.6’s wizard, each state, at a narrow width</span></h2>
      <div className="pg-grid">
        {CLAIM.map(v => (
          <div key={v.view} className="pg-wiz" data-wizard={v.view}>
            <p className="pg-cap">{v.view}</p>
            <WizardFrame title="Claim your handle" label={`Claim your handle: ${v.view}`} steps={CLAIM_STEPS} view={v.view} index={0}
              heading={v.heading} ask={v.ask} writes={v.writes} status={v.status} refusal={v.refusal} lines={v.lines}
              actions={{ cancel: act(v.actions.cancel), back: act(v.actions.back), next: act(v.actions.next) }}>{v.body}</WizardFrame>
          </div>
        ))}
      </div>
    </div>
  )
}
