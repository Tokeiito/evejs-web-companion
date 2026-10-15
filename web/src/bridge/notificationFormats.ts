// A notification's subject, worded as the retail client words it (item 81, its second part).
//
// The client formats a notification by the formatter its type has, else by notificationUtil's table
// (notificationSvc.py FormatNotifications, 164 to 187). Both are its code: the BFF reads them by running that code
// in the client's own Python (GET /api/client-data/notification-formats; scripts/client-notification-formats.py),
// for each type
//
//   table       the subject's and the body's label, and the name of the function that adds to the data, or the
//               name of the function that words the notification whole (notificationUtil.Format, 1506 to 1542:
//               GetByLabel(subject, **data), the data given notification_senderID, _receiverID and _created);
//   formatters  the formatter's name, and the labels its class is made with (notificationFormatMapping.py).
//
// The page words a subject only where it can be sure of it: by the table, where the subject's words ask for nothing
// the notification's data and those three do not hold (a function that adds to the data adds what they lack); by a
// formatter, where its subject's words ask for nothing at all (what its Format puts in is not known here); and the
// contacts' by their own formatters (contactNotifications.ts). Anything else is null, and the page says it its own way.

import { formatTemplate, parseTemplate, plainText, type FormatContext, type TemplateArguments } from "./clientWords.ts";
import { CONTACT_NOTIFICATION_TYPE, formatContactNotification } from "./contactNotifications.ts";
import type { Notification } from "./notifications.ts";
import { readDictPairs, type JsonValue } from "./wire.ts";

export interface NotificationTableEntry {
  readonly subject: string | null;
  readonly body: string | null;
  /** The function that adds to the data, by its name; null where there is none. */
  readonly parameters: string | null;
  /** The function that words the notification whole, by its name; null where the labels do. */
  readonly function: string | null;
}

export interface NotificationFormatter {
  readonly name: string | null;
  readonly subject: string | null;
  readonly body: string | null;
}

/** The client's notification formats, by type (the BFF's answer). */
export interface NotificationFormats {
  readonly table: Readonly<Record<string, NotificationTableEntry>>;
  readonly formatters: Readonly<Record<string, NotificationFormatter>>;
}

const textOrNull = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

/** The BFF's answer as the formats, or null for anything that is not them. */
export function decodeNotificationFormats(value: unknown): NotificationFormats | null {
  if (typeof value !== "object" || value === null) return null;
  const held = value as { table?: unknown; formatters?: unknown };
  const isTable = (each: unknown): each is Record<string, unknown> => typeof each === "object" && each !== null && !Array.isArray(each);
  if (!isTable(held.table) || !isTable(held.formatters)) return null;
  const table: Record<string, NotificationTableEntry> = {};
  for (const [key, entry] of Object.entries(held.table)) {
    if (!isTable(entry)) continue;
    table[key] = { subject: textOrNull(entry.subject), body: textOrNull(entry.body), parameters: textOrNull(entry.parameters), function: textOrNull(entry.function) };
  }
  const formatters: Record<string, NotificationFormatter> = {};
  for (const [key, entry] of Object.entries(held.formatters)) {
    if (!isTable(entry)) continue;
    formatters[key] = { name: textOrNull(entry.name), subject: textOrNull(entry.subject), body: textOrNull(entry.body) };
  }
  return { table, formatters };
}

/** A notification's data as arguments by name, where it is a dict; none where it is not (a YAML text not read here). */
function dataArguments(data: JsonValue | null): Record<string, JsonValue> {
  if (data === null || typeof data !== "object" || Array.isArray(data) || (data as { type?: unknown }).type !== "dict") return {};
  const keyOf = (key: unknown): string => (typeof key === "string" ? key : key && typeof key === "object" && "value" in key ? String((key as { value: unknown }).value) : String(key));
  return Object.fromEntries(readDictPairs(data).map(([key, value]) => [keyOf(key), value]));
}

/** What notificationUtil.Format gives GetByLabel: the data, and the notification's sender, receiver and making. */
export function notificationArguments(notification: Notification): TemplateArguments {
  return {
    ...dataArguments(notification.data),
    notification_senderID: notification.senderID,
    notification_receiverID: notification.receiverID,
    notification_created: notification.created === null ? null : { type: "long", value: notification.created.toString() },
  };
}

/** The label of a notification's subject the page can word, and the arguments it is worded with; null where it cannot be sure. */
export function notificationSubjectLabel(notification: Notification, formats: NotificationFormats, templates: Readonly<Record<string, string | null | undefined>>): { readonly label: string; readonly args: TemplateArguments } | null {
  const key = String(notification.typeID);
  const formatter = formats.formatters[key];
  const entry = formats.table[key];
  const label = formatter !== undefined ? formatter.subject : entry !== undefined && entry.function === null ? entry.subject : null;
  if (label === null) return null;
  const template = templates[label];
  if (typeof template !== "string") return { label, args: {} };
  const asked = parseTemplate(template).flatMap((part) => (typeof part === "string" ? [] : [part.name]));
  const args = notificationArguments(notification);
  if (formatter !== undefined ? asked.length > 0 : asked.some((name) => !(name in args) || args[name] === undefined)) return null;
  return { label, args };
}

/**
 * A notification's subject as the client words it (FormatNotifications), or null where the page cannot be sure of
 * it. `templates` are the install's words by label; a label whose words are not to hand yet gives null.
 */
export function notificationSubject(notification: Notification, formats: NotificationFormats, templates: Readonly<Record<string, string | null | undefined>>, nameOf: FormatContext["nameOf"]): string | null {
  if (notification.typeID === CONTACT_NOTIFICATION_TYPE.add || notification.typeID === CONTACT_NOTIFICATION_TYPE.edit || notification.typeID === CONTACT_NOTIFICATION_TYPE.buddyAdd) {
    const formatted = formatContactNotification(notification, templates, nameOf);
    return formatted === null ? null : plainText(formatted.subject);
  }
  const found = notificationSubjectLabel(notification, formats, templates);
  if (found === null) return null;
  const template = templates[found.label];
  if (typeof template !== "string") return null;
  return plainText(formatTemplate(template, found.args, { nameOf }));
}
