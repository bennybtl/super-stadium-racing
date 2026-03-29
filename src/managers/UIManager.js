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
    this.raceTimer = document.getElementById('race-timer');
    
    // Debug panel
    this.debugPanel = document.getElementById('debug-panel');
    this.raceStatusPanel = document.getElementById('race-status-panel');
    this.countdownOverlay = document.getElementById('countdown-overlay');
    this.countdownText = document.getElementById('countdown-text');

    // Debug panel elements
    this.debugCompression = document.getElementById('debug-compression');
    this.debugGroundedness = document.getElementById('debug-groundedness');
    this.debugPenetration = document.getElementById('debug-penetration');
    this.debugVVel = document.getElementById('debug-vvel');
    this.debugSpeed = document.getElementById('debug-speed');
    this.debugGrip = document.getElementById('debug-grip');
    this.debugSlip = document.getElementById('debug-slip');
    this.debugTerrain = document.getElementById('debug-terrain');
    this.debugSlope   = document.getElementById('debug-slope');
    this.debugX = document.getElementById('debug-x');
    this.debugY = document.getElementById('debug-y');
    this.debugZ = document.getElementById('debug-z');
  }

  updateCheckpoints(count) {
    this.checkpointCounter.textContent = count;
  }

  updateLaps(count, totalLaps = null) {
    this.lapCounter.textContent = count;
    // If total laps provided, update the parent display
    if (totalLaps !== null) {
      const lapDisplay = document.getElementById('lap-display');
      if (lapDisplay) {
        lapDisplay.innerHTML = `Lap: <span id="lap-counter">${count}</span>/${totalLaps}`;
        // Re-cache the lap counter reference since we replaced the HTML
        this.lapCounter = document.getElementById('lap-counter');
      }
    }
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

  showDebugPanel() {
    if (this.debugPanel) this.debugPanel.style.display = 'block';
  }

  hideDebugPanel() {
    if (this.debugPanel) this.debugPanel.style.display = 'none';
  }

  showRaceStatusPanel() {
    if (this.raceStatusPanel) this.raceStatusPanel.style.display = 'flex';
  }

  hideRaceStatusPanel() {
    if (this.raceStatusPanel) this.raceStatusPanel.style.display = 'none';
  }

  showCountdown(text) {
    if (this.countdownOverlay) {
      this.countdownOverlay.style.display = 'flex';
      this.countdownText.textContent = text;
      this.countdownText.style.color = text === 'GO!' ? '#00ff44' : '#ffffff';
    }
  }

  hideCountdown() {
    if (this.countdownOverlay) this.countdownOverlay.style.display = 'none';
  }

  updateDebugPanel(truckState, terrainType, slopeAngleDeg = null) {
    if (!this.debugCompression) return; // Debug panel may be disabled

    const speed = truckState.velocity.length();
    
    this.debugCompression.textContent = truckState.suspensionCompression.toFixed(2);
    this.debugGroundedness.textContent = (truckState.onGround ? 1 : 0);
    this.debugPenetration.textContent = '0.00'; // Legacy field
    this.debugVVel.textContent = truckState.verticalVelocity.toFixed(2);
    this.debugSpeed.textContent = speed.toFixed(2);
    this.debugGrip.textContent = truckState.grip.toFixed(3);
    this.debugSlip.textContent = (truckState.slipAngle * 180 / Math.PI).toFixed(1) + '°';
    this.debugTerrain.textContent = terrainType.name || 'dirt';
    this.debugSlope.textContent = slopeAngleDeg !== null
      ? slopeAngleDeg.toFixed(1) + '°'
      : '-';
  }

  updatePosition(position) {
    if (!this.debugX) return; // Debug panel may be disabled
    
    this.debugX.textContent = position.x.toFixed(2);
    this.debugY.textContent = position.y.toFixed(2);
    this.debugZ.textContent = position.z.toFixed(2);
  }

  updateTimer(milliseconds) {
    if (!this.raceTimer) return;
    
    const minutes = Math.floor(milliseconds / 60000);
    const seconds = Math.floor((milliseconds % 60000) / 1000);
    const ms = Math.floor((milliseconds % 1000) / 10);
    
    this.raceTimer.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  }

  showRaceTimer() {
    if (this.raceTimer) {
      this.raceTimer.style.display = 'block';
    }
  }

  hideRaceTimer() {
    if (this.raceTimer) {
      this.raceTimer.style.display = 'none';
    }
  }
}
