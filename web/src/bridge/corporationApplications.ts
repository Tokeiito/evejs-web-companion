// CorpApplicationEntry: keep native rows/text types for the seven-argument write.
import { isListValue, readDictPairs, type JsonValue } from "./wire.ts";
import { memberField, memberInteger } from "./corporationMemberDetails.ts";
export interface CorporationApplication {
  readonly applicationID: number;
  readonly characterID: number;
  readonly corporationID: number;
  readonly status: number;
  readonly date: bigint;
  readonly applicationText: JsonValue;
  readonly displayText: string;
}
export const APPLICATION_STATUS_LABELS: Readonly<Record<number, string>> = {
  0: "ApplicationUnprocessed", 6: "ApplicationStatusInvited", 4: "ApplicationStatusRejected",
  2: "ApplicationStatusAccepted", 3: "ApplicationStatusInvitationRejected", 7: "ApplicationStatusWithdrawn", 8: "ApplicationStatusDirectlyInvited",
};
export const applicationEnded = (status: number): boolean => [2, 3, 4, 7].includes(status);
export const applicationAcceptable = (status: number): boolean => status === 6 || status === 8;
// notificationCenter.GetNotificationAction356-362 (including invitation139).
export const corporationApplicationNotification = (typeID: number): boolean => [139, 18, 17, 142].includes(typeID);
const text = (value: JsonValue | undefined): string => typeof value === "string" ? value : value && typeof value === "object" && "value" in value && typeof value.value === "string" ? value.value : "";
// get_display_text_for_application533-539 uses Python .strip(), not JS trim.
// Measured with the installed python27.dll over every BMP character and byte:
// Unicode includes U+180E/U+0085 and excludes U+FEFF; bytes include 0xA0.
function displayText(value: JsonValue | undefined): string {
  const source = text(value);
  if (value && typeof value === "object" && "type" in value && value.type === "wstring") {
    return source.replace(/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u180e\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u180e\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g, "");
  }
  // The bridge projects native byte strings as UTF-8 text. Strip their bytes
  // before decoding, keeping Unicode and byte-string whitespace distinct.
  const bytes = new TextEncoder().encode(source);
  const space = (byte: number) => byte >= 9 && byte <= 13 || byte === 32 || byte === 160;
  let first = 0, end = bytes.length;
  while (first < end && space(bytes[first]!)) first++;
  while (end > first && space(bytes[end - 1]!)) end--;
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes.subarray(first, end));
}
export function corporationApplicationsOf(answer: JsonValue, old: boolean): readonly CorporationApplication[] {
  if (old ? !isListValue(answer) : !answer || typeof answer !== "object" || Array.isArray(answer) || !("type" in answer) || answer.type !== "dict") throw new Error("Your corporation applications could not be read.");
  const rows = old ? (isListValue(answer) ? answer.items : []) : readDictPairs(answer).flatMap(([, list]) => isListValue(list) ? list.items : []);
  return [...new Set(rows)].flatMap(row => {
    if (row === null || memberField(row, "corporationID") == null) return [];
    const integer = (key: string) => Number(memberInteger(row, key) ?? 0n);
    const applicationText = memberField(row, "applicationText") ?? "";
    const status = integer("status");
    return [{ applicationID: integer("applicationID"), characterID: integer("characterID"), corporationID: integer("corporationID"),
      status, date: memberInteger(row, "applicationDateTime") ?? 0n, applicationText,
      displayText: displayText(status === 4 ? memberField(row, "responseText") : applicationText) }];
  }).sort((a,b) => a.date > b.date ? -1 : a.date < b.date ? 1 : 0);
}
