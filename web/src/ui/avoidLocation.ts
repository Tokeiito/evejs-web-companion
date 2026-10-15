// A location's Avoid and Do Not Avoid, as the client's menu words them (menusvc.py 2030 to 2033): the place by name,
// and its kind by its map item's group (mapSvc.GetItem's typeID: a solar system's, a constellation's, a region's).

import { formatTemplate, plainText } from "../bridge/clientWords.ts";
import type { NameKind } from "../store/names.ts";

export const AVOID_WORDS = Object.freeze({
  avoid: "UI/Inflight/AvoidLocation",
  stopAvoiding: "UI/Inflight/StopAvoidingLocation",
});

/** The type the client's map gives a place (const.typeSolarSystem 5, typeConstellation 4, typeRegion 3); null for another. */
export function mapTypeOf(id: number): number | null {
  if (id >= 30_000_000 && id <= 39_999_999) return 5;
  if (id >= 20_000_000 && id <= 29_999_999) return 4;
  if (id >= 10_000_000 && id <= 19_999_999) return 3;
  return null;
}

/** The name kind a map place is named by in the page's cache. */
export function mapNameKind(id: number): "system" | "constellation" | "region" {
  const type = mapTypeOf(id);
  return type === 4 ? "constellation" : type === 3 ? "region" : "system";
}

/**
 * The menu entry's words: Avoid for a place not on the list, Do Not Avoid for one on it; the client's where its text
 * is to hand, this page's own where not.
 */
export function avoidEntryWords(
  avoided: boolean,
  id: number,
  templates: Readonly<Record<string, unknown>>,
  nameOf: (kind: NameKind, id: number) => string,
): string {
  const type = mapTypeOf(id);
  const locationType = type === null ? "" : nameOf("typeGroup", type);
  const template = templates[avoided ? AVOID_WORDS.stopAvoiding : AVOID_WORDS.avoid];
  if (typeof template === "string") return plainText(formatTemplate(template, { theLocation: id, locationType }, { nameOf }));
  const name = nameOf(mapNameKind(id), id);
  return avoided ? `Stop avoiding ${name} (${locationType})` : `Avoid ${name} (${locationType})`;
}
