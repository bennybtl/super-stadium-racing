export const DEFAULT_BOOST_CONFIG = {
  minSpeed: 8,
  straightMaxAngle: Math.PI / 12, // ~15°
  clearAheadDist: 15,
  clearLateralDist: 4,
  decisionCooldownMs: 600,
  baseChance: 0.1,
  behindWeight: 0.35,
  stockWeight: 0.25,
  maxChance: 0.85,
  stockRef: 4,
  debug: false,
  debugLogIntervalMs: 1200,
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
    this.debug = config.debug ?? DEFAULT_BOOST_CONFIG.debug;
    this.debugLogIntervalMs = Math.max(
      0,
      config.debugLogIntervalMs ?? DEFAULT_BOOST_CONFIG.debugLogIntervalMs
    );

    this._nextBoostDecisionAtMs = 0;
    this._lastDebugAtByKey = new Map();
    this._lastBoostBlocker = null;
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
    this._lastBoostBlocker = null;
  }

  update({ position, forward, rightVec, fwdSpeed, input }) {
    const truck = this.driver.truck;

    if (!truck || !this.gameState) {
      this._debug('missing-state', 'Skipping boost: missing truck or gameState');
      return;
    }
    if (this.gameState.boostCount <= 0) {
      this._debug('no-boost-stock', 'Skipping boost: no boosts left');
      return;
    }
    if (truck.state.boostActive) {
      this._debug('already-boosting', 'Skipping boost: boost already active');
      return;
    }
    if (input.back) {
      this._debug('bad-input', `Skipping boost: braking/reverse input active (back=${!!input.back})`);
      return;
    }
    if (fwdSpeed < this.minSpeed) {
      this._debug('too-slow', `Skipping boost: speed ${fwdSpeed.toFixed(2)} < min ${this.minSpeed.toFixed(2)}`);
      return;
    }

    const now = Date.now();
    if (now < this._nextBoostDecisionAtMs) {
      this._debug('cooldown', `Skipping boost: cooldown ${(this._nextBoostDecisionAtMs - now)}ms remaining`);
      return;
    }

    const curvature = this.driver._pathPlanner.scanPathCurvature(
      this.driver.currentPathIndex,
      this.driver.lookAheadDistance * 2
    );
    if (curvature > this.straightMaxAngle) {
      this._debug(
        'curvature',
        `Skipping boost: curvature ${curvature.toFixed(3)} > limit ${this.straightMaxAngle.toFixed(3)}`
      );
      this._nextBoostDecisionAtMs = now + this.decisionCooldownMs;
      return;
    }

    if (!this._isBoostLaneClear(position, forward, rightVec)) {
      if (this._lastBoostBlocker) {
        const b = this._lastBoostBlocker;
        this._debug(
          'lane-blocked',
          `Skipping boost: lane blocked by ${b.name} (fwd=${b.fwdDist.toFixed(1)}m lat=${b.latDist.toFixed(1)}m)`
        );
      } else {
        this._debug('lane-blocked', 'Skipping boost: lane blocked');
      }
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
    const roll = Math.random();

    this._debug(
      'decision',
      `Boost decision: chance=${chance.toFixed(3)} roll=${roll.toFixed(3)} behind=${behindFactor.toFixed(3)} stock=${stockFactor.toFixed(3)}`
    );

    if (roll <= chance && this.gameState.useBoost()) {
      truck.state.boostActive = true;
      truck.state.boostTimer = truck.state.boostDuration;
      this._debug('boost-fired', `BOOST ACTIVATED. remaining=${this.gameState.boostCount}`, true);
    } else {
      this._debug('boost-no-fire', 'Decision did not fire boost');
    }

    this._nextBoostDecisionAtMs = now + this.decisionCooldownMs;
  }

  _isBoostLaneClear(position, forward, rightVec) {
    this._lastBoostBlocker = null;
    for (const other of this.driver.otherTrucks) {
      if (!other?.mesh) continue;
      const odx = other.mesh.position.x - position.x;
      const odz = other.mesh.position.z - position.z;
      const fwdDist = odx * forward.x + odz * forward.z;
      if (fwdDist <= 0 || fwdDist > this.clearAheadDist) continue;

      const latDist = odx * rightVec.x + odz * rightVec.z;
      if (Math.abs(latDist) < this.clearLateralDist) {
        this._lastBoostBlocker = {
          name: other.name || other.mesh.name || 'truck',
          fwdDist,
          latDist,
        };
        return false;
      }
    }
    return true;
  }

  _debug(key, message, force = false) {
    if (!this.debug) return;

    const now = Date.now();
    if (!force && this.debugLogIntervalMs > 0) {
      const last = this._lastDebugAtByKey.get(key) ?? 0;
      if (now - last < this.debugLogIntervalMs) return;
      this._lastDebugAtByKey.set(key, now);
    }

    const name = this.selfTruckData?.name || this.driver?.name || 'AI';
    console.log(`[AIBoostController:${name}] ${message}`);
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
