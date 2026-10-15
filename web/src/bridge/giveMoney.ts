// Give Money, as the client gives it: an owner's menu's Give Money (menusvc.py _CharacterMenu, 615 to 616:
// wallet.TransferMoney(session.charid, None, charID, None)) opens the transfer window (walletSvc.py TransferMoney, 142
// to 151; transferMoneyWnd.py), which gives the pilot's own ISK to the character:
//
//   amount  a float of two decimal places, at least 0.1 and at most what the pilot has (walletSvc's wealth, the
//           GetCashBalance(0) it keeps and OnAccountChange puts right), 0.1 where nothing is typed (93; the field's
//           GetValue and CheckBounds, baseSingleLineEditNumber.py 105 to 119 and 320 to 331);
//   reason  forty characters at most, with < and > written as the entities (94; singleLineEditText.py GetValue, 39
//           to 45);
//
// and its OK (Confirm, 138 to 152) asks nothing where the amount is not above nought, and otherwise
//
//   sm.RemoteSvc('account').GiveCash(self.toID, amount, reason, toAccountKey=toAccountKey)
//
// the account key None for a character, then says the transfer was made and closes. Tranquility's recording of a
// transfer to a corporation (Open Wallet - Plex - Corp Wallet - Corp Transfers) has GiveCash(98827279, 100.0, '')
// with toAccountKey=1000; none has one to a character.
//
// WHAT THE SERVER TAKES FROM THE CALLER: the character given to, the amount and the reason. The ISK is the session's
// own character's (account's Handle_GiveCash).

import type { Ask } from "./ask.ts";

/** transferMoneyWnd.py 37: the least that is given. */
export const TRANSFER_MIN_ISK = 0.1;
/** transferMoneyWnd.py 94: the longest reason. */
export const TRANSFER_REASON_MAX = 40;

/**
 * The amount the window's field holds for what was typed, as the client's float field makes it: nothing typed the
 * least; what is not a number nought; the decimals past the second cut off; held between the least and what the
 * pilot has (`wealth`, none where it is not known).
 */
export function transferAmount(typed: string, wealth: number | null): number {
  const text = typed.trim().replace(/,/g, "");
  if (text === "") return TRANSFER_MIN_ISK;
  const value = Number(text);
  if (!Number.isFinite(value)) return 0;
  const cut = Math.trunc(value * 100) / 100;
  if (wealth !== null && cut > wealth) return wealth;
  return cut < TRANSFER_MIN_ISK ? TRANSFER_MIN_ISK : cut;
}

/** The reason as the window's field gives it: its first forty characters, < and > written as the entities. */
export function transferReason(typed: string): string {
  return typed.slice(0, TRANSFER_REASON_MAX).replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Gives `amount` of the pilot's ISK to the character `toID`, with the reason. Fails as the call fails. */
export async function giveMoney(act: Ask, toID: number, amount: number, reason: string): Promise<void> {
  if (!Number.isSafeInteger(toID) || toID <= 0) throw new Error("That is no one to give money to.");
  await act("account", "GiveCash", [toID, amount, reason], { toAccountKey: null });
}
