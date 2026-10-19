/** BaseInfoWindow._stop_reconstruct_thread kills only the registered tasklet.
 * Same-content ordinary NavigateHistory calls reconstruction directly instead. */
export interface InfoReadScope {
  assertCurrent(): void;
  retireRegistered(): void;
}

export function createInfoReadScope(pilotCurrent: () => boolean, registered = true): InfoReadScope {
  let retired = false;
  return {
    assertCurrent(): void {
      if (!retired && pilotCurrent()) return;
      throw Object.assign(new Error("This information reconstruction has retired."), { code: "INFO_RECONSTRUCTION_RETIRED" });
    },
    retireRegistered(): void { if (registered) retired = true; },
  };
}
