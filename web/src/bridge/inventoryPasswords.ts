import type { Ask } from "./ask.ts";
import { BridgeCallError } from "./callMethod.ts";
import type { JsonValue } from "./wire.ts";

export type InventoryPasswordType = 1 | 2;

/** Original invCache.PasswordHandlerCallWrapper1450-1477, below cached writer guards. */
export function inventoryPasswords(scope: {
  readonly ask: Ask;
  readonly act: Ask;
  readonly current: () => void;
  readonly prompt: (type: InventoryPasswordType) => Promise<string | null>;
}) {
  async function retry<T>(operation: () => Promise<T>, method: string, args: readonly JsonValue[], of: JsonValue): Promise<T> {
    for (;;) {
      scope.current();
      try {
        const result = await operation();
        scope.current();
        return result;
      } catch (error) {
        scope.current();
        if (method === "SetPassword") throw error;
        const key = error instanceof BridgeCallError ? error.refusal?.key : null;
        if (key === "PasswordProtectedCacheInvalid") {
          // Native takes args[1] verbatim, then raises a NEW challenge without prompting in this call.
          if (args.length < 2) throw new Error("PasswordProtectedCacheInvalid has no source location argument.");
          await scope.act("invCache", "InvalidateLocationCache", [args[1]!]);
          scope.current();
          throw new BridgeCallError("CALL_REFUSED", "SCGeneralPasswordRequired", 400, null, null,
            { key: "SCGeneralPasswordRequired", values: null });
        }
        const type = key === "SCGeneralPasswordRequired" ? 1 : key === "SCConfigPasswordRequired" ? 2 : null;
        if (type === null) throw error;
        const password = await scope.prompt(type);
        scope.current();
        if (password === null) throw error;
        // RAW same bound inventory: entry exceptions escape, its boolean result is ignored.
        await scope.act("invbroker", "EnterPassword", [type, password], null, of);
        scope.current();
      }
    }
  }
  const wrap = (raw: Ask): Ask => (service, method, args, kwargs, of) =>
    service === "invbroker" && of !== undefined && of !== null
      ? retry(() => raw(service, method, args, kwargs, of), method, args, of)
      : raw(service, method, args, kwargs, of);
  return { ask: wrap(scope.ask), act: wrap(scope.act), retry };
}

/** SingleLineEditText.GetValue: narrow Unicode maxletters precedes angle escaping; spaces are retained. */
export function inventoryPasswordText(value: string): string | null {
  const limited = value.slice(0, 16);
  // Python 2.7 unicode.isspace differs from JavaScript trim (notably U+0085 and U+FEFF).
  if (/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u180e\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*$/.test(limited)) return null;
  return limited.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
