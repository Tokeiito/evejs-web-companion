// medalribbonranks.py LayerBase80-207, AddSliders569-725 and
// PostOnClick747-772; the original compiled constants are checked in the loop log.
import { medalGraphicLayer, type MedalLayer, type MedalCreationGraphic } from "./corporationDecorations.ts";

export interface MedalDesignLayer { readonly graphic: string; readonly color: number }
export interface MedalDesign {
  readonly ribbon: readonly MedalDesignLayer[];
  readonly medal: readonly MedalDesignLayer[];
  readonly race: string | null;
  readonly ribbonVisible: readonly boolean[];
  readonly medalVisible: readonly boolean[];
  readonly ribbonSelected: readonly (number | null)[];
  readonly medalSelected: readonly (number | null)[];
  readonly ribbonColoursVisible: readonly boolean[];
}
export interface MedalDesignOption { readonly name: string; readonly graphics: readonly string[] }
export const RIBBON_BASES: readonly MedalDesignOption[] = ["caldari", "minmatar", "gallente", "amarr"].map(race => ({ name: race, graphics: [`${race}.1_1`, `${race}.1_2`] }));
export const RIBBON_SHAPES = ["2_1", "2_2", "2_3", "2_4", "3_1", "3_2", "3_3"] as const;
const families: readonly (readonly [string, number])[] = [["compass", 2], ["imperial", 2], ["pentagon", 1], ["rombus", 1], ["round", 6], ["shield", 1], ["square", 2], ["star", 7]];
function options(family: string, count: number): MedalDesignOption[] {
  return Array.from({ length: count * 4 }, (_, i) => {
    const name = `${family}.${Math.floor(i / 4) + 1}_${i % 4 + 1}`;
    return { name, graphics: [name] };
  });
}
export const MEDAL_BASES: readonly MedalDesignOption[] = families.flatMap(([family, count]) => options(family, count));
export const MEDAL_ELEMENTS: readonly MedalDesignOption[] = options("elements", 33);
// Original compiled ColorSwatch.swatches, not the decompiler's literal slots.
// Installed TriColor GetHSV/SetHSV/AsInt replay preserves every opaque palette
// integer after both native round trips (loop evidence cdx2673).
export const MEDAL_COLOURS = [
  "faf5e1", "ebd492", "cb9133", "825830", "f6e631", "f59122", "d95100", "bf1616",
  "790000", "7f1157", "abc8e2", "598cb9", "375d81", "3b8bd1", "124d8c", "183152",
  "185662", "6e9058", "3f740b", "516324", "384328", "bfb7aa", "625e57", "19191c",
] as const;
export function setMedalDesignColour(design: MedalDesign, row: number, swatch: number): MedalDesign {
  const hex = MEDAL_COLOURS[swatch];
  if (!hex || !Number.isInteger(row) || row < 0 || row > 3) return design;
  const ribbon = [...design.ribbon], id = 4 - row;
  ribbon[id] = { ...ribbon[id]!, color: 0xff000000 | Number.parseInt(hex, 16) };
  return { ...design, ribbon };
}
export function ribbonShapes(race: string | null): readonly MedalDesignOption[] {
  return RIBBON_SHAPES.map(shape => ({ name: `${race ?? "caldari"}.${shape}`, graphics: [`${race ?? "caldari"}.${shape}`] }));
}
export function emptyMedalDesign(): MedalDesign {
  return { ribbon: Array.from({ length: 5 }, (_, i) => ({ graphic: "", color: i === 0 ? -1 : -330271 })),
    medal: Array.from({ length: 4 }, () => ({ graphic: "", color: -1 })), race: null,
    ribbonVisible: [true, false, false, false], medalVisible: [true, false, false, false],
    ribbonSelected: [null, null, null, null], medalSelected: [null, null, null, null], ribbonColoursVisible: [false, false, false, false] };
}
export function selectMedalDesign(design: MedalDesign, part: 1 | 2, row: number, index: number): MedalDesign {
  const choices = part === 1 ? row === 0 ? RIBBON_BASES : ribbonShapes(design.race) : row === 0 ? MEDAL_BASES : MEDAL_ELEMENTS;
  const option = choices[index];
  if (!option || row < 0 || row > 3) return design;
  const layers = [...(part === 1 ? design.ribbon : design.medal)], visible = [...(part === 1 ? design.ribbonVisible : design.medalVisible)];
  const selected = [...(part === 1 ? design.ribbonSelected : design.medalSelected)];
  let race = design.race;
  if (part === 1 && row === 0) {
    race = option.name;
    layers[0] = { ...layers[0]!, graphic: option.graphics[0]! };
    layers[4] = { ...layers[4]!, graphic: option.graphics[1]! };
    if (race !== design.race) {
      for (const id of [1, 2, 3]) layers[id] = { ...layers[id]!, graphic: "" };
      selected.splice(1, 3, null, null, null);
    }
  } else {
    const id = 3 - row;
    layers[part === 1 ? id + 1 : id] = { ...layers[part === 1 ? id + 1 : id]!, graphic: option.graphics[0]! };
  }
  selected[row] = index;
  const coloursVisible = [...design.ribbonColoursVisible];
  if (part === 1) coloursVisible[row] = true;
  if (row < 3) visible[row + 1] = true;
  return part === 1 ? { ...design, ribbon: layers, race, ribbonVisible: visible, ribbonSelected: selected, ribbonColoursVisible: coloursVisible }
    : { ...design, medal: layers, medalVisible: visible, medalSelected: selected };
}
export function resetMedalDesignLayer(design: MedalDesign, part: 1 | 2, row: number): MedalDesign {
  if (row < 1 || row > 3) return design;
  const layers = [...(part === 1 ? design.ribbon : design.medal)], visible = [...(part === 1 ? design.ribbonVisible : design.medalVisible)];
  const id = (part === 1 ? 4 : 3) - row;
  layers[id] = { ...layers[id]!, graphic: "" }; visible[row] = false;
  // Native ResetSlider does not reset its cursor or any following row.
  return part === 1 ? { ...design, ribbon: layers, ribbonVisible: visible } : { ...design, medal: layers, medalVisible: visible };
}
export function medalDesignGraphics(design: MedalDesign): readonly MedalCreationGraphic[] {
  return ([1, 2] as const).flatMap(part => (part === 1 ? design.ribbon : design.medal).filter(layer => layer.graphic).map(layer => [part, layer.graphic, layer.color] as const));
}
export function medalDesignPreview(design: MedalDesign): readonly MedalLayer[] {
  return medalDesignGraphics(design).map(([part, graphic, color]) => medalGraphicLayer(part, graphic, color)).reverse();
}
