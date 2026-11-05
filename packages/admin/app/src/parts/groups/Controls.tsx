import { useState } from 'react'
import { Button, ButtonLink } from '../../design/Button.tsx'
import { Seg } from '../../design/Seg.tsx'
import { Tabs } from '../../design/Tabs.tsx'
import { MenuList, type MenuEntry } from '../../design/Menu.tsx'
import { Tooltip } from '../../design/Tooltip.tsx'
import { Kbd } from '../../design/Kbd.tsx'
import { Note, NoteBlock } from '../../design/Note.tsx'
import { StatusMark } from '../../design/StatusMark.tsx'
import { Choice, DateInput, NumberInput, SelectInput, Stepper, TextInput } from '../../design/inputs/index.ts'
import { Card, State } from './spec.tsx'

const noop = () => {}

const VISIBILITY: MenuEntry[] = [
  { type: 'header', label: 'Who can see this page' },
  { type: 'radio', label: 'Public', icon: 'globe', hint: 'propose', checked: false, onSelect: noop },
  { type: 'radio', label: 'Members', icon: 'members', checked: true, onSelect: noop },
  { type: 'radio', label: 'Hat: Ops', icon: 'hat', hint: 'applies now', checked: false, onSelect: noop },
  { type: 'separator' },
  { type: 'item', label: 'Hat: Treasurer', icon: 'lock', unavailable: 'you don’t wear it', onSelect: noop },
]

const RECORD_TABS = [
  { id: 'overview', label: 'Overview' }, { id: 'signers', label: 'Signers', count: 8 }, { id: 'balances', label: 'Balances', count: 7 },
  { id: 'transactions', label: 'Transactions', count: 112 }, { id: 'proposals', label: 'Proposals', count: 3 }, { id: 'modules', label: 'Modules' },
  { id: 'guards', label: 'Guards' }, { id: 'history', label: 'History' },
] as const

/** /parts/controls: every button variant and state, every input state, segmented, tabs (with counts, and a
 *  bar too narrow for its tabs), an open menu with radio and an unavailable item, a tooltip shown, kbd,
 *  every note state and the empty block — the gallery's six cards in its order, then the stepper and
 *  choices, and the overflowing tabs with the small buttons. Hover, focus and pressed are drawn, not live. */
