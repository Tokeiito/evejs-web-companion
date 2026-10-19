"use strict";

// bco_applications.py22-95: the personal dictionary survives corpid changes.
// Keep the original DBRows, including Unicode text, for UpdateApplicationOffer.
const { createKeptReads } = require("./keptReads");
const { rowFields } = require("./pilotDogma");
const items = value => Array.isArray(value) ? value : value?.items ?? [];
function createPilotCorporationApplications() {
  const kept = createKeptReads();
  const read = ask => kept.read("personal", ask);
  return {
    read,
    clear: () => kept.forget(),
    feed(notification, characterID, ask) {
      if (notification.method !== "OnCorporationApplicationChanged" || Number(notification.args?.[1]) !== characterID) return;
      const [corporationID, , applicationID, application] = notification.args;
      // UpdateMyApplications calls GetMyApplications first, even before prime.
      void read(ask).catch(() => {});
      void kept.amend("personal", answer => {
        if (answer?.type !== "dict" || !Array.isArray(answer.entries)) return undefined;
        let found = false;
        const update = old => {
          const rows = items(old);
          // Preserve the compiled client's None branch (50-55), including its
          // None placeholders; the personal view skips entries without owners.
          if (application === null) return { type: "list", items: rows.filter(row => rowFields(row)?.applicationID !== applicationID).map(() => null) };
          let replaced = false;
          const next = rows.map(row => {
            if (rowFields(row)?.applicationID !== applicationID) return row;
            replaced = true; return application;
          });
          if (!replaced) next.push(application);
          return { type: "list", items: next };
        };
        const entries = answer.entries.map(([key, value]) => {
          if (Number(key) !== Number(corporationID)) return [key, value];
          found = true; return [key, update(value)];
        });
        if (!found) entries.push([corporationID, update([])]);
        return { ...answer, entries };
      });
    },
  };
}
module.exports = { createPilotCorporationApplications };
