// The ship's squadrons as the client's ship fighter state holds them (ui/inflight/squadrons/shipFighterState.py
// _UpdateStateForShip): fighterMgr.GetFightersForShip (parklife/fightersSvc.py 99) answers the squadrons in the
// ship's tubes and those of its tubes out in space, each (tubeFlagID, fighterItemID, fighterTypeID, squadronSize), and
// their abilities' states (not read here).

import { FIGHTER_TUBE_FLAGS } from "./dogma/fighters.ts";
import { unwrapLong, type JsonValue } from "./wire.ts";

/** A squadron of the ship's: its tube, its item, its type and how many fighters it has (FighterInTubeTuple). */
export interface ShipSquadron {
  readonly tubeFlagID: number;
  readonly itemID: number;
  readonly typeID: number;
  readonly squadronSize: number;
}

function sequence(value: JsonValue | undefined): readonly JsonValue[] | null {
  if (Array.isArray(value)) return value;
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const { type, items } = value as { readonly type?: unknown; readonly items?: unknown };
    if ((type === "list" || type === "tuple") && Array.isArray(items)) return items as JsonValue[];
  }
  return null;
}

function whole(value: JsonValue | undefined): number | null {
  const read = unwrapLong(value);
  return read === null ? null : Number(read);
}

/** GetFightersForShip's answer: the squadrons in the tubes and in space; null where it is no such answer. */
export function decodeShipFighters(result: JsonValue | undefined): { readonly inTubes: readonly ShipSquadron[]; readonly inSpace: readonly ShipSquadron[] } | null {
  const parts = sequence(result);
  if (!parts || parts.length < 2) return null;
  const rows = (value: JsonValue | undefined): ShipSquadron[] =>
    (sequence(value) ?? []).flatMap((entry) => {
      const fields = sequence(entry);
      if (!fields || fields.length < 4) return [];
      const [tubeFlagID, itemID, typeID, squadronSize] = fields.slice(0, 4).map(whole);
      if (tubeFlagID == null || itemID == null || typeID == null || squadronSize == null) return [];
      return [{ tubeFlagID, itemID, typeID, squadronSize }];
    });
  return { inTubes: rows(parts[0]), inSpace: rows(parts[1]) };
}

/**
 * clientDogmaLocation.GetFightersForTube: each tube's squadron (shipFighterState.GetFightersForTubeID: the one in it,
 * else the one of it in space), in the tubes' order.
 */
export function squadronsByTube(fighters: { readonly inTubes: readonly ShipSquadron[]; readonly inSpace: readonly ShipSquadron[] } | null): ShipSquadron[] {
  if (!fighters) return [];
  return FIGHTER_TUBE_FLAGS.flatMap((flagID) =>
    fighters.inTubes.find((squadron) => squadron.tubeFlagID === flagID) ?? fighters.inSpace.find((squadron) => squadron.tubeFlagID === flagID) ?? [],
  );
}
