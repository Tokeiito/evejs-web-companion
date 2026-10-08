"use strict";

// The pilot's scan probes as the retail client knows them.
//
// The client is never handed a list of its probes. Its scan service
// (eve/client/script/parklife/scanSvc.py) keeps one, in a tracker
// (probescanning/probeTracker.py), from what the server tells it as things
// happen:
//
//   OnNewProbe(probe)                           AddProbe: a probe is out. The
//                                               client gives it the range step
//                                               it used last (7 to begin with)
//                                               and that step's range, makes
//                                               its destination where it is,
//                                               and calls it idle.
//   OnRemoveProbe(probeID)                      RemoveProbe
//   OnProbesIdle([probe, ...])                  each is idle, at its destination
//   OnProbeStateChanged(probeID, state)         UpdateProbeState
//   OnSystemScanStarted(start, ms, {id: probe}) SetProbesAsScanning: each is
//                                               scanning, and is where the
//                                               server says
//   OnSystemScanStopped(probeIDs, results, absent)   each is idle again
//   OnScannerInfoRemoved()                      FlushScannerState: none left
//
// and from what it does itself: after asking for a scan its idle probes are
// "moving" (RequestScans -> SetProbesAsMoving), and so are the ones the server
// agreed to recall (RecoverProbes); a probe switched off or on goes between
// idle and inactive (SetProbeActiveState); and where a probe is to go and how
// far it is to look are the client's own to keep (SetProbeDestination,
// SetProbeRangeStep), sent to the server with the next scan. A change of solar system, ship or
// structure empties the list (scanSvc.OnSessionChanged), and so a pilot who
// logs in with probes still out has none here until it reconnects to them
// (ReconnectToLostProbes, after which the server sends OnNewProbe for each).
//
// A probe's range steps are worked out from its type, as the client does
// (GetScanRangeStepsByTypeID): baseScanRange x rangeFactor^i astronomical
// units, for eight steps.
//
// Only the probes are kept here: no formations, no results.

/** probescanning/const.py */
const PROBE_STATE = Object.freeze({ INACTIVE: 0, IDLE: 1, MOVING: 2, WARPING: 3, SCANNING: 4, RETURNING: 5 });
const MAX_PROBES = 8;
const RANGE_STEPS = 8;
const AU = 149597870700.0;
const MAX_PROBE_DIST_FROM_SUN_SQUARED = (AU * 250) ** 2;
/** ProbeTracker.__init__: the range step a new probe is given before the player has chosen one. */
const FIRST_RANGE_STEP = 7;
/** dogma/const.py */
const ATTRIBUTE_BASE_SCAN_RANGE = 1370;
const ATTRIBUTE_RANGE_FACTOR = 1373;

const text = (value) => (Buffer.isBuffer(value) ? value.toString("utf8") : typeof value === "string" ? value : null);
const number = (value) => (typeof value === "bigint" ? Number(value) : typeof value === "number" && Number.isFinite(value) ? value : null);
const items = (value) => (Array.isArray(value) ? value : value && Array.isArray(value.items) ? value.items : []);
/** A util.KeyVal's fields by name. */
const fieldsOf = (value) => {
  const dict = value && value.type === "object" ? value.args : value;
  return new Map((dict && Array.isArray(dict.entries) ? dict.entries : []).map(([name, entry]) => [text(name) ?? name, entry]));
};
/** A point: three numbers, or null. */
const point = (value) => {
  const list = items(value).map(number);
  return list.length >= 3 && list.slice(0, 3).every((each) => each !== null) ? list.slice(0, 3) : null;
};

/** A probe as the server sends one (a util.KeyVal), or null when it has no ID. */
function readProbe(value) {
  const fields = fieldsOf(value);
  const probeID = number(fields.get("probeID"));
  if (probeID === null) return null;
  const pos = point(fields.get("pos")) ?? [0, 0, 0];
  return {
    probeID,
    typeID: number(fields.get("typeID")),
    pos,
    destination: point(fields.get("destination")) ?? pos.slice(),
    scanRange: number(fields.get("scanRange")) ?? 0,
    rangeStep: number(fields.get("rangeStep")) ?? 0,
    state: number(fields.get("state")) ?? PROBE_STATE.IDLE,
    expiry: fields.get("expiry") ?? null,
  };
}

/**
 * `typeAttribute(typeID, attributeID)` gives a type's dogma attribute from the
 * game's static data (godma.GetTypeAttribute), or null.
 */
