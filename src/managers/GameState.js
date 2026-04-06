/**
 * GameState - Centralized game state management
 */
export class GameState {
  constructor(maxBoosts = 5) {
    this.maxBoosts = maxBoosts;
    this.checkpointCount = 0;
    this.lapCount = 0;
    this.lastCheckpointPassed = 0; // Start at 0 so first checkpoint (1) is next
    this.boostCount = maxBoosts;
    this.lapTimes = []; // Array of lap times in milliseconds
    this.raceFinished = false;
    this.totalRaceTime = 0;
    this.fastestLap = null; // ms, or null if no laps completed
  }

  incrementCheckpoint(checkpointIndex) {
    this.checkpointCount++;
    this.lastCheckpointPassed = checkpointIndex;
    return this.checkpointCount;
  }

  completeLap(lapTime) {
    this.lapCount++;
    this.checkpointCount = 0;
    this.lastCheckpointPassed = 0; // Reset to 0 so first checkpoint (1) is next
    if (lapTime !== undefined) {
      this.lapTimes.push(lapTime);
      if (this.fastestLap === null || lapTime < this.fastestLap) {
        this.fastestLap = lapTime;
      }
    }
    return this.lapCount;
  }

  finishRace(totalTime) {
    this.raceFinished = true;
    this.totalRaceTime = totalTime ?? null;
  }

  resetCheckpoints() {
    this.checkpointCount = 0;
    this.lastCheckpointPassed = 0;
  }

  reset() {
    this.checkpointCount = 0;
    this.lapCount = 0;
    this.lastCheckpointPassed = 0;
    this.boostCount = this.maxBoosts;
    this.lapTimes = [];
    this.raceFinished = false;
    this.totalRaceTime = 0;
    this.fastestLap = null;
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
