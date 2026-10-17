// The client's groups of dogma attributes, as its compare tool (and its info window) heads and orders them
// (packages/dogma/attributes/uiAttributeGroups.py, from the id lists of packages/dogma/attributes/groups.py; their
// grouping by a type's category: uiAttributeGroupUtil.get_attribute_group_ids).
//
// These numbers are what those modules evaluate to: they were run inside the client's own python27.dll, with its own
// dogma/const.py and inventorycommon/const.py, and their tables printed (not copied out of the source by hand). A
// group's list keeps the client's order and the client's repeats (the modifiers' lists name some attributes twice,
// and the compare tool shows such an attribute twice).

/** A group of attributes (uiAttributeGroups.UIAttributeGroup's values). */
export type AttributeGroupID =
  | "accuracy"
  | "ammo_crystals"
  | "armor"
  | "armor_resistance"
  | "capacitor"
  | "charge_fitting"
  | "damage"
  | "drone_fitting"
  | "ewar_offence"
  | "ewar_resistance"
  | "fighter_base"
  | "flight"
  | "inventory"
  | "misc"
  | "missile_flight"
  | "modifiers"
  | "module_charges"
  | "module_fitting"
  | "module_harvest_yield"
  | "module_modifiers"
  | "module_operation"
  | "on_death"
  | "overloading"
  | "probe_scanning"
  | "requirements"
  | "shield"
  | "shield_resistance"
  | "ship_drones"
  | "ship_fighter_facilities"
  | "ship_fitting"
  | "ship_jump_drive_systems"
  | "ship_shared_facilities"
  | "ship_structure"
  | "siege_mode"
  | "structure"
  | "structure_resistance"
  | "targeting"
  | "worth";

