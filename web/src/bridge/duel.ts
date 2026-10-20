// crimewatchSvc562-588 and duelInviteWindow: exact challenge expiry is echoed.
import { unwrapLong, type JsonValue } from "./wire.ts";
import type { Ask } from "./ask.ts";
export interface DuelInvitation {
  readonly n: number;
  readonly characterID: number;
  readonly corporationID: number;
  readonly allianceID: number | null;
  readonly expiry: string;
  readonly expired: boolean;
  readonly clockOffsetMs: number;
}
export function duelChallengeOf(args: readonly unknown[]): Omit<DuelInvitation, "n" | "expired" | "clockOffsetMs"> | null {
  if (args.length !== 4) return null;
  const characterID = Number(args[0]), corporationID = Number(args[1]), allianceID = args[2] === null ? null : Number(args[2]), expiry = unwrapLong(args[3]);
  if (!Number.isSafeInteger(characterID) || characterID <= 0 || !Number.isSafeInteger(corporationID) || corporationID <= 0 || allianceID !== null && (!Number.isSafeInteger(allianceID) || allianceID < 0) || expiry === null || expiry <= 0n) return null;
  return { characterID, corporationID, allianceID: allianceID || null, expiry: String(expiry) };
}
export async function startDuelChallenge(act: Ask, characterID: number): Promise<void> {
  await act("crimewatch", "StartDuelChallenge", [characterID]);
}
export async function respondToDuelChallenge(act: Ask, invitation: DuelInvitation, accept: boolean): Promise<void> {
  await act("crimewatch", "RespondToDuelChallenge", [invitation.characterID, { type: "long", value: invitation.expiry } satisfies JsonValue, accept]);
}
