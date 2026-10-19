"use strict";

// The kind of electronic warfare a module working on a ship is, as the client's tactical service reads it from an effect
// the state says is playing (michelle.SetState: ScatterEwars, OnEwarOnConnect; tactical.OnEwarOnConnect): a module of a
// ship by its type's default effect (FindEwarTypeFromModuleTypeID: clientDogmaStaticSvc.GetDefaultEffect), an entity
// by its type's effect with the effect's guid (FindEwarTypeOnNpcFromGuid), and that effect's kind as
// dogma.effects.GetEwarTypeByEffectID has it: ECM where it has an electronic chance, a web where it has a propulsion
// chance, else BUFF_SLOTS_BY_EFFECT_ID's slot; none for an effect that is no electronic warfare.

/** inventorycommon/const.py categoryEntity. */
const CATEGORY_ENTITY = 11;

/**
 * dogma/effects/__init__.py BUFF_SLOTS_BY_EFFECT_ID: an effect's slot of the buff bar, by its effectID (dogma/const.py),
 * as buffBarConst names the slot. Generated from the decompiled client.
 */
const EWAR_SLOT_BY_EFFECT_ID = new Map([
  [6849, "warpScrambler"], // effectShipModuleFocusedWarpDisruptionScript
  [6848, "warpScramblerMWD"], // effectShipModuleFocusedWarpScramblingScript
  [1549, "ewTargetPaint"], // effectEwTargetPaint
  [3584, "ewRemoteSensorDamp"], // effectTargetMaxTargetRangeAndScanResolutionBonusHostile
  [3555, "ewTrackingDisrupt"], // effectTargetGunneryMaxRangeAndTrackingSpeedBonusHostile
  [3690, "ewTrackingDisrupt"], // effectTargetGunneryMaxRangeAndTrackingSpeedAndFalloffBonusHostile
  [3697, "ewTrackingDisrupt"], // effectTurretWeaponRangeFalloffTrackingSpeedMultiplyTargetHostile
  [1878, "ewRemoteSensorDamp"], // effectEntitySensorDampen
  [837, "ewRemoteSensorDamp"], // effectSensorBoostTargetedHostile
  [6846, "ewTrackingDisrupt"], // effectNpcEntityTrackingDisruptor
  [6383, "ewGuidanceDisrupt"], // effectGuidanceDisrupt
  [1879, "ewTargetPaint"], // effectEntityTargetPaint
  [39, "warpScrambler"], // effectWarpDisrupt
  [586, "webify"], // effectDecreaseTargetSpeed
  [563, "warpScrambler"], // effectWarpScrambleForEntity
  [575, "webify"], // effectModifyTargetSpeed2
  [3713, "warpScrambler"], // effectConcordWarpScramble
  [3714, "webify"], // effectConcordModifyTargetSpeed
  [5934, "warpScramblerMWD"], // effectWarpScrambleBlockMWDWithNPCEffect
  [3380, "focusedWarpScrambler"], // effectWarpDisruptSphere
  [3250, "ewEnergyVampire"], // effectLeech
  [2303, "ewEnergyNeut"], // effectEnergyDestabilizationNew
  [1872, "ewEnergyNeut"], // effectEntityCapacitorDrain
  [3003, "ewEnergyNeut"], // effectEnergyDestabilizationForStructure
  [6187, "ewEnergyNeut"], // effectEnergyNeutralizerFalloff
  [6197, "ewEnergyVampire"], // effectEnergyNosferatuFalloff
  [2481, "warpScrambler"], // effectWarpScrambleForStructure
  [2480, "webify"], // effectDecreaseTargetSpeedForStructures
  [5768, "warpScrambler"], // effectEssWarpScramble
  [5928, "warpScramblerMWD"], // effectWarpScrambleTargetMWDBlockActivationForEntity
  [1358, "electronic"], // effectEwTestEffectJam
  [1871, "electronic"], // effectEntityTargetJam
  [6437, "electronic"], // effectFighterAbilityECM
  [6434, "ewEnergyNeut"], // effectFighterAbilityEnergyNeutralizer
  [6435, "webify"], // effectFighterAbilityStasisWebifier
  [6436, "warpScrambler"], // effectFighterAbilityWarpDisruption
  [6464, "fighterTackle"], // effectFighterAbilityTackle
  [6422, "ewRemoteSensorDamp"], // effectRemoteSensorDampFalloff
  [6425, "ewTargetPaint"], // effectRemoteTargetPaintFalloff
  [6424, "ewTrackingDisrupt"], // effectShipModuleTrackingDisruptor
  [6426, "webify"], // effectRemoteWebifierFalloff
  [6423, "ewGuidanceDisrupt"], // effectShipModuleGuidanceDisruptor
  [6470, "electronic"], // effectRemoteECMFalloff
  [6695, "electronic"], // effectEntityECMFalloff
  [6218, "electronic"], // effectStructureEwEffectJam
  [6221, "ewTargetPaint"], // effectStructureEwTargetPaint
  [6216, "ewEnergyNeut"], // effectStructureEnergyNeutralizerFalloff
  [6222, "warpScramblerMWD"], // effectStructureWarpScrambleBlockMWDWithNPCEffect
  [6219, "webify"], // effectStructureDecreaseTargetSpeed
  [6217, "ewRemoteSensorDamp"], // effectStructureTargetMaxTargetRangeAndScanResolutionBonusHostile
  [6220, "ewTrackingDisrupt"], // effectStructureTargetGunneryMaxRangeAndTrackingSpeedAndFalloffBonusHostile
  [6682, "webify"], // effectStructureModuleEffectStasisWebifier
  [6683, "ewTargetPaint"], // effectStructureModuleEffectTargetPainter
  [6684, "ewRemoteSensorDamp"], // effectStructureModuleEffectRemoteSensorDampener
  [6685, "electronic"], // effectStructureModuleEffectECM
  [6686, "ewTrackingDisrupt"], // effectStructureModuleEffectWeaponDisruption
  [6691, "ewEnergyNeut"], // effectEntityEnergyNeutralizerFalloff
  [6696, "ewEnergyNeut"], // effectStarbaseEnergyNeutralizerFalloff
  [6693, "ewRemoteSensorDamp"], // effectRemoteSensorDampEntity
  [6692, "ewTargetPaint"], // effectRemoteTargetPaintEntity
  [6694, "ewTrackingDisrupt"], // effectNpcEntityWeaponDisruptor
  [6690, "webify"], // effectRemoteWebifierEntity
  [4560, "remoteTracking"], // effectRemoteTracking
  [31, "energyTransfer"], // effectEnergyTransfer
  [3583, "sensorBooster"], // effectTargetMaxTargetRangeAndScanResolutionBonusAssistance
  [2246, "eccmProjector"], // effectScanStrengthTargetPercentBonus
  [6185, "remoteHullRepair"], // effectShipModuleRemoteHullRepairer
  [592, "remoteArmorRepair"], // effectTargetArmorRepair
  [18, "shieldTransfer"], // effectShieldTransfer
  [6188, "remoteArmorRepair"], // effectShipModuleRemoteArmorRepairer
  [7166, "RemoteArmorMutadaptiveRepairer"], // effectShipModuleRemoteArmorMutadaptiveRepairer
  [6651, "remoteArmorRepair"], // effectShipModuleAncillaryRemoteArmorRepairer
  [6184, "energyTransfer"], // effectShipModuleRemoteCapacitorTransmitter
  [6186, "shieldTransfer"], // effectShipModuleRemoteShieldBooster
  [6652, "shieldTransfer"], // effectShipModuleAncillaryRemoteShieldBooster
  [6427, "sensorBooster"], // effectRemoteSensorBoostFalloff
  [6428, "remoteTracking"], // effectShipModuleRemoteTrackingComputer
  [6471, "eccmProjector"], // effectRemoteECCMFalloff
  [6223, "sensorBooster"], // effectStructureTargetMaxTargetRangeAndScanResolutionBonusAssistance
  [6225, "remoteTracking"], // effectStructureTargetGunneryMaxRangeFalloffTrackingSpeedBonusAssistance
  [6689, "remoteHullRepair"], // effectNpcEntityRemoteHullRepairer
  [6687, "remoteArmorRepair"], // effectNpcEntityRemoteArmorRepairer
  [6688, "shieldTransfer"], // effectNpcEntityRemoteShieldBooster
  [6741, "remoteArmorRepair"], // effectNpcBehaviorRemoteArmorRepairer
  [12073, "energyTransfer"], // effectNpcBehaviorRemoteCapacitorTransmitter
  [6742, "shieldTransfer"], // effectNpcBehaviorRemoteShieldBooster
  [6757, "electronic"], // effectBehaviorECM
  [6756, "ewEnergyNeut"], // effectNpcBehaviorEnergyNeutralizer
  [6882, "ewEnergyVampire"], // effectNpcBehaviorEnergyNosferatu
  [6746, "ewGuidanceDisrupt"], // effectNpcBehaviorGuidanceDisruptor
  [6755, "ewRemoteSensorDamp"], // effectBehaviorSensorDampener
  [6754, "ewTargetPaint"], // effectBehaviorTargetPainter
  [6747, "ewTrackingDisrupt"], // effectNpcBehaviorTrackingDisruptor
  [6744, "warpScrambler"], // effectBehaviorWarpDisrupt
  [6745, "warpScramblerMWD"], // effectBehaviorWarpScramble
  [6743, "webify"], // effectNpcBehaviorWebifier
]);

