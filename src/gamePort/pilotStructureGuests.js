"use strict";

/**
 * The guests of the structure a pilot is docked in, as the client's structure guests service keeps them
 * (eve/client/script/ui/services/structure/structureGuests.py, whole).
 *
 * Asked for once, while none are had (GetGuests, 21 to 26: RemoteSvc('structureGuests').GetGuests of the
 * structure the session is in), and answered a dict: each guest's (corporationID, allianceID, factionID) by its
 * character. From then on changed by the server's word: OnCharacterEnteredStructure(characterID, corporationID,
 * allianceID, factionID) sets that character's three (36), whether it was a guest or not, and
 * OnCharacterLeftStructure(characterID) takes the character out (40). All of it is let go when the session's
 * structure changes (DoSessionChanging, 31).
 *
 * NOT AS THE CLIENT DOES IT: with none had, each of the client's two handlers asks for the guests first (both go
 * through GetGuests). Here a notice with none had changes nothing, and the next reading asks. The server answers
 * who is there as it is asked, so the answer has what the notice said.
 */

/** A tuple or a list off the wire, or a plain one; anything else has no items. */
const itemsOf = (value) => (Array.isArray(value) ? value : value && Array.isArray(value.items) ? value.items : []);

/** An ID as a whole number above nought, off a number or a wire long; null for anything else. */
function idOf(value) {
  const number = typeof value === "bigint" ? Number(value) : value;
  return typeof number === "number" && Number.isSafeInteger(number) && number > 0 ? number : null;
}

function createPilotStructureGuests() {
  /** Each guest's three as they came, by its character, in the order they came. */
  const guests = new Map();
  /** The structure the guests were answered for, or null while none are had. */
  let guestsOf = null;

  return {
    /** Whether the guests are had for this structure. */
    known: (structureID) => guestsOf !== null && guestsOf === structureID,
    /** GetGuests answered, for this structure: the guests are what its dict has. */
    received(structureID, answered) {
      guests.clear();
      for (const entry of answered && answered.type === "dict" && Array.isArray(answered.entries) ? answered.entries : []) {
        const characterID = idOf(itemsOf(entry)[0]);
        if (characterID !== null) guests.set(characterID, [...itemsOf(itemsOf(entry)[1])]);
      }
      guestsOf = structureID;
    },
    /** The guests as GetGuests answers them, in a dict of its own. */
    read: () => ({ type: "dict", entries: [...guests].map(([characterID, three]) => [characterID, [...three]]) }),
    /** One of the server's notices. Answers whether it changed who is here. */
    feed(notification) {
      const method = notification && notification.method;
      const args = Array.isArray(notification && notification.args) ? notification.args : [];
      if (guestsOf === null) return false;
      if (method === "OnCharacterEnteredStructure" && args.length === 4) {
        const characterID = idOf(args[0]);
        return characterID === null ? false : (guests.set(characterID, args.slice(1)), true);
      }
      if (method === "OnCharacterLeftStructure" && args.length === 1) return guests.delete(idOf(args[0]));
      return false;
    },
    /** The pilot is in another structure, or in none: nothing of this one is kept. */
    left() {
      guests.clear();
      guestsOf = null;
    },
  };
}

module.exports = { createPilotStructureGuests };
