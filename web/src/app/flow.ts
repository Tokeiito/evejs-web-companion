// The R2 page controller: drives the login -> character select -> docked
// station panel flow and feeds every outcome into the client-state store as
// events ("how to add a page", docs/bridge-wire-contract.md). The Svelte view
// is a pure reader of the store; this module owns all fetch/decode logic so
// it stays framework-agnostic and unit-testable under node:test.

import { getCharacterSelectionData } from "../bridge/characterSelection.ts";
import {
  getStationGuests,
  getStationInfoCached,
  getStationItemBits,
} from "../bridge/stationPanel.ts";
import { BridgeCallError } from "../bridge/callMethod.ts";
import * as api from "./api.ts";
import type { ClientStore } from "../store/clientStore.ts";

export interface AppFlowOptions {
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
}

export interface AppFlow {
  /** Who-cares login, then the typed reference call to fill the character list. */
  login(username: string, password: string): Promise<void>;
  /** Select a character onto the persistent session, then run the docked reads. */
  selectCharacter(characterID: number): Promise<void>;
  /** Refresh the docked station-panel reads on the live session. */
  refreshStationPanel(): Promise<void>;
  /** Release the persistent session (character offline), back to the select list. */
  releaseSession(): Promise<void>;
  logout(): Promise<void>;
}

/** True when the session the BFF held is gone (TTL, takeover, restart). */
export function isSessionLost(error: unknown): boolean {
  return error instanceof BridgeCallError && error.code === "SESSION_NOT_FOUND";
}

export function createAppFlow(store: ClientStore, options: AppFlowOptions = {}): AppFlow {
  const callOptions = {
    ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
    ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
  };

  async function refreshStationPanel(): Promise<void> {
    try {
      // Retail issues these when the docked UI loads; the page issues them
      // after select succeeds (push forwarding is a later goal, G6).
      const [bits, guests, cached] = await Promise.all([
        getStationItemBits(callOptions),
        getStationGuests(callOptions),
        getStationInfoCached(callOptions),
      ]);
      store.apply({ type: "station/bits", bits });
      store.apply({ type: "station/guests", guests });
      store.apply({ type: "station/info-cached", cached });
    } catch (error) {
      if (isSessionLost(error)) {
        // The live session ended out from under us: reflect offline state and
        // let the view fall back to the character list.
        store.apply({ type: "character/offline" });
      }
      throw error;
    }
  }

  return {
    async login(username, password) {
      const result = await api.login(username, password, callOptions);
      store.apply({
        type: "session/logged-in",
        accountID: result.accountID,
        username: result.username,
      });
      // The character list comes from the typed retail reference call, not a
      // bespoke projection (charUnboundMgr.GetCharacterSelectionData).
      const selection = await getCharacterSelectionData(callOptions);
      store.apply({ type: "character/list", characters: selection.characters });
    },

    async selectCharacter(characterID) {
      store.apply({ type: "character/selected", characterID });
      const result = await api.selectCharacter(characterID, callOptions);
      store.apply({
        type: "character/online",
        character: result.character,
        station: result.station,
      });
      await refreshStationPanel();
    },

    refreshStationPanel,

    async releaseSession() {
      try {
        await api.releaseSession(callOptions);
      } finally {
        store.apply({ type: "character/offline" });
        store.apply({ type: "character/selected", characterID: null });
      }
    },

    async logout() {
      try {
        await api.logout(callOptions);
      } finally {
        store.apply({ type: "session/logged-out" });
      }
    },
  };
}
