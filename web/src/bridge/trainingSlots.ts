// Whether every training slot of the account is in use, reckoned by the page
// itself as the client's queue service reckons it (the plan's Phase 6b).
//
// The client asks this before it commits a change of the queue: with every slot
// used by the account's other characters the change is saved unstarted, and
// otherwise started (skillQueueSvc.OnClientQueueModified, 389, which reads
// IsAllCharacterTrainingSlotsUsed, 859). bridge/skillWrites.ts makes the save.
//
// THE READS, as the client makes them:
//
//   userSvc.GetMultiCharactersTrainingSlots()    skillQueueSvc.py 851: by the service's name, with nothing. A
//                                                dict with an entry for each extra slot the account has.
//                                                Recorded on Tranquility at every login, answering {}.
//   charUnboundMgr.GetCharacterSelectionData()   ccSvc.py 41: the selection screen's data, which the client
//                                                keeps from the choosing. On the game port the transport keeps
//                                                it likewise and answers this from it (src/gamePort/pilots.js).
//
// THE RECKONING. The account has one slot, and one more for each entry the first
// read answers. A slot is in use for each OTHER character of the account whose
// row in the selection data names a skill in training. Every slot is used when
// the two counts are equal.
//
// KEPT, as the service keeps it: reckoned when first wanted, and let go when
// the server says the account's training changed
// (OnMultipleCharactersTrainingUpdated), which it says after every save of a
// queue. The selection data is as old as the choosing, in the client as here:
// a character that began training since is not counted.
//
// THROUGH THE WEB GATEWAY the first read is not carried: its list has nothing
// of the user service's. Then nothing can be reckoned, and this says so.

import { failureCode, type Ask } from "./ask.ts";
import { isListValue, readKeyVal, type JsonValue } from "./wire.ts";

/**
 * IsAllCharacterTrainingSlotsUsed, from what the two reads answered: whether every training slot of the account
 * is used by a character other than `characterID`. Null where either answer is not what the client reads.
 */
export function allSlotsUsed(slots: JsonValue, selection: JsonValue, characterID: number): boolean | null {
  const extra = (slots as { type?: unknown; entries?: unknown } | null)?.type === "dict" ? (slots as { entries?: unknown }).entries : null;
  const characters = Array.isArray(selection) ? selection[2] : null;
  if (!Array.isArray(extra) || !isListValue(characters)) return null;
  const training = characters.items.filter((row) => readKeyVal(row, "characterID") !== characterID && (readKeyVal(row, "skillTypeID") ?? null) !== null);
  return training.length === 1 + extra.length;
}

export interface TrainingSlots {
  /**
   * Whether every training slot of the account is used by a character other than this one. Null where the
   * pilot's transport does not carry the reads, or what they answered could not be read. Fails as a read fails.
   */
  allUsed(characterID: number): Promise<boolean | null>;
  /** What was reckoned is let go: the account's training changed, or another character is chosen. */
  forget(): void;
}

/** The queue service's keeping of whether every slot is used, for the pilot `ask` asks for. */
export function createTrainingSlots(ask: Ask): TrainingSlots {
  let kept: boolean | null | undefined;
  // What was let go while it was being reckoned is not kept when it comes.
  let reckonings = 0;
  return {
    async allUsed(characterID) {
      if (kept !== undefined) return kept;
      const mine = reckonings;
      let reckoned: boolean | null;
      try {
        const slots = await ask("userSvc", "GetMultiCharactersTrainingSlots", []);
        reckoned = allSlotsUsed(slots, await ask("charUnboundMgr", "GetCharacterSelectionData", []), characterID);
      } catch (error) {
        if (failureCode(error) !== "CALL_NOT_ALLOWED") throw error;
        reckoned = null;
      }
      if (mine === reckonings) kept = reckoned;
      return reckoned;
    },
    forget() {
      kept = undefined;
      reckonings += 1;
    },
  };
}
