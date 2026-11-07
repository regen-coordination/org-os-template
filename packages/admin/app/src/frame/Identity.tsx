import { Icon } from '../design/Icon.tsx'
import { Menu, type MenuEntry } from '../design/Menu.tsx'
import { useFrame } from '../design/Shell.tsx'
import { shortAddress } from '../elements/atoms/chain.ts'
import { announce } from '../parts/live.tsx'
import { useSignOut } from '../session/session.ts'
import { openViewAs } from '../viewAs/ViewAs.tsx'
import type { Identity as Who } from './sections.ts'

/** The plain 0x address (C-9), and a word through the page's one polite region either way. */
async function copy(address: string) {
  try {
    await navigator.clipboard.writeText(address)
    announce('Address copied.')
  } catch {
    announce('Couldn’t copy. Select the address and copy it.')
  }
}

/** The signed-in identity (§5.2 item 6): the hat glyph in a 24px --wash circle, the hat's name (Sans 500 13) and
 *  the short address and hat id (Mono 11, faint). It opens a menu: the hats worn, Copy address, View as…. On the
 *  rail it is the hat glyph alone, still named; `full` draws it whole wherever it is (the phone's More sheet,
 *  which closes itself first when View as… is chosen: `onViewAs`).
 *  An email session (Lane 3) draws the person's name and their Roles as words, under a Roles header in the menu; it
 *  has no address, so no Copy address.
 *  `menu={false}` draws the face alone — presence's "signed-in as" state on /parts. While a session is live (L5,
 *  under SessionProvider) the menu ends with Sign out, which ends it and goes to /sign-in. */
export function Identity({ who, menu = true, full = false, onViewAs = openViewAs }: { who: Who; menu?: boolean; full?: boolean; onViewAs?: () => void }) {
  const expanded = useFrame().expanded || full
  const signOut = useSignOut()
  const roles = who.roles ?? []
  const second = who.roles
    ? roles.join(' · ')
    : [who.address ? shortAddress(who.address) : null, who.hatId ? `hat ${who.hatId}` : null].filter(Boolean).join(' · ')
  const face = (
    <>
      <span className="hatmark"><Icon name="hat" size="sm" /></span>
      <span className={expanded || !menu ? 'who-w' : 'who-w sr-only'}>
        <span className="who-t">{who.hatName}</span>
        {second && <><span className="sr-only">, </span><span className="who-s">{second}</span></>}
      </span>
    </>
  )
  if (!menu) return <span className="who">{face}</span>
  const items: MenuEntry[] = [
    ...(roles.length === 0 ? [] : [
      { type: 'header', label: 'Roles' } as const,
      ...roles.map(r => ({ type: 'link', label: r, href: '/roles', icon: 'hat' }) as const),
      { type: 'separator' } as const,
    ]),
    ...(who.hats.length === 0 ? [] : [
      { type: 'header', label: 'Hats worn' } as const,
      ...who.hats.map(h => ({ type: 'link', label: h, href: '/roles', icon: 'hat' }) as const),
      { type: 'separator' } as const,
    ]),
    ...(who.address ? [{ type: 'item', label: 'Copy address', icon: 'copy', onSelect: () => { void copy(who.address!) } } as const] : []),
    { type: 'item', label: 'View as…', icon: 'eye', onSelect: onViewAs },
    ...(signOut ? [{ type: 'separator' } as const, { type: 'item', label: 'Sign out', onSelect: () => { void signOut() } } as const] : []),
  ]
  return <Menu label="Signed in" face="who" text={face} items={items} trail={null} />
}
