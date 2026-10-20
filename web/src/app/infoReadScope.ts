import { createSignal, readonlySignal, type ReadableSignal } from "../store/signals.ts";
import type { InfoIdentity } from "../bridge/infoWindow.ts";

/** BaseInfoWindow._stop_reconstruct_thread kills only the registered tasklet.
 * Same-content ordinary NavigateHistory calls reconstruction directly instead. */
export interface InfoReadScope {
  readonly loading: ReadableSignal<boolean>;
  readonly identity: ReadableSignal<InfoIdentity | null>;
  /** Native registered tasklet death, for service work that owns cache publication. */
  readonly signal: AbortSignal;
  identify(): void;
  construct(): void;
  complete(): void;
  begin(): () => void;
  assertCurrent(): void;
  retireRegistered(withHistory?: boolean): void;
}

export function createInfoReadScope(pilotCurrent: () => boolean, options: {
  requested: InfoIdentity;
  registered?: boolean;
  initialIdentity?: InfoIdentity | null;
  onIdentify?(): void;
  onConstruct?(): void;
  onComplete?(): void;
  onRetire?(withHistory: boolean): void;
}): InfoReadScope {
  const { requested, registered = true } = options;
  const initialIdentity = options.initialIdentity !== undefined ? options.initialIdentity : requested.content === "corporation" ? null : requested;
  let retired = false;
  let completed = false;
  let pending = 0;
  const loading = createSignal(false);
  const identity = createSignal<InfoIdentity | null>(initialIdentity);
  const controller = new AbortController();
  const assertCurrent = (): void => {
    if (!retired && pilotCurrent()) return;
    throw Object.assign(new Error("This information reconstruction has retired."), { code: "INFO_RECONSTRUCTION_RETIRED" });
  };
  return {
    loading: readonlySignal(loading), identity: readonlySignal(identity), signal: controller.signal, assertCurrent,
    identify(): void { assertCurrent(); identity.set(requested); options.onIdentify?.(); },
    construct(): void { assertCurrent(); options.onConstruct?.(); },
    complete(): void { assertCurrent(); if (!completed) { completed = true; options.onComplete?.(); } },
    begin(): () => void {
      assertCurrent(); pending++; loading.set(true);
      let finished = false;
      return () => { if (finished) return; finished = true; if (--pending === 0) loading.set(false); };
    },
    retireRegistered(withHistory = true): void {
      if (registered && !retired) {
        options.onRetire?.(withHistory); retired = true; loading.set(false);
        controller.abort(Object.assign(new Error("This information reconstruction has retired."), { code: "INFO_RECONSTRUCTION_RETIRED" }));
      }
    },
  };
}
