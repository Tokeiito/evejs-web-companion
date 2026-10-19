// The saved fittings, read by whoever wants them (the plan's Phase 6b).
//
// Until 2026-10-11 the page asked two routes of the BFF: GET /api/bridge/fittings for the pilot's own, and
// GET /api/bridge/shared-fittings, which read the corporation's, the community's and the alliance's and of
// which the page took the corporation's alone.
//
// THE CALL, as the client makes it (fittingSvc.PrimeFittings, 430):
//
//   self.fittings[ownerID] = self.GetFittingMgr(ownerID).GetFittings(ownerID)
//
// once for an owner, and kept; the client changes what it keeps itself as a fitting is saved or deleted. The
// manager is chosen by whose the owner is (GetFittingMgr, 86 to 92): the session's character has
// sm.RemoteSvc('charFittingMgr'), its corporation 'corpFittingMgr', its alliance 'allianceFittingMgr'. Each is
// asked by its name, with the owner for its one argument. Recorded on Tranquility so, twice for a character and
// twice for a corporation. The client asks for its corporation's whatever corporation that is (1036).
//
// WHAT THE SERVER TAKES FROM THE CALLER: the owner, which must be the session's own of that kind
// (OWNER_SCOPE_DENIED otherwise): a session reads no other character's fittings, nor another corporation's.
// With no owner sent it takes the session's. The corporation's answer comes as a cached call's result
// (bridge/sharedFittings.ts unwraps it); the character's is the dict itself.
//
// THE ROUTES STILL STAND (src/server.js). Nothing of the page's asks either now.

import type { Ask } from "./ask.ts";
import type { JsonValue } from "./wire.ts";

const anID = (value: number): boolean => Number.isSafeInteger(value) && value > 0;

/** The pilot's own saved fittings, as the server answers them (decoded by bridge/fittings.ts). Fails as the call fails. */
export async function readCharacterFittings(ask: Ask, characterID: number): Promise<JsonValue> {
  if (!anID(characterID)) {
    throw new Error("There is no pilot to read the fittings of.");
  }
  return ask("charFittingMgr", "GetFittings", [characterID]);
}

/**
 * The fittings of the pilot's alliance (fittingSvc.GetAllianceFittings, 415 to 418: only for a pilot in one), as the
 * server answers them (decoded by bridge/sharedFittings.ts). Fails as the call fails.
 */
export async function readAllianceFittings(ask: Ask, allianceID: number): Promise<JsonValue> {
  if (!anID(allianceID)) {
    throw new Error("There is no alliance to read the fittings of.");
  }
  return ask("allianceFittingMgr", "GetFittings", [allianceID]);
}

/** The fittings of the pilot's corporation, as the server answers them (decoded by bridge/sharedFittings.ts). Fails as the call fails. */
export async function readCorporationFittings(ask: Ask, corporationID: number): Promise<JsonValue> {
  if (!anID(corporationID)) {
    throw new Error("There is no corporation to read the fittings of.");
  }
  return ask("corpFittingMgr", "GetFittings", [corporationID]);
}
