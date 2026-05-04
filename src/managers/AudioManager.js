import { CreateAudioEngineAsync } from "@babylonjs/core/AudioV2/webAudio/webAudioEngine";
import { CreateSoundAsync } from "@babylonjs/core/AudioV2/abstractAudio/audioEngineV2";

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
    this._disposeTimer = null;
    this._disposed = false;

    document.addEventListener("pointerdown", this._unlockHandler, { once: true, passive: true });
    document.addEventListener("keydown", this._unlockHandler, { once: true, passive: true });
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

    // Some audio engines may optimize away completely silent looped sources.
    // Keep a tiny audible headroom on start so the loop can begin, then mute later.
    if (loop && volume === 0) {
      volume = 0.0001;
    }

    const engineState = this.audioEngine?.state;
    console.debug(`[AudioManager] playSound ${key}: engineState=${engineState}, volume=${volume}, loop=${loop}, loopStart=${loopStart}, loopEnd=${loopEnd}`);

    if (this.audioEngine && this.audioEngine.state !== "running") {
      try {
        await this.audioEngine.unlockAsync();
      } catch (err) {
        console.error(`[AudioManager] unlockAsync failed before play ${key}:`, err);
      }
    }

    try {
      sound.play({ volume, loop, loopStart, loopEnd, startOffset });
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

    sound.volume = volume;
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