/**
 * Made with the client's data: `typeDogma(typeID)` a type's dogma row (its dogmaEffects, each with isDefault), or
 * null; `dogmaEffects(effectIDs)` the effects' rows by effectID (dogma/data.py get_effect); `categoryOf(typeID)` a
 * type's category, or null.
 */
function createEwarTypes({ typeDogma, dogmaEffects, categoryOf }) {
  /** GetEwarTypeByEffectID, of an effect's row and its id. */
  function ewarTypeOfEffect(effectID, effect) {
    if (!effect) return null;
    if (effect.electronicChance) return "electronic";
    if (effect.propulsionChance) return "webify";
    return EWAR_SLOT_BY_EFFECT_ID.get(effectID) ?? null;
  }

  /**
   * The slot of a module's electronic warfare, or null. An entity's is its type's effect with this guid (the last of
   * them, where there are more: the client warns of the conflict and takes the last it walks), anything else's its
   * type's default effect.
   */
  async function ewarTypeOf(moduleTypeID, guid) {
    const typeID = Number(moduleTypeID) || 0;
    if (typeID <= 0) return null;
    const row = await typeDogma(typeID);
    const typeEffects = Array.isArray(row && row.dogmaEffects) ? row.dogmaEffects : [];
    if (categoryOf(typeID) === CATEGORY_ENTITY) {
      const effectIDs = typeEffects.map((each) => Number(each && each.effectID) || 0).filter((id) => id > 0);
      const effects = effectIDs.length > 0 ? (await dogmaEffects(effectIDs)) || {} : {};
      let matched = null;
      for (const effectID of effectIDs.sort((a, b) => a - b)) {
        const effect = effects[String(effectID)];
        if (effect && effect.guid === guid) matched = effectID;
      }
      return matched === null ? null : ewarTypeOfEffect(matched, effects[String(matched)]);
    }
    const defaultEffect = typeEffects.find((each) => each && each.isDefault);
    const effectID = Number(defaultEffect && defaultEffect.effectID) || 0;
    if (effectID <= 0) return null;
    const effects = (await dogmaEffects([effectID])) || {};
    return ewarTypeOfEffect(effectID, effects[String(effectID)]);
  }

  return { ewarTypeOf };
}

module.exports = { createEwarTypes, EWAR_SLOT_BY_EFFECT_ID };
