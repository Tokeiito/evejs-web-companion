// Browser-side TS callMethod client (goal R1b).
//
// Mirrors the retail call tuple (service, method, args, kwargs) and drives it
// through the R1 BFF proxy route POST /api/bridge/call
// (docs/bridge-wire-contract.md). The BFF requires the signed web login
// session — since R42 the tab's own `Authorization: Bearer` token, with the
// same-origin cookie as the migration fallback — and pins the bridge session
// identity to the logged-in account.

import { sessionAuthHeaders, tokenAuthHeaders } from "../app/sessionToken.ts";
import {
  TransportQueueError,
  bridgeLane,
  type RequestPriority,
} from "../app/transport.ts";
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
  /** Safe language preferences only; identity and gameplay state are server-held. */
  readonly session?: SessionFields;
  /** Base URL prefix; default "" (same-origin against the BFF). */
  readonly baseUrl?: string;
  /** Injectable fetch for tests; default globalThis.fetch. */
  readonly fetch?: typeof fetch;
  readonly signal?: AbortSignal;
  /**
   * R107 multibox — this call's OWN session token. Same contract as
   * `ApiOptions.token` in app/api.ts: when the KEY is present the call is
   * per-session (Bearer with exactly this token, or no header when null, never
   * the global fallback); when absent it rides the per-tab global as before.
   * Character-scoped bridge helpers (bridge/stationPanel.ts,
   * bridge/characterSelection.ts) forward the flow's call options here, so this
   * route must honor it or a background pilot's station reads would run as
   * whoever last wrote the shared cookie.
   */
  readonly token?: string | null;
  /** R92 — lane priority; defaults to "read". See app/transport.ts. */
  readonly priority?: RequestPriority;
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
    // R92 — the SECOND fetch site in the client shares the one request lane, or
    // the cap would only bound half of what the tab does. See app/transport.ts.
    response = await bridgeLane.run(options.priority ?? "read", "/api/bridge/call", () =>
      doFetch(`${options.baseUrl ?? ""}/api/bridge/call`, {
      method: "POST",
      // R42/R107 — the session's own token, alongside the cookie. This route is
      // the second fetch site in the client (api.ts's requestJson is the other),
      // so it needs the header too or character selection and the station panel
      // would silently run as whoever last wrote the cookie. Per-session (token
      // key present) uses this flow's token; otherwise the per-tab global.
      headers: {
        ...("token" in options ? tokenAuthHeaders(options.token) : sessionAuthHeaders()),
        "content-type": "application/json",
      },
      credentials: "same-origin",
      body: JSON.stringify(body),
      // The same 65 s browser-side deadline as api.ts requestJson (see the
      // note there): a half-dead socket must abort into BRIDGE_NETWORK_ERROR
      // rather than freeze the awaiting loop forever. A caller's own signal
      // still wins.
      signal: options.signal ?? AbortSignal.timeout(65_000),
      }),
    );
  } catch (cause) {
    throw new BridgeCallError(
      "BRIDGE_NETWORK_ERROR",
      cause instanceof TransportQueueError
        ? cause.message
        : `Bridge call ${service}.${method} could not reach the BFF: ${
            cause instanceof Error ? cause.message : String(cause)
          } — ${bridgeLane.diagnose().verdict}`,
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
