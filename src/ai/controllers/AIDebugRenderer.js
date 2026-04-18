import { MeshBuilder, StandardMaterial, Color3 } from "@babylonjs/core";

/**
 * AIDebugRenderer
 *
 * Handles AI path/target debug visualization lifecycle.
 */
export class AIDebugRenderer {
  constructor(driver, config = {}) {
    this.driver = driver;
    this.updateEveryFrames = config.updateEveryFrames ?? 10;
    this._debugUpdateTimer = 0;

    this.debugLines = [];
    this.debugTarget = null;
  }

  onFrame() {
    if (!this.driver.debugEnabled || !this.driver.scene) return;
    this._debugUpdateTimer++;
    if (this._debugUpdateTimer >= this.updateEveryFrames) {
      this.updateVisualization();
      this._debugUpdateTimer = 0;
    }
  }

  updateTarget(targetWaypoint) {
    if (!this.driver.debugEnabled || !this.debugTarget) return;
    this.debugTarget.position.x = targetWaypoint.x;
    this.debugTarget.position.z = targetWaypoint.z;
    this.debugTarget.position.y = this.driver._terrainQuery.heightAt(targetWaypoint.x, targetWaypoint.z) + 2;
  }

  updateVisualization() {
    const d = this.driver;
    if (!d.scene || !d.track || !d.debugEnabled) return;

    this.debugLines.forEach(mesh => mesh.dispose());
    this.debugLines = [];

    for (let i = 0; i < d.path.length; i += 5) {
      const wp = d.path[i];
      const sphere = MeshBuilder.CreateSphere(`pathDebug${i}`, { diameter: 0.5 }, d.scene);
      sphere.position.x = wp.x;
      sphere.position.y = d._terrainQuery.heightAt(wp.x, wp.z) + 1;
      sphere.position.z = wp.z;

      const mat = new StandardMaterial(`pathDebugMat${i}`, d.scene);
      mat.diffuseColor = new Color3(1, 1, 0);
      mat.emissiveColor = new Color3(0.5, 0.5, 0);
      sphere.material = mat;

      this.debugLines.push(sphere);
    }

    if (!this.debugTarget) {
      this.debugTarget = MeshBuilder.CreateSphere("aiTarget", { diameter: 1 }, d.scene);
      const targetMat = new StandardMaterial("aiTargetMat", d.scene);
      targetMat.diffuseColor = new Color3(0, 1, 0);
      targetMat.emissiveColor = new Color3(0, 0.5, 0);
      this.debugTarget.material = targetMat;
    }
  }
}
