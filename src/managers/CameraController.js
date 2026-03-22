import { Vector3 } from "@babylonjs/core";

/**
 * CameraController - Handles camera positioning and zoom
 */
export class CameraController {
  constructor(camera, baseOffset = new Vector3(0, 28, -20)) {
    this.camera = camera;
    this.baseOffset = baseOffset;
    
    // Zoom settings
    this.zoomLevel = 2.0;
    this.minZoom = 0.5;
    this.maxZoom = 2.5;
    this.zoomStep = 0.1;
  }

  update(targetPosition) {
    // Calculate camera position with current zoom
    const offset = this.baseOffset.scale(this.zoomLevel);
    const targetCamPos = targetPosition.add(offset);
    
    // Smoothly follow the truck
    this.camera.position.x = targetCamPos.x;
    this.camera.position.y = targetCamPos.y;
    this.camera.position.z = targetCamPos.z;
    
    // Always look at the target
    this.camera.setTarget(targetPosition);
  }

  zoomIn() {
    this.zoomLevel = Math.max(this.minZoom, this.zoomLevel - this.zoomStep);
  }

  zoomOut() {
    this.zoomLevel = Math.min(this.maxZoom, this.zoomLevel + this.zoomStep);
  }

  getCurrentZoom() {
    return this.zoomLevel;
  }

  setZoom(level) {
    this.zoomLevel = Math.max(this.minZoom, Math.min(this.maxZoom, level));
  }
}
