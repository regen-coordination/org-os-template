import type { ReactNode } from 'react'

/** One key, as a key cap (§7.3): ⌘, K, g, esc, ↵. */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd>{children}</kbd>
}
