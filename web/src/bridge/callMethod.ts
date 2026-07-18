// Browser-side TS callMethod client (goal R1b).
//
// Mirrors the retail call tuple (service, method, args, kwargs) and drives it
// through the R1 BFF proxy route POST /api/bridge/call
// (docs/bridge-wire-contract.md). The BFF requires the signed web login
// session cookie (same-origin credentials) and pins the bridge session
// identity to the logged-in account.

import type {
  BridgeCallRequestBody,
  BridgeCallSuccessBody,
  BridgeErrorCode,
  BridgeNotification,
  CallArgs,
  CallKwargs,
  JsonValue,
  SessionFields,
} from "./wire.ts";

export interface BridgeCallOutcome<TResult = JsonValue> {
  readonly service: string;
  readonly method: string;
  readonly result: TResult;
  readonly notifications: readonly BridgeNotification[];
}

export interface CallMethodOptions {
  /** Extra scalar session fields for the browser-backed session (userid is BFF-pinned). */
  readonly session?: SessionFields;
  /** Base URL prefix; default "" (same-origin against the BFF). */
  readonly baseUrl?: string;
  /** Injectable fetch for tests; default globalThis.fetch. */
  readonly fetch?: typeof fetch;
  readonly signal?: AbortSignal;
}

/** Client-side (non-server) failure codes, alongside the wire's BridgeErrorCode set. */
export type BridgeClientErrorCode = "BRIDGE_NETWORK_ERROR" | "BRIDGE_BAD_RESPONSE";

export class BridgeCallError extends Error {
  override readonly name = "BridgeCallError";
  readonly code: BridgeErrorCode | BridgeClientErrorCode;
  /** HTTP status of the response; 0 when the request never completed. */
  readonly status: number;

  constructor(
    code: BridgeErrorCode | BridgeClientErrorCode,
    message: string,
    status: number,
  ) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function isSuccessBody(data: unknown): data is BridgeCallSuccessBody<JsonValue> {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { ok?: unknown }).ok === true &&
    typeof (data as { service?: unknown }).service === "string" &&
    typeof (data as { method?: unknown }).method === "string"
  );
}

/**
 * Invoke a whitelisted EveJS service method through the bridge:
 * browser -> POST /api/bridge/call -> gateway /_evejs-web/v1/call ->
 * serviceManager.lookup(service).callMethod(method, args, session, kwargs).
 *
 * Resolves with the handler result plus captured notifications; rejects with
 * BridgeCallError carrying the wire error code (CALL_NOT_ALLOWED, ...) or a
 * client-side code (BRIDGE_NETWORK_ERROR / BRIDGE_BAD_RESPONSE).
 */
export async function callMethod<TResult = JsonValue>(
  service: string,
  method: string,
  args: CallArgs = [],
  kwargs: CallKwargs = null,
  options: CallMethodOptions = {},
): Promise<BridgeCallOutcome<TResult>> {
  const doFetch = options.fetch ?? globalThis.fetch;
  const body: BridgeCallRequestBody = {
    service,
    method,
    args,
    kwargs,
    ...(options.session ? { session: options.session } : {}),
  };

  let response: Response;
  try {
    response = await doFetch(`${options.baseUrl ?? ""}/api/bridge/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (cause) {
    throw new BridgeCallError(
      "BRIDGE_NETWORK_ERROR",
      `Bridge call ${service}.${method} could not reach the BFF: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      0,
    );
  }

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    throw new BridgeCallError(
      "BRIDGE_BAD_RESPONSE",
      `Bridge call ${service}.${method} returned a non-JSON response (HTTP ${response.status}).`,
      response.status,
    );
  }

  if (typeof data === "object" && data !== null && (data as { ok?: unknown }).ok === false) {
    const errorBody = data as { error?: unknown; message?: unknown };
    throw new BridgeCallError(
      typeof errorBody.error === "string" ? errorBody.error : "BRIDGE_BAD_RESPONSE",
      typeof errorBody.message === "string"
        ? errorBody.message
        : `Bridge call ${service}.${method} failed (HTTP ${response.status}).`,
      response.status,
    );
  }

  if (!response.ok || !isSuccessBody(data)) {
    throw new BridgeCallError(
      "BRIDGE_BAD_RESPONSE",
      `Bridge call ${service}.${method} returned an unexpected envelope (HTTP ${response.status}).`,
      response.status,
    );
  }

  return {
    service: data.service,
    method: data.method,
    result: (data.result === undefined ? null : data.result) as TResult,
    notifications: Array.isArray(data.notifications) ? data.notifications : [],
  };
}
