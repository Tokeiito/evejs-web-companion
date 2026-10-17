// A fitting as text, as the client copies one to the clipboard (shipfitting/exportFittingUtil.py
// GetFittingEFTString; fittingSvc.ExportFittingToClipboard, 1145 to 1148).
//
//   [<ship>, <fitting's name>]
//   the low slots, the medium, the high, the rigs, the subsystems and the service slots, one module a line, each
//   kind followed by an empty line; a slot left empty before a filled one of its kind as "[Empty Low slot]" and the
//   like (an empty subsystem slot as an empty line), and the empty ones after the last filled one left out;
//   then the drones, the cargo and the fighters, "<name> x<quantity>" a line, each followed by an empty line;
//
// the lines joined by CR LF. The names are the types' English ones (GetNameFunc(False): evetypes.GetEnglishName),
// made clean (textImporting.CleanText). The client's copy in another language (isLocalized) is not the page's: its
// names are English.

/** One entry of a fitting's fitData. */
export interface ExportEntry {
  readonly typeID: number;
  readonly flagID: number;
  readonly quantity: number;
}

const FLAG_CARGO = 5;
const FLAG_LO_SLOT0 = 11;
const FLAG_MED_SLOT0 = 19;
const FLAG_HI_SLOT0 = 27;
const FLAG_DRONE_BAY = 87;
const FLAG_RIG_SLOT0 = 92;
const FLAG_SUBSYSTEM_SLOT0 = 125;
const FLAG_FIGHTER_BAY = 158;
const FLAG_SERVICE_SLOT0 = 164;
/** exportFittingUtil.NUM_SLOTS, and inventorycommon/const.py numVisibleSubsystems. */
const NUM_SLOTS = 8;
const NUM_VISIBLE_SUBSYSTEMS = 4;

/** emptySlotDict: what an empty slot of each kind is written as; none for a subsystem's. */
const EMPTY_SLOT: Readonly<Record<number, string>> = {
  [FLAG_LO_SLOT0]: "[Empty Low slot]",
  [FLAG_MED_SLOT0]: "[Empty Med slot]",
  [FLAG_HI_SLOT0]: "[Empty High slot]",
  [FLAG_RIG_SLOT0]: "[Empty Rig slot]",
  [FLAG_SERVICE_SLOT0]: "[Empty Service slot]",
};

/**
 * textImporting.CleanText (__init__.py 65 to 68): the <localized> tags taken out (StripTags with stripOnly) and the
 * important mark, '*'.
 */
export function cleanText(text: string): string {
  return text.split(/<\/localized>|<localized>|<localized .*?>|<localized *=.*?>|<localized\/>/).join("").replace(/\*/g, "");
}

/** GetFittingEFTString(fitting, isLocalized=False): the fitting as the text the client copies. */
export function fittingEftString(
  fitting: { readonly shipTypeID: number; readonly name: string; readonly modules: readonly ExportEntry[] },
  englishName: (typeID: number) => string,
): string {
  const fitData = fitting.modules;
  const cargoItems = fitData.filter((entry) => entry.flagID === FLAG_CARGO);
  const droneItems = fitData.filter((entry) => entry.flagID === FLAG_DRONE_BAY);
  const fighterItems = fitData.filter((entry) => entry.flagID === FLAG_FIGHTER_BAY);
  // {x[1]: x for x in fitData}: the last entry of a flag is the one kept.
  const byFlag = new Map<number, ExportEntry>();
  for (const entry of fitData) byFlag.set(entry.flagID, entry);
  const slotTuples: readonly (readonly [number, number])[] = [
    [NUM_SLOTS, FLAG_LO_SLOT0],
    [NUM_SLOTS, FLAG_MED_SLOT0],
    [NUM_SLOTS, FLAG_HI_SLOT0],
    [NUM_SLOTS, FLAG_RIG_SLOT0],
    [NUM_VISIBLE_SUBSYSTEMS, FLAG_SUBSYSTEM_SLOT0],
    [NUM_SLOTS, FLAG_SERVICE_SLOT0],
  ];
  const lines = [`[${cleanText(englishName(fitting.shipTypeID))}, ${fitting.name}]`];
  for (const [numSlots, firstSlot] of slotTuples) {
    let pending: string[] = [];
    const emptyString = EMPTY_SLOT[firstSlot] ?? "";
    for (let at = 0; at < numSlots; at += 1) {
      const module = byFlag.get(firstSlot + at);
      if (module) {
        lines.push(...pending);
        pending = [];
        lines.push(cleanText(englishName(module.typeID)));
      } else {
        pending.push(emptyString);
      }
    }
    lines.push("");
  }
  for (const location of [droneItems, cargoItems, fighterItems]) {
    for (const entry of location) lines.push(`${cleanText(englishName(entry.typeID))} x${entry.quantity}`);
    lines.push("");
  }
  return lines.join("\r\n");
}
