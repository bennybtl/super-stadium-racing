import onHighUrl from "../assets/sounds/bac-on-high.wav?url";
import onLowUrl from "../assets/sounds/bac-on-low.wav?url";
import offHighUrl from "../assets/sounds/bac-off-high.wav?url";
import offLowUrl from "../assets/sounds/bac-off-low.wav?url";
import v8OnHighUrl from "../assets/sounds/v8_on_high.wav?url";
import v8OnLowUrl from "../assets/sounds/v8_on_low.wav?url";
import v8OffHighUrl from "../assets/sounds/v8_off_high.wav?url";
import v8OffLowUrl from "../assets/sounds/v8_off_low.wav?url";

const PRESETS = {
  bac: {
    on_high:  onHighUrl,
    on_low:   onLowUrl,
    off_high: offHighUrl,
    off_low:  offLowUrl,
  },
  v8: {
    on_high:  v8OnHighUrl,
    on_low:   v8OnLowUrl,
    off_high: v8OffHighUrl,
    off_low:  v8OffLowUrl,
  },
};

// All BAC Mono samples are recorded at ~1000 RPM and pitch-shifted via playbackRate.
// Formula matches engine-audio-master: detune(cents) = (rpm - sampleRpm) * 0.2
// playbackRate = 2^(detune / 1200)
const SAMPLE_RPM = 1000;
const RPM_PITCH_FACTOR = 0.2;

// Virtual RPM model — arcade truck has no real engine physics
const IDLE_RPM = 800;
const MAX_RPM = 6500;
const NUM_GEARS = 3;
const DEFAULT_MAX_SPEED = 25; // m/s fallback if not provided

// On upshift, RPM drops by this fraction (e.g. 0.55 = drops to 55% of current RPM)
const UPSHIFT_RPM_RETAIN = 0.55;

// Equal-power crossfade thresholds (RPM) between low and high samples
const RPM_XFADE_START = 2500;
const RPM_XFADE_END = 4000;

// Smoothing: how fast RPM tracks the target (higher = faster response)
const RPM_RISE_SPEED = 4.0;  // when throttle on
const RPM_FALL_SPEED = 6.0;  // when coasting / decel

/**
 * Equal-power crossfade.
 * Returns gain1 (favours "high" end) and gain2 (favours "low" end).
 */
function crossFade(value, start, end) {
  const x = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return {
    gain1: Math.cos((1.0 - x) * 0.5 * Math.PI),
    gain2: Math.cos(x * 0.5 * Math.PI),
  };
}

function rpmToPlaybackRate(rpm) {
  const detuneCents = (rpm - SAMPLE_RPM) * RPM_PITCH_FACTOR;
  return Math.pow(2, detuneCents / 1200);
}

export class EngineAudio {
  constructor(audioManager) {
    this._am = audioManager;
    this._smoothRpm = IDLE_RPM;
    this._started = false;
    this._lastGear = 0;
  }

  static async create(audioManager, preset = 'bac') {
    const ea = new EngineAudio(audioManager);
    const urls = PRESETS[preset] ?? PRESETS.bac;

    await audioManager.loadSound("eng_on_high",  urls.on_high,  { loop: true, autoplay: false, volume: 1 });
    await audioManager.loadSound("eng_on_low",   urls.on_low,   { loop: true, autoplay: false, volume: 1 });
    await audioManager.loadSound("eng_off_high", urls.off_high, { loop: true, autoplay: false, volume: 1 });
    await audioManager.loadSound("eng_off_low",  urls.off_low,  { loop: true, autoplay: false, volume: 1 });

    return ea;
  }

  async _start() {
    if (this._started) return;
    this._started = true;
    await this._am.playLoop("eng_on_high",  { volume: 1, loopStart: 0, loopEnd: 0 });
    await this._am.playLoop("eng_on_low",   { volume: 1, loopStart: 0, loopEnd: 0 });
    await this._am.playLoop("eng_off_high", { volume: 1, loopStart: 0, loopEnd: 0 });
    await this._am.playLoop("eng_off_low",  { volume: 1, loopStart: 0, loopEnd: 0 });
  }

  /**
   * Call every frame.
   * @param {number} speed     - horizontal speed in m/s
   * @param {boolean} throttle - true when the player is pressing forward/throttle
   * @param {number} dt        - delta time in seconds
   * @param {number} [maxSpeed] - vehicle's current maxSpeed (e.g. from truck.state.maxSpeed)
   */
  update(speed, throttle, dt, maxSpeed = DEFAULT_MAX_SPEED) {
    if (!this._started) {
      this._start();
      return;
    }
    // ---- Virtual RPM from speed ----
    const absSpeed = Math.max(0, speed);
    const gearSpan = maxSpeed / NUM_GEARS;
    const gear = Math.min(NUM_GEARS - 1, Math.floor(absSpeed / gearSpan));
    const speedInGear = absSpeed - gear * gearSpan;
    const targetRpm = IDLE_RPM + (speedInGear / gearSpan) * (MAX_RPM - IDLE_RPM);

    // Upshift: drop RPM to simulate gear change
    if (gear > this._lastGear) {
      this._smoothRpm *= UPSHIFT_RPM_RETAIN;
    }
    this._lastGear = gear;

    // Smooth RPM toward target
    const rpmSpeed = throttle ? RPM_RISE_SPEED : RPM_FALL_SPEED;
    this._smoothRpm += (targetRpm - this._smoothRpm) * Math.min(1, rpmSpeed * dt);

    const rpm = this._smoothRpm;
    const playbackRate = rpmToPlaybackRate(rpm);

    // ---- Crossfades ----
    const { gain1: highGain, gain2: lowGain } = crossFade(rpm, RPM_XFADE_START, RPM_XFADE_END);
    const throttleBlend = throttle ? 1 : 0;
    const { gain1: onGain, gain2: offGain } = crossFade(throttleBlend, 0, 1);

    // Volume constant matches bac_mono config volume: 0.5
    const masterVol = 0.5;
    this._am.setSoundVolume("eng_on_high",  onGain  * highGain * masterVol);
    this._am.setSoundVolume("eng_on_low",   onGain  * lowGain  * masterVol);
    this._am.setSoundVolume("eng_off_high", offGain * highGain * masterVol);
    this._am.setSoundVolume("eng_off_low",  offGain * lowGain  * masterVol);

    this._am.setSoundPlaybackRate("eng_on_high",  playbackRate);
    this._am.setSoundPlaybackRate("eng_on_low",   playbackRate);
    this._am.setSoundPlaybackRate("eng_off_high", playbackRate);
    this._am.setSoundPlaybackRate("eng_off_low",  playbackRate);
  }

  stop() {
    ["eng_on_high", "eng_on_low", "eng_off_high", "eng_off_low"].forEach(key => {
      this._am.stopLoop(key);
    });
  }
}
