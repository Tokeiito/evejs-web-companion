// What the account may redeem, read by the page itself (bridge/redeem.ts decodes it).
//
// THE CALL, as the client makes it:
//
//   userSvc.GetRedeemTokens()   redeemsvc.py 64: by the service's name, with nothing. A rowset of the account's tokens.
//
// The transport on the game port fetched it at the pilot's choosing and fetches it again at the server's
// OnRedeemingQueueUpdated and after a claim, as the client's redeem service does, and answers this call from what it
// keeps (src/gamePort/pilots.js). The page reads it as the pilot comes online and at the notice (app/flow.ts).
//
// THROUGH THE WEB GATEWAY the call is not carried: its list has nothing of the user service's. Then there are no
// tokens to be had, and this says none.

import { failureCode, type Ask } from "./ask.ts";
import type { JsonValue } from "./wire.ts";

/** The account's tokens as the server answers them, or null where the pilot's transport does not carry the call. */
export async function readRedeemTokens(ask: Ask): Promise<JsonValue> {
  try {
    return await ask("userSvc", "GetRedeemTokens", []);
  } catch (error) {
    if (failureCode(error) === "CALL_NOT_ALLOWED") return null;
    throw error;
  }
}
