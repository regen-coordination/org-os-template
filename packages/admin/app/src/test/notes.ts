import { waitFor } from '@testing-library/react'

/** The error note a part shows (§6.2): a clay `Note`, said where it stands. It is not an alert: role="alert" is the
 *  compose canvas's refused connection and the tray's failed Apply and Propose only (§13; C10, E-81). Tests that
 *  found an error by `getByRole('alert')` find it here. */
export function errorNote(within: ParentNode = document): HTMLElement {
  const note = within.querySelector<HTMLElement>('.note-error')
  if (!note) throw new Error('no error note (.note-error) here')
  return note
}

/** `errorNote`, once it is drawn. */
export const findErrorNote = (within?: ParentNode): Promise<HTMLElement> => waitFor(() => errorNote(within))

/** What the page's one polite region is asked to say (parts/live.tsx's `org-os-announce` event), from now until
 *  `stop()`: an error note that is not an alert must be said through it when a person's own action failed. */
export function heard(): { said: string[]; stop(): void } {
  const said: string[] = []
  const hear = (e: Event) => { said.push(String((e as CustomEvent).detail)) }
  window.addEventListener('org-os-announce', hear)
  return { said, stop: () => window.removeEventListener('org-os-announce', hear) }
}
