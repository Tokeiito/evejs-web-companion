import type { Ask } from "./ask.ts";
import type { JsonValue } from "./wire.ts";

const MAX_CORPORATIONS = 100000;
const MAX_AGE_SECONDS = 600;

/** base_corporation.GetAggressionSettings256-261 keeps completed raw replies,
 * including None, in ExpiringDict(100000,600). It does not keep pending reads. */
export function createCorporationAggression(now: () => number = () => Date.now() / 1000) {
  const rows = new Map<number, { readonly answer: JsonValue; readonly at: number }>();
  let generation = 0;
  return {
    async get(ask: Ask, corporationID: number, current: () => void = () => {}): Promise<JsonValue> {
      current();
      const held = rows.get(corporationID);
      if (held) {
        // Native contains and get each check wall time, without renewing age.
        if (now() - held.at < MAX_AGE_SECONDS) {
          if (now() - held.at < MAX_AGE_SECONDS) return held.answer;
          rows.delete(corporationID);
          throw Object.assign(new Error(String(corporationID)), { name: "KeyError" });
        }
        rows.delete(corporationID);
      }
      const epoch = generation;
      const answer = await ask("corpmgr", "GetAggressionSettings", [corporationID]);
      current();
      if (epoch !== generation) throw Object.assign(new Error("The aggression read belongs to a previous pilot."), { code: "SESSION_REQUEST_RETIRED" });
      // ExpiringDict evicts before every full-capacity assignment, even when
      // replacing an existing key. OrderedDict then preserves a live key's slot.
      if (rows.size >= MAX_CORPORATIONS) rows.delete(rows.keys().next().value!);
      const at = now(), existing = rows.get(corporationID);
      if (existing && now() - existing.at >= MAX_AGE_SECONDS) rows.delete(corporationID);
      rows.set(corporationID, { answer, at });
      return answer;
    },
    reset(): void { generation++; rows.clear(); },
  };
}
