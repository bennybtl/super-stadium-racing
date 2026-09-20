import basementRiffBounceUrl from "../assets/music/Basement Riff Bounce.mp3?url";
import chromePulseUrl from "../assets/music/Chrome Pulse.mp3?url";
import neonLightningUrl from "../assets/music/Neon_Lightning.mp3?url";
import neonThunderUrl from "../assets/music/Neon_Thunder.mp3?url";
import neonThunderBreakdownUrl from "../assets/music/Neon_Thunder_Breakdown.mp3?url";
import neonThunderReduxUrl from "../assets/music/Neon_Thunder_redux.mp3?url";
import rustyCheckersUrl from "../assets/music/Rusty Checkers.mp3?url";
import twangRiffUrl from "../assets/music/Twang_Riff.mp3?url";
import twangRiff2Url from "../assets/music/Twang_Riff_2.mp3?url";
import whenTheNoiseIsGoneUrl from "../assets/music/When_the_Noise_Is_Gone.mp3?url";
import breakThroughTheSkyUrl from "../assets/music/break_through_the_sky.mp3?url";
import epicElectricUrl from "../assets/music/epic_electric.mp3?url";
import humbleUrl from "../assets/music/humble.mp3?url";

// Neon_Thunder itself is the theme song (see playTheme/stopTheme below) and is
// deliberately left out of the shuffle — that's why the redux/breakdown
// remixes exist, so the melody can still show up in the regular rotation.
const TRACKS = [
  { key: "music_basement_riff_bounce", url: basementRiffBounceUrl },
  { key: "music_chrome_pulse", url: chromePulseUrl },
  { key: "music_neon_lightning", url: neonLightningUrl },
  { key: "music_neon_thunder_breakdown", url: neonThunderBreakdownUrl },
  { key: "music_neon_thunder_redux", url: neonThunderReduxUrl },
  { key: "music_rusty_checkers", url: rustyCheckersUrl },
  { key: "music_twang_riff", url: twangRiffUrl },
  { key: "music_twang_riff_2", url: twangRiff2Url },
  { key: "music_when_the_noise_is_gone", url: whenTheNoiseIsGoneUrl },
  { key: "music_break_through_the_sky", url: breakThroughTheSkyUrl },
  { key: "music_epic_electric", url: epicElectricUrl },
  { key: "music_humble", url: humbleUrl },
];

const THEME_KEY = "music_theme";

/**
 * Plays the Neon_Thunder theme song on a loop — used on the main menu and
 * during the pre-race countdown, before handing off to the shuffled playlist
 * once the race actually starts (see stopTheme).
 */
export async function playTheme(audioManager) {
  await audioManager.loadSound(THEME_KEY, neonThunderUrl, {
    streaming: true,
    loop: true,
    autoplay: false,
    volume: 1,
  });
  await audioManager.playLoop(THEME_KEY, { volume: 1 });
}

export function stopTheme(audioManager) {
  audioManager.stopLoop(THEME_KEY);
}

function shuffle(array) {
  const result = array.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Plays a shuffled, non-repeating playlist of background music during gameplay.
 *
 * Tracks are loaded as streaming sounds (not fully decoded up front like the
 * short engine/effect samples) since music files are large and there are many
 * of them. Volume follows the "music" category in AudioManager, which is
 * inferred automatically from the "music_" key prefix.
 */
export class MusicManager {
  constructor(audioManager) {
    this._audioManager = audioManager;
    this._order = [];
    this._index = 0;
    this._currentKey = null;
    this._endedObserver = null;
    this._started = false;
  }

  static async create(audioManager) {
    const manager = new MusicManager(audioManager);

    for (const track of TRACKS) {
      await audioManager.loadSound(track.key, track.url, {
        streaming: true,
        loop: false,
        autoplay: false,
        volume: 1,
      });
    }

    return manager;
  }

  start() {
    if (this._started || TRACKS.length === 0) return;
    this._started = true;
    this._order = shuffle(TRACKS.map(t => t.key));
    this._index = 0;
    this._playCurrent();
  }

  _playCurrent() {
    const key = this._order[this._index];
    this._currentKey = key;

    const sound = this._audioManager.getSound(key);
    if (sound) {
      this._endedObserver = sound.onEndedObservable.addOnce(() => this._playNext());
    }

    this._audioManager.playSound(key, { volume: 1 });
  }

  _playNext() {
    if (!this._started) return;

    this._index++;
    if (this._index >= this._order.length) {
      // Reshuffle for another pass, avoiding an immediate repeat of the last track.
      let nextOrder;
      do {
        nextOrder = shuffle(TRACKS.map(t => t.key));
      } while (TRACKS.length > 1 && nextOrder[0] === this._order[this._order.length - 1]);
      this._order = nextOrder;
      this._index = 0;
    }

    this._playCurrent();
  }

  stop() {
    this._started = false;

    const sound = this._currentKey ? this._audioManager.getSound(this._currentKey) : null;
    if (sound && this._endedObserver) {
      sound.onEndedObservable.remove(this._endedObserver);
    }
    this._endedObserver = null;

    if (this._currentKey) {
      this._audioManager.stopSound(this._currentKey);
      this._currentKey = null;
    }
  }
}
