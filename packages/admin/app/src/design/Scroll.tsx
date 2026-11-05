import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/** A block that is wider than the screen scrolls inside itself, not the page (WCAG 1.4.10, reflow). When
 *  it does scroll it is a labelled region a keyboard can focus, so what is past the edge can be reached;
 *  when it does not, it is a plain block and adds neither a tab stop nor a landmark. */
export function Scroll({ label, children }: { label: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const [over, setOver] = useState(false)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const check = () => setOver(el.scrollWidth > el.clientWidth + 1)
    check()
    if (typeof ResizeObserver === 'undefined') return
    const watch = new ResizeObserver(check)
    watch.observe(el)
    if (el.firstElementChild) watch.observe(el.firstElementChild)
    return () => watch.disconnect()
  }, [])
  return (
    <div ref={box} className="scroll" {...(over ? { role: 'region', 'aria-label': `${label}, scrolls sideways`, tabIndex: 0 } : {})}>
      {children}
    </div>
  )
}
