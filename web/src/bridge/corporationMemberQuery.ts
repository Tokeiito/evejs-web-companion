// CorpQueryMembersForm: property/operator constants and ExecuteQuery276-293.
import type { JsonValue } from "./wire.ts";

export const MEMBER_QUERY_LABEL = "UI/Corporations/CorporationWindow/Members/FindMemberInRole/";
export const MEMBER_QUERY_PROPERTIES = [
  ["roles", "Role", "role"], ["rolesAtHQ", "RoleAtHQ", "locational"],
  ["rolesAtBase", "RoleAtBase", "locational"], ["rolesAtOther", "RoleAtOther", "locational"],
  ["grantableRoles", "GrantableRole", "role"], ["grantableRolesAtHQ", "GrantableRoleAtHQ", "locational"],
  ["grantableRolesAtBase", "GrantableRoleAtBase", "locational"], ["grantableRolesAtOther", "GrantableRoleAtOther", "locational"],
  ["baseID", "Base", "base"], ["startDateTime", "StartDate", "date"],
  ["characterID", "Name", "text"], ["titleMask", "Title", "title"],
] as const;
export type MemberQueryProperty = typeof MEMBER_QUERY_PROPERTIES[number][0];
export type MemberQueryControl = typeof MEMBER_QUERY_PROPERTIES[number][2];
export interface MemberQueryCriterion {
  readonly join: 1 | 2 | null;
  readonly property: MemberQueryProperty;
  readonly operator: number;
  readonly value: string | number | bigint | null;
}
export interface CorporationAdministration { readonly visible: boolean; readonly findMembers: boolean; readonly director: boolean }
export interface MemberQueryContext {
  readonly roles: readonly { readonly value: bigint; readonly name: string; readonly locational: boolean }[];
  readonly titles: readonly { readonly titleID: number; readonly titleName: string }[];
  readonly today: readonly [number, number, number];
}
const BIT_OPERATORS = [[7, "RolesInclude"], [8, "RolesNotInclude"]] as const;
const LOCATION_OPERATORS = [[1, "AlgebraicEqualSign"], [6, "AlgebraicNotEqualSign"]] as const;
const DATE_OPERATORS = [[1, "AlgebraicEqualSign"], [2, "AlgebraicGreaterThanSign"], [3, "AlgebraicGreaterThanOrEqualSign"], [4, "AlgebraicLessThanSign"], [5, "AlgebraicLessThanOrEqualSign"], [6, "AlgebraicNotEqualSign"]] as const;
const TEXT_OPERATORS = [[9, "ContainsRelation"], [10, "LikeRelation"], [11, "StartsWithRelation"], [12, "EndsWithRelation"], [13, "IsRelation"]] as const;
export function memberQueryControl(property: MemberQueryProperty): MemberQueryControl {
  return MEMBER_QUERY_PROPERTIES.find(row => row[0] === property)![2];
}
export function memberQueryOperators(property: MemberQueryProperty): readonly (readonly [number, string])[] {
  const control = memberQueryControl(property);
  return control === "base" ? LOCATION_OPERATORS : control === "date" ? DATE_OPERATORS : control === "text" ? TEXT_OPERATORS : BIT_OPERATORS;
}
/** Native lists, Python 2.7 int/long role masks and edit Unicode; no trimming. */
export function memberQueryArguments(criteria: readonly MemberQueryCriterion[], includeImplied: boolean, searchTitles: boolean): JsonValue[] {
  return [{ type: "list", items: criteria.map(row => {
    // Original iter_roles + installed corporationRolesLoader: pow(2, bit)
    // stays int through bit30, becomes long at31. Dates are always PyLong.
    const value: JsonValue = typeof row.value === "bigint" ? row.property !== "startDateTime" && row.value >= -2147483648n && row.value <= 2147483647n ? Number(row.value) : { type: "long", value: String(row.value) }
      : typeof row.value === "string" ? { type: "wstring", value: row.value } : row.value;
    return { type: "list", items: [...(row.join === null ? [] : [row.join]), row.property, row.operator, value] };
  }) }, includeImplied, searchTitles];
}
/** DatePicker.GetValue142-153; blue BlueOS.cpp1579-1607/core CcpTime.cpp55: UTC midnight FILETIME. */
export function memberQueryDate(year: number, month: number, day: number): bigint {
  return BigInt(Date.UTC(year, month - 1, day)) * 10_000n + 116_444_736_000_000_000n;
}
