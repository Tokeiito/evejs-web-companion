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
  /** What the briefing says of time, the last action's "not yet", and whether a special interaction is on offer. */
  times?: { declineTime: bigint | null; expirationTime: bigint | null } | null;
  cantReplay?: number | null;
  special?: boolean;
}): string {
  const store = createClientStore();
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
  if (options.words === true) {
    store.apply({ type: "words/loaded", available: true, templates: TEMPLATES });
  } else if (options.words === "none of them") {
    // Asked for, and the client has no text for any of it.
    store.apply({ type: "words/loaded", available: true, templates: Object.fromEntries(Object.keys(TEMPLATES).map((key) => [key, null])) });
  }
  return atFrozenClock(() => render(Panel as never, { props: { store, flow: fakeFlow() } } as never).body);
}

/** The text of each journal line, in order. */
const journalLines = (body: string): string[] =>
  [...body.matchAll(/<li[^>]*>([^<]*)<\/li>/g)].map((match) => (match[1] as string).trim()).filter((line) => line.includes(" · "));

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
