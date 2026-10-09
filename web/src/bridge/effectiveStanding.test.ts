// The pilot's effective standing with an agent. The sums are worked by hand from the client's rule.

import test from "node:test";
import assert from "node:assert/strict";

import { STANDING_SKILLS, applyStandingBonus, effectiveStandingWithAgent, standingBonusSkill } from "./effectiveStanding.ts";

const CALDARI = 500001;
const GURISTAS = 500010;
const AGENT = { agentID: 3008416, corporationID: 1000002, factionID: CALDARI };
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);
const noSkills = () => 0;
const levels = (given: Record<number, number>) => (typeID: number) => given[typeID] ?? 0;

test("the skills are the client's three", () => {
  assert.deepEqual(STANDING_SKILLS, { diplomacy: 3357, connections: 3359, criminalConnections: 3361 });
});

test("which skill raises a standing: Diplomacy below nought, Connections from nought, Criminal Connections with pirates", () => {
  assert.equal(standingBonusSkill(CALDARI, -0.01), 3357);
  assert.equal(standingBonusSkill(CALDARI, 0), 3359);
  assert.equal(standingBonusSkill(CALDARI, 4.2), 3359);
  for (const pirates of [500010, 500011, 500012, 500019, 500020, 500029]) {
    assert.equal(standingBonusSkill(pirates, 0), 3361, String(pirates));
    // Below nought it is Diplomacy for them as for anyone.
    assert.equal(standingBonusSkill(pirates, -1), 3357, String(pirates));
  }
  // Mordu's Legion and the Syndicate are not pirates by the client's list.
  assert.equal(standingBonusSkill(500018, 1), 3359);
  assert.equal(standingBonusSkill(500009, 1), 3359);
  // Four factions no skill moves, whichever way the standing lies.
  for (const unmoved of [500024, 500025, 500026, 500027]) {
    assert.equal(standingBonusSkill(unmoved, 3), null, String(unmoved));
    assert.equal(standingBonusSkill(unmoved, -3), null, String(unmoved));
  }
  // With no faction known it is still Diplomacy or Connections.
  assert.equal(standingBonusSkill(null, -1), 3357);
  assert.equal(standingBonusSkill(null, 1), 3359);
});

test("a bonus closes its share of the gap to ten, and none changes nothing", () => {
  assert.equal(applyStandingBonus(0, 3.3), 3.3);
  assert.equal(applyStandingBonus(0, -7), -7);
  // Level 5: a bonus of 2.0, a fifth of the gap.
  near(applyStandingBonus(2, 0), 2);
  near(applyStandingBonus(2, 5), 6);
  near(applyStandingBonus(2, -5), -2);
  near(applyStandingBonus(2, 10), 10);
  near(applyStandingBonus(1.6, -10), -6.8);
});

test("with nothing listed and no skills the effective standing is nought", () => {
  assert.deepEqual(effectiveStandingWithAgent(AGENT, new Map(), noSkills), { value: 0, low: false });
});

test("the greatest of the three counts, each raised by its own skill", () => {
  const standings = new Map([[CALDARI, 1.5], [1000002, 3.0], [3008416, -1.0]]);
  // No skills: the corporation's 3.0.
  near(effectiveStandingWithAgent(AGENT, standings, noSkills).value, 3.0);
  // Connections IV (1.6): faction 1.5 -> 2.86, corporation 3.0 -> 4.12; Diplomacy is not trained, so the agent's -1.0 stays.
  const connections = effectiveStandingWithAgent(AGENT, standings, levels({ 3359: 4 }));
  near(connections.value, (1 - (1 - 0.3) * (1 - 0.16)) * 10);
  assert.equal(connections.low, false);
  // Diplomacy alone raises only the one below nought, and the greatest is still the corporation's.
  near(effectiveStandingWithAgent(AGENT, standings, levels({ 3357: 5 })).value, 3.0);
  // The agent's own, when it is the greatest.
  near(effectiveStandingWithAgent(AGENT, new Map([[3008416, 6.5]]), noSkills).value, 6.5);
  // The faction's, when it is.
  near(effectiveStandingWithAgent(AGENT, new Map([[CALDARI, 2.25]]), noSkills).value, 2.25);
});

test("with one of them at -2.0 or worse it is the least that counts, after its skill", () => {
  const standings = new Map([[CALDARI, -3.0], [1000002, 8.0], [3008416, 9.0]]);
  assert.deepEqual(effectiveStandingWithAgent(AGENT, standings, noSkills), { value: -3.0, low: true });
  // Exactly -2.0 is low.
  assert.deepEqual(effectiveStandingWithAgent(AGENT, new Map([[1000002, -2.0]]), noSkills), { value: -2.0, low: true });
  // Just above it is not, and the greatest counts: nought, from the two not listed.
  assert.deepEqual(effectiveStandingWithAgent(AGENT, new Map([[1000002, -1.99]]), noSkills), { value: 0, low: false });
  // Diplomacy V lifts -3.0 to -0.4: no longer low, and the greatest is the agent's 9.0.
  const lifted = effectiveStandingWithAgent(AGENT, standings, levels({ 3357: 5 }));
  assert.equal(lifted.low, false);
  near(lifted.value, 9.0);
  // Diplomacy II lifts -3.0 only to -1.96: just above the line.
  assert.equal(effectiveStandingWithAgent(AGENT, standings, levels({ 3357: 2 })).low, false);
  // Diplomacy I lifts it to -2.48: still low, and that is the value.
  const still = effectiveStandingWithAgent(AGENT, standings, levels({ 3357: 1 }));
  assert.equal(still.low, true);
  near(still.value, (1 - (1 + 0.3) * (1 - 0.04)) * 10);
});

test("the skill goes by the agent's faction for all three standings", () => {
  const pirate = { agentID: 3019999, corporationID: 1000127, factionID: GURISTAS };
  const standings = new Map([[1000127, 2.0], [3019999, 1.0]]);
  // Connections does nothing for a pirate's agent; Criminal Connections does, for the corporation's and the agent's alike.
  near(effectiveStandingWithAgent(pirate, standings, levels({ 3359: 5 })).value, 2.0);
  near(effectiveStandingWithAgent(pirate, standings, levels({ 3361: 5 })).value, (1 - (1 - 0.2) * (1 - 0.2)) * 10);
  // A faction no skill moves: nothing is raised.
  const drone = { agentID: 3019998, corporationID: 1000288, factionID: 500025 };
  near(effectiveStandingWithAgent(drone, new Map([[1000288, 2.0]]), levels({ 3359: 5, 3357: 5 })).value, 2.0);
});

test("an agent with no corporation or faction known has those as nought, and no skill is asked about them", () => {
  const asked: number[] = [];
  const skill = (typeID: number) => { asked.push(typeID); return 5; };
  const alone = { agentID: 3008416, corporationID: null, factionID: null };
  // The agent's own -4.0, raised by Diplomacy V to -1.2; the greatest is nought, from the two there are none of.
  assert.deepEqual(effectiveStandingWithAgent(alone, new Map([[3008416, -4.0]]), skill), { value: 0, low: false });
  assert.deepEqual(asked, [3357]);
  // And -9.0 is raised only to -5.2: low.
  near(effectiveStandingWithAgent(alone, new Map([[3008416, -9.0]]), skill).value, (1 - (1 + 0.9) * (1 - 0.2)) * 10);
});
