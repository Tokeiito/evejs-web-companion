// Agent decoders (goal R4) against real handler-shaped marshaled fixtures
// captured from the agentMgr bridge: a conversation (agentSays + action
// buttons), a courier briefing (cargo / pickup / dropoff / reward / time bonus,
// with bigint-safe ISK + FILETIME decoding), and the mission journal.

import test from "node:test";
import assert from "node:assert/strict";

import {
  AGENT_BUTTON,
  agentButtonLabel,
  decodeBriefing,
  decodeConversation,
  decodeJournal,
  findAcceptAction,
  AGENT_MISSION,
  AGENT_TYPE_RESEARCH,
  decodeMissionChange,
  objectivesShown,
  offerOpen,
  openingAction,
  windowOnMissionChange,
} from "./agents.ts";
import type { AgentConversation } from "../store/types.ts";
import type { JsonValue } from "./wire.ts";

// An offered courier conversation: agentSays (briefingID, contentID) and the
// Accept(816,3) / Decline(817,9) / Defer(818,10) action buttons.
const OFFERED_CONVERSATION: JsonValue = {
  type: "tuple",
  items: [
    {
      type: "tuple",
      items: [
        { type: "tuple", items: [127958, 1382] },
        {
          type: "list",
          items: [
            { type: "tuple", items: [816, 3] },
            { type: "tuple", items: [817, 9] },
            { type: "tuple", items: [818, 10] },
          ],
        },
      ],
    },
    {
      type: "dict",
      entries: [
        ["missionCompleted", false],
        ["missionQuit", false],
        ["missionCantReplay", null],
        ["loyaltyPoints", 0],
        ["missionDeclined", false],
      ],
    },
  ],
};

// An idle conversation whose agentSays message is a (messageKey, substDict)
// tuple rather than a bare briefing id.
const IDLE_CONVERSATION: JsonValue = {
  type: "tuple",
  items: [
    {
      type: "tuple",
      items: [
        {
          type: "tuple",
          items: [
            { type: "tuple", items: ["UI/Agents/DefaultMessages/RootAgentSays/GenericGreetings", { type: "dict", entries: [] }] },
            1382,
          ],
        },
        { type: "list", items: [{ type: "tuple", items: [815, 2] }] },
      ],
    },
    { type: "dict", entries: [["missionDeclined", null], ["loyaltyPoints", 0]] },
  ],
};

const OBJECTIVE: JsonValue = {
  type: "dict",
  entries: [
    ["completionStatus", 0],
    ["collateral", { type: "list", items: [] }],
    ["dungeons", { type: "list", items: [] }],
    [
      "objectives",
      {
        type: "list",
        items: [
          {
            type: "tuple",
            items: [
              "transport",
              {
                type: "tuple",
                items: [
                  1000002,
                  { type: "dict", entries: [["typeID", 1531], ["solarsystemID", 30002780], ["locationID", 60000004]] },
                  1000002,
                  { type: "dict", entries: [["typeID", 1531], ["solarsystemID", 30001399], ["locationID", 60000256]] },
                  { type: "dict", entries: [["volume", 0.1], ["typeID", 3814], ["hasCargo", false], ["quantity", 1]] },
                ],
              },
            ],
          },
        ],
      },
    ],
    ["normalRewards", { type: "list", items: [{ type: "tuple", items: [29, 102000, null] }, { type: "tuple", items: [29, 38250, null] }] }],
    ["bonusRewards", { type: "list", items: [] }],
    ["missionState", 2],
    ["loyaltyPoints", 213],
    ["missionTitleID", 58607],
  ],
};

const BRIEFING: JsonValue = {
  type: "dict",
  entries: [
    [
      "Mission Keywords",
      {
        type: "dict",
        entries: [
          ["objectiveLocationID", 60000004],
          ["objectiveDestinationID", 60000256],
          ["objectiveQuantity", 1],
          ["objectiveDestinationSystemID", 30001399],
          ["objectiveTypeID", 3814],
          ["objectiveLocationSystemID", 30002780],
          ["rewardTypeID", 29],
          ["rewardQuantity", 102000],
        ],
      },
    ],
    ["Mission Title ID", 58607],
    ["AcceptTimestamp", { type: "long", value: "134289174004640000" }],
    ["Expiration Time", { type: "long", value: "134295222004640000" }],
    ["Mission Briefing ID", 127958],
  ],
};

