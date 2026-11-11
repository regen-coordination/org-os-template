import { useId, type ReactNode } from 'react'

/** One numbered section of the portal (§12.4): a 240px label column — the number in Mono 12 faint over the name in
 *  the portal's section size, sticky 24px from the top — and the content column, a lead in Fraunces (34em at most)
 *  then the section's elements. Under 900px the label sits above the lead. Its id is the nav's anchor. */
export function PortalSection({ id, no, name, lead, children }: { id: string; no: string; name: string; lead: string; children: ReactNode }) {
  const headId = useId()
  return (
    <section className="portal-sec" id={id} aria-labelledby={headId}>
      <div className="portal-sec-l">
        <p className="portal-sec-no" aria-hidden="true">{no}</p>
        <h2 className="portal-sec-t" id={headId}>{name}</h2>
      </div>
      <div className="portal-sec-c">
        <p className="portal-lead">{lead}</p>
        {children}
      </div>
    </section>
  )
}
