import { Icon, type IconName } from '../design/Icon.tsx'
import { Menu, type MenuEntry } from '../design/Menu.tsx'
import { useVisibilitySource } from './ViewAs.tsx'
import { readersWithin, sameVisibility, visibilityWord, type Visibility } from './visibility.ts'

function visibilityIcon(v: Visibility): IconName {
  return v.level === 'public' ? 'globe' : v.level === 'members' ? 'members' : 'hat'
}

/** The marker (§7.10): glyph 14 + word 12/500 mute — Public (globe), Members (two people), Hat: Ops (hat). A
 *  widening in flight (`proposed`) reads "Members → Public, proposed", the target in moss, as the control does: a
 *  reader who may not change visibility still sees it coming (L4a final review M-9). */
export function VisibilityMarker({ value, proposed }: { value: Visibility; proposed?: Visibility }) {
  return (
    <span className="vis"><Icon name={visibilityIcon(value)} size="sm" />{visibilityWord(value)}
      {proposed && <> → <span className="vis-to">{visibilityWord(proposed)}, proposed</span></>}
    </span>
  )
}

/** A restricted field of a visible record (§6.3 rendering 2): the value reads "<hat> only" in faint, with the
 *  lock. Schema is not secret; the value is. */
export function RestrictedValue({ hat }: { hat: string }) {
  return <span className="vis vis-field"><Icon name="lock" size="sm" />{hat} only</span>
}

/** The marker as a control (§7.10; the page editor bar, a record header, for those who may change it): a 26px
 *  outlined button with a chevron opening the visibility menu. A choice that lets nobody new read the thing
 *  "applies now"; one that lets someone new read it says "propose" and is staged as a *publication*-class change
 *  by the caller (`how`). A hat the member does not wear, and that sits under no hat they wear, is listed after
 *  a separator, aria-disabled "you don’t wear it". A widening in flight reads "Members → Public, proposed", the
 *  target in moss. A `parent` puts its level in the menu's header. `offers` leaves out a level the thing cannot be given
 *  where it is drawn. */
export function VisibilityControl({ value, parent, proposed, offers = () => true, onChoose }:
  { value: Visibility; parent?: Visibility; proposed?: Visibility; offers?(v: Visibility): boolean; onChoose(v: Visibility, how: 'applies' | 'propose'): void }) {
  const source = useVisibilitySource()
  const worn = new Set(source.worn())
  const hats: Visibility[] = source.hats().map(h => ({ level: 'hat', hat: h.hat, name: h.name }))
  const choice = (v: Visibility): MenuEntry => {
    const label = visibilityWord(v)
    if (sameVisibility(v, value)) return { type: 'radio', label, icon: visibilityIcon(v), checked: true, onSelect: () => {} }
    const how = readersWithin(v, value, source) ? 'applies' : 'propose'
    return { type: 'radio', label, icon: visibilityIcon(v), checked: false, hint: how === 'applies' ? 'applies now' : 'propose', onSelect: () => onChoose(v, how) }
  }
  // A hat is read by its wearers and the wearers of the hats above it (CONTEXT "Visibility"): a member may narrow
  // to a hat they wear or to any hat below one they wear (coordinator ruling; L4a-R19 overturned).
  const wears = (hat: string) => worn.has(hat) || source.hatsAbove(hat).some(h => worn.has(h))
  // `offers`: the levels the caller can give the thing here (L5: a private record does not move into git yet); the others
  // are left out, not disabled. Its own level is always shown.
  const mayChoose = (v: Visibility) => (v.level !== 'hat' || wears(v.hat) || sameVisibility(v, value)) && (offers(v) || sameVisibility(v, value))
  const notWorn = hats.filter(h => !mayChoose(h) && offers(h))
  const items: MenuEntry[] = [
    { type: 'header', label: parent ? `Who can see this · its parent is ${visibilityWord(parent)}` : 'Who can see this' },
    ...[{ level: 'public' } as const, { level: 'members' } as const, ...hats].filter(mayChoose).map(choice),
    ...(notWorn.length === 0 ? [] : [{ type: 'separator' } as const,
      ...notWorn.map((h): MenuEntry => ({ type: 'item', label: visibilityWord(h), icon: 'lock', unavailable: 'you don’t wear it', onSelect: () => {} }))]),
  ]
  const text = proposed
    ? <>{visibilityWord(value)} → <span className="vis-to">{visibilityWord(proposed)}, proposed</span></>
    : visibilityWord(value)
  return <Menu label="Visibility" face="vis vis-ctl" icon={visibilityIcon(value)} text={text} items={items} />
}
