import { useEffect, type ReactNode } from 'react'
import { AddressChip } from '../elements/atoms/AddressChip.tsx'
import { ChainList } from '../elements/atoms/ChainChip.tsx'
import { applyTheme } from '../theme.ts'
import { ageText } from '../time.ts'
import { DoorFoot } from './DoorFoot.tsx'
import { DoorSection } from './DoorSection.tsx'
import { DoorTop, membersHref } from './DoorTop.tsx'
import { Hero } from './Hero.tsx'
import { Ledger, WritingLedger } from './Ledger.tsx'
import { MapPlate } from './MapPlate.tsx'
import { PoolCard } from './PoolCard.tsx'
import { SignerDots } from './SignerDots.tsx'
import { doorLead, doorSections, type DoorModel, type DoorSectionId } from './door.ts'

/** While the door is drawn the page follows the reader's system light or dark (C-29): a `data-theme` the Hub keeps
 *  for this browser is taken off <html> — not forgotten, nothing is stored — and put back when the door goes. Run
 *  in an effect only: on the server there is no document. */
function useSystemTheme(on: boolean): void {
  useEffect(() => {
    if (!on) return
    const root = document.documentElement
    const kept = root.dataset.theme
    applyTheme(null, root)
    return () => applyTheme(kept === 'light' || kept === 'dark' ? kept : null, root)
  }, [on])
}

/** The hats, flat in the tree's order, indented by level below the shallowest one (three steps at most). */
function Hats({ hats }: { hats: DoorModel['hats'] }) {
  const top = Math.min(...hats.map(h => h.level))
  return (
    <ul className="door-hats">
      {hats.map((h, i) => (
        <li key={h.id ?? `${h.name}-${i}`} className="door-hat" data-level={Math.min(3, Math.max(0, h.level - top))}>
          <span className="door-hat-n">{h.name}</span>
          <span className="door-hat-l">{h.open ? 'open' : h.line}</span>
        </li>
      ))}
    </ul>
  )
}

function Treasury({ treasury: t, hats, now }: { treasury: NonNullable<DoorModel['treasury']>; hats: DoorModel['hats']; now: Date }) {
  const signerHat = hats.find(h => /signer/i.test(h.name))
  const age = ageText(t.readAt, now)
  return (
    <div className="door-cards">
      <article className="door-card">
        <p className="door-eyebrow">Signers</p>
        <SignerDots threshold={t.threshold} signers={t.signers} />
        <h3 className="door-card-t">Any {t.threshold} of {t.signers}</h3>
        {signerHat && <p className="door-card-p">Signers are whoever wears the {signerHat.name} hat.</p>}
      </article>
      <article className="door-card">
        <p className="door-eyebrow">Address</p>
        <AddressChip value={t.address} full />
        <ChainList chains={t.chains} />
        {age && <p className="door-age">balances read <time dateTime={t.readAt} title={t.readAt} data-volatile="" suppressHydrationWarning>{age}</time></p>}
      </article>
    </div>
  )
}

function Main({ specimen, children }: { specimen: boolean; children: ReactNode }) {
  return specimen ? <div>{children}</div> : <main id="door-main">{children}</main>
}

/** The public door (spec §12): the org's website, built from *public* records only — the caller passes a model that
 *  went through `publicOnly`. The top, the hero, the map plate, then the numbered sections that have public content
 *  (`doorSections`), then the foot. It reads nothing and writes nothing: no control on it changes anything, and
 *  nothing on it needs a member. It draws on the server as it does in the browser (`renderToString`, no `window`
 *  while drawing). `now` is the clock its read ages are told against; `notice` is a line above the top (the Hub's
 *  `/door` says its values are fixtures). `specimen` draws it inside another page (/parts): no skip link, no `<main>`
 *  of its own, and the page's theme left alone. */
export function DoorPage({ model, now = new Date(), notice, specimen = false }: { model: DoorModel; now?: Date; notice?: ReactNode; specimen?: boolean }) {
  useSystemTheme(!specimen)
  const sections = doorSections(model)
  const nav = sections.filter(s => s.id !== 'writing').map(s => ({ id: s.id, name: s.name }))
  const body: Record<DoorSectionId, () => ReactNode> = {
    who: () => <Hats hats={model.hats} />,
    fund: () => <>
      <div className="door-cards">{model.pools.map(p => <PoolCard key={p.id ?? p.address} pool={p} />)}</div>
      {model.openNote && (
        <p className="door-note"><span className="door-pill">Open</span><span>{model.openNote.text.trim().replace(/\.$/, '')} — {model.openNote.id}.</span></p>
      )}
    </>,
    treasury: () => <Treasury treasury={model.treasury!} hats={model.hats} now={now} />,
    decisions: () => <Ledger decisions={model.decisions} />,
    writing: () => <WritingLedger writing={model.writing} />,
  }
  return (
    <div className="door-page">
      {!specimen && <a className="skip" href="#door-main">Skip to the door</a>}
      {notice !== undefined && <p className="door-notice">{notice}</p>}
      <div className="door">
        <DoorTop org={model.org} nav={nav} members={membersHref(model.membersOrigin)} />
        <Main specimen={specimen}>
          <Hero org={model.org} facts={model.facts} />
          {model.map.items.length > 0 && <MapPlate map={model.map} now={now} />}
          {sections.map(s => (
            <DoorSection key={s.id} id={s.id} no={s.no} name={s.name} lead={doorLead(model, s.id)}>{body[s.id]()}</DoorSection>
          ))}
        </Main>
        <DoorFoot also={model.also} daoUri={model.daoUri} />
      </div>
    </div>
  )
}
