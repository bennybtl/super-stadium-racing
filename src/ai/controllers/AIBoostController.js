export const DEFAULT_BOOST_CONFIG = {
  minSpeed: 8,
  straightMaxAngle: Math.PI / 12, // ~15°
  clearAheadDist: 18,
  clearLateralDist: 4,
  decisionCooldownMs: 900,
  baseChance: 0.1,
  behindWeight: 0.35,
  stockWeight: 0.25,
  maxChance: 0.85,
  stockRef: 4,
};

/**
 * AIBoostController
 *
 * Encapsulates nitro usage decisions for an AI driver.
 */
export class AIBoostController {
  constructor(driver, config = {}) {
    this.driver = driver;
    this.gameState = null;
    this.selfTruckData = null;
    this.allTruckData = null;

    this.minSpeed = config.minSpeed ?? DEFAULT_BOOST_CONFIG.minSpeed;
    this.straightMaxAngle = config.straightMaxAngle ?? DEFAULT_BOOST_CONFIG.straightMaxAngle;
    this.clearAheadDist = config.clearAheadDist ?? DEFAULT_BOOST_CONFIG.clearAheadDist;
    this.clearLateralDist = config.clearLateralDist ?? DEFAULT_BOOST_CONFIG.clearLateralDist;
    this.decisionCooldownMs = config.decisionCooldownMs ?? DEFAULT_BOOST_CONFIG.decisionCooldownMs;
    this.baseChance = config.baseChance ?? DEFAULT_BOOST_CONFIG.baseChance;
    this.behindWeight = config.behindWeight ?? DEFAULT_BOOST_CONFIG.behindWeight;
    this.stockWeight = config.stockWeight ?? DEFAULT_BOOST_CONFIG.stockWeight;
    this.maxChance = config.maxChance ?? DEFAULT_BOOST_CONFIG.maxChance;
    this.stockRef = Math.max(1, config.stockRef ?? DEFAULT_BOOST_CONFIG.stockRef);

    this._nextBoostDecisionAtMs = 0;
  }

  setGameState(gameState) {
    this.gameState = gameState;
  }

  setRaceContext(selfTruckData, allTruckData) {
    this.selfTruckData = selfTruckData;
    this.allTruckData = allTruckData;
  }

  reset() {
    this._nextBoostDecisionAtMs = 0;
  }

  update({ position, forward, rightVec, fwdSpeed, input }) {
    const truck = this.driver.truck;

    if (!truck || !this.gameState) return;
    if (this.gameState.boostCount <= 0) return;
    if (truck.state.boostActive) return;
    if (!input.forward || input.back) return;
    if (fwdSpeed < this.minSpeed) return;

    const now = Date.now();
    if (now < this._nextBoostDecisionAtMs) return;

    const curvature = this.driver._pathPlanner.scanPathCurvature(
      this.driver.currentPathIndex,
      this.driver.lookAheadDistance * 2
    );
    if (curvature > this.straightMaxAngle) {
      this._nextBoostDecisionAtMs = now + this.decisionCooldownMs;
      return;
    }

    if (!this._isBoostLaneClear(position, forward, rightVec)) {
      this._nextBoostDecisionAtMs = now + this.decisionCooldownMs;
      return;
    }

    const behindFactor = this._estimateBehindFactor(); // 0..1
    const stockFactor = Math.min(this.gameState.boostCount / this.stockRef, 1); // 0..1
    const chance = Math.min(
      this.baseChance +
      this.behindWeight * behindFactor +
      this.stockWeight * stockFactor,
      this.maxChance
    );

    if (Math.random() <= chance && this.gameState.useBoost()) {
      truck.state.boostActive = true;
      truck.state.boostTimer = truck.state.boostDuration;
    }

    this._nextBoostDecisionAtMs = now + this.decisionCooldownMs;
  }

  _isBoostLaneClear(position, forward, rightVec) {
    for (const other of this.driver.otherTrucks) {
      if (!other?.mesh) continue;
      const odx = other.mesh.position.x - position.x;
      const odz = other.mesh.position.z - position.z;
      const fwdDist = odx * forward.x + odz * forward.z;
      if (fwdDist <= 0 || fwdDist > this.clearAheadDist) continue;

      const latDist = odx * rightVec.x + odz * rightVec.z;
      if (Math.abs(latDist) < this.clearLateralDist) {
        return false;
      }
    }
    return true;
  }

  _estimateBehindFactor() {
    if (!this.selfTruckData?.gameState || !this.allTruckData?.length) return 0;

    const own = this.selfTruckData.gameState;
    const totalCp = this.driver.checkpoints?.length || 1;

    let best = own;
    for (const td of this.allTruckData) {
      if (!td?.gameState) continue;
      const gs = td.gameState;
      if (gs.raceFinished) continue;
      if (gs.lapCount > best.lapCount) {
        best = gs;
      } else if (gs.lapCount === best.lapCount && gs.checkpointCount > best.checkpointCount) {
        best = gs;
      }
    }

    const ownProgress = own.lapCount * totalCp + own.checkpointCount;
    const bestProgress = best.lapCount * totalCp + best.checkpointCount;
    const gap = Math.max(0, bestProgress - ownProgress);
    return Math.min(gap / Math.max(3, totalCp), 1);
  }
}
