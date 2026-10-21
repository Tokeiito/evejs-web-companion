"use strict";

const { clientBlueWallclockPrimitives } = require("./clientBlueWallclock");

/** Real selected default-inactive timer, on the installed Python heap. Source:
 * blue TaskletTimer.cpp/.h; shipped differences audited at 0x1803208b0,
 * 0x180320e40,0x180321460,0x180322610; original blueTaskletImplementation.
 * Shares this client's raw Windows QPC and configured output registry. Reset
 * samples real thread/process CPU and UTC. Explicit timesliceReset is a local
 * owner lifecycle operation; there is no Blue pump, scheduler, active frame
 * accounting, telemetry or engine/ServiceManager readiness here.
 */
async function createClientTaskletTimer({ provider, clock, log }) {
  if (!provider || typeof provider.ready !== "function") throw new TypeError("An installed client runtime provider is required.");
  const primitives = clientBlueWallclockPrimitives(clock);
  for (const name of ["highRes", "highResUnitsPerSecond", "threadCPU", "processCPU", "utcNow"]) {
    if (typeof primitives[name] !== "function") throw new TypeError(`The client's actual ${name} sampler is required.`);
  }
  if (typeof log?.domain?.logCore !== "function") throw new TypeError("The client's real raw logger outlet is required.");
  const runtime = await provider.ready(), values = runtime.values;
  const channel = log.domain.createChannel(Buffer.from("blue"), Buffer.from("TaskletTimer"));
  const backend = values.wrap(runtime.binding.taskletTimerBackend({
    highRes: () => primitives.highRes(),
    frequency: () => primitives.highResUnitsPerSecond(),
    threadCPU: () => primitives.threadCPU(),
    processCPU: () => primitives.processCPU(),
    utcNow: () => primitives.utcNow(),
    rawWarn: bytes => log.domain.logCore(channel, 2, 0, bytes),
  }));
  const module = values.global("_create_tasklet_profile").call(backend);
  const call = name => (...args) => backend.getAttr(name).call(...args);
  return Object.freeze({
    backend, module, clock, log, identity: runtime.identity,
    primitiveIdentity: primitives.identity,
    Timer: module.getAttr("Timer"), TimerPush: module.getAttr("TimerPush"),
    EnterTasklet: call("EnterTasklet"), ReturnFromTasklet: call("ReturnFromTasklet"),
    GetCurrent: call("GetCurrent"), reset: call("Reset"),
    timesliceReset: call("TimesliceReset"), inspect: call("Inspect"),
  });
}

module.exports = { createClientTaskletTimer };
