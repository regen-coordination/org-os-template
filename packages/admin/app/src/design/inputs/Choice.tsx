import { Icon } from '../Icon.tsx'

/** One choice (§7.2): a checkbox or a radio, 16px, moss when on; or the wizard's choice card, a radio inside
 *  a label that takes the moss border and soft ring when chosen. Always a native input inside its label. */
export function Choice({ type, checked, label, hint, onChange, name, disabled }:
  { type: 'checkbox' | 'radio' | 'card'; checked: boolean; label: string; hint?: string; onChange: () => void; name?: string; disabled?: boolean }) {
  const kind = type === 'checkbox' ? 'checkbox' : 'radio'
  const box = (
    <span className="choice-box">
      <input type={kind} name={name} checked={checked} disabled={disabled} onChange={() => onChange()} />
      {kind === 'checkbox' && <Icon name="check" size="xs" />}
    </span>
  )
  if (type === 'card') {
    return (
      <label className="choice-card">
        {box}
        <span className="choice-text"><span className="choice-t">{label}</span>{hint && <>{' '}<span className="choice-hint">{hint}</span></>}</span>
      </label>
    )
  }
  return (
    <label className={`choice choice-${kind}`}>
      {box}
      <span className="choice-text">{label}{hint && <>{' '}<span className="choice-hint">{hint}</span></>}</span>
    </label>
  )
}
