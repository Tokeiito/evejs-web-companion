// corp_util.CanEditRole, bco_members.GetMyGrantableRoles and EditMemberDialog's role views.
import { MEMBER_ROLE_FIELDS, memberInteger, type CorporationMember } from "./corporationMemberDetails.ts";
import { readDictPairs, type JsonValue } from "./wire.ts";
import { intDictOrder } from "./py27DictOrder.ts";

export type RoleMasks = CorporationMember["masks"];
export type RoleField = "roles" | "rolesAtHQ" | "rolesAtBase" | "rolesAtOther";
export interface CorporationRoleSpec { readonly nameID: number; readonly descriptionID: number; readonly roleName: string }
export interface CorporationRoleGroupSpec {
  readonly appliesTo: RoleField;
  readonly appliesToGrantable: "grantableRoles" | "grantableRolesAtHQ" | "grantableRolesAtBase" | "grantableRolesAtOther";
  readonly isDivisional: number;
  readonly roleGroupNameID: number;
  readonly roleMask: string | number;
}
export interface CorporationRoleData {
  readonly roles: Readonly<Record<string, CorporationRoleSpec>>;
  readonly groups: Readonly<Record<string, CorporationRoleGroupSpec>>;
  readonly order: readonly number[];
  readonly locationalRoles: readonly string[];
}
export interface CorporationRole extends CorporationRoleSpec { readonly roleID: bigint }
export interface CorporationRoleGroup extends CorporationRoleGroupSpec { readonly groupID: number; readonly roles: readonly CorporationRole[] }
export type GrantMasks = Readonly<Record<RoleField, bigint>>;

export function memberRoleGroups(data: CorporationRoleData, name: (id: number) => string, query: string, take: string): readonly CorporationRoleGroup[] {
  const roles = Object.entries(data.roles).map(([bit, role]) => ({ ...role, roleID: 1n << BigInt(bit) }));
  const cmp = (a: string, b: string) => a.toUpperCase() < b.toUpperCase() ? -1 : a.toUpperCase() > b.toUpperCase() ? 1 : 0;
  return intDictOrder(data.order).map(groupID => {
    const group = data.groups[groupID]!;
    const included = roles.filter(role => (role.roleID & BigInt(group.roleMask)) === role.roleID);
    if (group.isDivisional) {
      const division = (role: CorporationRole) => Number(role.roleName.slice(-1));
      const desc = (role: CorporationRole) => role.roleName.startsWith("roleAccount") ? "" : role.roleName.includes("CanTake") ? take : role.roleName.includes("CanQuery") ? query : "";
      included.sort((a, b) => division(a) - division(b) || cmp(desc(a), desc(b)));
    } else included.sort((a, b) => cmp(name(a.nameID), name(b.nameID)));
    return { ...group, groupID, roles: included };
  });
}

export function memberTitleMasksOf(answer: JsonValue): Map<number, RoleMasks> {
  const indexed = answer && typeof answer === "object" && !Array.isArray(answer) && "dict" in answer && Array.isArray(answer.dict) ? answer.dict as readonly (readonly [JsonValue, JsonValue])[] : readDictPairs(answer);
  return new Map(indexed.map(([key, title]) => [Number(memberInteger(title, "titleID") ?? key), Object.fromEntries(MEMBER_ROLE_FIELDS.map(field => [field, memberInteger(title, field) ?? 0n])) as RoleMasks]));
}

/** bco_titles.OnTitleChanged / bco_base.GetAddRemoveFromChange: amend held rows without another read. */
export function changeMemberTitleMasks(titles: Map<number, RoleMasks>, titleID: number, change: JsonValue): void {
  const entries = readDictPairs(change).flatMap(([key, value]) => {
    const pair = Array.isArray(value) ? value : value && typeof value === "object" && "items" in value && Array.isArray(value.items) ? value.items : [];
    return typeof key === "string" && pair.length === 2 ? [{ key, old: pair[0], value: pair[1] }] : [];
  });
  if (!entries.length) return;
  if (entries.every(entry => entry.value === null)) { titles.delete(titleID); return; }
  if (entries.every(entry => entry.old === null)) titles.set(titleID, Object.fromEntries(MEMBER_ROLE_FIELDS.map(field => [field, 0n])) as RoleMasks);
  const held = titles.get(titleID);
  if (held) titles.set(titleID, { ...held, ...Object.fromEntries(entries.filter(entry => MEMBER_ROLE_FIELDS.some(field => field === entry.key)).map(entry => [entry.key, memberInteger({ [entry.key]: entry.value }, entry.key) ?? 0n])) });
}

export function myGrantableRoles(member: CorporationMember, viewerIsCEO: boolean, viewerIsDirector: boolean, data: CorporationRoleData, titles: ReadonlyMap<number, RoleMasks>): GrantMasks {
  const grants = { roles: 0n, rolesAtHQ: 0n, rolesAtBase: 0n, rolesAtOther: 0n };
  const activeCEO = viewerIsCEO && viewerIsDirector;
  if (activeCEO || (member.masks.roles & 1n) !== 0n) {
    const locational = new Set(data.locationalRoles);
    for (const bit of Object.keys(data.roles)) {
      const id = 1n << BigInt(bit);
      if (locational.has(id.toString())) { grants.rolesAtHQ |= id; grants.rolesAtBase |= id; grants.rolesAtOther |= id; }
      else if (id !== 1n || activeCEO) grants.roles |= id;
    }
  } else if (!viewerIsCEO) {
    const fields = Object.entries(data.groups).map(([, group]) => [group.appliesTo, group.appliesToGrantable] as const);
    for (const [field, grantable] of fields) grants[field] = member.masks[grantable];
    for (const [id, title] of titles) {
      if (!id || (member.titleMask & id) !== id) continue;
      for (const [field, grantable] of fields) grants[field] |= title[grantable];
    }
  }
  return grants;
}

/** Compiled corp_util.CanEditRole; the role grouping chooses the authority domain. */
export function canEditCorporationRole(roleID: bigint, grantable: boolean, targetIsCEO: boolean, targetIsDirector: boolean, viewerIsCEO: boolean, viewerIsDirector: boolean, appliesTo: RoleField, myBaseID: number | null, targetBaseID: number | null, grants: GrantMasks): boolean {
  if (grantable) return roleID !== 1n && viewerIsDirector && !targetIsCEO && !targetIsDirector;
  if (targetIsCEO || (targetIsDirector && !viewerIsCEO) || (targetIsDirector && (roleID & 1n) !== 1n)) return false;
  if (appliesTo === "rolesAtBase") {
    if (viewerIsCEO || (viewerIsDirector && !targetIsDirector)) return true;
    if (myBaseID !== targetBaseID) return false;
  }
  return (grants[appliesTo] & roleID) === roleID;
}

/** CheckBoxChange: Director replaces all direct masks; the target's titleMask is retained until UpdateMember. */
export function changeCorporationRole(masks: RoleMasks, field: typeof MEMBER_ROLE_FIELDS[number], roleID: bigint, checked: boolean): RoleMasks {
  if (field === "roles" && roleID === 1n) return Object.fromEntries(MEMBER_ROLE_FIELDS.map(key => [key, key === "roles" && checked ? 1n : 0n])) as RoleMasks;
  return { ...masks, [field]: checked ? masks[field] | roleID : masks[field] & ~roleID };
}