const JOURNAL: JsonValue = {
  type: "tuple",
  items: [
    {
      type: "list",
      items: [
        {
          type: "tuple",
          items: [
            2,
            0,
            "UI/Agents/MissionTypes/Courier",
            58607,
            3008416,
            { type: "long", value: "134295222004640000" },
            { type: "list", items: [] },
            0,
            0,
            1382,
          ],
        },
      ],
    },
    { type: "list", items: [] },
  ],
};

test("decodeConversation reads the offered courier conversation + action buttons", () => {
  const conversation = decodeConversation(OFFERED_CONVERSATION);
  assert.equal(conversation.agentSays, "127958");
  assert.equal(conversation.contentID, 1382);
  assert.deepEqual(
    conversation.actions.map((action) => [action.actionID, action.buttonType, action.label]),
    [
      [816, 3, "Accept"],
      [817, 9, "Decline"],
      [818, 10, "Defer"],
    ],
  );
  const accept = findAcceptAction(conversation);
  assert.ok(accept, "the offered conversation exposes an Accept action");
  assert.equal(accept!.actionID, 816);
  assert.equal(accept!.buttonType, AGENT_BUTTON.ACCEPT);
  assert.equal(conversation.lastActionInfo.missionDeclined, false);
});

test("decodeConversation reads a (messageKey, substDict) agentSays", () => {
  const conversation = decodeConversation(IDLE_CONVERSATION);
  assert.equal(
    conversation.agentSays,
    "UI/Agents/DefaultMessages/RootAgentSays/GenericGreetings",
  );
  assert.equal(conversation.actions.length, 1);
  assert.equal(conversation.actions[0]!.label, "Request Mission");
  assert.equal(findAcceptAction(conversation), null);
});

test("decodeBriefing reads the courier cargo, pickup, destination, reward, and time bonus", () => {
  const briefing = decodeBriefing(BRIEFING, OBJECTIVE);
  assert.ok(briefing, "a courier briefing decodes");
  assert.equal(briefing!.cargoTypeID, 3814);
  assert.equal(briefing!.cargoQuantity, 1);
  assert.equal(briefing!.cargoVolume, 0.1);
  assert.equal(briefing!.pickupLocationID, 60000004);
  assert.equal(briefing!.pickupSystemID, 30002780);
  assert.equal(briefing!.destinationLocationID, 60000256);
  assert.equal(briefing!.destinationSystemID, 30001399);
  // ISK / FILETIME are kept as bigint-safe decimal strings (unwrapLong), never
  // lossy Number.
  assert.equal(briefing!.rewardISK, "102000");
  assert.equal(briefing!.bonusISK, "38250");
  assert.equal(briefing!.loyaltyPoints, 213);
  assert.equal(briefing!.expirationTime, "134295222004640000");
  assert.equal(briefing!.acceptTimestamp, "134289174004640000");
});

test("decodeBriefing keeps a >2^53 ISK reward exact as a decimal string", () => {
  // A high-level courier reward that overflows Number: it must survive as its
  // exact decimal string, not a rounded double.
  const bigReward = "9007199254740993"; // 2^53 + 1
  const objective: JsonValue = {
    type: "dict",
    entries: [
      [
        "objectives",
        { type: "list", items: [{ type: "tuple", items: ["transport", { type: "tuple", items: [1, { type: "dict", entries: [] }, 1, { type: "dict", entries: [] }, { type: "dict", entries: [["typeID", 3814], ["quantity", 1]] }] }] }] },
      ],
      ["normalRewards", { type: "list", items: [{ type: "tuple", items: [29, { type: "long", value: bigReward }, null] }] }],
      ["bonusRewards", { type: "list", items: [] }],
      ["loyaltyPoints", 1],
    ],
  };
  const briefing = decodeBriefing({ type: "dict", entries: [] }, objective);
  assert.equal(briefing!.rewardISK, bigReward);
  assert.notEqual(briefing!.rewardISK, String(Number(bigReward)));
});

