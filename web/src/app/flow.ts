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
import { decodeContainer } from "../bridge/inventoryShip.ts";
import {
  AGENT_BUTTON,
  decodeBriefing,
  decodeConversation,
  decodeJournal,
} from "../bridge/agents.ts";
import { decodeFlightStatus } from "../bridge/flight.ts";
import type { FlightStepResult } from "./api.ts";
import { BridgeCallError } from "../bridge/callMethod.ts";
import * as api from "./api.ts";
import type { ClientStore } from "../store/clientStore.ts";
import type { AgentAction } from "../store/types.ts";
import { buildSystemGraph, solveRoute, type SystemGraph } from "../nav/routeSolver.ts";
import {
  createAutopilot,
  type AutopilotController,
  type AutopilotDeps,
  type RoutePlan,
} from "../nav/autopilotLoop.ts";

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
  /** Load the Inventory & Ship panel (station hangar + active-ship cargo). */
  loadInventory(): Promise<void>;
  /** Move a selected item hangar <-> active-ship cargo, then refresh. */
  moveItem(itemID: number, direction: "toCargo" | "toHangar", qty?: number | null): Promise<void>;
  /** Stack all loose stacks in the hangar or active-ship cargo, then refresh. */
  stackContainer(target: "hangar" | "cargo"): Promise<void>;
  /** Board a hangar ship (it becomes active), then refresh. */
  boardShip(shipID: number): Promise<void>;
  /** Load the docked station's agent roster (agentMgr.GetAgents). */
  loadAgents(): Promise<void>;
  /** Open a conversation with an agent (bound DoAction(None)). */
  openConversation(agentID: number): Promise<void>;
  /**
   * Take a conversation action (DoAction on the bound agent): request / accept /
   * decline. Accepting a courier refreshes the briefing + journal; declining
   * clears the briefing and refreshes the journal.
   */
  chooseAction(agentID: number, action: AgentAction): Promise<void>;
  /** Load the accepted-courier briefing (bound reads on the agent). */
  loadBriefing(agentID: number): Promise<void>;
  /** Load the mission journal (agentMgr.GetMyJournalDetails). */
  loadJournal(): Promise<void>;
  /** Refresh the flight status (location + ship movement state). */
  loadFlightStatus(): Promise<void>;
  /** Undock from the station (the session enters space). */
  undock(): Promise<void>;
  /** Warp to a chosen gate/celestial through the bound park. */
  warpTo(destinationID: number): Promise<void>;
  /** Jump through an NPC stargate (fromGate -> toGate). */
  jump(fromGateID: number, toGateID: number): Promise<void>;
  /** Dock at the destination station. */
  dock(stationID: number): Promise<void>;
  /**
   * R5b — start the browser autopilot to a destination (station or system ID):
   * solve the route client-side, then run the decide-loop. Surfaces a plan
   * error (unreachable / unknown) through the travel slice rather than throwing.
   */
  startRoute(destinationID: number): Promise<void>;
  /** Pause the autopilot loop (it stops issuing; the ship finishes its last move). */
  pauseRoute(): void;
  /** Resume a paused autopilot loop from where it stopped. */
  resumeRoute(): void;
  /** Abort the autopilot loop (it stops and never calls the bridge again). */
  abortRoute(): void;
  /** Release the persistent session (character offline), back to the select list. */
  releaseSession(): Promise<void>;
  logout(): Promise<void>;
}

/** True when the session the BFF held is gone (TTL, takeover, restart). */
export function isSessionLost(error: unknown): boolean {
  return error instanceof BridgeCallError && error.code === "SESSION_NOT_FOUND";
}

