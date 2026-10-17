// The client's skill pictures, by the res: paths it draws them with, as the BFF serves them from the install
// (GET /client-res/ui/texture/...: src/clientData/clientTextures.js).

/** skills/skillConst.py ICON_BY_GROUPID: each skill group's icon, by the group (inventorycommon/const.py). */
const ICON_BY_GROUP_ID: ReadonlyMap<number, string> = new Map([
  [1210, "armor"], [266, "corpMgmt"], [273, "drones"], [272, "electronicSystems"], [1216, "engineering"],
  [255, "gunnery"], [258, "fleetSupport"], [256, "missiles"], [275, "navigation"], [1220, "neuralEnhancement"],
  [1241, "planetMgmt"], [268, "production"], [4734, "skinSequencing"], [1218, "resourceProcessing"], [269, "rigging"],
  [1217, "scanning"], [270, "science"], [1209, "shields"], [278, "social"], [257, "spaceshipCmd"],
  [1545, "structureMgmt"], [1240, "subsystems"], [1213, "targeting"], [274, "trade"],
]);

/** A client texture's address on the BFF, for its res:/UI/Texture/... path. */
export function clientTexture(resPath: string): string {
  return `/client-res/${resPath.replace(/^res:\//i, "").toLowerCase()}`;
}

/** A skill group's icon (ICON_BY_GROUPID.get(groupID)); null for a group the table has none for. */
export function skillGroupIcon(groupID: number | null): string | null {
  const name = groupID === null ? undefined : ICON_BY_GROUP_ID.get(groupID);
  return name === undefined ? null : clientTexture(`res:/UI/Texture/Classes/Skills/skillGroups/${name}.png`);
}

/** The Apply Skill Points row's book mark (applySkillPointsWindow.py 274, 369): not yet, or the level complete. */
export const SKILL_BOOK_NOT_YET = clientTexture("res:/UI/Texture/Classes/Skills/doNotHave.png");
export const SKILL_TRAINING_COMPLETE = clientTexture("res:/UI/Texture/Classes/Skills/skillTrainingComplete.png");
