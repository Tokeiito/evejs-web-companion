// A ship's holds as the client's hold tracker knows them (inventorycommon/holdTracker.py, the HUD's cargo button):
// the cargo, and each hold the ship's type has by the attribute DOGMA_SM_HOLD_MAP pairs it with
// (inventorycommon/const.py 3385 to 3420, GetHoldsInType), each with its inventory controller's flag and that flag's
// name (invControllers.GetNameForFlag: inventoryFlagsCommon.inventoryFlagData), and the page's key for the bay
// (inventoryWrites.ts BAY_FLAGS) its read goes by.

import { strDictOrder } from "./py27DictOrder.ts";

export interface ShipHold {
  /** The tracker's name for it (inventorycommon/const.py shipCargoHold and its kin). */
  readonly holdName: string;
  /** The type attribute that says the type has it; null for the cargo, which every ship has. */
  readonly attributeID: number | null;
  /** Its inventory flag, and that flag's name, a label of the client's. */
  readonly flag: number;
  readonly label: string;
  /** The page's key for the bay (BAY_FLAGS), or null where the page reads no such bay. */
  readonly bayKey: string | null;
}

/** shipCargoHold. */
export const CARGO_HOLD: ShipHold = Object.freeze({ holdName: "ShipCargo", attributeID: null, flag: 5, label: "UI/Ship/CargoHold", bayKey: "cargo" });

/**
 * DOGMA_SM_HOLD_MAP in the order its dict iterates (asked of the client's python27.dll, the literal as written), each
 * attribute by its number in the install's dogmaAttributes.
 */
export const SHIP_HOLDS: readonly ShipHold[] = Object.freeze([
  { holdName: "ShipMaintenanceBay", attributeID: 907, flag: 90, label: "UI/Ship/ShipMaintenanceBay", bayKey: "shipMaintenance" },
  { holdName: "ShipFuelBay", attributeID: 1549, flag: 133, label: "UI/Ship/FuelBay", bayKey: "fuel" },
  { holdName: "ShipMediumShipHold", attributeID: 1562, flag: 140, label: "UI/Ship/MediumShipHold", bayKey: "mediumShip" },
  { holdName: "ShipExpeditionHold", attributeID: 5944, flag: 188, label: "UI/Ship/ExpeditionHold", bayKey: "expedition" },
  { holdName: "ShipCommandCenterHold", attributeID: 1646, flag: 148, label: "UI/Ship/CommandCenterHold", bayKey: "commandCenter" },
  { holdName: "ShipBoosterHold", attributeID: 2657, flag: 176, label: "UI/Ship/BoosterBay", bayKey: "booster" },
  { holdName: "ShipMineralHold", attributeID: 1558, flag: 136, label: "UI/Ship/MineralHold", bayKey: "mineral" },
  { holdName: "ShipCorpseHold", attributeID: 2467, flag: 174, label: "UI/Ship/CorpseBay", bayKey: "corpse" },
  { holdName: "ShipFighterBay", attributeID: 2055, flag: 158, label: "UI/Ship/FighterBay", bayKey: "fighter" },
  { holdName: "ShipGeneralMiningHold", attributeID: 1556, flag: 134, label: "UI/Ship/GeneralMiningHold", bayKey: "ore" },
  { holdName: "ShipDroneBay", attributeID: 283, flag: 87, label: "UI/Ship/DroneBay", bayKey: "drone" },
  { holdName: "ShipQuafeHold", attributeID: 1804, flag: 154, label: "UI/Ship/QuafeBay", bayKey: "quafe" },
  { holdName: "ShipPlanetaryCommoditiesHold", attributeID: 1653, flag: 149, label: "UI/Ship/PlanetaryCommoditiesHold", bayKey: "planetary" },
  { holdName: "ShipColonyResourcesHold", attributeID: 5646, flag: 185, label: "UI/Ship/InfrastructureHold", bayKey: "colony" },
  { holdName: "ShipIceHold", attributeID: 3136, flag: 181, label: "UI/Ship/IceHold", bayKey: "ice" },
  { holdName: "ShipIndustrialShipHold", attributeID: 1564, flag: 142, label: "UI/Ship/IndustrialShipHold", bayKey: "industrialShip" },
  { holdName: "ShipFrigateEscapeBay", attributeID: 3020, flag: 179, label: "UI/Ship/FrigateEscapeBay", bayKey: null },
  { holdName: "ShipSubsystemHold", attributeID: 2675, flag: 177, label: "UI/Ship/SubsystemBay", bayKey: "subsystem" },
  { holdName: "ShipSmallShipHold", attributeID: 1561, flag: 139, label: "UI/Ship/SmallShipHold", bayKey: "smallShip" },
  { holdName: "ShipShipHold", attributeID: 1560, flag: 138, label: "UI/Ship/ShipHold", bayKey: "ship" },
  { holdName: "ShipMobileDepotHold", attributeID: 5325, flag: 183, label: "UI/Ship/MobileDepotHold", bayKey: "mobileDepot" },
  { holdName: "ShipFleetHangar", attributeID: 911, flag: 155, label: "UI/Ship/FleetHangar", bayKey: "fleet" },
  { holdName: "ShipGasHold", attributeID: 1557, flag: 135, label: "UI/Ship/GasHold", bayKey: "gas" },
  { holdName: "ShipLargeShipHold", attributeID: 1563, flag: 141, label: "UI/Ship/LargeShipHold", bayKey: "largeShip" },
  { holdName: "ShipAsteroidHold", attributeID: 3227, flag: 182, label: "UI/Ship/AsteroidHold", bayKey: "asteroid" },
  { holdName: "ShipAmmoHold", attributeID: 1573, flag: 143, label: "UI/Ship/AmmoHold", bayKey: "ammo" },
  { holdName: "ShipSalvageHold", attributeID: 1559, flag: 137, label: "UI/Ship/SalvageHold", bayKey: "salvage" },
] satisfies ShipHold[]);

/** The type attributes the holds go by. */
export const SHIP_HOLD_ATTRIBUTES: readonly number[] = SHIP_HOLDS.map((hold) => hold.attributeID!);

/**
 * GetHoldsInType (3413 to 3420): the cargo, then each hold whose attribute the type has above nought, in the map's
 * order; and the tracker's dict of them (holdTracker.FetchInventoryControllers: self.holds, set in that order) as it
 * iterates. `attributeValue` is the ship type's value of an attribute, null where it has none.
 */
export function trackedShipHolds(attributeValue: (attributeID: number) => number | null): readonly ShipHold[] {
  const holds = [CARGO_HOLD, ...SHIP_HOLDS.filter((hold) => Boolean(attributeValue(hold.attributeID!)))];
  const byName = new Map(holds.map((hold) => [hold.holdName, hold]));
  return strDictOrder(holds.map((hold) => hold.holdName)).map((name) => byName.get(name)!);
}

/** holdTracker._GetRatioFromCapacity: used over capacity, 0 for a hold of none. */
export function holdRatio(capacity: { readonly capacity: number; readonly used: number }): number {
  return capacity.capacity === 0 ? 0 : capacity.used / capacity.capacity;
}
