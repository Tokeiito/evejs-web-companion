// Plain framework-agnostic signals (goal R1b, roadmap section 5).
//
// The client-state store is built on these so the view library chosen in R2
// (Svelte 5 or SolidJS) is not load-bearing. `subscribe` follows the Svelte
// store contract — the listener is called synchronously with the current value
// on subscribe, then on every change — so a signal is directly usable as a
// Svelte store, and SolidJS can wrap one with `from()`.

export type Unsubscribe = () => void;
export type Listener<T> = (value: T) => void;

export interface ReadableSignal<T> {
  /** Read the current value without subscribing. */
  get(): T;
  /**
   * Svelte-store-contract compatible: calls `listener` synchronously with the
   * current value, then again after every change. Returns an unsubscriber.
   */
  subscribe(listener: Listener<T>): Unsubscribe;
}

export interface WritableSignal<T> extends ReadableSignal<T> {
  set(value: T): void;
  update(updater: (value: T) => T): void;
}

/**
 * Create a writable signal. Listeners are only notified when the new value is
 * not `equals` to the old one (default: Object.is), so redundant sets are
 * free for subscribers.
 */
export function createSignal<T>(
  initial: T,
  equals: (a: T, b: T) => boolean = Object.is,
): WritableSignal<T> {
  let value = initial;
  const listeners = new Set<Listener<T>>();

  const get = (): T => value;

  const set = (next: T): void => {
    if (equals(value, next)) {
      return;
    }
    value = next;
    // Snapshot so a listener unsubscribing mid-notify cannot skip others.
    for (const listener of [...listeners]) {
      try {
        listener(value);
      } catch (error) {
        // A subscriber that throws must not take down the PRODUCER. The bot
        // loops emit progress through here from inside their tick — a view
        // effect throwing back through that emit used to kill the loop while
        // the panel kept saying "running". Delivery to the remaining
        // listeners continues, and the error still SURFACES: in the browser
        // `reportError` fires the same window "error" event an uncaught throw
        // would (the overlay banner appears); under Node the console carries
        // it.
        if (typeof reportError === "function") {
          reportError(error);
        } else {
          console.error(error);
        }
      }
    }
  };

  const update = (updater: (current: T) => T): void => {
    set(updater(value));
  };

  const subscribe = (listener: Listener<T>): Unsubscribe => {
    listeners.add(listener);
    listener(value);
    return () => {
      listeners.delete(listener);
    };
  };

  return { get, set, update, subscribe };
}

/** Expose a writable signal as read-only (for store consumers). */
export function readonlySignal<T>(signal: ReadableSignal<T>): ReadableSignal<T> {
  return {
    get: () => signal.get(),
    subscribe: (listener) => signal.subscribe(listener),
  };
}
