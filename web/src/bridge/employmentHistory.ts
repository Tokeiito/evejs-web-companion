// The character sheet's employment history, as the client's History panel's employment tab makes it.
//
// The tab (charsheet/employmentHistoryPanel.py 21 to 31) asks the info service when it is first shown, and again
// after the session's corporation changes. GetEmploymentHistorySubContent(session.charid) (infosvc.py 2840 to 2881)
// asks the server, in CCP's own spelling,
//
//   sm.RemoteSvc('corporationSvc').GetEmployementRecordAndCharacterTransfers(charID)
//
// and is answered the record of the pilot's corporations and its character transfers. Of each corporation of the
// record, in the order the server gave them (the newest first), it makes a line: the corporation's name, "(Closed)"
// beside it where the row says it was deleted; the date it began; and the date the corporation after it began, the
// one before it in the list, or "to this day" for the first. After it, the days between, at least one: the end less
// the start in the server's clock, divided by a day and rounded down (diff / const.DAY). The transfers, if any,
// follow under their own heading, each by its date, the newest first (GetCharacterTranfersSubContent, 2883 to 2892).
//
// The words are the client's own, read from the player's install by their labels (app/flow.ts requestWords); the
// page's own stand in where there is no install to read.

import { exactInt } from "./boundDogma.ts";
import { isListValue, readRowsetRows, type JsonValue } from "./wire.ts";

/** The tab's words by their labels (infosvc.py 2851 to 2862, 2876, 2887). */
export const EMPLOYMENT_WORD_LABELS = {
  toThisDay: "UI/InfoWindow/InCorpFromAndToThisDay",
  fromTo: "UI/InfoWindow/InCorpFromAndTo",
  closed: "UI/InfoWindow/CorporationClosed",
  days: "UI/Common/NumDays",
  transfers: "UI/InfoWindow/CharacterTransfers",
  transferredOn: "UI/InfoWindow/CharacterTransferredDate",
} as const;

/** One line of the tab: the corporation, the date it began, the next's (null: to this day), and the days between. */
export interface EmploymentLine {
  readonly corporationID: number;
  readonly deleted: boolean;
  /** The start, in the server's clock (100 ns ticks since 1601), as digits. */
  readonly fromDate: string;
  readonly toDate: string | null;
  readonly days: number;
}

/** What the tab shows: its lines, and the transfers' dates, the newest first. */
export interface EmploymentHistory {
  readonly lines: readonly EmploymentLine[];
  readonly transfers: readonly string[];
}

/** const.DAY: a day in the server's clock's ticks. */
const DAY = 864_000_000_000n;

/**
 * The server's answer made into the tab's lines, the days reckoned to `now` (the server's clock, as digits or a
 * bigint). Null where the answer is not the pair of a record and its transfers.
 */
export function employmentHistoryOf(answer: JsonValue | null | undefined, now: bigint): EmploymentHistory | null {
  const pair = Array.isArray(answer) ? answer : isListValue(answer) ? answer.items : null;
  if (pair === null || pair.length < 1) {
    return null;
  }
  const lines: EmploymentLine[] = [];
  let next: string | null = null;
  for (const row of readRowsetRows(pair[0])) {
    const corporationID = typeof row.corporationID === "number" ? row.corporationID : Number(row.corporationID);
    const fromDate = exactInt(row.startDate);
    if (!Number.isSafeInteger(corporationID) || corporationID <= 0 || fromDate === null) {
      continue;
    }
    const end = next === null ? now : BigInt(next);
    const days = Number((end - BigInt(fromDate)) / DAY);
    lines.push({
      corporationID,
      deleted: row.deleted === true || Number(row.deleted) === 1,
      fromDate,
      toDate: next,
      days: Math.max(1, days),
    });
    next = fromDate;
  }
  const transfers = readRowsetRows(pair[1])
    .map((row) => exactInt(row.transferDate))
    .filter((date): date is string => date !== null)
    .sort((left, right) => (BigInt(right) > BigInt(left) ? 1 : BigInt(right) < BigInt(left) ? -1 : 0));
  return { lines, transfers };
}
