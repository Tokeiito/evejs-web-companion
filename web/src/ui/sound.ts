// SOUND CUES (goal R81) — a handful of short synthesized tones for the moments
// a pilot should not have to be looking at the screen to notice.
//
// ---------------------------------------------------------------------------
// SYNTHESIZED, NOT SAMPLED
//
// There are no audio files. Every cue is a couple of oscillators and a gain
// envelope, which means: nothing to license, nothing to ship, nothing to fetch
// (this client often runs on a LAN with no outbound path), and no decode step
// before the first one plays. The whole cue set costs a few hundred bytes of
// code rather than a few hundred kilobytes of assets.
//
// ---------------------------------------------------------------------------
// ⚠ OFF BY DEFAULT, AND NO AudioContext UNTIL IT IS ASKED FOR
//
// A client that makes noise the first time you open it is a client people mute
// at the operating system and never hear from again. So it is off until someone
// turns it on in Settings.
//
// The context is also created LAZILY, on the first cue after it is enabled —
// never at module load. Two reasons, and the second is the real one:
//
//   1. Browsers block audio until a user gesture. A context created at load
//      starts `suspended`, and every cue played into it is silently dropped —
//      which looks exactly like the feature being broken.
//   2. An AudioContext is a real audio device handle. Opening one for a player
//      who has sound switched off costs them a device wake-up and, on a laptop,
//      measurable battery, for something they will never hear.
//
// `resume()` is called on every play, because a context can be suspended again
// at any time by the browser (a backgrounded tab) and a cue that arrives while
// suspended must not be lost silently.

import { writable, type Writable } from "svelte/store";

/** The cues, by the moment they mark. */
export type CueName = "lock" | "warp" | "dock" | "alert" | "notice";

/** One tone in a cue. */
interface Tone {
  /** Hz at the start of the tone. */
  readonly from: number;
  /** Hz at the end — equal to `from` for a flat tone, different for a sweep. */
  readonly to: number;
  /** Seconds from the cue's start. */
  readonly at: number;
  readonly seconds: number;
  /** Peak gain, 0-1, before the master volume. */
  readonly gain: number;
  readonly wave: OscillatorType;
}

/**
 * The cue set.
 *
 * Deliberately short, quiet and mid-range: these play over whatever the player
 * is already listening to, and a cue that demands attention for a target lock
 * is a cue that gets switched off. Only `alert` is allowed to be sharp, because
 * it is the only one that means "look at the screen now".
 */
const CUES: Readonly<Record<CueName, readonly Tone[]>> = {
  // Two quick rising blips — the retail lock is a mechanical, repeated sound.
  lock: [
    { from: 880, to: 880, at: 0, seconds: 0.05, gain: 0.18, wave: "square" },
    { from: 1174, to: 1174, at: 0.07, seconds: 0.05, gain: 0.18, wave: "square" },
  ],
  // A rising sweep: something is winding up.
  warp: [{ from: 220, to: 880, at: 0, seconds: 0.42, gain: 0.16, wave: "sawtooth" }],
  // A falling thud: something has arrived and stopped.
  dock: [{ from: 300, to: 90, at: 0, seconds: 0.3, gain: 0.22, wave: "sine" }],
  // Two harsh falling notes. The only cue that may be sharp.
  alert: [
    { from: 660, to: 660, at: 0, seconds: 0.12, gain: 0.26, wave: "square" },
    { from: 494, to: 494, at: 0.15, seconds: 0.18, gain: 0.26, wave: "square" },
  ],
  // A single soft blip for anything ordinary.
  notice: [{ from: 587, to: 587, at: 0, seconds: 0.07, gain: 0.12, wave: "sine" }],
};

/** Every cue name, for a settings UI that wants to preview them. */
export const CUE_NAMES = Object.keys(CUES) as readonly CueName[];

/** The tones a cue is made of. Exported so a test can read the set. */
export function cueTones(name: CueName): readonly Tone[] {
  return CUES[name];
}

/** How long a cue lasts, in seconds — its last tone's end. */
export function cueDuration(name: CueName): number {
  return CUES[name].reduce((longest, tone) => Math.max(longest, tone.at + tone.seconds), 0);
}

const STORAGE_KEY = "evejs-web-sound";

