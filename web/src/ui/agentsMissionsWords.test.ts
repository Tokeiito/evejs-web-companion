// The Agents & Missions panel, drawn with and without the retail client's own
// words: the journal's lines and the mission's title above what the agent says.
//
// Rendered with Svelte's server generator, as panelFirstMount.test.ts does.
// `$effect` does not run there, so what is asked of the BFF is tested where it
// is decided (bridge/journalWords.test.ts); this pins what is DRAWN from what
// the store holds. The templates are made up.

import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./svelteSsrHook.ts", import.meta.url);

const { render } = await import("svelte/server");
const { createClientStore } = await import("../store/clientStore.ts");
const { filetimeOf } = await import("../bridge/journalWords.ts");
const { decodeObjectives } = await import("../bridge/missionObjectives.ts");
const { PANE_LABELS } = await import("../bridge/missionObjectivePane.ts");
const { COURIER_OFFERED_GATEWAY, ENCOUNTER_OFFERED_GATEWAY } = await import("../bridge/missionObjectives.fixtures.ts");
const { default: Panel } = (await import("./AgentsMissions.svelte")) as { default: unknown };

const NOW_MS = Date.UTC(2026, 9, 8, 14, 0, 0);
const HOUR_TICKS = 36_000_000_000n;
const AGENT = 3008416;
const FOLDER = "UI/Journal/JournalWindow/Agents/";

/** Runs `body` with the browser's clock stopped, since a journal line says how long is left. */
function atFrozenClock<T>(body: () => T): T {
  const realNow = Date.now;
  Date.now = () => NOW_MS;
  try {
    return body();
  } finally {
    Date.now = realNow;
  }
}

function fakeFlow(): unknown {
  return new Proxy({}, { get: () => async () => {} });
}

const TEMPLATES: Record<string, string | null> = {
  [`${FOLDER}StateOffered`]: "On offer",
  [`${FOLDER}StateAccepted`]: "Taken",
  [`${FOLDER}OfferExpiresIn`]: "Goes in {[timeinterval]expirationTime.shortWrittenForm}",
  [`${FOLDER}MissionExpiresAtExact`]: "Ends at {[datetime]expirationTime, date=short, time=short}",
  "UI/Agents/MissionTypes/Courier": "Carrying",
  "#58607": "A Made-Up Errand to {[location]objectiveLocationSystemID.name}",
  "#58700": "Another Errand",
  "#129932": "Take it to {[location]objectiveLocationSystemID.name}.",
  "UI/Agents/StandardMission/DeclineMessageGeneric": "<i>Saying no too often costs standing.</i>",
  "UI/Agents/StandardMission/DeclineMessageTimeLeft": "Saying no inside {timeRemaining} costs standing.",
  "UI/Agents/Dialogue/ThisMissionExpiresAt": "Gone at {[datetime]expireTime}",
  "/Carbon/UI/Common/WrittenDateTimeQuantity/Hour": '{[numeric]units} {[numeric]units-> "hr", "hrs"}',
  "/Carbon/UI/Common/WrittenDateTimeQuantity/Minute": '{[numeric]units} {[numeric]units-> "mn", "mns"}',
  "/Carbon/UI/Common/WrittenDateTimeQuantity/ListForm": "{firstPart} plus {secondPart}",
  "UI/Common/Formatting/ListGenericDelimiter": "; ",
};

