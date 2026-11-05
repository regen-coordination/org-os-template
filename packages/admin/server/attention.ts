import type { Adapter, Attention, Resource } from './resources/types.ts'

/** Attention the server raises about itself, not about a file in the repository: the private store that cannot be
 *  opened (L5 spec §10.1), a backup that was not taken (§10.4); later the public remote (Task 17). Each item has a
 *  key; raising a key again replaces it, clearing it removes it. The resource graph reads the list through
 *  `serverAttentionAdapter`, so an item is a card on the Systems board and a row of Home's "Needs you", as an
 *  unreadable source already is. */
export class ServerAttention {
  private readonly items = new Map<string, { name: string; attention: Attention }>()
  /** Called after every change; the server re-reads the adapter and tells the open pages. */
  onChange: () => void = () => {}

  raise(key: string, name: string, attention: Attention): void {
    const was = this.items.get(key)
    if (was && was.name === name && was.attention.level === attention.level && was.attention.text === attention.text) return
    this.items.set(key, { name, attention })
    this.onChange()
  }

  clear(key: string): void {
    if (this.items.delete(key)) this.onChange()
  }

  /** The items as resources: `absent:server:<key>`, drawn as a card that something is missing. */
  resources(): Resource[] {
    return [...this.items].map(([key, { name, attention }]) => ({
      id: `absent:server:${key}`, kind: 'absent', board: 'systems', name, status: 'absent',
      attention, changed: null, facts: {}, source: null,
    }))
  }
}

/** The adapter that puts the server's own attention into the graph. It watches no file. */
export function serverAttentionAdapter(list: ServerAttention): Adapter {
  return {
    name: 'server', board: 'systems', title: 'This server', watch: [],
    read: async () => ({ nodes: list.resources(), edges: [] }),
  }
}