export default function Controls() {
  const [view, setView] = useState<'list' | 'map'>('list')
  const [tab, setTab] = useState<'open' | 'decided' | 'rules'>('open')
  const [recordTab, setRecordTab] = useState<(typeof RECORD_TABS)[number]['id']>('overview')
  const [threshold, setThreshold] = useState(4)
  const [signers, setSigners] = useState<'hat' | 'fixed'>('hat')
  const [when, setWhen] = useState<'now' | 'propose'>('now')
  const [remember, setRemember] = useState(true)
  return (
    <div className="pg">
      <p className="pg-lede">One filled button per view, in ink. Moss never fills a button: it marks what is selected, staged or yours. Destructive actions are ink with a confirmation, never red. Touch targets grow to 44&nbsp;px on coarse pointers.</p>
      <div className="pg-grid">
        <Card cap="Button · primary">
          <div className="pg-states">
            <State name="default"><Button primary>Propose</Button></State>
            <State name="hover"><span className="pg-hover"><Button primary>Propose</Button></span></State>
            <State name="focus"><span className="pg-focus"><Button primary>Propose</Button></span></State>
            <State name="pressed"><span className="pg-press"><Button primary>Propose</Button></span></State>
            <State name="busy"><Button primary busy="Proposing…">Propose</Button></State>
            <State name="disabled"><Button primary disabled>Propose</Button></State>
          </div>
        </Card>

        <Card cap="Button · secondary, ghost, icon">
          <div className="pg-states">
            <State name="default"><Button>Review</Button></State>
            <State name="hover"><span className="pg-hover"><Button>Review</Button></span></State>
            <State name="with icon"><Button icon="external">Open in Safe</Button></State>
            <State name="ghost"><Button variant="ghost">Show payload</Button></State>
            <State name="icon"><span className="pg-demo"><Button icon="copy" iconOnly label="Copy" /><Button icon="more" iconOnly variant="ghost" label="More" /></span></State>
            <State name="aria-disabled"><Button unavailable="Only the author can withdraw">Withdraw</Button></State>
          </div>
        </Card>

        <Card cap="Input">
          <div className="field">
            <label className="field-l" htmlFor="pc-threshold">Threshold</label>
            <NumberInput common={{ id: 'pc-threshold' }} value={4} onChange={noop} />
          </div>
          <div className="field pg-focus">
            <label className="field-l" htmlFor="pc-signer">Signer address</label>
            <TextInput common={{ id: 'pc-signer', 'aria-describedby': 'pc-signer-hint' }} prose={false} value="0x9C1f" readOnly={false} onChange={noop} mono />
            <span className="hint" id="pc-signer-hint">An EVM address. It is read back after the change.</span>
          </div>
          <div className="field">
            <label className="field-l" htmlFor="pc-amount">Amount</label>
            <TextInput common={{ id: 'pc-amount' }} prose={false} value="1.271,00" readOnly={false} onChange={noop} mono error="Use a dot for decimals: 1271.00" />
          </div>
          <div className="field">
            <span className="field-l"><label htmlFor="pc-title">Title</label><StatusMark mark="staged" /></span>
            <TextInput common={{ id: 'pc-title' }} prose={false} value="Return the pools to the treasury" readOnly={false} onChange={noop} staged={{ was: 'Return the Gardens pools' }} />
          </div>
        </Card>

        <Card cap="Segmented · tabs · menu">
          <Seg label="View" value={view} onChange={setView} icons={{ list: 'list', map: 'map' }} options={[{ value: 'list', label: 'List' }, { value: 'map', label: 'Map' }]} />
          <Tabs label="Proposals" value={tab} onChange={setTab}
            tabs={[{ id: 'open', label: 'Open', count: 1 }, { id: 'decided', label: 'Decided', count: 14 }, { id: 'rules', label: 'Rules' }]} />
          <MenuList label="Visibility" items={VISIBILITY} current={2} />
        </Card>

        <Card cap="Note · the one line for every state">
          <div className="pg-states">
            <State name="empty"><Note state="empty">No meetings yet.</Note></State>
            <State name="loading"><Note state="loading">Reading the Safe…</Note></State>
            <State name="error"><Note state="error" action={<button type="button">Try again</button>}>Couldn’t load proposals.</Note></State>
            <State name="unavailable"><Note state="unavailable">The Garden couldn’t be read. Showing the read from 2&nbsp;h ago.</Note></State>
            <State name="not yet"><Note state="notYet">Comments arrive with the workspace.</Note></State>
          </div>
        </Card>

        <Card cap="Empty block · tooltip · kbd">
          <NoteBlock title="Nothing waits on you." line="9 Systems read 4 min ago, none failing." />
          <div className="pg-demo pg-tip">
            <Tooltip shown text="eip155:42220:0x5D0B…8a5C · click to copy">
              <button type="button" className="btn ghost sm"><span className="mono">0x5D0B…8a5C</span></button>
            </Tooltip>
          </div>
          <div className="pg-demo"><Kbd>⌘</Kbd><Kbd>K</Kbd><Kbd>g</Kbd><Kbd>p</Kbd><Kbd>esc</Kbd><Kbd>↵</Kbd></div>
        </Card>

        <Card cap="Input · stepper, choices, select">
          <div className="field">
            <span className="field-l">Threshold</span>
            <Stepper value={threshold} min={1} max={8} of={8} label="Threshold" onChange={setThreshold} />
          </div>
          <div className="pg-choices" role="radiogroup" aria-label="Who signs for the treasury?">
            <Choice type="card" name="pc-signers" checked={signers === 'hat'} label="A new “Signers” hat" hint="Three wearers to start · Hats Signer Gate links it to the Safe" onChange={() => setSigners('hat')} />
            <Choice type="card" name="pc-signers" checked={signers === 'fixed'} label="Fixed addresses" hint="Owners set on the Safe directly; changing them is a transaction" onChange={() => setSigners('fixed')} />
          </div>
          <div className="pg-demo" role="radiogroup" aria-label="When it applies">
            <Choice type="radio" name="pc-when" checked={when === 'now'} label="Applies now" onChange={() => setWhen('now')} />
            <Choice type="radio" name="pc-when" checked={when === 'propose'} label="Propose" onChange={() => setWhen('propose')} />
          </div>
          <Choice type="checkbox" checked={remember} label="Remember this browser" onChange={() => setRemember(r => !r)} />
          <div className="field">
            <label className="field-l" htmlFor="pc-kind">Kind</label>
            <SelectInput common={{ id: 'pc-kind' }} options={['safe', 'hats-tree', 'gardens-pool']} value="safe" onChange={noop} />
          </div>
          <div className="field">
            <label className="field-l" htmlFor="pc-date">Decided on</label>
            <DateInput common={{ id: 'pc-date' }} value="2026-10-17" onChange={noop} onProblem={noop} mono />
          </div>
        </Card>

        <Card cap="Tabs · overflow, small buttons">
          <Tabs label="Treasury" value={recordTab} onChange={setRecordTab} tabs={[...RECORD_TABS]} />
          <div className="pg-demo">
            <Button small>Remove</Button>
            <Button small variant="ghost" icon="pen">Edit</Button>
            <Button small primary>Stage</Button>
          </div>
          <div className="pg-demo">
            <ButtonLink href="https://app.safe.global/home" external>Open in Safe</ButtonLink>
            <ButtonLink href="/parts/controls" variant="ghost">Open record</ButtonLink>
          </div>
        </Card>
      </div>
    </div>
  )
}
