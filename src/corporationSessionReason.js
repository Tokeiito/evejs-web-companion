"use strict";

// eveSessions.GetReason170-285, with newReason='corp.kickself'. Keep label
// arguments typed so the installed client data renders the nested reason.
function corporationSessionReason(oldReason, timeLeftMs) {
  const label = (name, entries = []) => [101, `UI/Sessions/${name}`, { type: "dict", entries }];
  const timed = (name, timeName) => {
    const reason = label(name);
    return timeLeftMs > 0 ? label(timeName, [["reason", reason], ["seconds", Math.ceil(Math.max(0.0001, timeLeftMs) / 1000)]]) : reason;
  };
  if (oldReason.startsWith("corp.")) return timed("CorpOperation", "EstimatedTimeLeft");
  const names = {
    autopilot: ["Autopilot", "AutopilotEstimatedTime"], undock: ["AreUndocking", "AreUndockingEstimatedTime"],
    dock: ["AreDocking", "AreDockingEstimmatedTime"], jump: ["AreJumping", "AreJumpingEstimatedTime"],
    eject: ["AreEjecting", "AreEjectingEstimatedTime"], evacuate: ["AreEvacuating", "AreEvacuatingEstimatedTime"],
    board: ["AreBoarding", "AreBoardingEstimatedTime"], selfdestruct: ["AreSelfDestructing", "AreSelfDestructiongEstimateTime"],
    charsel: ["AreSelectingCharacter", "AreSelectingCharacterEstimatedTime"], accelerationgate: ["AreUsingAccelerationGate", "AreUsingAccelerationGateEstimatedTime"],
    storeVessel: ["AreBoardingVessel", "AreBoardingVesselEstimatedTime"],
  };
  if (oldReason.startsWith("fleet.")) return timed("FleetOperations", "FleetOperationsEstimatedTime");
  if (oldReason === "bookmarking") return label("Bookmarking");
  const pair = Object.hasOwn(names, oldReason) ? names[oldReason] : null;
  return pair ? timed(...pair) : label("BaseReason");
}

function corporationSessionRefusal(held, now) {
  return { ok: false, error: "CALL_REFUSED", message: "PerformSessionChangeInProgress",
    refusal: { key: "PerformSessionChangeInProgress", values: { type: "dict", entries: [["reason", corporationSessionReason(held.nativeSessionChangeReason || "", Math.max(0, Number(held.cooldownUntilMs || 0) - now))]] } } };
}
module.exports = { corporationSessionReason, corporationSessionRefusal };
