import type { ReactElement } from 'react'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { InspectorProvider } from '../inspector/InspectorContext.tsx'
import { PanelProvider } from '../parts/panels.tsx'

/** Render at a path, with a fresh query client (no retries: an unstubbed route fails at once; a test
 *  may pass its own), a
 *  recorded in-memory location, the panel slots (with the live region) and the inspector. */
export function renderAt(ui: ReactElement, path = '/', opts: { queryClient?: QueryClient } = {}) {
  const loc = memoryLocation({ path, record: true })
  const qc = opts.queryClient ?? new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrap = (el: ReactElement) => (
    <QueryClientProvider client={qc}>
      <Router hook={loc.hook} searchHook={loc.searchHook}>
        <PanelProvider><InspectorProvider>{el}</InspectorProvider></PanelProvider>
      </Router>
    </QueryClientProvider>
  )
  const utils = render(wrap(ui))
  // rerender keeps the providers, so a test can change only what it draws
  return { ...utils, rerender: (el: ReactElement) => utils.rerender(wrap(el)), loc, qc }
}
