import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'

/** Live refresh: external edits (Obsidian, agents, git) invalidate cached queries. */
export function useRegistryEvents(): void {
  const queryClient = useQueryClient()
  useEffect(() => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const socket = new WebSocket(`${proto}://${location.host}/api/events`)
    socket.onmessage = event => {
      const msg = JSON.parse(event.data as string) as { type: string; registry?: string }
      if (msg.type === 'registry-changed' && msg.registry) {
        void queryClient.invalidateQueries({ queryKey: ['registry', msg.registry] })
        void queryClient.invalidateQueries({ queryKey: ['registries'] })
        void queryClient.invalidateQueries({ queryKey: ['status'] })
      }
    }
    return () => socket.close()
  }, [queryClient])
}