/** uiAttributeGroups.attribute_ids_by_attribute_group_id: each group's attributes, in its order. */
export const ATTRIBUTE_IDS_BY_GROUP: Readonly<Record<AttributeGroupID, readonly number[]>> = {
  accuracy: [
    54, 158, 160,
  ],
  ammo_crystals: [
    9, 786, 783, 784,
  ],
  armor: [
    265, 267, 270, 269, 268, 2035,
  ],
  armor_resistance: [
    267, 270, 269, 268,
  ],
  capacitor: [
    482, 55,
  ],
  charge_fitting: [
    128, 137, 602, 603, 2076, 2077, 2078, 785,
  ],
  damage: [
    51, 2182, 64, 114, 118, 117, 116,
  ],
  drone_fitting: [
    1272,
  ],
  ewar_offence: [
    241, 240, 238, 239, 97, 98, 2452, 2451, 2822, 105, 103, 90, 2260,
  ],
  ewar_resistance: [
    552, 2253, 2135, 2116, 2045, 2112, 2115, 2114, 2113, 208, 210, 211, 209,
  ],
  fighter_base: [
    2215, 2426, 2223,
  ],
  flight: [
    37, 1281, 70, 508, 4,
  ],
  inventory: [
    38, 1573, 1557, 3136, 1564, 1563, 1562, 1558, 1556, 3227, 1559, 1560, 1561, 1646, 1653, 2675, 2467, 2657, 5325,
    3020, 161,
  ],
  misc: [],
  missile_flight: [
    37, 281, 2700, 99, 654, 653, 70,
  ],
  modifiers: [
    567, 120, 244, 351, 309, 767, 3124, 317, 67, 216, 349, 517, 847, 782, 3159, 3160, 3161, 204, 20, 103, 566, 565,
    547, 554, 848, 596, 1536, 1130, 3113, 3114, 235, 306, 619, 202, 1190, 2267, 549, 144, 147, 134, 145, 146, 1334,
    780, 434, 1082, 335, 1159, 148, 796, 1131, 84, 895, 896, 1886, 83, 150, 149, 169, 1076, 2746, 1164, 2603, 1270,
    2796, 2797, 1296, 1950, 973, 1909, 1910, 1911, 902, 2754, 846, 1905, 1906, 1907, 2701, 68, 897, 548, 146, 72,
    983, 338, 1978, 1255, 213, 459, 1138, 806, 312, 327, 66, 151, 614, 624, 315, 319, 3109, 2342, 2352, 2353, 3108,
    2253, 2351, 2796, 2734, 2733, 2335, 2336, 2338, 2337, 591, 1619, 292, 293, 294, 39, 828, 310, 313, 424, 435,
    1079, 314, 557, 1160, 308, 1915, 1918, 323, 337, 851, 1376, 1375, 1374, 2665, 2688, 2689, 1034, 2692, 2694, 2695,
    1369, 1368, 2668, 2669, 2671, 2690, 2693, 2666, 2670, 2667, 2744, 2444, 2445, 2448, 717, 2355, 2356, 2357, 984,
    987, 986, 985, 1227, 2402, 2403, 2404, 2405, 1313, 1314, 1315, 1316, 1332, 1327, 2282, 2023, 2024, 2025, 2026,
    2072, 2073, 2074, 2075, 1030, 1029, 1027, 1028, 2434, 2435, 2437, 2438, 2439, 2440, 2442, 2449, 2436, 2441, 2748,
    2277, 2278, 2593, 2594, 2653, 2595, 2707, 2709, 2710, 2708, 2713, 2714,
  ],
  module_charges: [
    604, 605, 606, 609, 610, 128, 56, 1795, 38, 713, 714, 3104,
  ],
  module_fitting: [
    50, 30, 6, 1544, 978, 763, 1153, 1547, 2431, 1380, 1298, 1299, 1300, 1301, 1872, 1879, 1880, 1881, 2065, 2396,
    2476, 2477, 2478, 2479, 2480, 2481, 2482, 2483, 2484, 2485, 1302, 1303, 1304, 1305, 1944, 2103, 2463, 2486, 2487,
    2488, 2758, 5948,
  ],
  module_harvest_yield: [
    77, 3153, 3154, 3160, 3159,
  ],
  module_modifiers: [
    567, 120, 244, 351, 309, 767, 3124, 317, 67, 216, 349, 517, 847, 782, 3159, 3160, 3161, 204, 20, 103, 566, 565,
    547, 554, 848, 596, 1536, 1130, 3113, 3114, 235, 306, 619, 202, 1190, 2267, 549, 144, 147, 134, 145, 146, 1334,
    780, 434, 1082, 335, 1159, 148, 796, 1131, 84, 895, 896, 1886, 83, 150, 149, 169, 1076, 2746, 1164, 2603, 1270,
    2796, 2797, 1296, 1950, 973, 1909, 1910, 1911, 902, 2754, 846, 1905, 1906, 1907, 2701, 68, 897, 548, 146, 72,
    983, 338, 1978, 1255, 213, 459, 1138, 806, 312, 327, 66, 151, 614, 624, 315, 319, 3109, 2342, 2352, 2353, 3108,
    2253, 2351, 2796, 2734, 2733, 2335, 2336, 2338, 2337, 591, 1619, 292, 293, 294, 39, 828, 310, 313, 424, 435,
    1079, 314, 557, 1160, 308, 1915, 1918, 323, 337, 851, 1376, 1375, 1374, 2665, 2688, 2689, 1034, 2692, 2694, 2695,
    1369, 1368, 2668, 2669, 2671, 2690, 2693, 2666, 2670, 2667, 2744, 2444, 2445, 2448, 717, 2355, 2356, 2357, 984,
    987, 986, 985, 1227, 2402, 2403, 2404, 2405, 1313, 1314, 1315, 1316, 1332, 1327, 2282, 2023, 2024, 2025, 2026,
    2072, 2073, 2074, 2075, 1030, 1029, 1027, 1028, 2434, 2435, 2437, 2438, 2439, 2440, 2442, 2449, 2436, 2441, 2748,
    2277, 2278, 2593, 2594, 2653, 2595, 2707, 2709, 2710, 2708, 2713, 2714, 974, 977, 976, 975, 267, 270, 269, 268,
    271, 274, 273, 272, 265, 267, 270, 269, 268, 2035, 263, 479, 271, 274, 273, 272, 2034, 482, 55, 76, 192, 2104,
    564, 154, 283, 1271, 11, 48,
  ],
  module_operation: [
    73, 3115, 2399, 2397, 2400, 2398, 2745, 2535, 6, 669, 2262, 2279, 2281, 2280, 142, 2044, 1014, 143, 560, 3118,
    1045, 2832, 2067, 126, 125, 510, 197, 99, 1839, 5426, 5412, 2259, 2260, 2261, 2263, 2264, 2265, 2427, 2428, 2788,
    653, 654, 3036, 3037, 2608, 3255, 2109, 2110, 2794,
  ],
  on_death: [
    2275, 2276, 2271, 2272, 2273, 2274,
  ],
  overloading: [
    1212, 1223, 1205, 1206, 1225, 1935, 1222, 1937, 1181, 1208, 1226, 1231, 1486, 1936, 1230, 1210, 1213, 1211,
  ],
  probe_scanning: [
    1370, 1371, 1373, 1372, 787, 788, 600, 2697,
  ],
  requirements: [
    5618, 182, 277, 183, 278, 184, 279, 1285, 1286, 1289, 1287, 1290, 1288,
  ],
  shield: [
    263, 479, 271, 274, 273, 272, 2034,
  ],
  shield_resistance: [
    271, 274, 273, 272,
  ],
  ship_drones: [
    283, 1271,
  ],
  ship_fighter_facilities: [
    2055, 2216, 2217, 2218, 2219, 2737, 2738, 2739,
  ],
  ship_fitting: [
    48, 11, 1132, 14, 13, 12, 2056, 102, 101, 1154, 1547,
  ],
  ship_jump_drive_systems: [
    898, 867, 866, 868, 869, 1005, 1001, 1002, 1549, 3131, 3133,
  ],
  ship_shared_facilities: [
    912, 908, 979, 3105,
  ],
  ship_structure: [
    9, 113, 110, 109, 111, 2036,
  ],
  siege_mode: [
    2304, 2305, 2306, 2307, 2821, 2344, 2345, 2346, 2347, 2348, 1471, 2583, 2584, 2585, 2587, 2588, 2586, 2607, 2605,
    2606, 2604,
  ],
  structure: [
    9, 113, 110, 109, 111, 2036,
  ],
  structure_resistance: [
    113, 110, 109, 111,
  ],
  targeting: [
    76, 192, 2104, 564, 154,
  ],
  worth: [
    5617, 422, 633,
  ],
};

