/** The reading ring (§3.7, §6.1): a ¾ circle in the text's colour that turns, and stands still under reduced
 *  motion. Alone it is decoration (a busy button says "Proposing…" itself); with a label it says its word. */
export function Spinner({ label }: { label?: string }) {
  const ring = <span className="spin" aria-hidden="true" />
  if (label === undefined) return ring
  return <span className="spinner">{ring}<span>{label}</span></span>
}
