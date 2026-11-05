import { useEffect, useState } from 'react'

/** P1's phone breakpoint (design.css `max-width: 759px`). False where matchMedia is missing (jsdom). */
export const NARROW = '(max-width: 759px)'

export function useNarrow(query = NARROW): boolean {
  const read = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches
  const [narrow, setNarrow] = useState(read)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const m = window.matchMedia(query)
    const on = () => setNarrow(m.matches)
    on()
    m.addEventListener?.('change', on)
    return () => m.removeEventListener?.('change', on)
  }, [query])
  return narrow
}
