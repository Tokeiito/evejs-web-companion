// A pushed session change (OnSessionChanged), for the windows that listen for one.
//
// Both transports push it as { kind: "sessionchange", method: "OnSessionChanged", args: [change] },
// where `change` has an entry for each session variable that changed: its name, and the old value and
// the new. The retail client hands the same dict to every window's OnSessionChanged(isRemote, sess,
// change), and most of them only ask which names are in it.

import { readDictPairs } from "./wire.ts";

/** The names of the session variables that changed, or null if the notification is not a session change. */
export function sessionChangeNames(method: string | null, args: readonly unknown[]): readonly string[] | null {
  if (method !== "OnSessionChanged") {
    return null;
  }
  const change = args[0];
  if (change === null || typeof change !== "object") {
    return [];
  }
  // A dict as the wire spells one, or the plain object both transports send today.
  if ((change as { type?: unknown }).type === "dict") {
    return readDictPairs(change).map(([name]) => name).filter((name): name is string => typeof name === "string");
  }
  return Array.isArray(change) ? [] : Object.keys(change);
}
