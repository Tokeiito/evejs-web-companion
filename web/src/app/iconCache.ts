// Client for the BFF's icon-cache admin routes (the Settings panel). These are
// local-tool actions, not game state, so they live here rather than in the store
// flow — but they pick up the same per-tab session auth every BFF call uses.
import { sessionAuthHeaders } from "./sessionToken.ts";

export interface IconCacheStatus {
  readonly cachedCount: number;
  readonly autoDownload: boolean;
  readonly running: boolean;
  readonly source: string | null;
  readonly progress: string;
  readonly lastResult: string | null;
}

async function iconFetch(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: { ...sessionAuthHeaders(), ...((init?.headers as Record<string, string>) ?? {}) },
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || data.ok === false) {
    throw new Error(String((data && data.message) || `Request failed (HTTP ${response.status}).`));
  }
  return data;
}

export async function fetchIconStatus(): Promise<IconCacheStatus> {
  const d = await iconFetch("/api/icons/status");
  return {
    cachedCount: Number(d.cachedCount) || 0,
    autoDownload: d.autoDownload === true,
    running: d.running === true,
    source: typeof d.source === "string" ? d.source : null,
    progress: String(d.progress ?? ""),
    lastResult: typeof d.lastResult === "string" ? d.lastResult : null,
  };
}

export async function setIconAutoDownload(autoDownload: boolean): Promise<boolean> {
  const d = await iconFetch("/api/icons/settings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ autoDownload }),
  });
  return d.autoDownload === true;
}

export async function startIconPull(source: "gamestore" | "all-types"): Promise<void> {
  await iconFetch("/api/icons/cache", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source }),
  });
}
