const DEFAULT_HISTORY_FRAMES = 240;
const DEFAULT_REPORT_EVERY_MS = 3000;

function nowMs() {
  return performance.now();
}

/**
 * Lightweight per-frame profiler for mode update loops.
 *
 * Usage:
 *   profiler.beginFrame(dt);
 *   profiler.measure("trucks.update", () => { ... });
 *   profiler.endFrame();
 */
export class FrameProfiler {
  constructor(name, options = {}) {
    this.name = name;
    this.enabled = options.enabled ?? false;
    this.autoReport = options.autoReport ?? true;
    this.reportEveryMs = options.reportEveryMs ?? DEFAULT_REPORT_EVERY_MS;
    this.maxHistoryFrames = options.maxHistoryFrames ?? DEFAULT_HISTORY_FRAMES;

    this._frameStartMs = 0;
    this._frameActive = false;
    this._sectionStarts = Object.create(null);
    this._sections = Object.create(null);
    this._frames = [];
    this._lastReportAt = 0;
    this._boundWindowApi = false;
  }

  bindWindowApi(target = window, key = "gameLoopProfiler") {
    if (!target || this._boundWindowApi) return;
    target[key] = {
      enable: () => this.setEnabled(true),
      disable: () => this.setEnabled(false),
      toggle: () => this.setEnabled(!this.enabled),
      dump: () => this.dump(),
      report: () => this.report(),
      clear: () => this.clear(),
      setAutoReport: (value) => {
        this.autoReport = !!value;
      },
      setReportEveryMs: (ms) => {
        const next = Number(ms);
        if (Number.isFinite(next) && next > 0) this.reportEveryMs = next;
      },
      getSnapshot: () => this.getSnapshot(),
      status: () => ({
        enabled: this.enabled,
        autoReport: this.autoReport,
        reportEveryMs: this.reportEveryMs,
        historyFrames: this._frames.length,
        maxHistoryFrames: this.maxHistoryFrames,
      }),
    };
    this._boundWindowApi = true;
  }

  dispose(target = window, key = "gameLoopProfiler") {
    if (this._boundWindowApi && target?.[key]) {
      delete target[key];
    }
    this._boundWindowApi = false;
    this.clear();
  }

  setEnabled(enabled) {
    const next = !!enabled;
    if (this.enabled === next) return;
    this.enabled = next;
    persistFrameProfilerEnabled(next);
    if (next) {
      this._lastReportAt = nowMs();
      console.log(`[FrameProfiler:${this.name}] enabled`);
    } else {
      console.log(`[FrameProfiler:${this.name}] disabled`);
    }
  }

  clear() {
    this._frameStartMs = 0;
    this._frameActive = false;
    this._sectionStarts = Object.create(null);
    this._sections = Object.create(null);
    this._frames = [];
  }

  beginFrame(dt = 0) {
    if (!this.enabled) return;
    this._frameStartMs = nowMs();
    this._frameActive = true;
    this._sectionStarts = Object.create(null);
    this._sections = Object.create(null);
    this._dt = dt;
  }

  start(label) {
    if (!this.enabled) return;
    this._sectionStarts[label] = nowMs();
  }

  end(label) {
    if (!this.enabled) return;
    const start = this._sectionStarts[label];
    if (start == null) return;
    const delta = nowMs() - start;
    this._sections[label] = (this._sections[label] ?? 0) + delta;
    delete this._sectionStarts[label];
  }

  measure(label, fn) {
    if (!this.enabled) return fn();
    const t0 = nowMs();
    try {
      return fn();
    } finally {
      const delta = nowMs() - t0;
      this._sections[label] = (this._sections[label] ?? 0) + delta;
    }
  }

  addDuration(label, durationMs) {
    if (!this.enabled || !this._frameActive) return;
    const safeDuration = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
    if (safeDuration <= 0) return;
    this._sections[label] = (this._sections[label] ?? 0) + safeDuration;
  }

