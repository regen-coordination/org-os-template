import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'wouter'
import { usePanel } from '../parts/panels.tsx'

/** What a map hands the inspector beside the record (E-46, C6 fix I-1): the need it was opened at (the node's clay
 *  dot, Space on a lit node), and Move, when the map lets this viewer move that node. */
export interface InspectAt { need?: string; move?: () => void }
interface InspectorState { id: string | null; at: InspectAt; open: (id: string, at?: InspectAt) => void; close: () => void }
const Ctx = createContext<InspectorState>({ id: null, at: {}, open: () => {}, close: () => {} })

/** One inspector for the app, in the right panel slot. It belongs to the path it was opened on and
 *  closes once the path changes, so leaving a list or a map never leaves a stale panel behind, and
 *  the Escape stack never holds one that is hidden. It closes the right slot only while the slot
 *  shows it, never another panel there. */
export function InspectorProvider({ children }: { children: ReactNode }) {
  const [path] = useLocation()
  const pathRef = useRef(path)
  pathRef.current = path
  const right = usePanel('right')
  const mine = right.openId === 'inspector'
  const [state, setState] = useState<{ id: string; path: string; at: InspectAt } | null>(null)
  const shown = state && state.path === path && mine ? state.id : null
  useEffect(() => { if (state && state.path !== path) { setState(null); if (mine) right.close() } }, [path])
  const value = useMemo<InspectorState>(() => ({
    id: shown,
    at: shown !== null && state ? state.at : {},
    open: (id: string, at?: InspectAt) => {
      setState({ id, path: pathRef.current, at: at ?? {} })
      right.open('inspector', document.activeElement instanceof HTMLElement ? document.activeElement : null)
    },
    close: () => { setState(null); if (mine) right.close() },
  }), [shown, mine, state])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useInspector = (): InspectorState => useContext(Ctx)
