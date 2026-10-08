"use strict";

// The sim clock: the client's own count of game time.
//
// The retail client keeps two clocks. The real clock is the wall's. The sim
// clock is the one the game runs by: the ballpark steps once a second of it,
// a module's cycle and a rack's heat are measured in it, and under time
// dilation it runs slow. Both live in the client's engine, CCP's `blue`; this
// is the sim clock ported from its open source (C:\...\blue, MIT):
//
//   blue/src/BlueOS.cpp   the clock's first values (250-282), a frame's
//                         update of it (556-602), EnableSimDilation (1616),
//                         EvaluateTimeDilation (1869-1962)
//
// A clock in blue is in one of three states:
//
//   locked    the sim clock is the real clock. Every client starts so.
//   dynamic   the clock sets its own pace between two bounds, and goes from
//             one pace to another by an event two real seconds ahead, so that
//             whoever follows it can change pace at the same moment. A CCP
//             server's clock is so; a client's is after EnableSimDilation.
//   following the clock follows a master's events, sent over CCP's own
//             network layer. NOT PORTED: nothing on the game port sends them.
//
// Times are milliseconds, as numbers. blue keeps 100 ns counts; nothing here
// needs finer than a number holds.

/** How far ahead, in real time, a change of pace is set (BlueOS.cpp 1952). */
const DILATION_EVENT_LEAD_MS = 2000;

class SimClock {
  /** A clock as blue makes one, at the real time `realTime`: locked to the real clock (BlueOS.cpp 250-282). */
  constructor(realTime) {
    this.realTime = realTime;
    this.simTime = realTime;
    /** The pace of the sim clock: sim seconds to a real second. */
    this.simDilation = 1.0;
    /** blue.os.desiredSimDilation: the pace the clock is meant to hold, which is what the client shows a pilot. */
    this.desiredSimDilation = 1.0;
    this.syncBaseRealTime = realTime;
    this.syncBaseSimTime = realTime;
    this.dynamic = false;
    this.locked = true;
    this.lastOverloadedTime = realTime;
    this.lastUnderloadedTime = realTime;
    this.minSimDilation = 0.1;
    this.maxSimDilation = 1;
    this.dilationOverloadThreshold = 10_000;
    this.dilationUnderloadThreshold = 2_000;
    this.dilationOverloadAdjustment = 0.8254;
    this.dilationUnderloadAdjustment = 1.059254;
    /** Changes of pace set and not yet come: { factor, realTime, simTime }, soonest first. */
    this.pending = [];
    /**
     * Whether the frame just run left work undone. blue reads its scheduler
     * for this (tasklets still queued after the tick); a clock here keeps up
     * unless told otherwise.
     */
    this.overloaded = () => false;
  }

  /** blue.os.EnableSimDilation (BlueOS.cpp 1616): from now on the clock sets its own pace. */
  enableSimDilation(simClockOffset = 0) {
    this.locked = false;
    if (!this.dynamic) {
      this.simTime += simClockOffset;
      this.syncBaseSimTime += simClockOffset;
    }
    this.dynamic = true;
  }

  /**
   * One frame at the real time `realTime`: the clock is brought up to it
   * (BlueOS.cpp 556-602), then decides whether its pace should change
   * (EvaluateTimeDilation). Returns the sim time. A frame at a time already
   * past does not move the clock; it still judges the pace, so that bounds
   * just changed are acted on.
   */
  frame(realTime) {
    if (realTime > this.realTime) {
      this.realTime = realTime;
      if (this.locked) {
        this.simTime = realTime;
      } else {
        while (this.pending.length > 0 && realTime > this.pending[0].realTime) {
          // The event becomes the base the clock counts from.
          const event = this.pending.shift();
          this.simDilation = event.factor;
          this.desiredSimDilation = event.factor;
          this.syncBaseSimTime = event.simTime;
          this.syncBaseRealTime = event.realTime;
        }
        this.simTime = this.syncBaseSimTime + (realTime - this.syncBaseRealTime) * this.simDilation;
      }
    }
    this._evaluateTimeDilation();
    return this.simTime;
  }

  /** BlueOS::EvaluateTimeDilation (1869): hold the pace inside its bounds, and ease it by how well the clock keeps up. */
  _evaluateTimeDilation() {
    if (!this.dynamic) return;
    if (this.overloaded()) this.lastOverloadedTime = this.realTime;
    else this.lastUnderloadedTime = this.realTime;
    // One change at a time: nothing new is decided while one is on its way.
    if (this.pending.length > 0) return;
    let desired = 1;
    let changed = false;
    if (this.simDilation < this.minSimDilation) {
      desired = this.minSimDilation;
      changed = true;
    } else if (this.simDilation > this.maxSimDilation) {
      desired = this.maxSimDilation;
      changed = true;
    } else if (this.lastOverloadedTime > this.lastUnderloadedTime) {
      // Behind for a while: slow down, unless already as slow as allowed.
      if (this.simDilation > this.minSimDilation && this.realTime - this.lastUnderloadedTime > this.dilationOverloadThreshold) {
        desired = Math.max(this.minSimDilation, this.simDilation * this.dilationOverloadAdjustment);
        changed = true;
      }
    } else if (this.simDilation < this.maxSimDilation && this.realTime - this.lastOverloadedTime > this.dilationUnderloadThreshold) {
      // Keeping up for a while: speed up.
      desired = Math.min(this.maxSimDilation, this.simDilation * this.dilationUnderloadAdjustment);
      changed = true;
    }
    if (!changed) return;
    this.pending.push({ factor: desired, realTime: this.realTime + DILATION_EVENT_LEAD_MS, simTime: this.simTime + DILATION_EVENT_LEAD_MS * this.simDilation });
    // A full spell at the new pace before it is judged again.
    this.lastOverloadedTime = this.realTime;
    this.lastUnderloadedTime = this.realTime;
  }
}

module.exports = { DILATION_EVENT_LEAD_MS, SimClock };
