import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { handleEvent, type ServerEvent } from './events.ts'

/** Live refresh: external edits (Obsidian, agents, git), resource changes and job output. */
export function useServerEvents(): void {
  const queryClient = useQueryClient()
  useEffect(() => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const socket = new WebSocket(`${proto}://${location.host}/api/events`)
    socket.onmessage = event => {
      try { handleEvent(JSON.parse(event.data as string) as ServerEvent, queryClient) } catch { /* a message this page does not know */ }
    }
    return () => socket.close()
  }, [queryClient])
}
