// Where the stargates on this grid actually GO (goal R30 slice A) — pure,
// framework-free, fully testable.
//
// The overview can already see a stargate: it is a row like any other, with a
// name and a distance, and Warp to / Approach work on it. What it could not say
// was the one thing a player wants from a gate — *which system is on the other
// side*, and jump me through it. Without that, the moment a destination is off
// grid the player is pushed out of the cockpit and onto the Flight tab to type
// two raw gate IDs by hand.
//
// The answer is already in the browser. The R5b route solver holds the whole
// gate graph (`nav/routeSolver.ts`), fetched once and cached, and each directed
// edge out of a system carries exactly the pair `CmdStargateJump` wants:
// `gateID` (the gate HERE — an overview row's own itemID) and
// `destinationGateID` (the gate on the far side). This module is the small
// translation from "edges out of a system" to "what to render on a gate row".
//
// Two rules it does not bend:
//   - Nothing here produces a numeric game ID for display (R7d). A link whose
//     system name has not resolved reads as "Jump through this gate", never as
//     "Jump to 30002718".
//   - An unusable link says WHY rather than disappearing or guessing (R9a). A
//     graph edge with no gate on the far side cannot be jumped, and the caller
//     is handed a sentence to put on the disabled control.

import type { SystemEdge, SystemGraph } from "../nav/routeSolver.ts";

/**
 * One stargate on this grid and where it leads.
 *
 * `gateID` is the gate in the CURRENT system — it matches the `itemID` of the
 * overview row for that gate, which is how a row is recognised as a gate at
 * all. `destinationGateID` is the gate on the far side: the `toGate` argument
 * of `flow.jump(fromGate, toGate)`.
 */
export interface GateLink {
  readonly gateID: number;
  readonly toSystemID: number;
  /** The destination system's name, or null when the map has no name for it. */
  readonly toSystemName: string | null;
  readonly destinationGateID: number;
}

/**
 * The stargates leading out of `systemID`, in the graph's own edge order.
 *
 * Deduplicated by `gateID`: one physical gate is one row in the overview, so it
 * must yield at most one link even if the served graph ever carried a duplicate
 * edge. First edge wins, which keeps the result stable across reloads.
 *
 * An unknown system, or a system with no edges, yields an empty list — never a
 * throw. A grid with no gates is an ordinary thing (a belt, a wormhole system,
 * a deadspace pocket), not an error.
 */
export function buildGateLinks(
  graph: SystemGraph,
  systemID: number,
): readonly GateLink[] {
  if (!(systemID > 0)) {
    return [];
  }
  const links: GateLink[] = [];
  const seen = new Set<number>();
  for (const edge of graph.neighbors(systemID) as readonly SystemEdge[]) {
    if (!(edge.gateID > 0) || seen.has(edge.gateID)) {
      continue;
    }
    seen.add(edge.gateID);
    links.push({
      gateID: edge.gateID,
      toSystemID: edge.toSystemID,
      toSystemName: graph.systemName(edge.toSystemID),
      destinationGateID: edge.destinationGateID > 0 ? edge.destinationGateID : 0,
    });
  }
  return links;
}

/**
 * The link for an overview row, or null when that row is not a stargate.
 *
 * This is the ONLY test the panel applies to decide whether a row is a gate.
 * Deliberately so: the snapshot's coarse `kind` does not distinguish a stargate
 * from any other structure, and matching on a type name would be a guess in a
 * different language. Being in the gate graph as a source gate *is* what makes
 * something a gate you can jump through — and it is the same fact that supplies
 * the destination, so a row can never be labelled a gate we cannot route.
 */
export function gateLinkFor(
  links: readonly GateLink[],
  itemID: number,
): GateLink | null {
  if (!(itemID > 0)) {
    return null;
  }
  return links.find((link) => link.gateID === itemID) ?? null;
}

/**
 * What the button says. Names the destination system when the map knows it and
 * falls back to the gate itself when it does not — never to an id (R7d).
 */
export function jumpLabel(link: GateLink): string {
  const name = link.toSystemName;
  if (typeof name === "string" && name.trim().length > 0) {
    return `Jump to ${name.trim()}`;
  }
  return "Jump through this gate";
}

/**
 * Why this jump cannot be offered, or null when it can be.
 *
 * The only blocking case is a graph edge with no gate recorded on the far side:
 * `CmdStargateJump` needs both ends, so there is nothing honest to send. The
 * caller renders the control DISABLED carrying this sentence — never greyed out
 * in silence, and never with a guessed destination gate.
 *
 * Note what is NOT blocked here: being far from the gate. The server owns that
 * refusal and states its own range, and second-guessing it in the browser would
 * put an invented distance rule on screen next to the server's real one.
 */
export function jumpBlockedReason(link: GateLink): string | null {
  if (!(link.destinationGateID > 0)) {
    return "No gate on the far side in the star map";
  }
  return null;
}
