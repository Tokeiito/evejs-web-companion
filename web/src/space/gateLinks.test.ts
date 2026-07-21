// Gate links (goal R30 slice A): turning the cached route graph into the one
// thing a gate row could never say — which system is on the other side.

import test from "node:test";
import assert from "node:assert/strict";

import { buildSystemGraph } from "../nav/routeSolver.ts";
import {
  buildGateLinks,
  gateLinkFor,
  jumpBlockedReason,
  jumpLabel,
  type GateLink,
} from "./gateLinks.ts";

// Alpha(1) <-> Bravo(2) <-> Charlie(3), plus a dead-end system 4 whose edge
// records no gate on the far side, and system 5 which has a gate but no name.
const GRAPH = buildSystemGraph({
  systems: { "1": "Alpha", "2": "Bravo", "3": "Charlie", "4": "Delta" },
  edges: [
    [1, 2, 112, 211],
    [2, 1, 211, 112],
    [2, 3, 223, 322],
    [3, 2, 322, 223],
    [1, 4, 114, 0],
    [1, 5, 115, 511],
  ],
});

test("a system's gates carry the destination system and the far-side gate", () => {
  const links = buildGateLinks(GRAPH, 2);
  assert.deepEqual(links, [
    { gateID: 211, toSystemID: 1, toSystemName: "Alpha", destinationGateID: 112 },
    { gateID: 223, toSystemID: 3, toSystemName: "Charlie", destinationGateID: 322 },
  ]);
});

test("a system with no gates, and an unknown system, yield an empty list", () => {
  // System 9 is not in the graph at all; a grid with no gates is ordinary.
  assert.deepEqual(buildGateLinks(GRAPH, 9), []);
  assert.deepEqual(buildGateLinks(GRAPH, 0), []);
  assert.deepEqual(buildGateLinks(GRAPH, -1), []);
});

test("one physical gate yields at most one link", () => {
  const doubled = buildSystemGraph({
    systems: { "1": "Alpha", "2": "Bravo" },
    edges: [
      [1, 2, 112, 211],
      [1, 2, 112, 211],
    ],
  });
  const links = buildGateLinks(doubled, 1);
  assert.equal(links.length, 1, "a duplicated edge must not double the row's buttons");
});

test("a row is a gate ONLY because it is in the graph as a source gate", () => {
  const links = buildGateLinks(GRAPH, 1);
  // The gate rows.
  assert.equal(gateLinkFor(links, 112)?.toSystemName, "Bravo");
  assert.equal(gateLinkFor(links, 114)?.toSystemID, 4);
  // An asteroid, a station, the player's own ship: not gates.
  assert.equal(gateLinkFor(links, 50001248), null);
  assert.equal(gateLinkFor(links, 0), null);
  // The gate on the FAR side is not a gate on THIS grid.
  assert.equal(gateLinkFor(links, 211), null, "the far-side gate is not on this grid");
});

test("the label names the destination system, and never an id (R7d)", () => {
  const links = buildGateLinks(GRAPH, 2);
  assert.equal(jumpLabel(links[0] as GateLink), "Jump to Alpha");
  assert.equal(jumpLabel(links[1] as GateLink), "Jump to Charlie");

  // A system the map has no name for still gets a sentence a player can read,
  // with no number anywhere in it.
  const unnamed = gateLinkFor(buildGateLinks(GRAPH, 1), 115) as GateLink;
  assert.equal(unnamed.toSystemName, null);
  const label = jumpLabel(unnamed);
  assert.equal(label, "Jump through this gate");
  assert.equal(/\d/.test(label), false, "no label may carry a numeric id");

  // Whitespace is not a name.
  assert.equal(
    jumpLabel({ gateID: 1, toSystemID: 2, toSystemName: "   ", destinationGateID: 3 }),
    "Jump through this gate",
  );
});

test("no label built from this graph ever renders a number", () => {
  for (const systemID of [1, 2, 3, 4]) {
    for (const link of buildGateLinks(GRAPH, systemID)) {
      assert.equal(
        /\d/.test(jumpLabel(link)),
        false,
        `label for gate into ${link.toSystemID} leaked a number`,
      );
    }
  }
});

test("a jump with no gate on the far side is blocked, and SAYS why", () => {
  const links = buildGateLinks(GRAPH, 1);
  const broken = gateLinkFor(links, 114) as GateLink;
  assert.equal(broken.destinationGateID, 0);
  const reason = jumpBlockedReason(broken);
  assert.equal(typeof reason, "string");
  assert.equal(/\d/.test(reason as string), false, "the reason must not carry an id");

  // A complete link is not blocked.
  assert.equal(jumpBlockedReason(gateLinkFor(links, 112) as GateLink), null);
});

test("distance is NOT a blocking reason — the server owns that refusal", () => {
  // Nothing in this module measures how far the ship is from the gate. If it
  // did, the browser would be putting an invented range rule on screen next to
  // the server's real one. The only block is a link we cannot address at all.
  const complete: GateLink = {
    gateID: 112,
    toSystemID: 2,
    toSystemName: "Bravo",
    destinationGateID: 211,
  };
  assert.equal(jumpBlockedReason(complete), null);
});
