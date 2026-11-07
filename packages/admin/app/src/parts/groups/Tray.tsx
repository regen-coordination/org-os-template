import type { ReactNode } from 'react'
import { Button } from '../../design/Button.tsx'
import { ConfirmDialog } from '../../design/ConfirmDialog.tsx'
import { useFrame } from '../../design/Shell.tsx'
import { TrayBar, TrayPanel } from '../../changes/Tray.tsx'
import { opSummary, ruleWords } from '../../changes/rows.ts'
import { SignIn, type SignInState } from '../../elements/signin/SignIn.tsx'
import { EXPANDED, SIGNIN, STAGED, STALE } from '../../test/fixtures/house/tray.ts'
import { Card } from './spec.tsx'
import { SpecimenHeadings } from '../../design/PageHeading.tsx'

const noop = () => {}

/** One collapsed specimen: the bar as the dock draws it, named for what it shows. On a phone (the /parts page's own
 *  frame under 760) it is the card the phone draws above its bottom bar. */
function Bar({ label, children }: { label: string; children: ReactNode }) {
  return <div className="tray pg-tray-bar" role="group" aria-label={label}>{children}</div>
}

/** The sign-in states beside the idle card, each under its name (§11.4). */
const SIGNIN_STATES: readonly [SignInState, string][] = [['waiting', 'waiting'], ['signed-in', 'signed in'], ['not-member', 'not a member'], ['failed', 'failed']]

/** /parts/tray: the Changes tray (§5.6) from fixtures — expanded with a stale op (the head, one block per op, the
 *  foot); collapsed, direct; stale; applying; and the question Discard all asks. Then sign-in (§11.4), the section's
 *  other half: the idle card, and beside it waiting, signed in, not a member and failed. */
export default function Tray() {
  const phone = useFrame().mode === 'phone'
  const last = STAGED.ops[STAGED.ops.length - 1]!
  return (
    <div className="pg">
      <p className="pg-lede">The tray is always one key away (g c) and opens upward from its dock under the page. It lists your staged ops, one block each, says which rule decides, and turns into Propose or Apply. On a phone it is a card above the bottom bar, and Review is the page /changes. Sign-in proves an address; nothing is sent on chain.</p>
      <div className="pg-tray">
        <div className="pg-tray-x" role="group" aria-label="Changes, expanded">
          <TrayPanel view={EXPANDED} primary={<Button primary disabled>Propose</Button>} />
        </div>
        <div className="pg-tray-col">
          <Bar label="Changes, collapsed">
            <TrayBar count={STAGED.ops.length} phone={phone} line={`${opSummary(last)} · ${ruleWords(STAGED.rule)}`}
              primary={<Button primary>Apply</Button>} />
          </Bar>
          <Bar label="Changes, stale">
            <TrayBar count={STALE.ops.length} stale={STALE.stale.length} phone={phone} line={null} />
          </Bar>
          <Bar label="Changes, applying">
            <TrayBar count={STAGED.ops.length} busy="Applying…" phone={phone} line={ruleWords(STAGED.rule)} />
          </Bar>
          <Card cap="confirm · discard">
            <ConfirmDialog inline title={`Discard ${EXPANDED.ops.length} staged ops?`} body="They exist only in your change. Nothing on the trunk is touched."
              confirm="Discard" cancel="Keep them" onConfirm={noop} onCancel={noop} />
          </Card>
        </div>
      </div>
      <SpecimenHeadings level={2}>
      <div className="pg-tray">
        <div className="pg-signin" role="group" aria-label="Sign-in, idle">
          <SignIn {...SIGNIN} state="idle" onSignIn={noop} onCancel={noop} />
        </div>
        <div className="pg-tray-col">
          {SIGNIN_STATES.map(([state, name]) => (
            <div key={state} className="pg-signin" role="group" aria-label={`Sign-in, ${name}`}>
              <p className="pg-cap">{name}</p>
              <SignIn {...SIGNIN} state={state} onSignIn={noop} onCancel={noop} />
            </div>
          ))}
        </div>
      </div>
      </SpecimenHeadings>
    </div>
  )
}
