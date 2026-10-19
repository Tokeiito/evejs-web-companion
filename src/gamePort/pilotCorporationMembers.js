"use strict";

// bco_members.__PrimeEveOwners/GetMemberIDs/OnCorporationMemberChanged,
// build 3396210:110-151,229-241. IDs are kept without fabricating owner rows.
const { createKeptReads } = require("./keptReads");
const text = value => Buffer.isBuffer(value) ? value.toString("utf8") : value;
const items = value => Array.isArray(value) ? value : value?.items ?? [];
const field = (value, name) => value?.entries?.find(([key]) => text(key) === name)?.[1];
const id = value => {
  const number = Number(value?.type === "long" ? value.value : value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
};

function corporationMemberIDsOf(answer) {
  if (answer?.type !== "list" || !Array.isArray(answer.items)) {
    throw new Error("Your corporation's members could not be read (the server did not answer with a list).");
  }
  return answer.items.map(row => {
    const header = items(field(row?.args, "header")), line = items(field(row?.args, "line"));
    const ownerID = id(line[header.findIndex(key => text(key) === "ownerID")]);
    if (ownerID === null) throw new Error("A corporation member's owner ID could not be read.");
    return ownerID;
  });
}

function createPilotCorporationMembers() {
  const kept = createKeptReads();
  let version = 0;
  return {
    clear() { version++; kept.forget(); },
    async read(ask, current) {
      const epoch = version;
      const assertCurrent = () => { current(); if (version !== epoch) throw Object.assign(new Error("This corporation membership belongs to a retired session."), { code: "SESSION_REQUEST_RETIRED", statusCode: 409 }); };
      assertCurrent();
      const ids = await kept.read("ids", async () => {
        assertCurrent(); const answer = await ask(); assertCurrent();
        return corporationMemberIDsOf(answer);
      });
      assertCurrent(); return [...ids];
    },
    feed(notification, corporationID) {
      if (notification.method !== "OnCorporationMemberChanged") return;
      const change = field(notification.args?.[2], "corporationID");
      if (!change) return;
      const [oldCorp, newCorp] = items(change), who = id(notification.args?.[1]), epoch = version;
      if (who === null) return;
      // Amend behind a reply already in flight, as the other native kept reads do.
      // Before any prime, a notice has nothing to change; a later prime sees it.
      void kept.amend("ids", ids => {
        if (epoch !== version) return ids;
        if (id(oldCorp) === corporationID) return ids.filter(member => member !== who);
        if (id(newCorp) === corporationID && !ids.includes(who)) return [...ids, who];
        return ids;
      });
    },
  };
}

module.exports = { corporationMemberIDsOf, createPilotCorporationMembers };
