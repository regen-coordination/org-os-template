export type Unsubscribe = () => void;

export type EmitterOptions<M extends object> = {
  // Event types whose payloads are kept while nobody listens and replayed to the first subscriber.
  buffer?: (keyof M)[];
  // Most payloads kept per buffered type (oldest dropped first).
  bufferLimit?: number;
};

export class Emitter<M extends object> {
  private listeners = new Map<keyof M, Set<(payload: any) => void>>();
  private buffered: Set<keyof M>;
  private pending = new Map<keyof M, unknown[]>();
  private bufferLimit: number;

  constructor(
    private onListenerError: (type: keyof M, error: unknown) => void = (type, error) =>
      console.error(`[cockpit] listener for ${String(type)} failed`, error),
    opts: EmitterOptions<M> = {},
  ) {
    this.buffered = new Set(opts.buffer ?? []);
    this.bufferLimit = opts.bufferLimit ?? 50;
  }

  on<K extends keyof M>(type: K, fn: (payload: M[K]) => void): Unsubscribe {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn);
    const queued = this.pending.get(type);
    if (queued) {
      this.pending.delete(type);
      for (const payload of queued) this.call(type, fn, payload as M[K]);
    }
    return () => {
      set!.delete(fn);
    };
  }

  emit<K extends keyof M>(type: K, payload: M[K]): void {
    const set = this.listeners.get(type);
    if (!set?.size) {
      if (this.buffered.has(type)) {
        const queue = this.pending.get(type) ?? [];
        queue.push(payload);
        if (queue.length > this.bufferLimit) queue.shift();
        this.pending.set(type, queue);
      }
      return;
    }
    for (const fn of [...set]) this.call(type, fn, payload);
  }

  clear(): void {
    this.listeners.clear();
    this.pending.clear();
  }

  private call<K extends keyof M>(type: K, fn: (payload: M[K]) => void, payload: M[K]): void {
    try {
      fn(payload);
    } catch (error) {
      this.onListenerError(type, error);
    }
  }
}