test("decodeBriefing returns null when there is no transport objective or keywords", () => {
  const empty: JsonValue = { type: "dict", entries: [["objectives", { type: "list", items: [] }]] };
  assert.equal(decodeBriefing({ type: "dict", entries: [] }, empty), null);
});

test("decodeJournal reads the active courier mission and empty offered bucket", () => {
  const journal = decodeJournal(JOURNAL);
  assert.equal(journal.active.length, 1);
  assert.equal(journal.offered.length, 0);
  const mission = journal.active[0]!;
  assert.equal(mission.missionState, 2);
  assert.equal(mission.missionTypeLabel, "UI/Agents/MissionTypes/Courier");
  assert.equal(mission.missionTitleID, 58607);
  assert.equal(mission.agentID, 3008416);
  assert.equal(mission.missionID, 1382);
  assert.equal(mission.expirationTime, "134295222004640000");
});

test("decodeJournal buckets an OFFERED row (state 1) under offered, not active", () => {
  // The runtime returns all missions in the first tuple slot (getJournalDetails
  // -> [allMissions, []]); an offered mission (missionState 1) arrives there
  // too and must still land in `offered` (seen mis-bucketed live in R4).
  const offeredRow: JsonValue = {
    type: "tuple",
    items: [1, 0, "UI/Agents/MissionTypes/Courier", 111, 222, { type: "long", value: "134" }, { type: "list", items: [] }, 1, 0, 333],
  };
  const acceptedRow: JsonValue = {
    type: "tuple",
    items: [2, 0, "UI/Agents/MissionTypes/Courier", 444, 555, { type: "long", value: "135" }, { type: "list", items: [] }, 0, 0, 666],
  };
  const journal = decodeJournal({
    type: "tuple",
    items: [{ type: "list", items: [offeredRow, acceptedRow] }, { type: "list", items: [] }],
  });
  assert.equal(journal.offered.length, 1);
  assert.equal(journal.offered[0]!.missionID, 333);
  assert.equal(journal.active.length, 1);
  assert.equal(journal.active[0]!.missionID, 666);
});

test("decodeJournal reads a row as the client unpacks it: whether it is important, and a name sent as text", () => {
  // journal.py 686: missionState, importantMission, missionTypeLabel, missionNameID, agentID, expirationTime,
  // bookmarks, remoteOfferable, remoteCompletable, contentID. The name is a message's number or text.
  const row = (important: JsonValue, name: JsonValue): JsonValue => ({
    type: "tuple",
    items: [2, important, "UI/Agents/MissionTypes/Courier", name, 222, { type: "long", value: "135" }, { type: "list", items: [] }, 0, 0, 666],
  });
  const decoded = (important: JsonValue, name: JsonValue) =>
    decodeJournal({ type: "tuple", items: [{ type: "list", items: [row(important, name)] }, { type: "list", items: [] }] }).active[0]!;
  assert.deepEqual(decoded(0, 58607), {
    missionState: 2,
    importantMission: false,
    missionTypeLabel: "UI/Agents/MissionTypes/Courier",
    missionTitleID: 58607,
    missionTitle: null,
    agentID: 222,
    expirationTime: "135",
    missionID: 666,
  });
  assert.equal(decoded(1, 58607).importantMission, true);
  assert.equal(decoded(true, 58607).importantMission, true);
  for (const not of [false, null, 2, "1"] as JsonValue[]) {
    assert.equal(decoded(not, 58607).importantMission, false, JSON.stringify(not));
  }
  const named = decoded(0, "A name as text");
  assert.equal(named.missionTitle, "A name as text");
  assert.equal(named.missionTitleID, null);
  // Text that reads as a number is still text, not a message's number.
  assert.equal(decoded(0, "58607").missionTitleID, null);
  assert.equal(decoded(0, "58607").missionTitle, "58607");
});

