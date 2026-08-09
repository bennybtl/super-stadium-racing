export const DEFAULT_BOOST_CONFIG = {
  minSpeed: 8,
  straightMaxAngle: Math.PI / 12, // ~15°
  // Drift gating (see _isSlipAcceptable). Slip below driftThreshold × this
  // counts as settled; above it, boost only on a slide that is unwinding.
  slipSettledFactor: 0.6,
  driftExitSlipRate: 0.35,       // rad/s of slip DECREASE that reads as a drift exit
  maxBoostSlipAngle: 0.6,        // rad (~34°) — too sideways to boost, unwinding or not
  clearAheadDist: 15,
  clearLateralDist: 4,
  decisionCooldownMs: 600,
  baseChance: 0.1,
  behindWeight: 0.35,
  stockWeight: 0.25,
  maxChance: 0.85,
  stockRef: 4,
  wallProbeStep: 2,
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
    this.slipSettledFactor = config.slipSettledFactor ?? DEFAULT_BOOST_CONFIG.slipSettledFactor;
    this.driftExitSlipRate = config.driftExitSlipRate ?? DEFAULT_BOOST_CONFIG.driftExitSlipRate;
    this.maxBoostSlipAngle = config.maxBoostSlipAngle ?? DEFAULT_BOOST_CONFIG.maxBoostSlipAngle;
    this.clearAheadDist = config.clearAheadDist ?? DEFAULT_BOOST_CONFIG.clearAheadDist;
    this.clearLateralDist = config.clearLateralDist ?? DEFAULT_BOOST_CONFIG.clearLateralDist;
    this.decisionCooldownMs = config.decisionCooldownMs ?? DEFAULT_BOOST_CONFIG.decisionCooldownMs;
    this.baseChance = config.baseChance ?? DEFAULT_BOOST_CONFIG.baseChance;
    this.behindWeight = config.behindWeight ?? DEFAULT_BOOST_CONFIG.behindWeight;
    this.stockWeight = config.stockWeight ?? DEFAULT_BOOST_CONFIG.stockWeight;
    this.maxChance = config.maxChance ?? DEFAULT_BOOST_CONFIG.maxChance;
    this.stockRef = Math.max(1, config.stockRef ?? DEFAULT_BOOST_CONFIG.stockRef);
    this.wallProbeStep = Math.max(0.5, config.wallProbeStep ?? DEFAULT_BOOST_CONFIG.wallProbeStep);
    this.debug = config.debug ?? DEFAULT_BOOST_CONFIG.debug;
    this.debugLogIntervalMs = Math.max(
      0,
      config.debugLogIntervalMs ?? DEFAULT_BOOST_CONFIG.debugLogIntervalMs
    );

    this._nextBoostDecisionAtMs = 0;
    this._lastDebugAtByKey = new Map();
    this._lastBoostBlocker = null;

    // Slip trend, sampled every update so the rate is warm whenever a boost
    // actually becomes possible.
    this._lastSlipAngle = null;
    this._lastSlipAtMs = 0;
    this._slipRate = 0; // rad/s, negative while a drift unwinds
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
    this._lastSlipAngle = null;
    this._lastSlipAtMs = 0;
    this._slipRate = 0;
  }

  update({ position, forward, rightVec, fwdSpeed, input }) {
    const truck = this.driver.truck;

    if (!truck || !this.gameState) {
      this._debug('missing-state', 'Skipping boost: missing truck or gameState');
      return;
    }

    // Sampled before every other gate so the trend is continuous — the checks
    // below bail on most ticks, and a rate measured across those gaps is noise.
    const now = Date.now();
    const slipAngle = this._sampleSlip(truck.state, now);

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

    if (now < this._nextBoostDecisionAtMs) {
      this._debug('cooldown', `Skipping boost: cooldown ${(this._nextBoostDecisionAtMs - now)}ms remaining`);
      return;
    }

    // Deliberately does NOT arm the cooldown: a drift exit is a short window,
    // and sitting out 600ms would miss the moment worth boosting on.
    if (!this._isSlipAcceptable(slipAngle, truck.state)) {
      this._debug(
        'drifting',
        `Skipping boost: slip ${slipAngle.toFixed(3)} rate ${this._slipRate.toFixed(3)} rad/s (threshold ${(truck.state?.driftThreshold ?? 0).toFixed(3)})`
      );
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

  /**
   * Track the slip angle's rate of change (rad/s). Called every update, before
   * the gates that bail early, so a usable trend exists the moment one passes.
   * A long gap between samples (paused, respawned) yields no trend rather than a
   * fabricated one.
   */
  _sampleSlip(state, now) {
    const slip = state?.slipAngle ?? 0;
    const dtMs = now - this._lastSlipAtMs;

    if (this._lastSlipAngle !== null && dtMs >= 16 && dtMs <= 500) {
      this._slipRate = (slip - this._lastSlipAngle) / (dtMs / 1000);
    } else if (dtMs > 500) {
      this._slipRate = 0;
    }

    this._lastSlipAngle = slip;
    this._lastSlipAtMs = now;
    return slip;
  }

  /**
   * Nitro while sideways just spins the truck, but boosting *out* of a drift is
   * the real technique — so the gate is on the slide unwinding, not on slip
   * being small. Settled slip passes outright; a slide that is still building
   * (or is simply too far gone) is blocked however fast it is recovering.
   */
  _isSlipAcceptable(slipAngle, state) {
    const driftThreshold = state?.driftThreshold;
    if (!Number.isFinite(driftThreshold)) return true;

    if (slipAngle <= driftThreshold * this.slipSettledFactor) return true;
    if (slipAngle > this.maxBoostSlipAngle) return false;

    return this._slipRate <= -this.driftExitSlipRate;
  }

  _isBoostLaneClear(position, forward, rightVec) {
    this._lastBoostBlocker = null;

    if (this._isBoostPathBlockedByWalls(position, forward, rightVec)) {
      return false;
    }

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

  _isBoostPathBlockedByWalls(position, forward, rightVec) {
    if (!this.driver?.wallManager || !this.driver?.worldToGrid || !this.driver?.isBlocked) {
      return false;
    }

    const laneOffsets = [0, this.clearLateralDist * 0.6, -this.clearLateralDist * 0.6];
    const startDist = Math.max(2, this.wallProbeStep);

    for (let dist = startDist; dist <= this.clearAheadDist; dist += this.wallProbeStep) {
      for (const lateral of laneOffsets) {
        const sampleX = position.x + forward.x * dist + rightVec.x * lateral;
        const sampleZ = position.z + forward.z * dist + rightVec.z * lateral;
        const cell = this.driver.worldToGrid(sampleX, sampleZ);
        if (this.driver.isBlocked(cell.x, cell.z)) {
          this._lastBoostBlocker = {
            name: 'wall/curb',
            fwdDist: dist,
            latDist: lateral,
          };
          return true;
        }
      }
    }

    return false;
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
    console.debug(`[AIBoostController:${name}] ${message}`);
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