  endFrame() {
    if (!this.enabled || !this._frameActive) return;
    this._frameActive = false;

    for (const label of Object.keys(this._sectionStarts)) {
      const start = this._sectionStarts[label];
      const delta = nowMs() - start;
      this._sections[label] = (this._sections[label] ?? 0) + delta;
    }
    this._sectionStarts = Object.create(null);

    const frameMs = Math.max(0, nowMs() - this._frameStartMs);
    const row = {
      frameMs,
      dt: this._dt,
      sections: { ...this._sections },
      at: Date.now(),
    };
    this._frames.push(row);
    if (this._frames.length > this.maxHistoryFrames) {
      this._frames.shift();
    }

    if (this.autoReport) {
      const now = nowMs();
      if (now - this._lastReportAt >= this.reportEveryMs) {
        this.report();
        this._lastReportAt = now;
      }
    }
  }

  getSnapshot() {
    const frames = this._frames;
    const frameCount = frames.length;
    if (frameCount === 0) {
      return {
        name: this.name,
        frameCount: 0,
        avgFrameMs: 0,
        fps: 0,
        sections: [],
      };
    }

    let totalFrameMs = 0;
    let minFrameMs = Number.POSITIVE_INFINITY;
    let maxFrameMs = 0;
    const sectionTotals = Object.create(null);

    for (const frame of frames) {
      totalFrameMs += frame.frameMs;
      if (frame.frameMs < minFrameMs) minFrameMs = frame.frameMs;
      if (frame.frameMs > maxFrameMs) maxFrameMs = frame.frameMs;
      for (const [name, ms] of Object.entries(frame.sections)) {
        sectionTotals[name] = (sectionTotals[name] ?? 0) + ms;
      }
    }

    const avgFrameMs = totalFrameMs / frameCount;
    const fps = avgFrameMs > 0 ? 1000 / avgFrameMs : 0;

    const sections = Object.entries(sectionTotals)
      .map(([name, totalMs]) => {
        const avgMs = totalMs / frameCount;
        return {
          section: name,
          avgMs,
          pctFrame: avgFrameMs > 0 ? (avgMs / avgFrameMs) * 100 : 0,
        };
      })
      .sort((a, b) => b.avgMs - a.avgMs);

    const profiledMs = sections.reduce((sum, s) => sum + s.avgMs, 0);
    const unprofiledMs = Math.max(0, avgFrameMs - profiledMs);
    if (unprofiledMs > 0.05) {
      sections.push({
        section: "unprofiled",
        avgMs: unprofiledMs,
        pctFrame: avgFrameMs > 0 ? (unprofiledMs / avgFrameMs) * 100 : 0,
      });
    }

    return {
      name: this.name,
      frameCount,
      avgFrameMs,
      minFrameMs,
      maxFrameMs,
      fps,
      sections,
    };
  }

  report() {
    const snapshot = this.getSnapshot();
    if (snapshot.frameCount === 0) return;

    console.groupCollapsed(
      `[FrameProfiler:${snapshot.name}] ${snapshot.frameCount}f avg ${snapshot.avgFrameMs.toFixed(2)}ms (${snapshot.fps.toFixed(1)} fps)`
    );
    console.table(
      snapshot.sections.map((s) => ({
        section: s.section,
        avgMs: +s.avgMs.toFixed(3),
        pctFrame: `${s.pctFrame.toFixed(1)}%`,
      }))
    );
    console.log(
      `frame min/avg/max = ${snapshot.minFrameMs.toFixed(2)} / ${snapshot.avgFrameMs.toFixed(2)} / ${snapshot.maxFrameMs.toFixed(2)} ms`
    );
    console.groupEnd();
  }

  dump() {
    this.report();
  }
}

export function shouldEnableFrameProfiler() {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("profile") === "1") return true;
    if (params.get("profile") === "true") return true;
    const persisted = window.localStorage.getItem("offroad.frameProfiler.enabled");
    if (persisted === "1" || persisted === "true") return true;
  } catch (_err) {
    // Ignore URL/localStorage read failures in constrained environments.
  }
  return false;
}

export function persistFrameProfilerEnabled(enabled) {
  try {
    window.localStorage.setItem("offroad.frameProfiler.enabled", enabled ? "1" : "0");
  } catch (_err) {
    // Ignore storage failures.
  }
}
