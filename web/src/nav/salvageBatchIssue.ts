import { isSessionChangeSettling, isTransitionTimeout, isTransportTransient } from "../bridge/refusals.ts";
import type { SalvageBatchOutcome, SalvageBatchResult, SalvageBatchStep } from "./scriptDecide.ts";

/** Keep each definite result; an unknown outcome stops dispatch before another write. */
export async function issueSalvageBatch(
  steps: readonly SalvageBatchStep[],
  issue: (step: SalvageBatchStep) => Promise<void>,
  isSessionLost: (error: unknown) => boolean,
): Promise<SalvageBatchResult> {
  const outcomes: SalvageBatchOutcome[] = [];
  for (const step of steps) {
    try {
      await issue(step);
      outcomes.push({ step, ok: true });
    } catch (error) {
      const code = error !== null && typeof error === "object" && "code" in error ? String(error.code) : "";
      if (isSessionLost(error) || isTransportTransient(error) || isTransitionTimeout(error) ||
          isSessionChangeSettling(error) || code === "BRIDGE_BAD_RESPONSE" || code === "MODULE_ACTION_UNCERTAIN") {
        // Preserve the original error and its classification. The runner can
        // keep definite earlier results while reconciling the interrupted call.
        if (error !== null && typeof error === "object") {
          try { Object.assign(error, { salvageBatchOutcomes: outcomes }); }
          catch { /* An immutable error must still retain its original classification. */ }
        }
        throw error;
      }
      outcomes.push({ step, ok: false, error });
    }
  }
  return { kind: "salvageBatch", outcomes };
}
