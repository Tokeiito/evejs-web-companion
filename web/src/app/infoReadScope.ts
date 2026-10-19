import { createSignal, readonlySignal, type ReadableSignal } from "../store/signals.ts";
import type { InfoIdentity } from "../bridge/infoWindow.ts";

/** BaseInfoWindow._stop_reconstruct_thread kills only the registered tasklet.
 * Same-content ordinary NavigateHistory calls reconstruction directly instead. */
export interface InfoReadScope {
  readonly loading: ReadableSignal<boolean>;
  readonly identity: ReadableSignal<InfoIdentity | null>;
  identify(): void;
  begin(): () => void;
  assertCurrent(): void;
  retireRegistered(): void;
}

export function createInfoReadScope(pilotCurrent: () => boolean, requested: InfoIdentity, registered = true,
  initialIdentity: InfoIdentity | null = requested.content === "corporation" ? null : requested): InfoReadScope {
  let retired = false;
  let pending = 0;
  const loading = createSignal(false);
  const identity = createSignal<InfoIdentity | null>(initialIdentity);
  const assertCurrent = (): void => {
    if (!retired && pilotCurrent()) return;
    throw Object.assign(new Error("This information reconstruction has retired."), { code: "INFO_RECONSTRUCTION_RETIRED" });
  };
  return {
    loading: readonlySignal(loading), identity: readonlySignal(identity), assertCurrent,
    identify(): void { assertCurrent(); identity.set(requested); },
    begin(): () => void {
      assertCurrent(); pending++; loading.set(true);
      let finished = false;
      return () => { if (finished) return; finished = true; if (--pending === 0) loading.set(false); };
    },
    retireRegistered(): void { if (registered) { retired = true; loading.set(false); } },
  };
}
