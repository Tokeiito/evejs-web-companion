// The contacts' notifications, worded as the client words them (item 81, its first part).
//
// The client's notification service formats each notification by the formatter its type has
// (notificationSvc.py FormatNotifications, 164 to 187; notifications/common/formatting/notificationFormatMapping.py),
// else by notificationUtil.Format's table. A contact added (89) or edited (90), and one added through Buddy Connect
// (166), have the contact formatters (notifications/common/formatters/contactFormatters.py): the subject its label,
// the body its label with the sender, the standing given by its word, and the message; Buddy Connect's message the
// client's own words. A formatter that fails gives the client's words for a notification it could not read.
//
// The Contacts tab's Notifications group (contactsForm.py GetScrolllist, contactNotifications) shows each of its
// group's (notificationconst.py groupTypes: 89, 90, 2001, 2002, 166, 251) that is a communication (notificationSvc.py
// GetNotificationsByGroupID, 60 to 73: the sign-on and sign-off are not, notificationconst.py nonCommunicationTypes),
// newest first, each entry the body's first two parts between its line breaks (addressbookService.py GetNotifications,
// 970 to 988).

import { formatTemplate, plainText } from "./clientWords.ts";
import type { NameKind } from "../store/names.ts";
import type { Notification } from "./notifications.ts";
import { readDictPairs, unwrapLong, type JsonValue } from "./wire.ts";

/** notificationconst.py's types of the contacts' group. */
export const CONTACT_NOTIFICATION_TYPE = Object.freeze({ add: 89, edit: 90, signedOn: 2001, signedOff: 2002, buddyAdd: 166, pochvenContract: 251 });
/**
 * notificationconst.py nonCommunicationTypes (974 to 994): the types a group's read leaves out, twenty named and the
 * skill training group's (+ groupTypes[groupSkillTraining]: 1000, 1001, 1002, 1033, 6020, as the client's own code
 * answers when run, scripts/client-notification-formats.py's groups).
 */
const NON_COMMUNICATION_TYPES: ReadonlySet<number> = new Set([1032, 2001, 2002, 1003, 1004, 1005, 1006, 1008, 1007, 141, 140, 1021, 180, 1050, 3001, 179, 1060, 200, 4001, 4002, 1000, 1001, 1002, 1033, 6020]);

/** notificationconst.IsTypeInCommunications (1071 to 1077). */
export const isCommunicationType = (typeID: number): boolean => !NON_COMMUNICATION_TYPES.has(typeID);

/** The words the contact formatters use, by their labels. */
export const CONTACT_NOTIFICATION_LABELS = Object.freeze({
  subjAdd: "Notifications/subjContactAdd",
  bodyAdd: "Notifications/bodyContactAdd",
  subjEdit: "Notifications/subjContactEdit",
  bodyEdit: "Notifications/bodyContactEdit",
  excellent: "Notifications/partRelationshipExcellent",
  good: "Notifications/partRelationshipGood",
  neutral: "Notifications/partRelationshipNeutral",
  bad: "Notifications/partRelationshipBad",
  horrible: "Notifications/partRelationshipHorrible",
  buddyMessage: "UI/PeopleAndPlaces/BuddyConnectConnectedMessage",
  badSubject: "Notifications/subjBadNotificationMessage",
  badBody: "Notifications/bodyBadNotificationMessage",
});

type Templates = Readonly<Record<string, string | null | undefined>>;
type NameOf = (kind: NameKind, id: number) => string;

/** A notification's data as a plain object, where it is a dict; null where it is not (an unread YAML text, or none). */
function dataOf(data: JsonValue | null): Record<string, JsonValue> | null {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
  if ((data as { type?: unknown }).type !== "dict") return null;
  const keyOf = (key: unknown): string => (typeof key === "string" ? key : key && typeof key === "object" && "value" in key ? String((key as { value: unknown }).value) : String(key));
  return Object.fromEntries(readDictPairs(data).map(([key, value]) => [keyOf(key), value]));
}

