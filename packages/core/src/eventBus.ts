/**
 * Typed event bus (SRS INT-010). Events are declared once in `events.ts`.
 * Payloads must be plain data, never live objects.
 */
export type Handler<T> = (payload: T) => void;

export class EventBus<E extends object> {
  private handlers = new Map<keyof E, Set<Handler<never>>>();

  on<K extends keyof E>(name: K, handler: Handler<E[K]>): () => void {
    let set = this.handlers.get(name);
    if (!set) {
      set = new Set();
      this.handlers.set(name, set);
    }
    set.add(handler as Handler<never>);
    return () => this.off(name, handler);
  }

  once<K extends keyof E>(name: K, handler: Handler<E[K]>): () => void {
    const off = this.on(name, (payload) => {
      off();
      handler(payload);
    });
    return off;
  }

  off<K extends keyof E>(name: K, handler: Handler<E[K]>): void {
    this.handlers.get(name)?.delete(handler as Handler<never>);
  }

  emit<K extends keyof E>(name: K, payload: E[K]): void {
    const set = this.handlers.get(name);
    if (!set) return;
    // Copy so handlers can unsubscribe while we iterate.
    for (const handler of [...set]) {
      try {
        (handler as Handler<E[K]>)(payload);
      } catch (error) {
        console.error(`[events] handler for "${String(name)}" threw`, error);
      }
    }
  }

  listenerCount<K extends keyof E>(name: K): number {
    return this.handlers.get(name)?.size ?? 0;
  }

  clear(): void {
    this.handlers.clear();
  }
}
