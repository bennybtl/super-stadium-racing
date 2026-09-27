// Player unlock progression: which trucks and track-pack tracks are
// available. Mirrors ChampionshipStorage/UpgradeStorage's localStorage-manager
// shape.
//
// A pack's "starter" tracks (see config/progression.js) are free-play
// available the moment the pack is active. Its other tracks only appear in
// that pack's championship calendar until the player wins one outright,
// which unlocks it for free play too. Completing a pack's championship in
// the top 3 unlocks its reward truck and activates its reward pack (or
// Remix Championship, for the last pack in the chain).

import { PACK_PROGRESSION, DEFAULT_UNLOCKED_TRUCKS, DEFAULT_ACTIVE_PACK } from '../config/progression.js';

const STORAGE_KEY = 'player_progress';
export const PROGRESS_SCHEMA_VERSION = 1;

function isValid(s) {
  return s
    && s.version === PROGRESS_SCHEMA_VERSION
    && Array.isArray(s.unlockedTrucks)
    && Array.isArray(s.activePacks)
    && Array.isArray(s.unlockedTracks)
    && Array.isArray(s.completedPacks);
}

function defaultState() {
  return {
    version: PROGRESS_SCHEMA_VERSION,
    unlockedTrucks: [...DEFAULT_UNLOCKED_TRUCKS],
    activePacks: [DEFAULT_ACTIVE_PACK],
    unlockedTracks: [],
    completedPacks: [],
  };
}

export function loadPlayerProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (isValid(data)) return data;
    }
  } catch {
    // fall through to seeding
  }
  const seeded = defaultState();
  savePlayerProgress(seeded);
  return seeded;
}

export function savePlayerProgress(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  return state;
}

function starterTracksOf(packId) {
  return PACK_PROGRESSION[packId]?.starterTracks ?? [];
}

export function getUnlockedTruckKeys() {
  return loadPlayerProgress().unlockedTrucks;
}

export function isTruckUnlocked(key) {
  return getUnlockedTruckKeys().includes(key);
}

export function getActivePackIds() {
  return loadPlayerProgress().activePacks;
}

export function getCompletedPackIds() {
  return loadPlayerProgress().completedPacks;
}

export function isPackStarterTrack(packId, trackKey) {
  return starterTracksOf(packId).includes(trackKey);
}

/** Free-play (non-championship) track keys: starters of active packs, plus any individually won. */
export function getFreePlayTrackKeys() {
  const state = loadPlayerProgress();
  const starters = state.activePacks.flatMap(starterTracksOf);
  return [...new Set([...starters, ...state.unlockedTracks])];
}

export function isTrackFreePlayUnlocked(key) {
  return getFreePlayTrackKeys().includes(key);
}

/**
 * A pack's tracks split into its fixed starter order and the rest (in
 * track-loader order — caller shuffles if desired). Only loaded, non-hidden
 * tracks are returned, so an unbundled pack (or one that's all WIP) yields
 * both lists empty — a hidden track can't be raced in a championship any
 * more than it can be picked in free play.
 */
export function getPackTracks(packId) {
  const starters = starterTracksOf(packId);
  const allInPack = (window.trackLoader?.getTrackList?.() ?? [])
    .filter(key => {
      const track = window.trackLoader.getTrack(key);
      return track?.packId === packId && track?.hidden !== true;
    });
  const starterSet = new Set(starters);
  return {
    starters: starters.filter(key => allInPack.includes(key)),
    rest: allInPack.filter(key => !starterSet.has(key)),
  };
}

export function unlockTrackForFreePlay(key) {
  const state = loadPlayerProgress();
  if (state.unlockedTracks.includes(key)) return state;
  state.unlockedTracks = [...state.unlockedTracks, key];
  return savePlayerProgress(state);
}

/**
 * Apply a finished championship's result for `packId`. On a top-3 finish
 * (1-based `finishPosition`), grants the pack's reward truck and activates
 * its reward pack. Both grants and the completedPacks record are idempotent,
 * so replaying an already-completed pack is harmless.
 */
export function applyChampionshipCompletion(packId, finishPosition) {
  const state = loadPlayerProgress();
  if (!state.completedPacks.includes(packId)) {
    state.completedPacks = [...state.completedPacks, packId];
  }
  if (finishPosition <= 3) {
    const reward = PACK_PROGRESSION[packId];
    if (reward?.rewardTruck && !state.unlockedTrucks.includes(reward.rewardTruck)) {
      state.unlockedTrucks = [...state.unlockedTrucks, reward.rewardTruck];
    }
    if (reward?.rewardPack && !state.activePacks.includes(reward.rewardPack)) {
      state.activePacks = [...state.activePacks, reward.rewardPack];
    }
  }
  return savePlayerProgress(state);
}
