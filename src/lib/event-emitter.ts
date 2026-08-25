/**
 * Lightweight typed event emitter — generic pub/sub for inter-module
 * communication without tight coupling.
 *
 * Usage:
 *   type Events = { 'stateChange': { isPlaying: boolean }; 'end': void };
 *   const emitter = new EventEmitter<Events>();
 *   const unsub = emitter.on('stateChange', (data) => { ... });
 *   emitter.emit('stateChange', { isPlaying: true });
 *   unsub(); // remove listener
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler<T> = T extends void ? () => void : (data: T) => void;

/** AggregateError-compatible error that bundles multiple handler failures into one. */
export class AggregatedHandlerErrors extends Error {
  public readonly errors: unknown[];
  constructor(errors: unknown[], message?: string) {
    super(message ?? `Multiple event handlers failed (${errors.length})`);
    this.name = 'AggregatedHandlerErrors';
    this.errors = errors;
  }
}

export class EventEmitter<T extends Record<string, unknown>> {
  private listeners = new Map<keyof T, Set<Handler<unknown>>>();

  /** Subscribe to an event. Returns an unsubscribe function. */
  on<K extends keyof T>(event: K, handler: Handler<T[K]>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    const handlers = this.listeners.get(event)!;
    handlers.add(handler as Handler<unknown>);
    return () => { handlers.delete(handler as Handler<unknown>); };
  }

  /** Emit an event, calling all subscribed handlers. Collects errors from every handler and throws them together as an AggregateError if multiple occurred; otherwise rethrows the single error. */
  emit<K extends keyof T>(event: K, ...[data]: T[K] extends void ? [] : [T[K]]): void {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    const errors: unknown[] = [];
    for (const handler of handlers) {
      try {
        (handler as Handler<T[K]>)(data as T[K]);
      } catch (err) {
        errors.push(err);
      }
    }
    if (errors.length === 0) return;
    if (errors.length === 1) throw errors[0];
    throw new AggregatedHandlerErrors(errors, `Event handler failed for '${String(event)}'`);
  }

  /** Remove all listeners for a specific event, or all events if none specified. */
  clear(event?: keyof T): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  /** Unsubscribe from an event using the handler reference instead of the unsubscribe function. */
  off<K extends keyof T>(event: K, handler: Handler<T[K]>): void {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    handlers.delete(handler as Handler<unknown>);
  }
}
