// An access list's name as the client shows it: in the folder window's combos (bookmarkContainerWindow.py 36 to 38)
// and in an access list's link (ownergroups/client/link.py get_access_group_name, 62 to 66). An NPC corporation's list
// goes by the corporation's name; a list the system made by its label (accessGroupsController.py
// FixGroupLabelsForSystemGroups, 115 to 121); any other by its own name.

import type { AccessGroup } from "../bridge/bookmarks.ts";

/** idCheckers.IsNPCCorporation: a corporation's number among the NPC corporations'. */
export const isNpcCorporation = (id: number | null): id is number => id !== null && id >= 1_000_000 && id < 2_000_000;

/** invConst.ownerSystem: a list the system made, named by a label. */
const OWNER_SYSTEM = 1;
const SYSTEM_LABEL = "UI/AclBookmarks/";

/** The label a system list is named by, where it is one: for the page's words to fetch. */
export function accessGroupLabel(group: AccessGroup): string | null {
  return group.creatorID === OWNER_SYSTEM && group.name.startsWith(SYSTEM_LABEL) ? group.name : null;
}

/** The list's name: `ownerName` names an owner, `label` reads a label. */
export function accessGroupName(group: AccessGroup, ownerName: (id: number) => string, label: (path: string) => string): string {
  if (isNpcCorporation(group.creatorID)) return ownerName(group.creatorID);
  const path = accessGroupLabel(group);
  return path !== null ? label(path) : group.name;
}
