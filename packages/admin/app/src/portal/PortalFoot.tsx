import type { PortalModel } from './portal.ts'

/** The portal's foot (§12.5): "Also on" and the org's other public places (its link Systems), the daoURI in Mono with
 *  "EIP-4824", and what the portal is: "A DAO-OS Hub" (Q66, E-28). */
export function PortalFoot({ also, daoUri }: { also: PortalModel['also']; daoUri?: string }) {
  return (
    <footer className="portal-foot">
      {also.length > 0 && (
        <p className="portal-foot-p">Also on {also.map((a, i) => <span key={a.href}>{i > 0 && ' · '}<a href={a.href}>{a.name}</a></span>)}</p>
      )}
      {daoUri && <p className="portal-foot-p">daoURI <a className="portal-uri" href={daoUri}>{daoUri}</a> · EIP-4824</p>}
      <p className="portal-foot-p">A DAO-OS Hub</p>
    </footer>
  )
}