test("decodeJournal reads tuples the game port gives as bare arrays", () => {
  // The gateway prints a tuple as {type:"tuple", items}; a decoded marshal
  // stream has no such wrapper, so the game port gives an array. Lists keep
  // their wrapper on both. (parity report: agentMgr.GetMyJournalDetails.)
  const row = (state: number, missionID: number): JsonValue[] => [
    state, 0, "UI/Agents/MissionTypes/Courier", 111, 222,
    { type: "long", value: "134295222004640000" }, { type: "list", items: [] }, 0, 0, missionID,
  ];
  const journal = decodeJournal([
    { type: "list", items: [row(1, 333), row(2, 666)] },
    { type: "list", items: [] },
  ]);
  assert.equal(journal.offered.length, 1);
  assert.equal(journal.offered[0]!.missionID, 333);
  assert.equal(journal.active.length, 1);
  assert.equal(journal.active[0]!.missionID, 666);
  assert.equal(journal.active[0]!.expirationTime, "134295222004640000");
});

test("decodeJournal reads the same journal from either spelling", () => {
  const bare = (value: JsonValue): JsonValue => {
    if (Array.isArray(value)) return value.map(bare);
    if (typeof value !== "object" || value === null) return value;
    const wrapper = value as { type?: unknown; items?: JsonValue[] };
    if (wrapper.type === "tuple" && Array.isArray(wrapper.items)) return wrapper.items.map(bare);
    if (wrapper.type === "list" && Array.isArray(wrapper.items)) return { type: "list", items: wrapper.items.map(bare) };
    return value;
  };
  assert.deepEqual(decodeJournal(bare(JOURNAL)), decodeJournal(JOURNAL));
  assert.equal(decodeJournal(bare(JOURNAL)).active.length, 1);
});

test("agentButtonLabel names the retail dialogue buttons", () => {
  assert.equal(agentButtonLabel(AGENT_BUTTON.ACCEPT), "Accept");
  assert.equal(agentButtonLabel(AGENT_BUTTON.DECLINE), "Decline");
  assert.equal(agentButtonLabel(AGENT_BUTTON.COMPLETE), "Complete Mission");
  assert.equal(agentButtonLabel(999), "Action 999");
});

test("every button the retail client knows has a name here, and an unknown one says its number", () => {
  // appConst.agentDialogueButton*: 1 to 19, no gaps. A research agent's three showed as "Action 12/13/14" until named.
  const numbers = Object.values(AGENT_BUTTON).sort((left, right) => left - right);
  assert.deepEqual(numbers, Array.from({ length: 19 }, (_, index) => index + 1));
  for (const buttonType of numbers) {
    assert.doesNotMatch(agentButtonLabel(buttonType), /^Action /, `button ${buttonType} has a name`);
  }
  assert.equal(agentButtonLabel(AGENT_BUTTON.START_RESEARCH), "Start Research");
  assert.equal(agentButtonLabel(AGENT_BUTTON.CANCEL_RESEARCH), "Cancel Research");
  assert.equal(agentButtonLabel(AGENT_BUTTON.BUY_DATACORES), "Buy Datacores");
  assert.equal(agentButtonLabel(20), "Action 20");
});

test("what an agent says is kept as the server sent it: a label with its parameters, plain text, or a message's number", () => {
  const says = (first: JsonValue) => decodeConversation({ type: "tuple", items: [{ type: "tuple", items: [{ type: "tuple", items: [first, 4802] }, { type: "list", items: [] }] }, { type: "dict", entries: [] }] });
  // A label with its parameters, as the web gateway wraps a tuple and as the game port gives it.
  const wrapped = says({ type: "tuple", items: ["UI/Agents/Research/ResearchStarted", { type: "dict", entries: [["skillID", 11450]] }] });
  assert.equal(wrapped.agentSays, "UI/Agents/Research/ResearchStarted");
  assert.deepEqual(wrapped.agentSaysWords, { label: "UI/Agents/Research/ResearchStarted", parameters: { type: "dict", entries: [["skillID", 11450]] }, text: null });
  const bare = says(["UI/Agents/DefaultMessages/RootAgentSays/GenericGreetings", { type: "dict", entries: [] }]);
  assert.deepEqual(bare.agentSaysWords, { label: "UI/Agents/DefaultMessages/RootAgentSays/GenericGreetings", parameters: { type: "dict", entries: [] }, text: null });
  // A label with nothing after it has no parameters.
  assert.deepEqual(says(["UI/Agents/Bare"]).agentSaysWords, { label: "UI/Agents/Bare", parameters: null, text: null });
  // Plain text is text.
  assert.deepEqual(says("Come back later.").agentSaysWords, { label: null, parameters: null, text: "Come back later." });
  // A mission's own text comes as its message's number, with the mission's content ID beside it.
  const numbered = says(127958);
  assert.equal(numbered.agentSays, "127958");
  assert.deepEqual(numbered.agentSaysWords, { label: null, parameters: null, text: null, messageID: 127958 });
  assert.equal(numbered.contentID, 4802);
  // A number that cannot be a message's is not one.
  for (const wrong of [0, -5, 1.5]) {
    assert.equal(says(wrong).agentSaysWords, null, String(wrong));
  }
  // Something that is neither is nothing.
  assert.equal(says([7, {}]).agentSaysWords, null);
});

