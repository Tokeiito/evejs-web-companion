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
} from "./agents.ts";
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

test("agentButtonLabel names the retail dialogue buttons", () => {
  assert.equal(agentButtonLabel(AGENT_BUTTON.ACCEPT), "Accept");
  assert.equal(agentButtonLabel(AGENT_BUTTON.DECLINE), "Decline");
  assert.equal(agentButtonLabel(AGENT_BUTTON.COMPLETE), "Complete Mission");
  assert.equal(agentButtonLabel(999), "Action 999");
});
