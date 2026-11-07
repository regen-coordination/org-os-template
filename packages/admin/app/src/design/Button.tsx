import type { MouseEvent, ReactNode, Ref } from 'react'
import { Link } from 'wouter'
import { Icon, type IconName } from './Icon.tsx'
import { Spinner } from './Spinner.tsx'
import { Tooltip } from './Tooltip.tsx'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost'

export interface ButtonProps {
  children?: ReactNode
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void
  variant?: ButtonVariant
  primary?: boolean        // 0.6's name for variant="primary" (L4-R4)
  icon?: IconName          // a leading 14px glyph
  iconOnly?: boolean       // the glyph alone; the name is `label`, or the text given as children
  small?: boolean          // 26px, only inside dense rows and cards
  busy?: string            // the -ing label shown while the action runs ("Proposing…"); still focusable
  unavailable?: string     // why it cannot be used now: aria-disabled, the reason as its description and tooltip.
                           // Passed at all (even undefined), the button keeps its tooltip's place while the reason
                           // comes and goes, so it is never remounted and focus stays on it (E-57)
  disabled?: boolean
  title?: string
  pressed?: boolean
  expanded?: boolean
  haspopup?: 'menu' | 'dialog'
  controls?: string        // the id of what it opens
  label?: string           // the accessible name, when it differs from the text
  describedby?: string     // the id of the text that says why it is disabled, or what it does
  type?: 'button' | 'submit'
  ref?: Ref<HTMLButtonElement>  // a panel's opener, so closing it returns focus here
  id?: string              // where focus returns to, when what it opened is gone
}

/** The class a button or a button-like link draws with (§7.1). Secondary is the default; `primary` and
 *  `variant="primary"` are the same thing. */
export function buttonClass(p: { variant?: ButtonVariant; primary?: boolean; icon?: IconName; iconOnly?: boolean; small?: boolean }): string {
  const variant = p.primary ? 'primary' : p.variant ?? 'secondary'
  return ['btn', variant, p.iconOnly ? 'icon' : p.icon ? 'has-ico' : null, p.small ? 'sm' : null].filter(Boolean).join(' ')
}

/** Always a real button. Busy and unavailable keep it focusable and in the tab order and swallow the click;
 *  `disabled` is the native attribute, for a control with nothing to say about why. */
export function Button(props: ButtonProps) {
  const { children, onClick, variant, primary = false, icon, iconOnly = false, small = false, busy, unavailable,
    disabled = false, title, pressed, expanded, haspopup, controls, label, describedby, type = 'button', ref, id } = props
  const name = label ?? (iconOnly && typeof children === 'string' ? children : undefined)
  const lead = busy !== undefined ? <Spinner /> : icon ? <Icon name={icon} size="sm" /> : null
  const inert = busy !== undefined || unavailable !== undefined
  const button = (
    <button ref={ref} id={id} type={type} className={buttonClass({ variant, primary, icon, iconOnly, small })}
      onClick={e => { if (inert) { e.preventDefault(); return } onClick?.(e) }} disabled={disabled} title={title}
      aria-pressed={pressed} aria-expanded={expanded} aria-haspopup={haspopup} aria-controls={controls}
      aria-label={iconOnly ? busy ?? name : busy !== undefined ? undefined : name}
      aria-busy={busy !== undefined ? true : undefined} aria-disabled={unavailable !== undefined ? true : undefined}
      aria-describedby={describedby}>
      {lead}{iconOnly ? null : busy ?? children}
    </button>
  )
  // A button that may be unavailable (the prop is passed, even undefined) always sits in its tooltip's wrapper, so the
  // reason toggling never swaps <button> for <Tooltip> under it; one that never is renders alone, as in 0.6.
  if (unavailable === undefined && !Object.hasOwn(props, 'unavailable')) return button
  return <Tooltip text={unavailable ?? ''} off={unavailable === undefined}>{button}</Tooltip>
}

/** A link drawn as a button: for actions that go somewhere (Open record, New, an operation). An external one
 *  opens a new tab, leads with the external glyph and says so in its name. */
export function ButtonLink({ href, children, primary = false, variant, icon, external = false, small = false }:
  { href: string; children: ReactNode; primary?: boolean; variant?: ButtonVariant; icon?: IconName; external?: boolean; small?: boolean }) {
  const glyph = icon ?? (external ? 'external' : undefined)
  const cls = buttonClass({ variant, primary, icon: glyph, small })
  const body = <>{glyph && <Icon name={glyph} size="sm" />}{children}</>
  if (external) {
    return <a className={cls} href={href} target="_blank" rel="noopener noreferrer">{body}<span className="sr-only"> (opens in a new tab)</span></a>
  }
  return <Link href={href} className={cls}>{body}</Link>
}
