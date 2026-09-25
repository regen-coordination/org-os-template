export type Unsubscribe = () => void;

export class Emitter<M extends object> {
  private listeners = new Map<keyof M, Set<(payload: any) => void>>();

  constructor(
    private onListenerError: (type: keyof M, error: unknown) => void = (type, error) =>
      console.error(`[cockpit] listener for ${String(type)} failed`, error),
  ) {}

  on<K extends keyof M>(type: K, fn: (payload: M[K]) => void): Unsubscribe {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(fn);
    return () => {
      set!.delete(fn);
    };
  }

  emit<K extends keyof M>(type: K, payload: M[K]): void {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (error) {
        this.onListenerError(type, error);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