/** BaseContactFormatter.GetRelationshipName (contactFormatters.py): a standing's word, or the level itself. */
function relationshipName(level: JsonValue | undefined, word: (label: string, own: string) => string): string {
  const value = typeof level === "number" ? level : unwrapLong(level ?? null);
  const number = value === null ? null : Number(value);
  if (number === 10) return word(CONTACT_NOTIFICATION_LABELS.excellent, "Excellent standing");
  if (number === 5) return word(CONTACT_NOTIFICATION_LABELS.good, "Good standing");
  if (number === 0) return word(CONTACT_NOTIFICATION_LABELS.neutral, "Neutral standing");
  if (number === -5) return word(CONTACT_NOTIFICATION_LABELS.bad, "Bad standing");
  if (number === -10) return word(CONTACT_NOTIFICATION_LABELS.horrible, "Terrible standing");
  return number === null ? "None" : String(number);
}

/** A notification formatted: its subject and its body, the body as the client's markup. */
export interface FormattedNotification {
  readonly subject: string;
  readonly body: string;
}

/**
 * The contact formatters' Format (BaseContactFormatter.Format): the subject by its label; the body by its label,
 * with notification_senderID, messageText (the data's message, or Buddy Connect's words) and level. Null for a type
 * that has none of them. Data that is no dict is what the formatter fails on, and gives the client's words for a
 * notification it could not read (FormatNotifications, 174 to 177).
 */
export function formatContactNotification(notification: Notification, templates: Templates, nameOf: NameOf): FormattedNotification | null {
  const labels =
    notification.typeID === CONTACT_NOTIFICATION_TYPE.add || notification.typeID === CONTACT_NOTIFICATION_TYPE.buddyAdd ? [CONTACT_NOTIFICATION_LABELS.subjAdd, CONTACT_NOTIFICATION_LABELS.bodyAdd] as const
    : notification.typeID === CONTACT_NOTIFICATION_TYPE.edit ? [CONTACT_NOTIFICATION_LABELS.subjEdit, CONTACT_NOTIFICATION_LABELS.bodyEdit] as const
    : null;
  if (labels === null) return null;
  const word = (label: string, own: string): string => {
    const template = templates[label];
    return typeof template === "string" ? template : own;
  };
  const data = dataOf(notification.data);
  if (data === null) {
    return {
      subject: word(CONTACT_NOTIFICATION_LABELS.badSubject, "Unreadable notification"),
      body: formatTemplate(word(CONTACT_NOTIFICATION_LABELS.badBody, "Notification {id} could not be read."), { id: notification.notificationID }, { nameOf }),
    };
  }
  const message = data.message;
  const messageText = notification.typeID === CONTACT_NOTIFICATION_TYPE.buddyAdd
    ? word(CONTACT_NOTIFICATION_LABELS.buddyMessage, "Added through Buddy Connect")
    : typeof message === "string" ? message : message && typeof message === "object" && !Array.isArray(message) && "value" in message ? String((message as { value: unknown }).value) : "";
  const isAdd = labels[0] === CONTACT_NOTIFICATION_LABELS.subjAdd;
  return {
    subject: word(labels[0], isAdd ? "Added as a contact" : "Contact standing changed"),
    body: formatTemplate(
      word(labels[1], isAdd ? "{[character]notification_senderID.name} added you with {level}.<br><br>{messageText}" : "{[character]notification_senderID.name} set your standing to {level}.<br><br>{messageText}"),
      { notification_senderID: notification.senderID, messageText, level: relationshipName(data.level, word) },
      { nameOf },
    ),
  };
}

/** addressbookService.GetNotifications (970 to 988): the body's parts between its line breaks, the empty left out; the entry shows the first two. */
export function notificationEntryParts(body: string): { readonly label: string; readonly label2: string; readonly hint: string } {
  const parts = body.split("<br>").filter((part) => part !== "");
  return {
    label: plainText(parts[0] ?? ""),
    label2: plainText(parts[1] ?? ""),
    hint: plainText(body.replace(/<br><br>/g, "<br>")),
  };
}
