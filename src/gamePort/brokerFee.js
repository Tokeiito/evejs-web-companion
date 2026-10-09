"use strict";

// The broker's fee rate at an NPC station, as the retail client works it out.
//
// The client names this rate when it places an order: it is a buy order's ninth
// argument (buyThisTypeWindow.py 701), a sale's fourth for an order that stands
// (sellMulti.py 462), and a field of each item of a sale (sellMulti.py 501).
// The server works the rate out for itself and refuses an order whose named
// rate is not its own (MktBrokersFeeUnexpected2).
//
//   marketsvc.GetBrokersFeeCommissionFromStationID(stationID)            (161)
//     SkillLimits.GetBrokersFeeForLocation                 (skilllimits.py 25)
//         the base, 3 percent, less 0.3 of a percent for each level of
//         Broker Relations the pilot has in effect
//     BrokerFeeProvider.GetAdjustedCommissionPercentage      (brokerFee.py 62)
//         facwarCommon.GetAdjustedFeePercentage: a tenth off for each level
//             the system is upgraded to, where the militias fight over it
//         less 0.0003 for each point of standing the station's owner's
//             faction has to the pilot, and 0.0002 for each point the owner
//             itself has: standingSvc.GetStanding(fromID, session.charid),
//             the standing kept, or none (marketsvc.py 745)
//
// The sums are in the client's order, one operation at a time, so that the
// float is the client's to the last digit: the test holds it to the client's
// own Python.
//
// Not here: a structure, whose base is asked of the server and where no skill
// applies; and the upgrade level itself, which the client asks of the war's
// manager for a system in a warzone. Whoever calls this names the level.

const MARKET_COMMISSION_PERCENTAGE = 3.0;
const BROKER_RELATIONS_SKILL_MODIFIER = 0.3;
const MARKET_FACTION_STANDING_MULTIPLIER = 0.0003;
const MARKET_NPC_CORP_STANDING_MULTIPLIER = 0.0002;

/**
 * The rate, as a fraction: 0.03 is three percent. `brokerRelations` is the level in effect; the two standings
 * are the owner's faction's and the owner's to the pilot; `upgradeLevel` is the system's, nought outside a warzone.
 */
function brokersFeeRate({ brokerRelations, factionToCharStanding, corpToCharStanding, upgradeLevel = 0 }) {
  let rate = MARKET_COMMISSION_PERCENTAGE / 100.0;
  rate -= (brokerRelations * BROKER_RELATIONS_SKILL_MODIFIER) / 100;
  // "if not feePercentageAtLocation: return 0.0"
  if (!rate) return 0.0;
  rate *= 1 - 0.1 * upgradeLevel;
  return rate - factionToCharStanding * MARKET_FACTION_STANDING_MULTIPLIER - corpToCharStanding * MARKET_NPC_CORP_STANDING_MULTIPLIER;
}

module.exports = { brokersFeeRate };