function panel(options: {
  words: boolean | "none of them";
  talking: boolean;
  buttons?: readonly number[];
  briefed?: boolean;
  briefedTitleID?: number | null;
  /** The mission's objectives as read for the layout, whether the client's words for the pane are to hand, and any of them that are not. */
  objectives?: unknown;
  paneWords?: boolean;
  without?: readonly string[];
  /** What the briefing says of time, the last action's "not yet", and whether a special interaction is on offer. */
  times?: { declineTime: bigint | null; expirationTime: bigint | null } | null;
  cantReplay?: number | null;
  special?: boolean;
  /** Where the pilot was selected, and what its flight status has said since (neither: nothing is known of where it is). */
  online?: { stationID: number | null; structureID: number | null; solarSystemID: number | null };
  flight?: { docked: boolean; stationID: number | null; structureID: number | null; solarSystemID: number | null };
  /** The security of solar systems as read, by ID, and whether the client's words for a place's name are to hand. */
  security?: Record<number, number>;
  locationWords?: boolean;
  /** Whether the client's words for a short written interval are to hand. */
  intervalWords?: boolean;
  /** What the client's agents service knows of the page's agent, and the solar system the server says it is in. */
  agentRecord?: Record<string, unknown> | null;
  agentSystem?: number | null;
  /** The jumps on the autopilot's route, by "<from>:<to>", as worked out. */
  jumps?: Record<string, number | null>;
  /** The pilot's standings and skills as read, each as [id, value] pairs. */
  standings?: ReadonlyArray<readonly [number, number]>;
  skillLevels?: ReadonlyArray<readonly [number, number]>;
  /** A mission's page held by the store, whether the client's words for it are to hand, and whether the BFF has a client at all. */
  page?: Record<string, unknown>;
  pageWords?: boolean;
  noClient?: boolean;
}): string {
  const store = createClientStore();
  // Coming online first: it clears what the last pilot's agents held.
  if (options.online !== undefined) {
    store.apply({ type: "character/online", character: { characterID: 140000002, characterName: "Test Two", corporationID: 1000002, ...options.online }, station: null } as never);
  }
  if (options.flight !== undefined) {
    store.apply({ type: "flight/status", status: { inSpace: !options.flight.docked, shipID: 1, shipTypeID: 606, shipIsCapsule: false, shipMode: null, shipSpeedFraction: null, ...options.flight } } as never);
  }
  store.apply({ type: "names/resolved", entries: { [`agent:${AGENT}`]: "Antaken Kamola", "agent:3009999": "Some Other Agent", "system:30002780": "Muvolailen" } });
  store.apply({
    type: "agents/journal",
    journal: {
      offered: [{ missionState: 1, missionTypeLabel: "UI/Agents/MissionTypes/Courier", missionTitleID: 58607, agentID: AGENT, missionID: 2156, expirationTime: String(filetimeOf(NOW_MS) + 5n * HOUR_TICKS) }],
      active: [{ missionState: 2, missionTypeLabel: "UI/Agents/MissionTypes/Courier", missionTitleID: 58700, agentID: 3009999, missionID: 2200, expirationTime: String(filetimeOf(Date.UTC(2026, 9, 10, 15, 30))) }],
    },
  });
  if (options.talking) {
    store.apply({
      type: "agents/conversation",
      agentID: AGENT,
      conversation: {
        agentSays: "129932",
        agentSaysWords: { label: null, parameters: null, text: null, messageID: 129932 },
        contentID: 2156,
        actions: (options.buttons ?? []).map((buttonType, index) => ({ actionID: 800 + index, buttonType, label: `button ${buttonType}` })),
        ...(options.special === undefined ? {} : { specialInteractions: options.special }),
        lastActionInfo: { missionCompleted: null, missionDeclined: null, missionQuit: null, loyaltyPoints: null, missionCantReplay: options.cantReplay ?? null },
      },
    });
    if (options.times !== undefined) {
      store.apply({ type: "agents/mission-times", times: options.times });
    }

    store.apply({ type: "agents/mission-keywords", key: `${AGENT}:2156`, keywords: { objectiveLocationSystemID: 30002780 } });
  }
  if (options.briefed) {
    store.apply({
      type: "agents/briefing",
      briefing: {
        missionTitleID: options.briefedTitleID === undefined ? 58607 : options.briefedTitleID, cargoTypeID: 3814, cargoQuantity: 1, cargoVolume: 0.1, pickupLocationID: 60000004, pickupSystemID: 30002780,
        destinationLocationID: 60000256, destinationSystemID: 30001399, rewardISK: "102000", bonusISK: "38250", loyaltyPoints: 213, expirationTime: null, acceptTimestamp: null,
      },
    });
  }
  // Kept by the store whether or not a window is open: the page must not draw them without one.
  if (options.objectives !== undefined) {
    store.apply({ type: "agents/objectives", objectives: options.objectives as never });
  }
  if (options.page !== undefined) {
    store.apply({
      type: "agents/mission-page",
      page: { agentID: AGENT, contentID: 2156, missionState: 1, important: false, expirationTime: String(filetimeOf(NOW_MS) + 5n * HOUR_TICKS), missionTitleID: 58607, missionTitle: null, objectives: null, record: null, ...options.page } as never,
    });
    store.apply({ type: "agents/mission-keywords", key: `${AGENT}:2156`, keywords: { objectiveLocationSystemID: 30002780 } });
  }
  if (options.agentRecord !== undefined) {
    store.apply({ type: "agents/record", agentID: AGENT, record: options.agentRecord as never });
    store.apply({ type: "names/resolved", entries: { "corporation:1000002": "A Made-Up Company", "faction:500001": "A Made-Up State" } });
  }
  if (options.jumps !== undefined) {
    store.apply({ type: "names/autopilot-jumps", jumps: options.jumps });
  }
  if (options.agentSystem !== undefined) {
    store.apply({ type: "agents/solar-system", agentID: AGENT, solarSystemID: options.agentSystem });
  }
  if (options.standings !== undefined) {
    store.apply({ type: "standings/loaded", char: options.standings.map(([fromID, standing]) => ({ fromID, standing })), charError: null, corp: null, corpError: null });
  }
  if (options.skillLevels !== undefined) {
    store.apply({
      type: "skills/loaded", characterName: "Test Two", totalSkillPoints: 0, freeSkillPoints: 0, queue: null, clockOffsetMs: 0,
      skills: options.skillLevels.map(([typeID, level]) => ({ typeID, name: `skill ${typeID}`, groupName: "Social", level, rank: 1, skillPoints: 0, levelSkillPoints: [], inTraining: false })),
    } as never);
  }
  if (options.security !== undefined) {
    store.apply({ type: "names/system-security", security: options.security });
  }
  if (options.noClient) {
    store.apply({ type: "words/loaded", available: false, templates: {} });
  }
  if (options.words === true) {
    const templates = { ...TEMPLATES, ...(options.paneWords ? PANE_TEMPLATES : {}), ...(options.pageWords ? PAGE_TEMPLATES : {}), ...(options.intervalWords ? SHORT_INTERVAL_TEMPLATES : {}), ...(options.locationWords ? LOCATION_TEMPLATES : {}) };
    store.apply({ type: "words/loaded", available: true, templates: Object.fromEntries(Object.entries(templates).filter(([key]) => !(options.without ?? []).includes(key))) });
  } else if (options.words === "none of them") {
    // Asked for, and the client has no text for any of it.
    store.apply({ type: "words/loaded", available: true, templates: Object.fromEntries(Object.keys(TEMPLATES).map((key) => [key, null])) });
  }
  return atFrozenClock(() => render(Panel as never, { props: { store, flow: fakeFlow() } } as never).body);
}

/** The text of each journal line, in order. */
const journalLines = (body: string): string[] =>
  [...body.matchAll(/<span class="journal-line">([^<]*)<\/span>/g)].map((match) => (match[1] as string).trim()).filter((line) => line.includes(" · "));

test("with the client's words the journal's lines are the client's: state, agent, name, type, expiry", () => {
  const body = panel({ words: true, talking: false });
  assert.deepEqual(journalLines(body), [
    "Taken · Some Other Agent · Another Errand · Carrying · Ends at 2026.10.10 15:30",
    // A journal line's name is filled with nothing, as the client fills it: its tag shows nothing.
    "On offer · Antaken Kamola · A Made-Up Errand to  · Carrying · Goes in 5h",
  ]);
});

test("without the client's words the journal's lines are this client's, and no message number is shown", () => {
  for (const words of [false, "none of them"] as const) {
    const body = panel({ words, talking: false });
    assert.deepEqual(journalLines(body), [
      "Accepted · Some Other Agent · Courier · due by 2026.10.10 15:30",
      "Offered · Antaken Kamola · Courier · open for another 5h",
    ], String(words));
    assert.doesNotMatch(body, /58607|58700/);
  }
  assert.doesNotMatch(panel({ words: "none of them", talking: true }), /mission-title/);
});