// --- the window's own rules --------------------------------------------------

const talk = (buttons: readonly number[]): AgentConversation => ({
  agentSays: "",
  agentSaysWords: null,
  contentID: null,
  actions: buttons.map((buttonType, index) => ({ actionID: 900 + index, buttonType, label: agentButtonLabel(buttonType) })),
  lastActionInfo: { missionCompleted: null, missionDeclined: null, missionQuit: null, loyaltyPoints: null },
});

test("the action the window presses by itself on opening: a mission to request or view, first, from an agent with nothing else to do", () => {
  assert.equal(AGENT_TYPE_RESEARCH, 4);
  const pressed = (buttons: readonly number[], agentTypeID: number | null = 2) => openingAction(talk(buttons), agentTypeID)?.actionID ?? null;
  // The only thing on offer: pressed, whoever the agent is.
  assert.deepEqual([pressed([AGENT_BUTTON.REQUEST_MISSION]), pressed([AGENT_BUTTON.VIEW_MISSION]), pressed([AGENT_BUTTON.REQUEST_MISSION], 4), pressed([AGENT_BUTTON.VIEW_MISSION], null)], [900, 900, 900, 900]);
  // First of several: pressed for an ordinary agent, not for a research agent or one that locates characters.
  assert.equal(pressed([AGENT_BUTTON.VIEW_MISSION, AGENT_BUTTON.DEFER]), 900);
  assert.equal(pressed([AGENT_BUTTON.VIEW_MISSION, AGENT_BUTTON.CANCEL_RESEARCH], AGENT_TYPE_RESEARCH), null);
  assert.equal(pressed([AGENT_BUTTON.REQUEST_MISSION, AGENT_BUTTON.LOCATE_CHARACTER]), null);
  assert.equal(pressed([AGENT_BUTTON.REQUEST_MISSION, AGENT_BUTTON.DEFER], null), null, "an agent of unknown kind");
  // Not first, or not a mission: nothing.
  assert.deepEqual([pressed([AGENT_BUTTON.ACCEPT, AGENT_BUTTON.REQUEST_MISSION]), pressed([AGENT_BUTTON.ACCEPT]), pressed([AGENT_BUTTON.LOCATE_CHARACTER]), pressed([])], [null, null, null, null]);
});

test("the objectives are shown unless the last action completed, declined or quit the mission, or was told not yet", () => {
  const info = (more: Record<string, unknown>) => ({ missionCompleted: null, missionDeclined: null, missionQuit: null, loyaltyPoints: 0, ...more });
  assert.equal(objectivesShown(info({})), true);
  assert.equal(objectivesShown(info({ missionCompleted: false, missionDeclined: false, missionQuit: false, missionCantReplay: 0 })), true);
  for (const ended of [{ missionCompleted: true }, { missionDeclined: true }, { missionQuit: true }, { missionCantReplay: 600_000 }]) {
    assert.equal(objectivesShown(info(ended)), false, JSON.stringify(ended));
  }
});

