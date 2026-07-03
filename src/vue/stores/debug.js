import { defineStore } from 'pinia';
import { ref, reactive, shallowRef } from 'vue';

// ─── Debug panel store ────────────────────────────────────────────────────────
export const useDebugStore = defineStore('debug', () => {
  const visible = ref(false);
  const showBridgeDriveSurfaces = ref(false);
  const data = reactive({
    compression: '-', groundedness: '-', penetration: '-',
    vvel: '-', speed: '-', grip: '-', slip: '-',
    terrain: '-', slope: '-', x: '0.00', y: '0.00', z: '0.00',
    nx: '0.000', ny: '1.000', nz: '0.000',
    surfaceId: '-', surfaceType: '-', surfaceKind: '-', surfaceLevel: '-',
    topologyNodes: '-', topologyConnectors: '-', topologySummary: '-',
    topologyAutoLinked: '-', topologyAutoUnlinked: '-',
    topologyTerrainLinks: '-', topologyBridgeLinks: '-',
  });
  const recording  = ref(false);
  const frameCount = ref(0);

  // ── Vehicle handling debug overlay (practice mode) ──
  const vehicleVisible = ref(false);
  const vehicle = reactive({
    name: '-',
    // High-level handling knobs (the live-tunable interface).
    driftEnter: 0.5,
    driftMaintain: 0.5,
    lateralBias: 0.0,
    driftExit: 0.5,
    // A few high-value params that round out the vehicle's feel.
    grip: 0.12,
    turnSpeed: 3.6,
    weightTransfer: 1.35,
    // Read-only: the low-level drift values the knobs currently resolve to.
    resolved: {},
  });

  const _bridge = shallowRef(null);
  function setBridge(mgr) { _bridge.value = mgr; }
  function startRecording() { _bridge.value?.startRecording(); }
  function stopRecording()  { _bridge.value?.stopRecording();  }
  function dumpLog()        { _bridge.value?.dumpLog();        }
  function toggleBridgeDriveSurfaces() {
    showBridgeDriveSurfaces.value = !showBridgeDriveSurfaces.value;
    _bridge.value?.setBridgeDriveSurfaceDebug?.(showBridgeDriveSurfaces.value);
  }
  // Setting a handling knob re-resolves the low-level drift params on the truck.
  function setVehicleKnob(key, val) {
    vehicle[key] = val;
    _bridge.value?.applyVehicleHandling?.();
  }
  // Setting a direct param writes it straight onto truck state.
  function setVehicleParam(key, val) {
    vehicle[key] = val;
    _bridge.value?.applyVehicleParam?.(key, val);
  }
  function copyVehicleJson() { _bridge.value?.copyVehicleJson?.(); }
  function resetVehicleHandling() { _bridge.value?.resetVehicleHandling?.(); }

  return {
    visible,
    showBridgeDriveSurfaces,
    data,
    recording,
    frameCount,
    vehicleVisible,
    vehicle,
    setBridge,
    startRecording,
    stopRecording,
    dumpLog,
    toggleBridgeDriveSurfaces,
    setVehicleKnob,
    setVehicleParam,
    copyVehicleJson,
    resetVehicleHandling,
  };
});
