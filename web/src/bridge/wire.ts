// TypeScript view of docs/bridge-wire-contract.md (goal R1b).
//
// The unit the bridge mirrors is the retail call tuple
// (service, method, args, kwargs). These types cover the browser -> BFF hop
// (POST /api/bridge/call) plus the marshaled value encodings retail-shaped
// handler results use on the wire (list / dict / util.KeyVal / long).

// --- JSON building blocks --------------------------------------------------

export type JsonScalar = string | number | boolean | null;
export type JsonValue = JsonScalar | readonly JsonValue[] | { readonly [key: string]: JsonValue };

// --- Call tuple ------------------------------------------------------------

export type CallArgs = readonly JsonValue[];
export type CallKwargs = Readonly<Record<string, JsonValue>> | null;

/**
 * Extra session scalars forwarded to the gateway-materialized browser-backed
 * session. Scalars only; the BFF pins `userid` to the logged-in account, so a
 * browser-supplied userid is ignored.
 */
export type SessionFields = Readonly<Record<string, JsonScalar>>;

export interface BridgeCallRequestBody {
  readonly service: string;
  readonly method: string;
  readonly args: CallArgs;
  readonly kwargs: CallKwargs;
  readonly session?: SessionFields;
}

// --- Response envelopes ----------------------------------------------------

/** One captured sendServiceNotification call, in handler order. */
export interface BridgeNotification {
  readonly service: string;
  readonly method: string;
  readonly args: readonly JsonValue[];
  readonly kwargs: Readonly<Record<string, JsonValue>> | null;
}

export interface BridgeCallSuccessBody<TResult = JsonValue> {
  readonly ok: true;
  readonly service: string;
  readonly method: string;
  readonly result: TResult;
  readonly notifications: readonly BridgeNotification[];
}

export interface BridgeErrorBody {
  readonly ok: false;
  readonly error: string;
  readonly message?: string;
}

/**
 * Error codes the BFF route can return (docs/bridge-wire-contract.md).
 * Gateway codes pass through with their status. The (string & {}) arm keeps
 * the union open for codes added later without breaking narrowing on these.
 */
export type BridgeErrorCode =
  | "CALL_INVALID"
  | "CALL_NOT_ALLOWED"
  | "CALL_SERVICE_UNAVAILABLE"
  | "CALL_FAILED"
  | "UNAUTHORIZED"
  | "GATEWAY_RUNTIME_NOT_READY"
  | "AUTH_REQUIRED"
  | "EVE_GATEWAY_UNREACHABLE"
  | "EVE_GATEWAY_TIMEOUT"
  | (string & {});

// --- Marshaled value encodings ---------------------------------------------
// Retail-shaped results carry these wrappers (built by eve.js service
// helpers, JSON-encoded by the gateway).

// These are type aliases (not interfaces) on purpose: aliases get implicit
// index signatures, so marshaled wrappers stay assignable to JsonValue.

/**
 * Retail long/FILETIME. Handlers that hold a BigInt cross the gateway as a
 * decimal string; handlers that used plain numbers still emit numbers.
 * Clients must accept both (wire contract, value encoding).
 */
export type LongValue = {
  readonly type: "long";
  readonly value: number | string;
};

export type ListValue<TItem = JsonValue> = {
  readonly type: "list";
  readonly items: readonly TItem[];
};

export type DictEntry = readonly [string, JsonValue];

export type DictValue = {
  readonly type: "dict";
  readonly entries: readonly DictEntry[];
};

/** util.KeyVal row: {type:"object", name:"util.KeyVal", args:{type:"dict", entries:[[k,v],...]}} */
export type KeyValValue = {
  readonly type: "object";
  readonly name: "util.KeyVal";
  readonly args: DictValue;
};

// --- Decoding helpers ------------------------------------------------------

export function isListValue(value: unknown): value is ListValue {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "list" &&
    Array.isArray((value as { items?: unknown }).items)
  );
}

export function isKeyValValue(value: unknown): value is KeyValValue {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as { type?: unknown; name?: unknown; args?: unknown };
  if (candidate.type !== "object" || candidate.name !== "util.KeyVal") {
    return false;
  }
  const args = candidate.args as { type?: unknown; entries?: unknown } | null | undefined;
  return (
    typeof args === "object" &&
    args !== null &&
    args.type === "dict" &&
    Array.isArray(args.entries)
  );
}

/** Read one key from a util.KeyVal row; undefined when absent or malformed. */
export function readKeyVal(row: unknown, key: string): JsonValue | undefined {
  if (!isKeyValValue(row)) {
    return undefined;
  }
  const entry = row.args.entries.find(
    (candidate) => Array.isArray(candidate) && candidate[0] === key,
  );
  return entry ? entry[1] : undefined;
}

/**
 * Unwrap a retail long to bigint. Accepts the {type:"long"} wrapper with a
 * number or decimal-string value (both are on the wire per the contract) and
 * bare integers; null for anything else (including absent/null fields).
 */
export function unwrapLong(value: unknown): bigint | null {
  if (typeof value === "number" && Number.isInteger(value)) {
    return BigInt(value);
  }
  if (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "long"
  ) {
    const inner = (value as { value?: unknown }).value;
    if (typeof inner === "number" && Number.isInteger(inner)) {
      return BigInt(inner);
    }
    if (typeof inner === "string" && /^-?\d+$/.test(inner)) {
      return BigInt(inner);
    }
  }
  return null;
}
