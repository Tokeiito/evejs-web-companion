// Sound cues (goal R81): off by default, no audio device opened until asked,
// and a corrupt setting that can never turn sound ON.

import test from "node:test";
import assert from "node:assert/strict";

import {
  CUE_NAMES,
  SOUND_DEFAULTS,
  cueDuration,
  cueTones,
  parseSoundSettings,
  playCue,
  soundContextIsOpen,
  soundSettings,
} from "./sound.ts";

// --- the default is the one that matters -------------------------------------

test("sound is OFF by default", () => {
  // A client that makes noise the first time you open it is a client people
  // mute at the OS and never hear from again.
  assert.equal(SOUND_DEFAULTS.enabled, false);
});

test("nothing plays, and NO audio device is opened, while sound is off", () => {
  // ⚠ Opening an AudioContext for someone who has sound switched off costs them
  // a device wake-up and battery for something they will never hear — and, in a
  // browser, a context created before a user gesture starts suspended and drops
  // every cue silently, which looks exactly like the feature being broken.
  assert.equal(playCue("alert"), false);
  assert.equal(soundContextIsOpen(), false);
});

test("nothing plays at zero volume either", () => {
  soundSettings.set({ enabled: true, volume: 0 });
  assert.equal(playCue("alert"), false);
  soundSettings.set(SOUND_DEFAULTS);
});

test("playCue never throws where there is no Web Audio at all", () => {
  // Under the test runner there is no `window`, which is the same shape as SSR.
  soundSettings.set({ enabled: true, volume: 0.5 });
  assert.doesNotThrow(() => playCue("lock"));
  assert.equal(playCue("lock"), false, "it reports that it did not play");
  soundSettings.set(SOUND_DEFAULTS);
});

// --- the saved setting -------------------------------------------------------

test("a missing or unreadable setting falls back to the defaults", () => {
  for (const raw of [null, undefined, "", "not json", "{", "[]", "42", '"x"']) {
    assert.deepEqual(parseSoundSettings(raw as string), SOUND_DEFAULTS, `${String(raw)}`);
  }
});

test("a corrupt setting can never turn sound ON", () => {
  // ⚠ The one direction the fallback is not allowed to go. `enabled` is read as
  // a strict `=== true`, so a truthy-but-wrong value stays off.
  for (const raw of [
    JSON.stringify({ enabled: "yes" }),
    JSON.stringify({ enabled: 1 }),
    JSON.stringify({ enabled: {} }),
    JSON.stringify({ volume: 1 }),
  ]) {
    assert.equal(parseSoundSettings(raw).enabled, false, raw);
  }
});

test("an explicit true does turn it on", () => {
  assert.equal(parseSoundSettings(JSON.stringify({ enabled: true })).enabled, true);
});

test("volume is clamped into range rather than trusted", () => {
  assert.equal(parseSoundSettings(JSON.stringify({ enabled: true, volume: 4 })).volume, 1);
  assert.equal(parseSoundSettings(JSON.stringify({ enabled: true, volume: -2 })).volume, 0);
  assert.equal(parseSoundSettings(JSON.stringify({ enabled: true, volume: 0.3 })).volume, 0.3);
});

test("a nonsensical volume falls back rather than muting or deafening", () => {
  const parsed = parseSoundSettings(JSON.stringify({ enabled: true, volume: "loud" }));
  assert.equal(parsed.volume, SOUND_DEFAULTS.volume);
});

// --- the cue set -------------------------------------------------------------

test("every cue has at least one tone", () => {
  for (const name of CUE_NAMES) {
    assert.ok(cueTones(name).length > 0, `the '${name}' cue is silent`);
  }
});

test("every cue is SHORT — these play over whatever the player is listening to", () => {
  for (const name of CUE_NAMES) {
    const seconds = cueDuration(name);
    assert.ok(seconds > 0, `the '${name}' cue has no duration`);
    assert.ok(seconds <= 0.6, `the '${name}' cue lasts ${seconds}s, which is a sound effect, not a cue`);
  }
});

test("every cue is quiet, and only the alert is allowed to be the loudest", () => {
  const peak = (name: (typeof CUE_NAMES)[number]): number =>
    cueTones(name).reduce((loudest, tone) => Math.max(loudest, tone.gain), 0);
  for (const name of CUE_NAMES) {
    assert.ok(peak(name) <= 0.3, `the '${name}' cue peaks at ${peak(name)}`);
  }
  // A cue that demands attention for a target lock is a cue that gets switched
  // off; only "look at the screen now" earns the top of the range.
  for (const name of CUE_NAMES) {
    if (name === "alert") continue;
    assert.ok(peak("alert") >= peak(name), `'${name}' is louder than the alert`);
  }
});

test("tones are ordered within a cue and none starts before it begins", () => {
  for (const name of CUE_NAMES) {
    let last = -1;
    for (const tone of cueTones(name)) {
      assert.ok(tone.at >= 0, `a tone in '${name}' starts before the cue`);
      assert.ok(tone.at >= last, `tones in '${name}' are out of order`);
      assert.ok(tone.seconds > 0, `a tone in '${name}' has no length`);
      last = tone.at;
    }
  }
});

test("every tone is in a range a person can hear comfortably", () => {
  for (const name of CUE_NAMES) {
    for (const tone of cueTones(name)) {
      for (const hz of [tone.from, tone.to]) {
        assert.ok(hz >= 60 && hz <= 4000, `'${name}' has a ${hz}Hz tone`);
      }
    }
  }
});