function createPilotScanner({ typeAttribute = () => null } = {}) {
  /** probeID -> probe, in the order they came. */
  const probes = new Map();
  const stepsByType = new Map();
  let lastRangeStepUsed = FIRST_RANGE_STEP;

  /** GetScanRangeStepsByTypeID: the eight ranges of a probe type, in metres; null when the type's attributes are not known. */
  function rangeSteps(typeID) {
    if (!stepsByType.has(typeID)) {
      const base = Number(typeAttribute(typeID, ATTRIBUTE_BASE_SCAN_RANGE));
      const factor = Number(typeAttribute(typeID, ATTRIBUTE_RANGE_FACTOR));
      stepsByType.set(typeID, Number.isFinite(base) && Number.isFinite(factor) && base > 0 && factor > 0
        ? Array.from({ length: RANGE_STEPS }, (_, index) => base * factor ** index * AU)
        : null);
    }
    return stepsByType.get(typeID);
  }

  /** UpdateProbeState: a probe the tracker does not hold is left alone. */
  function setState(probeID, state) {
    const probe = probes.get(probeID);
    if (!probe) return false;
    probe.state = state;
    return true;
  }

  /** AddProbe. */
  function addProbe(value) {
    const probe = readProbe(value);
    if (!probe) return null;
    const steps = rangeSteps(probe.typeID);
    // With the type's attributes unknown the server's own step and range stand.
    if (steps) {
      probe.rangeStep = lastRangeStepUsed;
      probe.scanRange = steps[lastRangeStepUsed - 1];
    }
    probe.destination = probe.pos.slice();
    probe.state = PROBE_STATE.IDLE;
    probes.set(probe.probeID, probe);
    return probe;
  }

  /** UpdateProbePosition: where the server says it is, pulled in if that is further from the sun than a probe can be. */
  function setPosition(probe, position) {
    const distSq = position[0] ** 2 + position[1] ** 2 + position[2] ** 2;
    let at = position;
    if (distSq > MAX_PROBE_DIST_FROM_SUN_SQUARED) {
      const scale = MAX_PROBE_DIST_FROM_SUN_SQUARED / distSq;
      at = position.map((each) => each * scale);
    }
    probe.pos = at.slice();
    probe.destination = at.slice();
  }

  /** A notification from the session. True when it was the scanner's. */
  function feed(notification) {
    const args = Array.isArray(notification.args) ? notification.args : [];
    switch (notification.method) {
      case "OnNewProbe":
        addProbe(args[0]);
        return true;
      case "OnRemoveProbe":
        probes.delete(number(args[0]));
        return true;
      case "OnProbesIdle":
        for (const each of items(args[0])) {
          const told = readProbe(each);
          const probe = told ? probes.get(told.probeID) : null;
          // The client sets the state, then the destination, and the second fails for a probe it does not
          // hold: nothing after that probe in the list is taken.
          if (!probe) break;
          probe.state = PROBE_STATE.IDLE;
          probe.destination = told.destination.slice();
        }
        return true;
      case "OnProbeStateChanged":
        setState(number(args[0]), number(args[1]) ?? PROBE_STATE.INACTIVE);
        return true;
      case "OnSystemScanStarted": {
        const told = args[2] && Array.isArray(args[2].entries) ? args[2].entries : [];
        for (const [probeID, each] of told) {
          const probe = probes.get(number(probeID));
          if (!probe) continue;
          probe.state = PROBE_STATE.SCANNING;
          const where = point(fieldsOf(each).get("pos"));
          if (where) setPosition(probe, where);
        }
        return true;
      }
      case "OnSystemScanStopped":
        for (const probeID of items(args[0])) setState(number(probeID), PROBE_STATE.IDLE);
        return true;
      case "OnScannerInfoRemoved":
        probes.clear();
        return true;
      default:
        return false;
    }
  }

  const copy = (probe) => ({ ...probe, pos: probe.pos.slice(), destination: probe.destination.slice() });

  return {
    feed,
    /** probeTracker.Refresh: no probes. The range step last used is kept, as the client keeps it. */
    flush() {
      probes.clear();
    },
    /** Every probe held, in the order they came. */
    probes: () => [...probes.values()].map(copy),
    /** GetActiveProbes: the ones that are not inactive. */
    activeProbes: () => [...probes.values()].filter((probe) => probe.state !== PROBE_STATE.INACTIVE).map(copy),
    /** GetProbesForScanning: the idle ones. */
    idleProbes: () => [...probes.values()].filter((probe) => probe.state === PROBE_STATE.IDLE).map(copy),
    /** SetProbesAsMoving, after a scan is asked for; and what RecoverProbes does with the ones the server agreed to recall. */
    moving(probeIDs) {
      for (const probeID of probeIDs) setState(number(probeID), PROBE_STATE.MOVING);
    },
    /** SetProbeActiveState: off takes an idle probe to inactive, on an inactive one to idle; nothing else moves. */
    setActive(probeID, active) {
      const probe = probes.get(number(probeID));
      if (!probe) return;
      if (active && probe.state === PROBE_STATE.INACTIVE) probe.state = PROBE_STATE.IDLE;
      else if (!active && probe.state === PROBE_STATE.IDLE) probe.state = PROBE_STATE.INACTIVE;
    },
    /** SetProbeDestination: where the probe is to go. */
    setDestination(probeID, location) {
      const probe = probes.get(number(probeID));
      const where = point(location);
      if (probe && where) probe.destination = where;
    },
    /** SetProbeRangeStep: one of the eight steps, which is then the step a new probe starts on. */
    setRangeStep(probeID, rangeStep) {
      const step = number(rangeStep);
      const probe = probes.get(number(probeID));
      if (!probe || step === null || !Number.isInteger(step) || step < 1 || step > RANGE_STEPS) return;
      lastRangeStepUsed = step;
      probe.rangeStep = step;
      const steps = rangeSteps(probe.typeID);
      if (steps) probe.scanRange = steps[step - 1];
    },
    /** probeTracker.DestroyProbe, once the server has been asked: an idle or inactive probe is dropped from the list. */
    removed(probeID) {
      const probe = probes.get(number(probeID));
      if (probe && (probe.state === PROBE_STATE.IDLE || probe.state === PROBE_STATE.INACTIVE)) probes.delete(probe.probeID);
    },
    rangeSteps,
  };
}

module.exports = { AU, FIRST_RANGE_STEP, MAX_PROBES, MAX_PROBE_DIST_FROM_SUN_SQUARED, PROBE_STATE, RANGE_STEPS, createPilotScanner, readProbe };