/** uiAttributeGroups.name_by_group_id: the label each group is headed by. */
export const GROUP_NAME_LABELS: Readonly<Record<AttributeGroupID, string>> = {
  accuracy: "UI/Common/Accuracy",
  ammo_crystals: "UI/InfoWindow/CrystalDurability",
  armor: "UI/Common/Armor",
  armor_resistance: "UI/Common/Armor",
  capacitor: "UI/Fitting/FittingWindow/Capacitor",
  charge_fitting: "UI/Fitting/FittingWindow/Fitting",
  damage: "UI/Common/Damage",
  drone_fitting: "UI/Fitting/FittingWindow/Fitting",
  ewar_offence: "UI/Inflight/EwarHints/ElectronicWarfare",
  ewar_resistance: "UI/Common/EWarResistances",
  fighter_base: "UI/Common/FighterBase",
  flight: "UI/Common/Flight",
  inventory: "UI/Neocom/InventoryBtn",
  misc: "UI/InfoWindow/Miscellaneous",
  missile_flight: "UI/Common/Flight",
  modifiers: "UI/Common/Modifiers",
  module_charges: "UI/Generic/Charges",
  module_fitting: "UI/Fitting/FittingWindow/Fitting",
  module_harvest_yield: "UI/Ship/HarvestYield",
  module_modifiers: "UI/Common/Modifiers",
  module_operation: "UI/Ship/ModuleOperation",
  on_death: "UI/InfoWindow/OnDeath",
  overloading: "UI/Ship/Overloading",
  probe_scanning: "UI/Agency/ProbeScanning",
  requirements: "UI/InfoWindow/TabNames/Requirements",
  shield: "UI/Common/Shield",
  shield_resistance: "UI/Common/Shield",
  ship_drones: "UI/Drones/Drones",
  ship_fighter_facilities: "UI/InfoWindow/FighterFacilities",
  ship_fitting: "UI/Fitting/FittingWindow/Fitting",
  ship_jump_drive_systems: "UI/InfoWindow/JumpDriveSystems",
  ship_shared_facilities: "UI/InfoWindow/SharedFacilities",
  ship_structure: "UI/Fitting/Structure",
  siege_mode: "UI/Ship/SiegeModeModifiers",
  structure: "UI/Fitting/Structure",
  structure_resistance: "UI/Fitting/Structure",
  targeting: "UI/Ship/TargetAcquisition",
  worth: "UI/Common/Worth",
};