test("the mission's title stands above what the agent says, filled as the agent's own lines are", () => {
  const body = panel({ words: true, talking: true });
  const title = /<h3 class="mission-title[^"]*">([^<]*)<\/h3>/.exec(body);
  assert.ok(title, "there is a title");
  assert.equal(title[1], "A Made-Up Errand to Muvolailen");
  // And it comes before the agent's line.
  assert.ok(body.indexOf("mission-title") < body.indexOf("Take it to Muvolailen."));
  // The same mission's line in the journal is still filled with nothing, conversation or no: the journal
  // does not know the mission's keywords.
  assert.ok(journalLines(body).includes("On offer · Antaken Kamola · A Made-Up Errand to  · Carrying · Goes in 5h"));
});

test("there is no title without the client's text for it, without a conversation, or for an agent with no mission", () => {
  assert.doesNotMatch(panel({ words: false, talking: true }), /mission-title/);
  assert.doesNotMatch(panel({ words: true, talking: false }), /mission-title/);

  const store = createClientStore();
  store.apply({ type: "words/loaded", available: true, templates: TEMPLATES });
  store.apply({ type: "agents/journal", journal: { offered: [], active: [{ missionState: 2, missionTypeLabel: null, missionTitleID: 58700, agentID: 3009999, missionID: 2200, expirationTime: null }] } });
  store.apply({
    type: "agents/conversation",
    agentID: AGENT,
    conversation: { agentSays: "Hello.", agentSaysWords: { label: null, parameters: null, text: "Hello." }, contentID: null, actions: [], lastActionInfo: { missionCompleted: null, missionDeclined: null, missionQuit: null, loyaltyPoints: null } },
  });
  const body = atFrozenClock(() => render(Panel as never, { props: { store, flow: fakeFlow() } } as never).body);
  assert.doesNotMatch(body, /mission-title/);
  // That other agent's mission is in the journal all the same, with "Mission" where it has no type.
  assert.match(body, /Taken · [^<]* · Another Errand · Mission · /);
});

test("an offer's briefing is on show with nothing to do to the package; an accepted mission's has its buttons", () => {
  // On offer: Accept (3) and Decline (9) in the conversation.
  const offered = panel({ words: false, talking: true, buttons: [3, 9], briefed: true });
  assert.match(offered, /Courier briefing/);
  assert.match(offered, /class="note mission-offered"/);
  assert.doesNotMatch(offered, /Load package into ship|Set autopilot to dropoff/);
  // Accepted: Complete (6) and Quit (11).
  const accepted = panel({ words: false, talking: true, buttons: [6, 11], briefed: true });
  assert.match(accepted, /Courier briefing/);
  assert.match(accepted, /Load package into ship/);
  assert.match(accepted, /Set autopilot to dropoff/);
  assert.doesNotMatch(accepted, /mission-offered/);
  // No briefing held: neither.
  assert.doesNotMatch(panel({ words: false, talking: true, buttons: [3, 9] }), /Courier briefing|mission-offered/);
});

test("the title above what the agent says is the briefing's when one is held, and the journal's otherwise", () => {
  const titleOf = (body: string): string | null => body.match(/<h3 class="mission-title">([^<]*)<\/h3>/)?.[1] ?? null;
  // The journal's line for this agent is the made-up errand; the briefing read for this layout is another mission.
  assert.equal(titleOf(panel({ words: true, talking: true, buttons: [3, 9], briefed: true, briefedTitleID: 58700 })), "Another Errand");
  // No briefing held, or one with no title: the journal's.
  assert.equal(titleOf(panel({ words: true, talking: true, buttons: [3, 9] })), "A Made-Up Errand to Muvolailen");
  assert.equal(titleOf(panel({ words: true, talking: true, buttons: [3, 9], briefed: true, briefedTitleID: null })), "A Made-Up Errand to Muvolailen");
  assert.equal(titleOf(panel({ words: true, talking: true, buttons: [3, 9], briefed: true, briefedTitleID: 0 })), "A Made-Up Errand to Muvolailen");
});

test("the mission's time is written under what the agent says, in the client's words", () => {
  const timeOf = (body: string): string | null => body.match(/<p class="note mission-time">([^<]*)<\/p>/)?.[1] ?? null;
  const HOUR = 36_000_000_000n;
  const MIN = 600_000_000n;
  // An offer with no decline timer running.
  assert.equal(timeOf(panel({ words: true, talking: true, times: { declineTime: -1n, expirationTime: null } })), "Saying no too often costs standing.");
  // Inside the decline window.
  assert.equal(timeOf(panel({ words: true, talking: true, times: { declineTime: 3n * HOUR + 24n * MIN, expirationTime: null } })), "Saying no inside 3 hrs plus 24 mns costs standing.");
  // Accepted: when it expires.
  const when = (BigInt(Date.UTC(2026, 9, 15, 23, 54, 0)) + 11_644_473_600_000n) * 10_000n;
  const accepted = panel({ words: true, talking: true, times: { declineTime: null, expirationTime: when } });
  assert.equal(timeOf(accepted), "Gone at 2026.10.15 23:54");
  // It comes straight after what the agent says.
  assert.match(accepted, /class="agent-says"[^>]*>[^<]*<\/p>\s*(<!--[^>]*-->\s*)*<p class="note mission-time">/);
});

test("no line for a mission's time where the client shows none", () => {
  const drawn = (options: Parameters<typeof panel>[0]): boolean => /mission-time/.test(panel(options));
  const times = { declineTime: -1n, expirationTime: null };
  assert.equal(drawn({ words: true, talking: true, times }), true);
  // The agent said not yet; one of its special interactions is on offer.
  assert.equal(drawn({ words: true, talking: true, times, cantReplay: 36_000_000_000 }), false);
  assert.equal(drawn({ words: true, talking: true, times, special: true }), false);
  // The briefing says nothing of time, or there is no briefing.
  assert.equal(drawn({ words: true, talking: true, times: { declineTime: null, expirationTime: null } }), false);
  assert.equal(drawn({ words: true, talking: true, times: null }), false);
  assert.equal(drawn({ words: true, talking: true }), false);
  // No window open.
  assert.equal(drawn({ words: true, talking: false, times }), false);
  // Without the client's words for it, nothing is written in their place.
  assert.equal(drawn({ words: false, talking: true, times }), false);
  assert.equal(drawn({ words: "none of them", talking: true, times }), false);
});

// --- the objectives pane -------------------------------------------------------

