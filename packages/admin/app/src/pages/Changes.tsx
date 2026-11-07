import { PageHead } from '../design/PageHead.tsx'
import Tray from '../changes/Tray.tsx'

/** /changes (§5.6, L4-R10): the Changes tray drawn whole as a page — on a phone, where the card above the bottom bar
 *  leads, and from the sidebar's or the More sheet's Changes at any width. The dock is not drawn here (App.tsx). */
export default function Changes() {
  return <><PageHead title="Changes" /><Tray page /></>
}
