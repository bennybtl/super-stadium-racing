import { CreateAudioEngineAsync } from "@babylonjs/core/AudioV2/webAudio/webAudioEngine";
import { CreateSoundAsync } from "@babylonjs/core/AudioV2/abstractAudio/audioEngineV2";
import { loadAudioSettings } from "../settingsStorage.js";

const SOUND_CATEGORY = {
  ENGINE: "engine",
  EFFECTS: "effects",
  MUSIC: "music",
};

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function clampPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export class AudioManager {
  static async create(scene) {
    const audioEngine = await CreateAudioEngineAsync({
      resumeOnInteraction: false,
      disableDefaultUI: true,
    });

    const manager = new AudioManager(scene, audioEngine);
    return manager;
  }

  constructor(scene, audioEngine) {
    this.scene = scene;
    this.audioEngine = audioEngine;
    this._sounds = new Map();
    this._loopingSounds = new Set();
    this._unlockHandler = this._unlockAudio.bind(this);
    this._soundCategories = new Map();
    this._requestedVolumes = new Map();
    this._audioSettings = loadAudioSettings();
    this._settingsChangedHandler = this._handleAudioSettingsChanged.bind(this);
    this._disposeTimer = null;
    this._disposed = false;

    document.addEventListener("pointerdown", this._unlockHandler, { once: true, passive: true });
    document.addEventListener("keydown", this._unlockHandler, { once: true, passive: true });
    window.addEventListener("offroad:audio-settings-changed", this._settingsChangedHandler);
  }

  _normalizeAudioSettings(candidate) {
    return {
      engine: clampPercent(candidate?.engine),
      effects: clampPercent(candidate?.effects),
      music: clampPercent(candidate?.music),
    };
  }

  _resolveCategory(key, explicitCategory) {
    if (explicitCategory === SOUND_CATEGORY.ENGINE || explicitCategory === SOUND_CATEGORY.EFFECTS || explicitCategory === SOUND_CATEGORY.MUSIC) {
      return explicitCategory;
    }

    if (typeof key === "string" && key.startsWith("eng_")) {
      return SOUND_CATEGORY.ENGINE;
    }

    if (typeof key === "string" && key.startsWith("music")) {
      return SOUND_CATEGORY.MUSIC;
    }

    return SOUND_CATEGORY.EFFECTS;
  }

  _categoryGain(category) {
    const settings = this._audioSettings;
    if (category === SOUND_CATEGORY.ENGINE) return (settings.engine ?? 0) / 100;
    if (category === SOUND_CATEGORY.MUSIC) return (settings.music ?? 0) / 100;
    return (settings.effects ?? 0) / 100;
  }

  _scaledVolume(key, requestedVolume) {
    const category = this._soundCategories.get(key) ?? SOUND_CATEGORY.EFFECTS;
    return clamp01(requestedVolume) * this._categoryGain(category);
  }

  _refreshAllSoundVolumes() {
    for (const [key, sound] of this._sounds) {
      const requested = this._requestedVolumes.get(key);
      sound.volume = this._scaledVolume(key, requested ?? 1);
    }
  }

  _handleAudioSettingsChanged(event) {
    this._audioSettings = this._normalizeAudioSettings(event?.detail);
    this._refreshAllSoundVolumes();
  }

  async _unlockAudio() {
    if (!this.audioEngine) return;
    if (this.audioEngine.state !== "running") {
      console.debug("[AudioManager] unlocking audio engine via user gesture");
      try {
        await this.audioEngine.unlockAsync();
      } catch (error) {
        console.error("[AudioManager] unlockAsync failed:", error);
      }
    }
  }

  async loadSound(key, url, options = {}) {
    if (this._sounds.has(key)) return this._sounds.get(key);

    try {
      const sound = await CreateSoundAsync(key, url, {
        autoplay: false,
        loop: false,
        volume: 1,
        ...options,
      }, this.audioEngine);

      const category = this._resolveCategory(key, options.category);
      const requestedVolume = options.volume ?? 1;
      this._soundCategories.set(key, category);
      this._requestedVolumes.set(key, requestedVolume);
      sound.volume = this._scaledVolume(key, requestedVolume);

      console.debug(`[AudioManager] sound loaded: ${key}`);
      this._sounds.set(key, sound);
      return sound;
    } catch (error) {
      console.error(`[AudioManager] failed to load sound ${key}:`, error);
      return null;
    }
  }

  async playSound(key, options = {}) {
    const sound = this._sounds.get(key);
    if (!sound) {
      console.warn(`[AudioManager] playSound: unknown key ${key}`);
      return;
    }

    let {
      volume = 1,
      loop = false,
      loopStart = 0,
      loopEnd = 0,
      startOffset = 0,
    } = options;

    if (!this._soundCategories.has(key)) {
      this._soundCategories.set(key, this._resolveCategory(key, options.category));
    }
    this._requestedVolumes.set(key, volume);

    let scaledVolume = this._scaledVolume(key, volume);

    // Some audio engines may optimize away completely silent looped sources.
    // Keep a tiny audible headroom on start so the loop can begin, then mute later.
    if (loop && scaledVolume === 0) {
      scaledVolume = 0.0001;
    }

    const engineState = this.audioEngine?.state;
    console.debug(`[AudioManager] playSound ${key}: engineState=${engineState}, volume=${scaledVolume}, loop=${loop}, loopStart=${loopStart}, loopEnd=${loopEnd}`);

    if (this.audioEngine && this.audioEngine.state !== "running") {
      try {
        await this.audioEngine.unlockAsync();
      } catch (err) {
        console.error(`[AudioManager] unlockAsync failed before play ${key}:`, err);
      }
    }

    try {
      sound.play({ volume: scaledVolume, loop, loopStart, loopEnd, startOffset });
      console.debug(`[AudioManager] playSound ${key}: play() called`);
    } catch (err) {
      console.error(`[AudioManager] playSound ${key} failed:`, err);
    }
  }

  async playLoop(key, options = {}) {
    if (this._loopingSounds.has(key)) {
      return;
    }

    await this.playSound(key, {
      loop: true,
      ...options,
    });

    this._loopingSounds.add(key);
  }

  stopLoop(key) {
    if (!this._loopingSounds.has(key)) {
      return;
    }

    this.stopSound(key);
    this._loopingSounds.delete(key);
  }

  setSoundVolume(key, volume) {
    const sound = this._sounds.get(key);
    if (!sound) {
      console.warn(`[AudioManager] setSoundVolume: unknown key ${key}`);
      return;
    }

    this._requestedVolumes.set(key, volume);
    sound.volume = this._scaledVolume(key, volume);
  }

  setSoundPlaybackRate(key, playbackRate) {
    const sound = this._sounds.get(key);
    if (!sound) {
      console.warn(`[AudioManager] setSoundPlaybackRate: unknown key ${key}`);
      return;
    }
    sound.playbackRate = playbackRate;
  }

  setSoundPitch(key, pitch) {
    const sound = this._sounds.get(key);
    if (!sound) {
      console.warn(`[AudioManager] setSoundPitch: unknown key ${key}`);
      return;
    }
    sound.pitch = pitch;
  }

  stopSound(key) {
    const sound = this._sounds.get(key);
    if (!sound) return;
    if (sound.state === "Stopped") return;

    try {
      sound.stop();
    } catch (error) {
      console.warn(`[AudioManager] stopSound failed for ${key}:`, error);
    }
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;

    document.removeEventListener("pointerdown", this._unlockHandler);
    document.removeEventListener("keydown", this._unlockHandler);
    window.removeEventListener("offroad:audio-settings-changed", this._settingsChangedHandler);

    // Give any pending AudioBufferSourceNode ended callbacks a chance to run
    // before disposing the sounds. Babylon's WebAudio static sounds can throw
    // if dispose races the ended cleanup path.
    const sounds = Array.from(this._sounds.values());
    const audioEngine = this.audioEngine;

    for (const sound of sounds) {
      try {
        if (sound.state !== "Stopped") {
          sound.stop();
        }
      } catch (error) {
        console.warn("[AudioManager] sound.stop() failed during teardown:", error);
      }
    }

    this._sounds.clear();
    this._loopingSounds.clear();
    this._soundCategories.clear();
    this._requestedVolumes.clear();
    this.audioEngine = null;

    if (this._disposeTimer) clearTimeout(this._disposeTimer);
    this._disposeTimer = setTimeout(() => {
      for (const sound of sounds) {
        try {
          sound.dispose();
        } catch (error) {
          console.warn('[AudioManager] sound.dispose() failed during teardown:', error);
        }
      }

      if (audioEngine) {
        try {
          audioEngine.dispose();
        } catch (error) {
          console.warn('[AudioManager] audioEngine.dispose() failed during teardown:', error);
        }
      }
    }, 100);
  }
}
