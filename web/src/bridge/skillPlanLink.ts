// A skill plan's link, as the client makes and follows it (eve/client/script/ui/skillPlan/link.py, evelink/link.py):
//
//   the url        format_skill_plan_url: "skillPlan:{skillPlanID}:{ownerID}" — the plan's id as Python writes it (a
//                  certified plan's a whole number, the others' str(uuid.UUID)), the owner's likewise, "None" for none
//                  (a certified plan; a personal plan's is the pilot, a corporation plan's the corporation)
//   the link       evelink.Link (_format_link): <a href="{url}">{name}</a>, as the share button's drag data
//                  (SkillPlanDragData.get_link) puts it into a chat or a mail
//   followed       handle_link (parse_skillPlanID_url): the id a whole number where it reads as one, else a uuid; the
//                  owner a whole number where it reads as one, else none; then OpenSkillPlanWnd

export const SKILL_PLAN_SCHEME = "skillPlan";

/** format_skill_plan_url */
export function skillPlanUrl(skillPlanID: string | number, ownerID: number | null): string {
  return `${SKILL_PLAN_SCHEME}:${skillPlanID}:${ownerID === null ? "None" : ownerID}`;
}

/** skillplan_link: evelink.Link's markup. */
export function skillPlanLinkMarkup(skillPlanID: string | number, name: string, ownerID: number | null): string {
  return `<a href="${skillPlanUrl(skillPlanID, ownerID)}">${name}</a>`;
}

/** Python's int() of a word: a whole number, signs and spaces about it allowed; else null. */
function pythonInt(text: string): number | null {
  const trimmed = text.trim();
  if (!/^[+-]?\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : null;
}

/** uuid.UUID(text): the hex digits of one (braces, "urn:uuid:" and hyphens aside), as str() writes it. */
function pythonUuid(text: string): string | null {
  const hex = text.trim().replace(/^urn:uuid:/i, "").replace(/[{}-]/g, "");
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) return null;
  const lower = hex.toLowerCase();
  return `${lower.slice(0, 8)}-${lower.slice(8, 12)}-${lower.slice(12, 16)}-${lower.slice(16, 20)}-${lower.slice(20)}`;
}

/**
 * parse_skillPlanID_url: the plan's id (a whole number, else a uuid) and its owner (a whole number, else none). Null
 * where the client's own parse would raise (not three parts, or an id neither a number nor a uuid).
 */
export function parseSkillPlanUrl(url: string): { readonly skillPlanID: number | string; readonly ownerID: number | null } | null {
  const parts = url.split(":");
  if (parts.length !== 3 || parts[0] !== SKILL_PLAN_SCHEME) return null;
  const asNumber = pythonInt(parts[1]!);
  const skillPlanID = asNumber !== null ? asNumber : pythonUuid(parts[1]!);
  if (skillPlanID === null) return null;
  return { skillPlanID, ownerID: pythonInt(parts[2]!) };
}

/** The drag data's type the page puts a link in (the client's SkillPlanDragData: get_link). */
export const LINK_DRAG_TYPE = "application/x-evejs-link";
