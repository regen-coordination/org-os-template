import type { DoorModel } from './door.ts'

/** The door's foot (§12.5): "Also on" and the org's other public places (its link Systems), the daoURI in Mono with
 *  "EIP-4824", and what the door is: "A DAO-OS Hub" (Q66, E-28). */
export function DoorFoot({ also, daoUri }: { also: DoorModel['also']; daoUri?: string }) {
  return (
    <footer className="door-foot">
      {also.length > 0 && (
        <p className="door-foot-p">Also on {also.map((a, i) => <span key={a.href}>{i > 0 && ' · '}<a href={a.href}>{a.name}</a></span>)}</p>
      )}
      {daoUri && <p className="door-foot-p">daoURI <a className="door-uri" href={daoUri}>{daoUri}</a> · EIP-4824</p>}
      <p className="door-foot-p">A DAO-OS Hub</p>
    </footer>
  )
}
