import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

const EVENT = 'org-os-announce'

/** Says a sentence through the page's one live region (spec §8): a block that failed, a refused drop. */
export function announce(text: string): void {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: text }))
}

/** Whether a dialog is open as a modal (showModal): the browser's `:modal`, else (a DOM without it) `aria-modal`. */
function isModal(d: HTMLDialogElement): boolean {
  try { return d.matches(':modal') } catch { return d.open && d.getAttribute('aria-modal') === 'true' }
}

/** The topmost modal dialog open now, or null. */
function topModal(): HTMLDialogElement | null {
  return [...document.querySelectorAll('dialog')].filter(isModal).at(-1) ?? null
}

/** The live region: polite, hidden, and without a role, so it never stands in for the tray's status bar. While a modal
 *  dialog is open everything outside it is inert, and a sentence said there would reach no one (E-92): the region is
 *  then drawn inside the topmost modal, and back in the page when it closes. */
export function LiveRegion() {
  const [text, setText] = useState('')
  const [host, setHost] = useState<HTMLDialogElement | null>(null)
  useEffect(() => {
    const on = (e: Event) => setText(String((e as CustomEvent).detail))
    window.addEventListener(EVENT, on)
    // a dialog opens or closes by its `open` attribute (showModal sets it), or comes and goes with its panel
    const follow = () => setHost(topModal())
    const watch = new MutationObserver(follow)
    watch.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] })
    follow()
    return () => { window.removeEventListener(EVENT, on); watch.disconnect() }
  }, [])
  const region = <div className="sr-only" aria-live="polite" data-testid="live">{text}</div>
  return host ? createPortal(region, host) : region
}
