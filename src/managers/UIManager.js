/**
 * UIManager - Handles all DOM updates for game UI
 */
export class UIManager {
  constructor() {
    // Cache DOM elements
    this.checkpointCounter = document.getElementById('checkpoint-counter');
    this.lapCounter = document.getElementById('lap-counter');
    this.boostCounter = document.getElementById('boost-counter');
    this.boostDisplay = document.getElementById('boost-display');
    
    // Debug panel elements
    this.debugCompression = document.getElementById('debug-compression');
    this.debugGroundedness = document.getElementById('debug-groundedness');
    this.debugPenetration = document.getElementById('debug-penetration');
    this.debugVVel = document.getElementById('debug-vvel');
    this.debugSpeed = document.getElementById('debug-speed');
    this.debugGrip = document.getElementById('debug-grip');
    this.debugSlip = document.getElementById('debug-slip');
    this.debugTerrain = document.getElementById('debug-terrain');
    this.debugX = document.getElementById('debug-x');
    this.debugY = document.getElementById('debug-y');
    this.debugZ = document.getElementById('debug-z');
  }

  updateCheckpoints(count) {
    this.checkpointCounter.textContent = count;
  }

  updateLaps(count) {
    this.lapCounter.textContent = count;
  }

  updateBoosts(count) {
    this.boostCounter.textContent = count;
  }

  setBoostActive(active) {
    if (active) {
      this.boostDisplay.classList.add('active');
    } else {
      this.boostDisplay.classList.remove('active');
    }
  }

  updateDebugPanel(truckState, terrainType) {
    if (!this.debugCompression) return; // Debug panel may be disabled

    const speed = truckState.velocity.length();
    
    this.debugCompression.textContent = truckState.suspensionCompression.toFixed(2);
    this.debugGroundedness.textContent = (truckState.onGround ? 1 : 0);
    this.debugPenetration.textContent = '0.00'; // Legacy field
    this.debugVVel.textContent = truckState.verticalVelocity.toFixed(2);
    this.debugSpeed.textContent = speed.toFixed(2);
    this.debugGrip.textContent = truckState.grip.toFixed(3);
    this.debugSlip.textContent = (truckState.slipAngle * 180 / Math.PI).toFixed(1) + '°';
    this.debugTerrain.textContent = terrainType || 'dirt';
  }

  updatePosition(position) {
    if (!this.debugX) return; // Debug panel may be disabled
    
    this.debugX.textContent = position.x.toFixed(2);
    this.debugY.textContent = position.y.toFixed(2);
    this.debugZ.textContent = position.z.toFixed(2);
  }
}