test("a conversation says how long until the agent will offer the mission again, when that is the answer", () => {
  const said = (entries: unknown[]) => decodeConversation({
    type: "tuple",
    items: [
      { type: "tuple", items: [{ type: "tuple", items: ["x", { type: "dict", entries: [] }] }, { type: "list", items: [] }] },
      { type: "dict", entries },
    ],
  } as unknown as JsonValue).lastActionInfo;
  assert.equal(said([["missionCantReplay", 86_400_000]]).missionCantReplay, 86_400_000);
  assert.equal(said([["missionCantReplay", null]]).missionCantReplay, null);
  assert.equal(said([]).missionCantReplay, null);
});

test("a mission is still on offer while the agent offers a way to accept it", () => {
  assert.deepEqual(
    [[AGENT_BUTTON.ACCEPT, AGENT_BUTTON.DECLINE], [AGENT_BUTTON.DEFER, AGENT_BUTTON.ACCEPT_REMOTELY], [AGENT_BUTTON.ACCEPT_CHOICE]].map((buttons) => offerOpen(talk(buttons))),
    [true, true, true],
  );
  assert.deepEqual(
    [[AGENT_BUTTON.COMPLETE, AGENT_BUTTON.QUIT], [AGENT_BUTTON.REQUEST_MISSION], [AGENT_BUTTON.DECLINE], []].map((buttons) => offerOpen(talk(buttons))),
    [false, false, false, false],
  );
  assert.equal(offerOpen(null), false);
});

test("a pushed OnAgentMissionChange is read for what happened and with which agent", () => {
  assert.deepEqual(decodeMissionChange("OnAgentMissionChange", ["modified", 3008416]), { action: "modified", agentID: 3008416 });
  // An agent sent as a long, as the game port sends a large one.
  assert.deepEqual(decodeMissionChange("OnAgentMissionChange", ["accepted", { type: "long", value: "3008416" }]), { action: "accepted", agentID: 3008416 });
  // No agent: the client takes that as every agent's journal being out of date.
  assert.deepEqual(decodeMissionChange("OnAgentMissionChange", ["offered", null]), { action: "offered", agentID: null });
  assert.deepEqual(decodeMissionChange("OnAgentMissionChange", ["offered"]), { action: "offered", agentID: null });
  assert.deepEqual(decodeMissionChange("OnAgentMissionChange", ["offered", 0]), { action: "offered", agentID: null });
  // Not that notification, or one that does not say what happened.
  assert.equal(decodeMissionChange("OnAgentMissionChanged", ["modified", 3008416]), null);
  assert.equal(decodeMissionChange(null, ["modified", 3008416]), null);
  assert.equal(decodeMissionChange("OnAgentMissionChange", [7, 3008416]), null);
  assert.equal(decodeMissionChange("OnAgentMissionChange", []), null);
});

test("what the window open on an agent does when the server says a mission changed", () => {
  const AGENT = 3008416;
  const does = (action: string, agentID: number | null = AGENT, open: number | null = AGENT) => windowOnMissionChange({ action, agentID }, open);
  // The client's constants, as the server sends them.
  assert.deepEqual(AGENT_MISSION, { MODIFIED: "modified", OFFER_REMOVED: "offer_removed", RESET: "reset", TALK_TO_COMPLETED: "talk_to_completed" });
  // Modified: it talks to its agent again.
  assert.equal(does("modified"), "again");
  // The offer taken away, the mission reset, the talk it asked for done: it closes.
  assert.deepEqual(["offer_removed", "reset", "talk_to_completed"].map((action) => does(action)), ["close", "close", "close"]);
  // Everything else the server says leaves the window as it is.
  for (const action of ["accepted", "completed", "declined", "dungeon_moved", "failed", "offered", "offer_declined", "offer_expired", "prolong", "quit", "research_started", "research_update_ppd"]) {
    assert.equal(does(action), "stay", action);
  }
  // Another agent's mission, no agent named, or no window open.
  assert.equal(does("modified", 3008417), "stay");
  assert.equal(does("reset", 3008417), "stay");
  assert.equal(does("modified", null), "stay");
  assert.equal(does("modified", AGENT, null), "stay");
  assert.equal(does("reset", null, null), "stay");
});
