// The mail window's Communications tab, as the retail client makes it (item 81, its fifth part): its groups, their
// unread counts, and an entry's hint (neocom/notifications.py NotificationForm; notificationSvc.py). The groups
// themselves (each one's label, the group of each type) are the client's code's, read by running it
// (notificationFormats.ts, NotificationGroups).

import { plainText } from "./clientWords.ts";
import type { NotificationGroups } from "./notificationFormats.ts";
import type { Notification } from "./notifications.ts";

/** const.notificationsMaxUpdated (appConst.py 1795): the most notifications one mark or delete may name. */
export const NOTIFICATIONS_MAX_UPDATED = 100;
/** HINTCUTOFF (neocom/notifications.py 27): the characters of a body an entry's hint shows. */
export const HINT_CUTOFF = 100;
/** DELETE_INTERVAL (neocom/notifications.py 28): 0.3 seconds, within which a second Delete key is not heeded. */
export const DELETE_INTERVAL_MS = 300;
/** The reading pane's wait after the selection moves (MsgScrollSelectionChange, 327 to 333: AutoTimer(1000, ...)). */
export const READ_DELAY_MS = 1000;
/** const.ownerSystem, which a sender of -1 is (LoadGroupFromNode, 176 to 177; GetReadingText, 440 to 441). */
export const OWNER_SYSTEM = 1;

/**
 * The left side's groups in order (GetStaticLabelsGroups, 114 to 129): the Unread group first, then every group of
 * groupNamePaths sorted by its words lowercased (SortListOfTuples on StripTags(label).lower()). The Bounties group
 * is left out only where the server's global config hides player bounties (IsPlayerBountyHidden), which EveJS's
 * does not set, so it is shown (its default, globalConfig/const.py 30: '0').
 */
export function notificationGroupOrder(groups: NotificationGroups, labelOf: (groupID: number) => string): readonly number[] {
  const named = [...groups.names.keys()].map((groupID) => [plainText(labelOf(groupID)).toLowerCase(), groupID] as const);
  named.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return [groups.unread, ...named.map(([, groupID]) => groupID)];
}

/**
 * GetAllUnreadCount (notificationSvc.py 124 to 136): the unread notifications counted by their type's group
 * (GetUnreadNotifications, 103 to 122: GetTypeGroup), and all of them for the Unread group.
 */
export function unreadCountsByGroup(unread: readonly Notification[], groups: NotificationGroups): ReadonlyMap<number, number> {
  const counts = new Map<number, number>();
  for (const notification of unread) {
    const groupID = groups.typeGroup.get(notification.typeID);
    if (groupID !== undefined) counts.set(groupID, (counts.get(groupID) ?? 0) + 1);
  }
  counts.set(groups.unread, unread.length);
  return counts;
}

const unescape = (text: string): string => text.replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&").replace(/&AMP;/g, "&").replace(/&GT;/g, ">").replace(/&LT;/g, "<");
const escape = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * eveformat.truncate_text_ignoring_tags (eveformat/tags.py 88 to 108): the markup's tags kept, its text cut at
 * `length` characters (its entities counted as the characters they stand for), and `trail` put after where the
 * count reaches `length`, even where nothing follows.
 */
export function truncateIgnoringTags(markup: string, length: number, trail: string | null): string {
  let result = "";
  let counter = 0;
  let done = false;
  for (const part of markup.split(/(<.*?>)/)) {
    if (part.startsWith("<")) {
      result += part;
      continue;
    }
    if (done) continue;
    for (const letter of unescape(part)) {
      result += escape(letter);
      counter += 1;
      if (counter === length) {
        done = true;
        if (trail) result += trail;
        break;
      }
    }
  }
  return result;
}

/** An entry's hint (LoadGroupFromNode, 189): its body with its line breaks as spaces, cut at HINTCUTOFF with the trail. */
export function notificationHint(body: string, trail: string): string {
  return plainText(truncateIgnoringTags(body.split("<br>").join(" "), HINT_CUTOFF, trail)).trim();
}
