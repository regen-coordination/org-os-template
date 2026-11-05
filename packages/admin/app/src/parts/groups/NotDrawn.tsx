import { Note } from '../../design/Note.tsx'

/** A group the house has not drawn yet: listed on the index, one note on its page. */
export function NotDrawn() {
  return <Note state="notYet">Not drawn yet.</Note>
}
