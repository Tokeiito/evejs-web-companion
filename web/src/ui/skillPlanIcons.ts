// The skill plans' faction and career path pictures, by the res: paths the client draws them with, as the BFF serves
// them from the install (clientTexture).
//
//   skillPlanConst.py ICON_BY_FACTION_ID   the four empires' faction buttons and an opened plan's faction icon
//   careerConst.py ICON_BY_CAREER_ID       a career path button's picture (eveicon resolve(128): the 128px one)
//   careerConst.py CAREERS_32_SIZES        a corporation category button's and an opened plan's career icon
//                                          (resolve(32); the unclassified one for career_path_none)
//   toggleButtonGroupCircular.py           a circular button's stroke, fill and glow (the faction and category ones)
//   careerPathToggleButtonGroup.py         a career path button's backgrounds and its selection
//   skillPlanInfoIcon.py                   the info icon beside a career path's name

import { clientTexture } from "./skillGroupIcons.ts";

/** appConst: factionCaldariState, factionMinmatarRepublic, factionAmarrEmpire, factionGallenteFederation. */
const FACTION_ICON_NAMES: ReadonlyMap<number, string> = new Map([
  [500001, "iconCaldari"], [500002, "iconMinmatar"], [500003, "iconAmarr"], [500004, "iconGallente"],
]);

/** ICON_BY_FACTION_ID[factionID]; null for a faction the table has none for. */
export function factionIcon(factionID: number | null): string | null {
  const name = factionID === null ? undefined : FACTION_ICON_NAMES.get(factionID);
  return name === undefined ? null : clientTexture(`res:/UI/Texture/Classes/SkillPlan/factionButtons/${name}.png`);
}

/** skillPlanConst.py HINT_BY_FACTION_ID: an opened plan's faction tooltip text. */
export const FACTION_HINT_LABELS: ReadonlyMap<number, string> = new Map([
  [500003, "UI/SkillPlan/SkillPlanFactionAmarr"], [500004, "UI/SkillPlan/SkillPlanFactionGallente"],
  [500002, "UI/SkillPlan/SkillPlanFactionMinmatar"], [500001, "UI/SkillPlan/SkillPlanFactionCaldari"],
]);

/** characterdata/careerpathconst.py: none 0, explorer 4, industrialist 5, enforcer 6, soldier of fortune 7. */
const CAREER_ICON_IDS: ReadonlyMap<number, string> = new Map([
  [0, "unclassified"], [4, "explorer"], [5, "industrialist"], [6, "enforcer"], [7, "soldier_of_fortune"],
]);

/**
 * A career path's eveicon at a size the install has (eveicon/icon_data.py resolve: the first of its sizes, 16, 32, 64,
 * 80 and 128, at least as big as asked); null for a career path with none. ICON_BY_CAREER_ID has no unclassified one.
 */
export function careerIcon(careerPathID: number | null, size: 32 | 128): string | null {
  const id = careerPathID === null ? undefined : CAREER_ICON_IDS.get(careerPathID);
  if (id === undefined || (size === 128 && careerPathID === 0)) return null;
  return clientTexture(`res:/UI/Texture/eveicon/career_icons/${id}_${size}px.png`);
}

/** skillPlanConst.py HINT_BY_CAREER_ID: an opened plan's career path tooltip text. */
export const CAREER_HINT_LABELS: ReadonlyMap<number, string> = new Map([
  [6, "UI/SkillPlan/SkillPlanCareerPathEnforcer"], [4, "UI/SkillPlan/SkillPlanCareerPathExplorer"],
  [5, "UI/SkillPlan/SkillPlanCareerPathIndustrial"], [7, "UI/SkillPlan/SkillPlanCareerPathSoldier"],
]);

/** ToggleButtonGroupButtonCircular's stroke (opacity 0.1), fill (selected, half on hover) and glow (selected). */
export const CIRCULAR_BUTTON = Object.freeze({
  stroke: clientTexture("res:/UI/Texture/Classes/SkillPlan/factionButtons/bgStroke.png"),
  fill: clientTexture("res:/UI/Texture/Classes/SkillPlan/factionButtons/bgFill.png"),
  glow: clientTexture("res:/UI/Texture/Classes/SkillPlan/factionButtons/bgGlow.png"),
});

/** CareerPathToggleButtonGroupButton's fixed, glow and hexagon backgrounds and its selection frame. */
export const CAREER_BUTTON = Object.freeze({
  fixed: clientTexture("res:/UI/Texture/classes/skillPlan/careerPathButtons/fixedBG.png"),
  glow: clientTexture("res:/UI/Texture/classes/skillPlan/careerPathButtons/glowBG.png"),
  hexagon: clientTexture("res:/UI/Texture/classes/skillPlan/careerPathButtons/hexagonBG.png"),
  selection: clientTexture("res:/UI/Texture/classes/skillPlan/careerPathButtons/selectionHighlight.png"),
});

/** SkillPlanInfoIcon's texture. */
export const SKILL_PLAN_INFO_ICON = clientTexture("res:/UI/Texture/Classes/SkillPlan/infoIcon.png");