/**
 * uiAttributeGroups' groups for a category, in their order: category_ship_attribute_group_ids and the others (a
 * charge with attributeCrystalVolatilityChance has ammo_crystal_attribute_group_ids).
 */
export const GROUPS_BY_KIND: Readonly<Record<"ship" | "drone" | "fighter" | "charge" | "ammoCrystal" | "module", readonly AttributeGroupID[]>> = {
  ship: ["worth", "requirements", "modifiers", "ship_structure", "armor", "shield", "ewar_resistance", "targeting", "ship_drones", "ship_shared_facilities", "ship_fighter_facilities", "on_death", "ship_jump_drive_systems", "flight", "capacitor", "ship_fitting", "inventory"],
  drone: ["worth", "requirements", "accuracy", "damage", "modifiers", "ship_structure", "armor", "shield", "ewar_resistance", "capacitor", "targeting", "inventory", "on_death", "ship_jump_drive_systems", "flight", "drone_fitting"],
  fighter: ["worth", "requirements", "modifiers", "flight", "fighter_base", "shield", "structure", "targeting", "inventory"],
  charge: ["worth", "requirements", "modifiers", "missile_flight", "probe_scanning", "ewar_offence", "damage", "module_operation", "charge_fitting", "structure", "armor", "shield", "inventory", "misc"],
  ammoCrystal: ["worth", "requirements", "modifiers", "module_operation", "missile_flight", "probe_scanning", "ewar_offence", "damage", "ammo_crystals", "charge_fitting", "structure", "armor", "shield", "inventory", "misc"],
  module: ["worth", "requirements", "accuracy", "damage", "module_modifiers", "siege_mode", "module_operation", "ewar_offence", "module_harvest_yield", "module_charges", "module_fitting", "overloading", "structure", "inventory", "misc"],
};

/** inventorycommon.const.compareCategories: the categories whose types a menu offers to compare (menusvc.py 2347). */
export const COMPARE_CATEGORIES: readonly number[] = [8, 17, 18, 20, 4, 7, 66, 6, 16, 23, 22, 32, 87];

/** groups.can_fit_ship_type_attribute_ids: a module's "can be fitted to" hulls, shown as one (comparableType.py). */
export const CAN_FIT_SHIP_TYPE_ATTRIBUTE_IDS: readonly number[] = [
  1302, 1303, 1304, 1305, 1944, 2103, 2463, 2486, 2487, 2488, 2758, 5948,
];

/** groups.can_fit_ship_group_attribute_ids: a module's "can be fitted to" groups, the first of them shown. */
export const CAN_FIT_SHIP_GROUP_ATTRIBUTE_IDS: readonly number[] = [
  1298, 1299, 1300, 1301, 1872, 1879, 1880, 1881, 2065, 2396, 2476, 2477, 2478, 2479, 2480, 2481, 2482, 2483, 2484,
  2485,
];

/** groups.skill_level_by_required_skill: a required skill's attribute, and the attribute of the level it needs. */
export const SKILL_LEVEL_BY_REQUIRED_SKILL: ReadonlyMap<number, number> = new Map([
  [1285, 1286],
  [1289, 1287],
  [1290, 1288],
  [182, 277],
  [183, 278],
  [184, 279],
]);

/** dogma.const.non_linear_units: the units no best or worst is shown for (comparableAttribute.is_linear). */
export const NON_LINEAR_UNITS: readonly number[] = [119, 143, 116, 115, 137, 142];