/** Short, human-readable reason for a failed docked read. */
function readErrorReason(error: unknown): string {
  if (error instanceof BridgeCallError) {
    return error.code;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function createAppFlow(store: ClientStore, options: AppFlowOptions = {}): AppFlow {
  const callOptions = {
    ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
    ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
  };

  async function refreshStationPanel(): Promise<void> {
    // Retail issues these when the docked UI loads; the page issues them after
    // select succeeds (push forwarding is a later goal, G6). The three reads
    // are INDEPENDENT: a slow or failed map.GetStationInfo (the heavy
    // full-table marshal) must never blank the services row or the guest list.
    // And because selectCharacter calls this after the view has already
    // switched to the panel, a failure is reported through the store (visible
    // in the panel) rather than thrown into an unmounted caller — except a
    // lost session, which must unwind the flow back to the character list.
    const labels = ["GetStationItemBits", "GetGuests", "GetStationInfo"] as const;
    const [bits, guests, cached] = await Promise.allSettled([
      getStationItemBits(callOptions),
      getStationGuests(callOptions),
      getStationInfoCached(callOptions),
    ]);

    if (bits.status === "fulfilled") {
      store.apply({ type: "station/bits", bits: bits.value });
    }
    if (guests.status === "fulfilled") {
      store.apply({ type: "station/guests", guests: guests.value });
    }
    if (cached.status === "fulfilled") {
      store.apply({ type: "station/info-cached", cached: cached.value });
    }

    const failures = [bits, guests, cached]
      .map((result, index) => ({ result, label: labels[index] }))
      .filter((entry) => entry.result.status === "rejected") as ReadonlyArray<{
      result: PromiseRejectedResult;
      label: string;
    }>;

    // A lost live session can't be recovered by any read: flip offline and
    // unwind so the view falls back to the character list.
    const lost = failures.find((entry) => isSessionLost(entry.result.reason));
    if (lost) {
      store.apply({ type: "character/offline" });
      throw lost.result.reason;
    }

    // Otherwise keep whatever succeeded and surface the rest (null clears a
    // stale error after a clean refresh). Never throw here.
    store.apply({
      type: "station/read-error",
      message: failures.length
        ? failures
            .map((entry) => `${entry.label}: ${readErrorReason(entry.result.reason)}`)
            .join("; ")
        : null,
    });
  }

  // Load the Inventory & Ship panel. The two containers are decoded
  // independently (their own error is preserved) so one failed read never
  // blanks the other — R2's Promise.allSettled rule, applied here on the BFF's
  // already-settled per-container results. A lost session unwinds to select.
  async function loadInventory(): Promise<void> {
    let panel: Awaited<ReturnType<typeof api.loadInventory>>;
    try {
      panel = await api.loadInventory(callOptions);
    } catch (error) {
      if (isSessionLost(error)) {
        // The live session ended out from under the inventory tab: unwind to
        // the character list like refreshStationPanel/runMutation, so the page
        // doesn't stay mounted with stale rows on a dead session.
        store.apply({ type: "character/offline" });
      }
      throw error;
    }
    store.apply({
      type: "inventory/loaded",
      stationID: panel.stationID,
      activeShipID: panel.activeShipID,
      hangar: decodeContainer(panel.hangar.list, panel.hangar.capacity, panel.hangar.error),
      cargo: decodeContainer(panel.cargo.list, panel.cargo.capacity, panel.cargo.error),
    });
  }

  // Run a mutation, then refresh the panel. A lost session is rethrown to
  // unwind the flow; any other failure is surfaced through the store (the page
  // stays put and shows the reason) rather than thrown into the UI handler.
  async function runMutation(action: () => Promise<void>): Promise<void> {
    try {
      await action();
      store.apply({ type: "inventory/action-error", message: null });
    } catch (error) {
      if (isSessionLost(error)) {
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({ type: "inventory/action-error", message: readErrorReason(error) });
      return;
    }
    await loadInventory();
  }

  // --- R4 Agents & Missions ------------------------------------------------

  async function loadJournal(): Promise<void> {
    const result = await api.loadJournal(callOptions);
    store.apply({ type: "agents/journal", journal: decodeJournal(result) });
  }

  async function loadBriefing(agentID: number): Promise<void> {
    const reads = await api.loadBriefing(agentID, callOptions);
    store.apply({
      type: "agents/briefing",
      briefing: decodeBriefing(reads.briefing, reads.objective),
    });
  }

  // Run an agent read/action, unwinding to offline on a lost session and
  // surfacing any other failure through the store (the page stays put and shows
  // the reason) rather than throwing into the UI handler.
  async function runAgentAction(action: () => Promise<void>): Promise<void> {
    try {
      await action();
      store.apply({ type: "agents/action-error", message: null });
    } catch (error) {
      if (isSessionLost(error)) {
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({ type: "agents/action-error", message: readErrorReason(error) });
    }
  }

  // --- R5a Flight (manually-stepped space movement) ------------------------

  // A movement refusal (CALL_REFUSED, 409) carries the handler's OWN
  // user-facing text as the message (scrambled, invalid target,
  // docking-approach, lost control, ship destroyed). Surface it so the operator
  // sees the real reason, not just the code — "pause on unsafe" must show why.
  function flightErrorReason(error: unknown): string {
    if (error instanceof BridgeCallError) {
      return error.message && error.message !== error.code
        ? `${error.code}: ${error.message}`
        : error.code;
    }
    return readErrorReason(error);
  }

  // Push a step's decoded flight snapshot into the store.
  function applyFlight(step: FlightStepResult): void {
    store.apply({ type: "flight/status", status: decodeFlightStatus(step.flight) });
  }

  async function loadFlightStatus(): Promise<void> {
    try {
      applyFlight(await api.getFlightStatus(callOptions));
    } catch (error) {
      if (isSessionLost(error)) {
        store.apply({ type: "character/offline" });
      }
      throw error;
    }
  }

  // Run one movement step, record it as the last action, and refresh the flight
  // snapshot the step returned. A lost session unwinds to the character list; a
  // movement refusal (scrambled, invalid target, docking-approach, lost control,
  // ship destroyed) is surfaced through the store as a visible reason — never a
  // silent no-op or a fake success. On refusal the flight snapshot is still
  // refreshed so the readout reflects the real (unchanged) state.
  async function runFlightStep(
    label: string,
    step: () => Promise<FlightStepResult>,
  ): Promise<void> {
    let result: FlightStepResult;
    try {
      result = await step();
    } catch (error) {
      if (isSessionLost(error)) {
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({ type: "flight/action-error", message: `${label} refused: ${flightErrorReason(error)}` });
      // Re-read the true state so the page shows where the ship actually is,
      // not a stale optimistic guess (best-effort; ignore a follow-up failure).
      try {
        applyFlight(await api.getFlightStatus(callOptions));
      } catch {
        // The refusal reason is already surfaced; a failed re-read changes nothing.
      }
      return;
    }
    store.apply({ type: "flight/action", action: label });
    applyFlight(result);
  }

  // --- R5b Travel (browser autopilot decide-loop) --------------------------

  // The client-side route solver's graph (fetched once, then cached) and the
  // single autopilot controller instance. The loop runs in the browser; closing
  // the tab kills this JS and the loop simply stops issuing (no "stop" sent) —
  // the ship completes its last server-side command and sits (roadmap §7).
  let routeGraph: SystemGraph | null = null;
  let autopilot: AutopilotController | null = null;

  async function loadRouteGraph(): Promise<SystemGraph> {
    if (routeGraph) {
      return routeGraph;
    }
    const data = await api.loadSystemGraph(callOptions);
    routeGraph = buildSystemGraph(data);
    return routeGraph;
  }

  // Wire the framework-agnostic controller to the BFF calls and the store. The
  // loop reads flight-status each cycle (pushed to the flight slice too, so the
  // Flight readout stays in sync) and pushes its progress into the travel slice.
  function makeAutopilotDeps(): AutopilotDeps {
    return {
      getStatus: async () => {
        const step = await api.getFlightStatus(callOptions);
        const status = decodeFlightStatus(step.flight);
        store.apply({ type: "flight/status", status });
        return status;
      },
      undock: async () => {
        await api.undock(callOptions);
      },
      warp: async (destinationID) => {
        await api.warpTo(destinationID, callOptions);
      },
      approach: async (destinationID) => {
        await api.approach(destinationID, callOptions);
      },
      jump: async (fromGateID, toGateID) => {
        await api.jump(fromGateID, toGateID, callOptions);
      },
      dock: async (stationID) => {
        await api.dock(stationID, callOptions);
      },
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => Date.now(),
      onProgress: (progress) => {
        const nameFor = (systemID: number | null): string | null =>
          systemID !== null && routeGraph ? routeGraph.systemName(systemID) : null;
        store.apply({
          type: "travel/progress",
          status: progress.status,
          action: progress.action,
          phase: progress.phase,
          currentSystemID: progress.currentSystemID,
          currentSystemName: nameFor(progress.currentSystemID),
          nextSystemID: progress.nextSystemID,
          nextSystemName: nameFor(progress.nextSystemID),
          remainingJumps: progress.remainingJumps,
          totalJumps: progress.totalJumps,
          failureReason: progress.failureReason,
        });
        // A lost session inside the loop unwinds to character select, like every
        // other held-session flow (R3-R5a).
        if (progress.status === "error") {
          store.apply({ type: "character/offline" });
        }
      },
      isSessionLost,
      refusalReason: (error) => flightErrorReason(error),
    };
  }

  async function startRoute(destinationID: number): Promise<void> {
    store.apply({ type: "travel/plan-error", message: null });

    // 1. The client-side route graph (retail's clientPathfinderService is local;
    //    this is read-only static reference data, not a gateway/route call).
    let graph: SystemGraph;
    try {
      graph = await loadRouteGraph();
    } catch (error) {
      if (isSessionLost(error)) {
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({ type: "travel/plan-error", message: `Could not load the map graph: ${readErrorReason(error)}` });
      return;
    }

    // 2. The current location is the route origin (also validates the session).
    let originSystem: number | null;
    try {
      const step = await api.getFlightStatus(callOptions);
      const status = decodeFlightStatus(step.flight);
      store.apply({ type: "flight/status", status });
      originSystem = status.solarSystemID;
    } catch (error) {
      if (isSessionLost(error)) {
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({ type: "travel/plan-error", message: `Could not read your location: ${readErrorReason(error)}` });
      return;
    }
    if (originSystem === null) {
      store.apply({ type: "travel/plan-error", message: "Your current solar system is unknown." });
      return;
    }

    // 3. Resolve the destination (a courier destination is a station; the solver
    //    routes systems) from static reference data.
    let destination: Awaited<ReturnType<typeof api.resolveDestination>>;
    try {
      destination = await api.resolveDestination(destinationID, callOptions);
    } catch (error) {
      if (isSessionLost(error)) {
        store.apply({ type: "character/offline" });
        throw error;
      }
      store.apply({ type: "travel/plan-error", message: `Could not resolve the destination: ${readErrorReason(error)}` });
      return;
    }
    if (destination.kind === "unknown" || destination.solarSystemID === null) {
      store.apply({ type: "travel/plan-error", message: `Unknown destination ${destinationID}.` });
      return;
    }

    // 4. Solve the route (fewest jumps).
    const route = solveRoute(graph, originSystem, destination.solarSystemID);
    if (!route.reachable) {
      store.apply({
        type: "travel/plan-error",
        message: `No gate route from ${graph.systemName(originSystem) ?? originSystem} to ${destination.systemName ?? destination.solarSystemID}.`,
      });
      return;
    }

    const destinationStationID = destination.kind === "station" ? destination.stationID : null;
    const destinationName = destination.kind === "station" ? destination.stationName : destination.systemName;
    const plan: RoutePlan = {
      destinationSystemID: destination.solarSystemID,
      destinationStationID,
      destinationName,
      hops: route.hops,
    };

    store.apply({
      type: "travel/planned",
      destinationSystemID: destination.solarSystemID,
      destinationStationID,
      destinationName,
      route: route.hops.map((hop) => ({
        fromSystemID: hop.fromSystemID,
        toSystemID: hop.toSystemID,
        gateToWarpID: hop.gateToWarpID,
        jumpToGateID: hop.jumpToGateID,
        fromSystemName: graph.systemName(hop.fromSystemID),
        toSystemName: graph.systemName(hop.toSystemID),
      })),
      totalJumps: route.hops.length,
      startedAt: Date.now(),
    });

    // 5. Run the decide-loop in the browser.
    if (!autopilot) {
      autopilot = createAutopilot(makeAutopilotDeps());
    }
    autopilot.start(plan);
    void autopilot.run();
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

    loadInventory,

    async moveItem(itemID, direction, qty = null) {
      await runMutation(() => api.moveItem(itemID, direction, qty ?? null, callOptions));
    },

    async stackContainer(target) {
      await runMutation(() => api.stackItems(target, callOptions));
    },

    async boardShip(shipID) {
      await runMutation(() => api.boardShip(shipID, callOptions));
    },

    async loadAgents() {
      await runAgentAction(async () => {
        const list = await api.loadAgents(callOptions);
        store.apply({ type: "agents/list", stationID: list.stationID, agents: list.agents });
      });
    },

    async openConversation(agentID) {
      await runAgentAction(async () => {
        const result = await api.agentAction(agentID, null, callOptions);
        store.apply({
          type: "agents/conversation",
          agentID,
          conversation: decodeConversation(result),
        });
        // Opening a conversation clears any stale briefing from a prior agent.
        store.apply({ type: "agents/briefing", briefing: null });
      });
    },

    async chooseAction(agentID, action) {
      await runAgentAction(async () => {
        const result = await api.agentAction(agentID, action.actionID, callOptions);
        store.apply({
          type: "agents/conversation",
          agentID,
          conversation: decodeConversation(result),
        });
        // Accepting a courier stages the mission: pull its briefing + journal
        // entry. Declining clears the briefing; the journal always refreshes so
        // the offered/accepted/cleared state stays truthful.
        if (action.buttonType === AGENT_BUTTON.ACCEPT || action.buttonType === AGENT_BUTTON.ACCEPT_REMOTELY) {
          await loadBriefing(agentID);
        } else if (action.buttonType === AGENT_BUTTON.DECLINE) {
          store.apply({ type: "agents/briefing", briefing: null });
        }
        await loadJournal();
      });
    },

    loadBriefing,

    loadJournal,

    loadFlightStatus,

    async undock() {
      await runFlightStep("Undock", () => api.undock(callOptions));
    },

    async warpTo(destinationID) {
      await runFlightStep("Warp", () => api.warpTo(destinationID, callOptions));
    },

    async jump(fromGateID, toGateID) {
      await runFlightStep("Jump", () => api.jump(fromGateID, toGateID, callOptions));
    },

    async dock(stationID) {
      await runFlightStep("Dock", () => api.dock(stationID, callOptions));
    },

    startRoute,

    pauseRoute() {
      autopilot?.pause();
    },

    resumeRoute() {
      if (autopilot) {
        autopilot.resume();
        void autopilot.run();
      }
    },

    abortRoute() {
      autopilot?.abort();
    },

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
