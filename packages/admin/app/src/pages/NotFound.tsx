import { useLocation } from 'wouter'
import { NoteBlock } from '../design/Note.tsx'
import { Kbd } from '../design/Kbd.tsx'

/** The not-found page (§14.1): a note block, "No page at /x.", its line the page's h1, and the ⌘K hint. */
export default function NotFound() {
  const [path] = useLocation()
  return <NoteBlock heading title={`No page at ${path}.`} line={<><Kbd>⌘K</Kbd> finds every page, record and command.</>} />
}
