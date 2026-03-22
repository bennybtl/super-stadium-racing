/**
 * GameState - Centralized game state management
 */
export class GameState {
  constructor(maxBoosts = 5) {
    this.maxBoosts = maxBoosts;
    this.checkpointCount = 0;
    this.lapCount = 0;
    this.lastCheckpointPassed = -1;
    this.boostCount = maxBoosts;
  }

  incrementCheckpoint(checkpointIndex) {
    this.checkpointCount++;
    this.lastCheckpointPassed = checkpointIndex;
    return this.checkpointCount;
  }

  completeLap() {
    this.lapCount++;
    this.checkpointCount = 0;
    this.lastCheckpointPassed = -1;
    return this.lapCount;
  }

  resetCheckpoints() {
    this.checkpointCount = 0;
    this.lastCheckpointPassed = -1;
  }

  reset() {
    this.checkpointCount = 0;
    this.lapCount = 0;
    this.lastCheckpointPassed = -1;
    this.boostCount = this.maxBoosts;
  }

  useBoost() {
    if (this.boostCount > 0) {
      this.boostCount--;
      return true;
    }
    return false;
  }

  getState() {
    return {
      checkpoints: this.checkpointCount,
      laps: this.lapCount,
      boosts: this.boostCount,
      lastCheckpoint: this.lastCheckpointPassed
    };
  }
}
