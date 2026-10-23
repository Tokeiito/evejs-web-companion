// The redeem window's claim, as the client makes it (eve/client/script/ui/shared/redeem/redeemItemsContainer.py redeem,
// 343 to 356, and redeemsvc.py ClaimRedeemTokens, 99 to 131):
//
//   sm.RemoteSvc('userSvc').ClaimRedeemTokens(tokens, charID, useHomeStation=useHomeStation)
//
// the selected tokens as a list of (tokenID, massTokenID), the session's own character, and whether they go to the
// home station (Redeem to Home Station) or to the station the pilot is docked in (Redeem to Current Station, which the
// window offers only docked: CurrentStationSection.is_enabled, 613 to 614). The game port fetches the tokens afresh
// once it is answered, as the client does (127).

import type { Ask } from "./ask.ts";
import { canRedeemOrdinarily, decodeRedeemOutcome, tokenKey, TRAINING_CERTIFICATE_NOTICE, type RedeemOutcome, type RedeemToken } from "./redeem.ts";

/** Redeems `tokens` for the character, to its home station or where it is docked. Fails as the call fails. */
export async function claimRedeemTokens(act: Ask, tokens: readonly RedeemToken[], characterID: number, useHomeStation: boolean): Promise<RedeemOutcome> {
  if (tokens.length === 0) throw new Error("Select something to redeem first.");
  if (!Number.isSafeInteger(characterID) || characterID <= 0) throw new Error("There is no pilot to redeem for.");
  if (tokens.some((token) => !canRedeemOrdinarily(token))) throw new Error(TRAINING_CERTIFICATE_NOTICE);
  const answer = await act("userSvc", "ClaimRedeemTokens", [tokens.map(tokenKey), characterID], { useHomeStation });
  return decodeRedeemOutcome(answer);
}
