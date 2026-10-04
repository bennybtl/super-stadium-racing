// Progression chain: which trucks/tracks are available from the start, and
// what finishing a pack's championship in the top 3 unlocks next.
//
// A pack's `starterTracks` are free-play-available the moment the pack is
// active; its remaining tracks only race in that pack's championship
// calendar until the player wins one outright (see ProgressStorage), which
// unlocks it for free play too.

export const DEFAULT_UNLOCKED_TRUCKS = ['baja'];
export const DEFAULT_ACTIVE_PACK = 'southwest_pack_1';

// Sentinel "pack" awarded by the last real pack. Not a real packId — it has
// no starterTracks/track pool of its own; its championship draws randomly
// from every loaded track instead (see ModeController._drawCalendar).
export const REMIX_PACK_ID = 'remix_championship';
export const REMIX_TRACK_COUNT = 8;

export const PACK_PROGRESSION = {
  southwest_pack_1: {
    starterTracks: ['desert_doublecross', 'dust_devil', 'rattlesnake_ridge', 'toro_bravo'],
    rewardTruck: 'coati',
    rewardPack: 'midwest_pack_1',
  },
  midwest_pack_1: {
    starterTracks: ['apple_river', 'over_the_top', 'prairie_rumble', 'over_rush'],
    rewardTruck: 'gila',
    rewardPack: 'onroad_pack_1',
  },
  onroad_pack_1: {
    // TODO: 3 more tracks are planned for this pack; starters below reflect
    // the 4 tracks currently bundled.
    starterTracks: ['green_horn', 'hot_shot', 'rock_ridge', 'switchback'],
    rewardTruck: 'solano',
    rewardPack: 'offroad_pack_1',
  },
  offroad_pack_1: {
    // TODO: not yet bundled into src/tracks/ (source JSON lives in
    // track-packs/offroad_pack_1/) — starters TBD once it is.
    starterTracks: [],
    rewardTruck: 'rodeo',
    rewardPack: 'offroad_pack_2',
  },
  offroad_pack_2: {
    // TODO: not yet bundled into src/tracks/ (source JSON lives in
    // track-packs/offroad_pack_2/) — starters TBD once it is.
    starterTracks: [],
    rewardTruck: null,
    rewardPack: REMIX_PACK_ID,
  },
};
