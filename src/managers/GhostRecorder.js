export class GhostRecorder {
  constructor() {
    this.frames = [];
    this.recording = false;
  }

  start() {
    this.frames = [];
    this.recording = true;
  }

  record(position, heading) {
    if (!this.recording) return;
    this.frames.push({
      x: position.x,
      y: position.y,
      z: position.z,
      h: heading,
    });
  }

  stop() {
    this.recording = false;
    return this.frames.length > 0 ? this.frames : null;
  }

  reset() {
    this.frames = [];
    this.recording = false;
  }
}