export interface SoundSettings {
  readonly enabled: boolean;
  /** Master volume, 0-1. */
  readonly volume: number;
}

/** ⚠ OFF. See the note at the top of the file. */
export const SOUND_DEFAULTS: SoundSettings = { enabled: false, volume: 0.5 };

/**
 * Read the saved settings.
 *
 * Total: anything unparseable or out of range falls back to the defaults, which
 * for `enabled` means OFF. A corrupt setting must never turn sound ON — that is
 * the one direction the fallback is not allowed to go.
 */
export function parseSoundSettings(raw: string | null | undefined): SoundSettings {
  if (typeof raw !== "string" || raw.length === 0) {
    return SOUND_DEFAULTS;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return SOUND_DEFAULTS;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return SOUND_DEFAULTS;
  }
  const record = parsed as Record<string, unknown>;
  const enabled = record.enabled === true;
  const volume =
    typeof record.volume === "number" && Number.isFinite(record.volume)
      ? Math.min(1, Math.max(0, record.volume))
      : SOUND_DEFAULTS.volume;
  return { enabled, volume };
}

function load(): SoundSettings {
  if (typeof localStorage === "undefined") {
    return SOUND_DEFAULTS;
  }
  try {
    return parseSoundSettings(localStorage.getItem(STORAGE_KEY));
  } catch {
    return SOUND_DEFAULTS;
  }
}

/** The sound settings, shared with the Settings panel. */
export const soundSettings: Writable<SoundSettings> = writable<SoundSettings>(load());

soundSettings.subscribe((value) => {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // A browser with storage disabled still gets working sound for the session.
  }
});

// --- the engine --------------------------------------------------------------

let context: AudioContext | null = null;
let current: SoundSettings = SOUND_DEFAULTS;
soundSettings.subscribe((value) => {
  current = value;
});

/** The AudioContext constructor, or null where there is none (SSR, tests). */
function audioContextCtor(): typeof AudioContext | null {
  if (typeof window === "undefined") {
    return null;
  }
  const scope = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

/**
 * Play a cue, if sound is on.
 *
 * Never throws and never awaits: a caller is always in the middle of something
 * else (a poll, a click handler), and audio failing is never a reason for that
 * to fail. Returns whether a cue was actually started, which is what makes this
 * testable at all.
 */
export function playCue(name: CueName): boolean {
  if (!current.enabled || current.volume <= 0) {
    return false;
  }
  const Ctor = audioContextCtor();
  if (!Ctor) {
    return false;
  }
  try {
    // Lazily, on the first cue after it was switched on — never at module load.
    context ??= new Ctor();
    // A context can be suspended at any time (a backgrounded tab); resume on
    // every play so a cue is not silently swallowed.
    if (context.state === "suspended") {
      void context.resume().catch(() => {});
    }
    const master = context.createGain();
    master.gain.value = current.volume;
    master.connect(context.destination);

    const start = context.currentTime;
    for (const tone of CUES[name]) {
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = tone.wave;
      osc.frequency.setValueAtTime(tone.from, start + tone.at);
      if (tone.to !== tone.from) {
        osc.frequency.linearRampToValueAtTime(tone.to, start + tone.at + tone.seconds);
      }
      // An envelope, not a hard gate: a square wave switched on and off at full
      // gain clicks, and a click is the most irritating sound a UI can make.
      gain.gain.setValueAtTime(0, start + tone.at);
      gain.gain.linearRampToValueAtTime(tone.gain, start + tone.at + 0.01);
      gain.gain.linearRampToValueAtTime(0, start + tone.at + tone.seconds);
      osc.connect(gain);
      gain.connect(master);
      osc.start(start + tone.at);
      osc.stop(start + tone.at + tone.seconds + 0.02);
    }
    return true;
  } catch {
    // A browser that refuses to make an AudioContext (autoplay policy, no
    // device) costs the player nothing but silence.
    return false;
  }
}

/** Throw away the audio device — used when sound is switched off. */
export function closeSound(): void {
  const open = context;
  context = null;
  if (open) {
    void open.close().catch(() => {});
  }
}

/** True when an audio device is currently open. For tests and Settings. */
export function soundContextIsOpen(): boolean {
  return context !== null;
}