const PANE_TEMPLATES: Record<string, string> = {
  "UI/Agents/Commands/StartConversationWith": "Speak with {[character]agentID.name}",
  "UI/Agents/Commands/RemoveOffer": "<b>Take it away</b>",
  "UI/Agents/Commands/ReadDetails": "<i>Look closer</i>",
  [PANE_LABELS.heading.open]: "{missionName}: to do",
  [PANE_LABELS.heading.complete]: "{missionName}: done",
  [PANE_LABELS.overview]: "Do all of these.",
  [PANE_LABELS.transportHeader]: "Carry",
  [PANE_LABELS.transportBlurb]: "Carry these:",
  [PANE_LABELS.transportPickup]: "From",
  [PANE_LABELS.transportDropOff]: "To",
  [PANE_LABELS.transportCargo]: "Load",
  [PANE_LABELS.objectiveHeader]: "Target",
  [PANE_LABELS.dungeonBody]: "Destroy them.",
  [PANE_LABELS.dungeonCompleted]: "Won",
  [PANE_LABELS.objectiveLocation]: "Place",
  [PANE_LABELS.rewardsTitle]: "Pay",
  [PANE_LABELS.rewardsHeader]: "Yours when it is done:",
  [PANE_LABELS.loyaltyPoints]: "{[numeric]lpAmount, useGrouping} points",
  [PANE_LABELS.isk]: "{[numeric]amount, useGrouping, decimalPlaces=2} ISK",
  [PANE_LABELS.quantityAndItem]: "{[numeric]quantity, useGrouping} x {[item]item.name}",
  "#57959": "A Carrying Job",
  "#57212": "A Fight",
  "#115502": "Go to {[location]dungeonLocationID.name} and end it.",
};
const text = (html: string): string => html.replace(/<!--[^>]*-->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const { PAGE_LABELS, PAGE_MESSAGES } = await import("../bridge/missionPage.ts");
const PAGE_TEMPLATES: Record<string, string> = {
  [PAGE_LABELS.offered]: "On offer now",
  [PAGE_LABELS.completed]: "All done",
  [PAGE_LABELS.importantStandings]: "<b>This one counts.</b>",
  [PAGE_LABELS.briefingTitle]: "What it is",
  [PAGE_LABELS.objectivesTitle]: "To do",
  [PAGE_LABELS.cargo]: "Load",
  [PAGE_LABELS.pickup]: "From",
  [PAGE_LABELS.dropOff]: "To",
  [PAGE_LABELS.objectiveLocation]: "Place",
  [PAGE_LABELS.transportBlurb]: "Carry these:",
  [PAGE_LABELS.dungeonBody]: "Destroy them",
  [PAGE_LABELS.cargoWithSize]: "{cargoDescription} ({[numeric]size, decimalPlaces=1} m3)",
  [PAGE_LABELS.rewardsTitle]: "Pay",
  [PAGE_LABELS.bonusTitle]: "Extra",
  [PAGE_LABELS.securityTax]: "<b>Less is paid</b> hereabouts.",
  [PAGE_LABELS.jumpsAway]: "{[numeric]jumps} {[numeric]jumps -> \"jump\", \"jumps\"} off",
  [PAGE_LABELS.noRoute]: "No way there",
  [PAGE_LABELS.loyaltyPointsShort]: "{[numeric]lpAmount, useGrouping} pts",
  [PAGE_LABELS.isk]: "{[numeric]amount, useGrouping, decimalPlaces=2} ISK",
  [PAGE_LABELS.quantityAndItem]: "{[numeric]quantity, useGrouping} x {[item]item.name}",
  [PAGE_LABELS.startConversation]: "Have a word",
  [PAGE_LABELS.agentLevel]: "Grade {level}",
  [PAGE_LABELS.effectiveStanding]: "Stands at {[numeric]effectiveStanding, decimalPlaces=1}",
  [PAGE_LABELS.effectiveStandingLow]: "Stands at <b>{[numeric]effectiveStanding, decimalPlaces=1}</b>, too low",
  "#900109": "Deliveries",
  [PAGE_LABELS.thisStation]: "Right here",
  [PAGE_LABELS.thisSolarSystem]: "In this system",
  "#900260": "The Made-Up Errand",
  "#900954": "The briefing itself.",
  "#900955": "Bring it to {[location]objectiveLocationSystemID.name},\r\n<b>{[character]agentID.name}</b> says.<br>Soon.<br><br>",
  "#900956": "One more thing",
  "#900957": "Mind the <i>gate</i>.",
};
// Made up, and unlike this page's own short form on purpose, so the two can be told apart.
const SHORT_INTERVAL_TEMPLATES: Record<string, string> = {
  "/Carbon/UI/Common/WrittenDateTimeQuantityShort/Day": "{[numeric]value} dys",
  "/Carbon/UI/Common/WrittenDateTimeQuantityShort/Hour": "{[numeric]value} hrs",
  "/Carbon/UI/Common/WrittenDateTimeQuantityShort/Minute": "{[numeric]value} mns",
  "/Carbon/UI/Common/WrittenDateTimeQuantityShort/DateTimeShortWritten2Elements": "{value1} and {value2}",
};
const LOCATION_TEMPLATES: Record<string, string> = {
  "UI/Agents/LocationWrapper": "{startFontTag}{[numeric]securityRating, decimalPlaces=1}{endFontTag}{image}&nbsp;{locationName, linkinfo=linkdata} {securityWarning}",
  "UI/Agents/LowSecWarning": "<b>(low!)</b>",
};
const PAGE_RECORD = { nameID: 900260, messages: { [PAGE_MESSAGES.briefing]: 900954, [PAGE_MESSAGES.offered]: 900955, [PAGE_MESSAGES.extraHeader]: 900956, [PAGE_MESSAGES.extraBody]: 900957 } };
const pageOf = (body: string): string | null => body.match(/<section class="mission-page">([\s\S]*?)<\/section>/)?.[1] ?? null;
const paneOf = (body: string): string | null => body.match(/<section class="mission-objectives">([\s\S]*?)<\/section>/)?.[1] ?? null;

test("with the client's words the objectives pane is drawn, in its order, with the marks beside its rows", () => {
  // The courier's briefing is held too, as it is after any layout: the pane takes the place of the page's own table.
  const body = panel({ words: true, paneWords: true, talking: true, buttons: [3, 9], briefed: true, objectives: decodeObjectives(COURIER_OFFERED_GATEWAY) });
  const pane = paneOf(body);
  assert.notEqual(pane, null);
  assert.match(pane as string, /<h2 class="mission-objectives-title open">A Carrying Job: to do<\/h2>/);
  assert.equal(
    text(pane as string),
    // The heading, the overview, the transport with its three rows, the offer's note, then the pay.
    "A Carrying Job: to do Do all of these. Carry Carry these: ○ From station 60000004 ○ To station 60000019 ○ Load 1 x type 2595 " +
      "This is the offer. Accept it in the conversation to be given the package. Pay Yours when it is done: 13,800.00 ISK 49 points",
  );
  // The page's own courier table is not drawn beside it.
  assert.doesNotMatch(body, /Courier briefing/);
});

test("an accepted courier has its package's buttons beside the transport; an offer has none", () => {
  const accepted = paneOf(panel({ words: true, paneWords: true, talking: true, buttons: [6, 11], objectives: decodeObjectives(COURIER_OFFERED_GATEWAY) })) as string;
  assert.match(accepted, /Load package into ship/);
  assert.match(accepted, /Set autopilot to dropoff/);
  assert.doesNotMatch(accepted, /mission-offered/);
  const offered = paneOf(panel({ words: true, paneWords: true, talking: true, buttons: [3, 9], objectives: decodeObjectives(COURIER_OFFERED_GATEWAY) })) as string;
  assert.doesNotMatch(offered, /Load package into ship|Set autopilot to dropoff/);
  // A mission with nothing to carry has neither.
  const fight = paneOf(panel({ words: true, paneWords: true, talking: true, buttons: [6, 11], objectives: decodeObjectives(ENCOUNTER_OFFERED_GATEWAY) })) as string;
  assert.doesNotMatch(fight, /Load package|autopilot|mission-offered/);
});

test("a mission that is not a courier has its pane too: the dungeon in the agent's words, and what it pays", () => {
  const pane = paneOf(panel({ words: true, paneWords: true, talking: true, buttons: [3, 9], objectives: decodeObjectives(ENCOUNTER_OFFERED_GATEWAY) })) as string;
  // The agent's words for the dungeon are filled as its other words are; the place it names is not known to this page yet.
  assert.equal(text(pane), "A Fight: to do Do all of these. Target Go to and end it. ○ Place system 30002779 Pay Yours when it is done: 65,000.00 ISK 87 points");
});

test("a dungeon that is over is struck through, with what became of it; a mission finished by a game master says so", () => {
  const fight = decodeObjectives(ENCOUNTER_OFFERED_GATEWAY) as NonNullable<ReturnType<typeof decodeObjectives>>;
  const over = { ...fight, completionStatus: 2, dungeons: [{ ...fight.dungeons[0], completionStatus: 1, objectiveCompleted: 1, briefingMessage: null }] };
  const pane = paneOf(panel({ words: true, paneWords: true, talking: true, buttons: [6], objectives: over })) as string;
  assert.match(pane, /<p class="note mission-cheated">[^<]+<\/p>/);
  assert.match(pane, /<h2 class="mission-objectives-title complete">A Fight: done<\/h2>/);
  assert.match(pane, /<s>Destroy them\.<\/s>\s*<span class="mission-outcome">Won<\/span>/);
  assert.match(pane, /<span class="mission-mark done" title="done">✓<\/span>/);
  // Not over: no strike, no note.
  const open = paneOf(panel({ words: true, paneWords: true, talking: true, buttons: [6], objectives: decodeObjectives(ENCOUNTER_OFFERED_GATEWAY) })) as string;
  assert.doesNotMatch(open, /<s>|mission-cheated|mission-outcome/);
});

test("without the client's words for the pane, a courier keeps this page's own table, and nothing else has a pane", () => {
  // The words store has the journal's words but not the pane's.
  const courier = panel({ words: true, talking: true, buttons: [6, 11], briefed: true, objectives: decodeObjectives(COURIER_OFFERED_GATEWAY) });
  assert.equal(paneOf(courier), null);
  assert.match(courier, /Courier briefing/);
  assert.match(courier, /Load package into ship/);
  const fight = panel({ words: false, talking: true, buttons: [6, 11], objectives: decodeObjectives(ENCOUNTER_OFFERED_GATEWAY) });
  assert.equal(paneOf(fight), null);
  assert.doesNotMatch(fight, /Courier briefing/);
  // No objectives, or no window: no pane.
  assert.equal(paneOf(panel({ words: true, paneWords: true, talking: true })), null);
  assert.equal(paneOf(panel({ words: true, paneWords: true, talking: false, objectives: decodeObjectives(COURIER_OFFERED_GATEWAY) })), null);
});

test("a pane is only as good as its words: no name for the mission, no pane; no words of the agent's for a dungeon, the stock ones", () => {
  const courier = decodeObjectives(COURIER_OFFERED_GATEWAY);
  // The mission's own name is not to hand: nothing is put in its place.
  const nameless = panel({ words: true, paneWords: true, without: ["#57959"], talking: true, buttons: [6, 11], briefed: true, objectives: courier });
  assert.equal(paneOf(nameless), null);
  assert.match(nameless, /Courier briefing/);
  // The agent's words for the dungeon are not to hand: the client's stock words for one.
  const fight = paneOf(panel({ words: true, paneWords: true, without: ["#115502"], talking: true, buttons: [3, 9], objectives: decodeObjectives(ENCOUNTER_OFFERED_GATEWAY) })) as string;
  assert.match(text(fight), /Target Destroy them\. ○ Place system 30002779/);
});

test("each journal line can start a conversation with its agent, in the client's words for it or this page's", () => {
  const buttons = (body: string): string[] => [...body.matchAll(/<button[^>]*class="link journal-talk"[^>]*>([\s\S]*?)<\/button>/g)].map((match) => text(match[1] as string));
  // The client's menu words, filled with the agent's name.
  const client = panel({ words: true, paneWords: true, talking: false });
  assert.deepEqual(buttons(client), ["Speak with Some Other Agent", "Speak with Antaken Kamola"]);
  // Without them, this page's own.
  assert.deepEqual(buttons(panel({ words: false, talking: false })), ["Start conversation with Some Other Agent", "Start conversation with Antaken Kamola"]);
  // The buttons sit on the line, after its words: Read Details first, as the client's menu has it, then this one.
  assert.match(client, /<li><span class="journal-line">[^<]*<\/span>\s*(<!--[^>]*-->\s*)*<button[^>]*class="link journal-details"[^>]*>[^<]*<\/button>\s*(<!--[^>]*-->\s*)*<button[^>]*class="link journal-talk"/);
});

test("an offer's journal line can be removed; a mission that was accepted cannot", () => {
  const lines = (body: string): Array<[string, string[]]> =>
    [...body.matchAll(/<li><span class="journal-line">([^<]*)<\/span>([\s\S]*?)<\/li>/g)].map((match) => [
      (match[1] as string).split(" · ")[0] as string,
      [...(match[2] as string).matchAll(/<button[^>]*class="link (journal-[a-z]+)"[^>]*>([\s\S]*?)<\/button>/g)].map((button) => `${button[1]}: ${text(button[2] as string)}`),
    ]);
  // The client's words for it, without their markup.
  assert.deepEqual(lines(panel({ words: true, paneWords: true, talking: false })), [
    ["Taken", ["journal-details: Look closer", "journal-talk: Speak with Some Other Agent"]],
    ["On offer", ["journal-details: Look closer", "journal-talk: Speak with Antaken Kamola", "journal-remove: Take it away"]],
  ]);
  // This page's own.
  assert.deepEqual(lines(panel({ words: false, talking: false })).map(([, buttons]) => buttons), [
    ["journal-details: Read details", "journal-talk: Start conversation with Some Other Agent"],
    ["journal-details: Read details", "journal-talk: Start conversation with Antaken Kamola", "journal-remove: Remove offer"],
  ]);
});

// --- the mission's page (the journal's Read Details) ---------------------------------

test("a mission's page is drawn from what is held, in the client's order and words", () => {
  const body = panel({ words: true, pageWords: true, talking: false, page: { objectives: decodeObjectives(COURIER_OFFERED_GATEWAY), record: PAGE_RECORD } });
  const page = pageOf(body);
  assert.ok(page, "the page is drawn");
  assert.equal(text(page), [
    // The client's own name for the mission, and its state.
    "The Made-Up Errand On offer now",
    "Have a word Close",
    // The journal's own label, with this page's short form of the time left.
    "Goes in 5h",
    // What the agent says on offering, filled with the mission's keywords and the agent, tidied, and plain.
    "What it is Bring it to Muvolailen,Antaken Kamola says. Soon.",
    "To do Carry these:",
    "○ Load 1 x type 2595 (0.1 m3)",
    "○ From station 60000004",
    "○ To station 60000019",
    "Pay 13,800.00 ISK 49 pts",
    "Extra 17,000.00 ISK",
    "One more thing Mind the gate.",
  ].join(" "));
  // The state is coloured by what it is, and the briefing keeps its line break.
  assert.match(page, /<span class="mission-page-state offered">On offer now<\/span>/);
  assert.match(page, /Antaken Kamola says\.\nSoon\./);
  // The agent's window is not opened by reading a mission's details.
  assert.doesNotMatch(body, /Conversation ·/);
});

test("a page with nothing read yet shows what the journal said; a mission that is not an offer has the briefing itself", () => {
  const waiting = pageOf(panel({ words: true, pageWords: true, talking: false, page: {} })) as string;
  // No record: the journal's name for it, filled with nothing.
  assert.equal(text(waiting), "A Made-Up Errand to On offer now Have a word Close Goes in 5h");
  const accepted = pageOf(panel({ words: true, pageWords: true, talking: false, page: { missionState: 2, record: PAGE_RECORD, expirationTime: null } })) as string;
  assert.equal(text(accepted), "The Made-Up Errand Have a word Close What it is The briefing itself. One more thing Mind the gate.");
  // A mission that matters to standings says so, above the briefing.
  const important = pageOf(panel({ words: true, pageWords: true, talking: false, page: { missionState: 2, important: true, record: PAGE_RECORD, expirationTime: null } })) as string;
  assert.match(text(important), /Close This one counts\. What it is/);
});

test("a mission to fight has its dungeon as a step, in the agent's words", () => {
  const page = pageOf(panel({ words: true, pageWords: true, talking: false, page: { contentID: 13735, missionState: 2, expirationTime: null, objectives: decodeObjectives(ENCOUNTER_OFFERED_GATEWAY) } })) as string;
  // The objectives' own state is the one that counts: on offer.
  assert.match(text(page), /On offer now/);
  // The agent's words for the dungeon are not to hand here: the client's stock ones.
  assert.match(text(page), /To do Destroy them ○ Place system 30002779 Pay 65,000\.00 ISK 87 pts Extra 80,000\.00 ISK/);
});

test("no page is drawn with none held, and with no client to read the page says what it lacks", () => {
  assert.equal(pageOf(panel({ words: true, pageWords: true, talking: false })), null);
  const bare = pageOf(panel({ words: false, noClient: true, talking: false, page: { objectives: decodeObjectives(COURIER_OFFERED_GATEWAY) } })) as string;
  assert.match(bare, /class="note mission-page-wordless"/);
  // Its own words for the two buttons and the title, and the steps by their places alone.
  assert.match(text(bare), /^Mission Start conversation Close The mission's details are worded with the retail client's own text/);
  assert.match(text(bare), /station 60000004 ○ station 60000019$/);
  // Before it is known whether there is a client, and with one, there is no such note.
  assert.doesNotMatch(pageOf(panel({ words: false, talking: false, page: {} })) as string, /mission-page-wordless/);
  assert.doesNotMatch(pageOf(panel({ words: true, pageWords: true, talking: false, page: {} })) as string, /mission-page-wordless/);
});

test("a mission with something to carry and somewhere to fight has the carrying first, each under its own line", () => {
  const dict = (entries: Array<[string, unknown]>) => ({ type: "dict", entries });
  const tuple = (...items: unknown[]) => ({ type: "tuple", items });
  const place = (locationID: number, solarsystemID: number) => dict([["locationID", locationID], ["solarsystemID", solarsystemID], ["typeID", 1531]]);
  const both = decodeObjectives(dict([
    ["contentID", 2156], ["missionState", 2], ["completionStatus", 0],
    ["objectives", { type: "list", items: [tuple("transport", tuple(1, place(60000004, 30002780), 1, place(60000019, 30002778), dict([["typeID", 2595], ["quantity", 1], ["volume", 0], ["hasCargo", true]])))] }],
    ["dungeons", { type: "list", items: [dict([["dungeonID", 3030], ["objectiveCompleted", 1], ["location", place(30002779, 30002779)]])] }],
  ]) as never);
  const page = pageOf(panel({ words: true, pageWords: true, talking: false, page: { missionState: 2, expirationTime: null, objectives: both } })) as string;
  assert.match(text(page), /To do Carry these: ✓ Load 1 x type 2595 ✓ From station 60000004 ○ To station 60000019 Destroy them ✓ Place system 30002779$/);
});

// --- where the pilot is, for the marks beside a mission's objectives -------------------

test("the marks go by where the pilot is now: selected in the pick-up's station, and then undocked from it", () => {
  const selected = { stationID: 60000004, structureID: null, solarSystemID: 30002780 };
  const steps = (flight?: { docked: boolean; stationID: number | null; structureID: number | null; solarSystemID: number | null }) => {
    const page = pageOf(panel({ words: true, pageWords: true, talking: false, online: selected, ...(flight ? { flight } : {}), page: { objectives: decodeObjectives(COURIER_OFFERED_GATEWAY) } })) as string;
    return [...page.matchAll(/<li class="mission-step[^"]*">([\s\S]*?)<\/li>/g)].map((match) => text(match[1] as string));
  };
  // Docked where it was selected, with no flight status read yet.
  assert.deepEqual(steps(), ["○ Load 1 x type 2595 (0.1 m3)", "✓ From Right here station 60000004", "○ To station 60000019"]);
  // The flight status agrees.
  assert.deepEqual(steps({ docked: true, stationID: 60000004, structureID: null, solarSystemID: 30002780 })[1], "✓ From Right here station 60000004");
  // Undocked: the pick-up is not done any more, and its station is in this system.
  assert.deepEqual(steps({ docked: false, stationID: null, structureID: null, solarSystemID: 30002780 }), ["○ Load 1 x type 2595 (0.1 m3)", "○ From In this system station 60000004", "○ To station 60000019"]);
  // Docked at the drop-off without the package: nothing is done there either.
  assert.deepEqual(steps({ docked: true, stationID: 60000019, structureID: null, solarSystemID: 30002778 }), ["○ Load 1 x type 2595 (0.1 m3)", "○ From station 60000004", "○ To Right here station 60000019"]);
});

test("the agent window's pane goes by where the pilot is now too", () => {
  const selected = { stationID: 60000004, structureID: null, solarSystemID: 30002780 };
  const marks = (flight?: { docked: boolean; stationID: number | null; structureID: number | null; solarSystemID: number | null }) => {
    const pane = paneOf(panel({ words: true, paneWords: true, talking: true, buttons: [3, 9], online: selected, ...(flight ? { flight } : {}), objectives: decodeObjectives(COURIER_OFFERED_GATEWAY) })) as string;
    return [...pane.matchAll(/<span class="mission-mark ([a-z]+)"/g)].map((match) => match[1]);
  };
  // Pick-up, drop-off, cargo.
  assert.deepEqual(marks(), ["done", "open", "open"]);
  assert.deepEqual(marks({ docked: false, stationID: null, structureID: null, solarSystemID: 30002780 }), ["open", "open", "open"]);
});

// --- the agent's card and its corporation's, on the mission's page ---------------------

test("the mission's page has the agent's card and its corporation's, between the warning and the briefing", () => {
  const record = { agentID: AGENT, agentTypeID: 2, divisionID: 22, level: 1, stationID: 60000004, corporationID: 1000002, factionID: 500001, divisionNameID: 900109 };
  const page = pageOf(panel({ words: true, pageWords: true, talking: false, agentRecord: record, page: { missionState: 2, important: true, expirationTime: null, record: PAGE_RECORD } })) as string;
  assert.equal(text(page), "The Made-Up Errand Have a word Close This one counts. Grade 1 Antaken Kamola Deliveries A Made-Up Company A Made-Up State What it is The briefing itself. One more thing Mind the gate.");
  assert.match(page, /<div class="mission-page-card agent">[\s\S]*<div class="mission-page-card corporation">/);

  // An agent with no corporation has the one card; one not known to the client's agents service has none.
  const alone = pageOf(panel({ words: true, pageWords: true, talking: false, agentRecord: { ...record, corporationID: null, factionID: null }, page: { missionState: 2, expirationTime: null } })) as string;
  assert.match(text(alone), /Close Grade 1 Antaken Kamola Deliveries$/);
  assert.doesNotMatch(alone, /mission-page-card corporation/);
  for (const agentRecord of [null, undefined]) {
    const none = pageOf(panel({ words: true, pageWords: true, talking: false, ...(agentRecord === null ? { agentRecord } : {}), page: { missionState: 2, expirationTime: null } })) as string;
    assert.doesNotMatch(none, /mission-page-card/);
  }
  // Without the client's words the card has the names, and no level or division.
  const wordless = pageOf(panel({ words: false, talking: false, agentRecord: record, page: { missionState: 2, expirationTime: null } })) as string;
  assert.match(text(wordless), /Close Antaken Kamola A Made-Up Company A Made-Up State$/);
});

test("the corporation's card begins with the pilot's effective standing, from the standings and skills the store holds", () => {
  const record = { agentID: AGENT, agentTypeID: 2, divisionID: 22, level: 1, stationID: 60000004, corporationID: 1000002, factionID: 500001, divisionNameID: 900109 };
  const card = (options: { standings?: ReadonlyArray<readonly [number, number]>; skillLevels?: ReadonlyArray<readonly [number, number]> }) => {
    const page = pageOf(panel({ words: true, pageWords: true, talking: false, agentRecord: record, ...options, page: { missionState: 2, expirationTime: null } })) as string;
    return /<div class="mission-page-card corporation">([\s\S]*?)<\/div>/.exec(page)?.[1] ?? "";
  };
  // The corporation's 3.5, raised by Connections IV: (1 - 0.65 * 0.84) * 10 = 4.54.
  const raised = card({ standings: [[1000002, 3.5], [AGENT, -0.5]], skillLevels: [[3359, 4]] });
  assert.equal(text(raised), "Stands at 4.5 A Made-Up Company A Made-Up State");
  assert.doesNotMatch(raised, /standing low/);
  // With the skills read and none of the three trained, the standing as it is.
  assert.equal(text(card({ standings: [[1000002, 3.5]], skillLevels: [] })), "Stands at 3.5 A Made-Up Company A Made-Up State");
  // A low one is marked.
  const low = card({ standings: [[500001, -4]], skillLevels: [] });
  assert.equal(text(low), "Stands at -4.0, too low A Made-Up Company A Made-Up State");
  assert.match(low, /class="mission-page-card-line standing[^"]* low/);
  // Until both are held, the card has no standing line.
  for (const options of [{ standings: [[1000002, 3.5]] as const }, { skillLevels: [[3359, 4]] as const }, {}]) {
    assert.equal(text(card(options)), "A Made-Up Company A Made-Up State");
  }
});

// --- the time left, the client's short way --------------------------------------------------

test("the journal's line and the mission's page write the time left the client's short way when its words are to hand", () => {
  const body = panel({ words: true, pageWords: true, intervalWords: true, talking: false, page: {} });
  // (The page's words are loaded too here, and one of them is the journal's own word for an offer.)
  assert.deepEqual(journalLines(body).map((line) => line.split(" · ").pop()), ["Ends at 2026.10.10 15:30", "Goes in 5 hrs"]);
  assert.match(text(pageOf(body) as string), /Have a word Close Goes in 5 hrs$/);
  // Without them, this page's own short form, as before.
  const own = panel({ words: true, pageWords: true, talking: false, page: {} });
  assert.deepEqual(journalLines(own).map((line) => line.split(" · ").pop()), ["Ends at 2026.10.10 15:30", "Goes in 5h"]);
  assert.match(text(pageOf(own) as string), /Goes in 5h$/);
});

// --- a place's security rating ----------------------------------------------------------

test("a place is drawn with its system's security rating, on the page and on the pane, once that is read", () => {
  const security = { 30002780: 0.708087, 30002778: 0.3 };
  const page = pageOf(panel({ words: true, pageWords: true, locationWords: true, talking: false, security, page: { missionState: 2, expirationTime: null, objectives: decodeObjectives(COURIER_OFFERED_GATEWAY) } })) as string;
  assert.match(text(page), /○ From 0\.7 station 60000004 ○ To 0\.3 station 60000019 \(low!\)/);
  const pane = paneOf(panel({ words: true, paneWords: true, locationWords: true, talking: true, buttons: [3, 9], security, objectives: decodeObjectives(COURIER_OFFERED_GATEWAY) })) as string;
  assert.match(text(pane), /From 0\.7 station 60000004 ○ To 0\.3 station 60000019 \(low!\)/);
  // Before it is read, the name alone.
  const before = pageOf(panel({ words: true, pageWords: true, locationWords: true, talking: false, page: { missionState: 2, expirationTime: null, objectives: decodeObjectives(COURIER_OFFERED_GATEWAY) } })) as string;
  assert.match(text(before), /○ From station 60000004 ○ To station 60000019/);
});

// --- the banner about reduced rewards ---------------------------------------------------

test("the banner about reduced rewards is drawn after the rewards and before the extra information, for an agent in the safest space", () => {
  const record = { agentID: AGENT, agentTypeID: 2, divisionID: 22, level: 1, stationID: 60000004, corporationID: 1000002, factionID: 500001, divisionNameID: null };
  const held = { objectives: decodeObjectives(COURIER_OFFERED_GATEWAY), record: PAGE_RECORD };
  const drawn = (options: Partial<Parameters<typeof panel>[0]>) => pageOf(panel({ words: true, pageWords: true, talking: false, agentRecord: record, page: held, ...options })) as string;
  const page = drawn({ agentSystem: 30000142, security: { 30000142: 1 } });
  assert.match(text(page), /Extra 17,000\.00 ISK Less is paid hereabouts\. One more thing Mind the gate\./);
  assert.match(page, /<p class="note mission-page-banner" role="note">Less is paid hereabouts\.<\/p>/);
  // None where the agent's system is less safe, where it is not known, or for a career agent.
  for (const options of [
    { agentSystem: 30000142, security: { 30000142: 0.9 } },
    { agentSystem: 30000142 },
    { security: { 30000142: 1 } },
    { agentSystem: null, security: { 30000142: 1 } },
    { agentSystem: 30000142, security: { 30000142: 1 }, agentRecord: { ...record, agentTypeID: 12 } },
    { agentSystem: 30000142, security: { 30000142: 1 }, agentRecord: null },
  ]) {
    const none = drawn(options);
    assert.doesNotMatch(none, /mission-page-banner/, JSON.stringify(options));
    assert.match(text(none), /Extra 17,000\.00 ISK One more thing Mind the gate\./);
  }
});

// --- how many jumps away ----------------------------------------------------------------

test("a place's distance is drawn from where the pilot is now: jumps by the autopilot's route, once worked out", () => {
  const held = { missionState: 2, expirationTime: null, objectives: decodeObjectives(COURIER_OFFERED_GATEWAY) };
  const jumps = { "30000142:30002780": 4, "30000142:30002778": 1, "30002780:30002778": 2, "30009999:30002780": 9 };
  const drawn = (options: Partial<Parameters<typeof panel>[0]>) => text(pageOf(panel({ words: true, pageWords: true, talking: false, page: held, jumps, ...options })) as string);
  // In space, three systems off: both places by their jumps from there.
  assert.match(drawn({ flight: { docked: false, stationID: null, structureID: null, solarSystemID: 30000142 } }), /○ From 4 jumps off station 60000004 ○ To 1 jump off station 60000019/);
  // Docked where the package is: that station is here, and the other is told from this system.
  assert.match(drawn({ flight: { docked: true, stationID: 60000004, structureID: null, solarSystemID: 30002780 } }), /✓ From Right here station 60000004 ○ To 2 jumps off station 60000019/);
  // From a system nothing is worked out for yet, nothing is said.
  assert.match(drawn({ flight: { docked: false, stationID: null, structureID: null, solarSystemID: 30000144 } }), /○ From station 60000004 ○ To station 60000019/);
  // No route.
  assert.match(drawn({ jumps: { "30000142:30002780": null }, flight: { docked: false, stationID: null, structureID: null, solarSystemID: 30000142 } }), /○ From No way there station 60000004 ○ To station 60000019/);
});
