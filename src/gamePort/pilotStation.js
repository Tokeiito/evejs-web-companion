"use strict";

/**
 * The station a pilot is docked in, as the client's station service keeps it
 * (eve/client/script/ui/station/base.py).
 *
 * Its guests: asked for once for a station (GetGuests, 99: while no list was received, or the list received was
 * another station's), and from then on changed by the server's word of each pilot who arrives or leaves
 * (OnCharNowInStation, 85; OnCharNoLongerInStation, 92). A guest is (charID, corpID, allianceID, warFactionID),
 * as the answer lists one and as each notice carries one.
 *
 * Its own item: (ownerID, itemID, operationID, stationTypeID), asked for while there is none or its itemID is not
 * the station the session is in (GetStationItem, 573; HasInvalidStationItem, 586).
 *
 * Both are let go when the pilot leaves the station (OnSessionChanged, ProcessSessionChange, 74 to 82).
 */

/** A list off the wire, or a plain one; anything else has no items. */
const itemsOf = (value) => (Array.isArray(value) ? value : value && Array.isArray(value.items) ? value.items : []);

/** An ID as a whole number above nought, off a number or a wire long; null for anything else. */
function idOf(value) {
  const number = typeof value === "bigint" ? Number(value) : value;
  return typeof number === "number" && Number.isSafeInteger(number) && number > 0 ? number : null;
}

function createPilotStation() {
  /** The guests by character, each as its four came, in the order they came. */
  const guests = new Map();
  /** The station the guests were received for (guestListReceived), or null. */
  let guestsOf = null;
  /** The station's own item as it was answered, or null. */
  let item = null;

  /** A guest's four as a row of its own, by its character; null where it names nobody. */
  const rowOf = (guest) => {
    const row = itemsOf(guest);
    const characterID = idOf(row[0]);
    return characterID === null ? null : [characterID, [characterID, ...row.slice(1)]];
  };

  return {
    /** Whether the guests are had for this station. */
    guestsKnown: (stationID) => guestsOf !== null && guestsOf === stationID,
    /** GetGuests answered, for this station: the guests are what it listed. */
    guestsReceived(stationID, answered) {
      guests.clear();
      for (const guest of itemsOf(answered)) {
        const row = rowOf(guest);
        if (row !== null) guests.set(row[0], row[1]);
      }
      guestsOf = stationID;
    },
    /** The guests as GetGuests lists them, in a list of its own. */
    guestsRead: () => [...guests.values()].map((guest) => [...guest]),
    /** One of the server's notices. Answers whether it changed who is here. */
    feed(notification) {
      const method = notification && notification.method;
      if (method !== "OnCharNowInStation" && method !== "OnCharNoLongerInStation") return false;
      const row = rowOf(itemsOf(notification.args)[0]);
      if (row === null) return false;
      // base.py 88: added only where the character is not a guest yet.
      if (method === "OnCharNowInStation") return guests.has(row[0]) ? false : (guests.set(row[0], row[1]), true);
      return guests.delete(row[0]);
    },
    /** Whether the station's own item is had, and is this station's. */
    itemKnown: (stationID) => item !== null && stationID !== null && idOf(itemsOf(item)[1]) === stationID,
    /** GetStationItemBits answered. */
    itemReceived(bits) {
      item = bits;
    },
    /** The station's own item as it was answered, or null. */
    itemRead: () => item,
    /** The pilot has left the station: nothing of it is kept. */
    left() {
      guests.clear();
      guestsOf = null;
      item = null;
    },
  };
}

module.exports = { createPilotStation };
