<template>
  <div
    v-if="debug.vehicleVisible"
    class="fixed top-2 right-2 z-[900] w-[270px] border border-emerald-400 bg-black/75 p-3 font-mono text-[11px] text-emerald-400 pointer-events-auto"
  >
    <div class="mb-2 flex items-center justify-between">
      <span class="font-bold uppercase tracking-[0.15em] text-emerald-300">Vehicle Handling</span>
      <span class="max-w-[120px] truncate text-slate-400">{{ debug.vehicle.name }}</span>
    </div>

    <!-- Handling knobs -->
    <div class="mb-1 text-[9px] uppercase tracking-[0.15em] text-slate-500">Drift knobs</div>
    <Slider label="Enter"    :value="debug.vehicle.driftEnter"    :min="0" :max="1"  :step="0.01" @change="v => debug.setVehicleKnob('driftEnter', v)" />
    <Slider label="Maintain" :value="debug.vehicle.driftMaintain" :min="0" :max="1"  :step="0.01" @change="v => debug.setVehicleKnob('driftMaintain', v)" />
    <Slider label="Lat Bias" :value="debug.vehicle.lateralBias"   :min="-1" :max="1" :step="0.01" :digits="2" @change="v => debug.setVehicleKnob('lateralBias', v)" />
    <Slider label="Exit"     :value="debug.vehicle.driftExit"     :min="0" :max="1"  :step="0.01" @change="v => debug.setVehicleKnob('driftExit', v)" />

    <!-- Direct params -->
    <div class="mb-1 mt-3 text-[9px] uppercase tracking-[0.15em] text-slate-500">Params</div>
    <Slider label="Grip"     :value="debug.vehicle.grip"           :min="0.04" :max="0.3" :step="0.005" :digits="3" @change="v => debug.setVehicleParam('grip', v)" />
    <Slider label="Turn"     :value="debug.vehicle.turnSpeed"       :min="2.5"  :max="5"   :step="0.1"   :digits="1" @change="v => debug.setVehicleParam('turnSpeed', v)" />
    <Slider label="Wt Xfer"  :value="debug.vehicle.weightTransfer"  :min="0.6"  :max="1.8" :step="0.05"  :digits="2" @change="v => debug.setVehicleParam('weightTransfer', v)" />

    <!-- Resolved low-level readout -->
    <div class="mb-1 mt-3 text-[9px] uppercase tracking-[0.15em] text-slate-500">Resolves to</div>
    <div class="grid grid-cols-2 gap-x-2 text-slate-400">
      <Readout label="thresh" :v="debug.vehicle.resolved.driftThreshold" :d="3" />
      <Readout label="maxGrip" :v="debug.vehicle.resolved.maxDriftGrip" :d="3" />
      <Readout label="dropoff" :v="debug.vehicle.resolved.slipDropoffRate" :d="2" />
      <Readout label="minSlip" :v="debug.vehicle.resolved.minSlipFactor" :d="3" />
      <Readout label="zoneCor" :v="debug.vehicle.resolved.gripZoneCorrection" :d="3" />
      <Readout label="latRet" :v="debug.vehicle.resolved.lateralRetention" :d="2" />
    </div>

    <div class="mt-3 flex items-center gap-2">
      <button
        @click="debug.copyVehicleJson()"
        class="flex-1 rounded border border-emerald-400 bg-slate-900 px-2 py-1 text-[11px] text-emerald-400 hover:bg-slate-800"
      >Copy JSON</button>
      <button
        @click="debug.resetVehicleHandling()"
        class="flex-1 rounded border border-amber-300 bg-slate-900 px-2 py-1 text-[11px] text-amber-300 hover:bg-slate-800"
      >Reset</button>
    </div>
    <div class="mt-2 text-[9px] text-slate-500">Press V to toggle · changes are live, not saved.</div>
  </div>
</template>

<script setup>
import { h } from 'vue';
import { useDebugStore } from './store.js';

const debug = useDebugStore();

// Tiny inline labeled-slider so the template above stays readable.
const Slider = {
  props: {
    label: String,
    value: Number,
    min: Number,
    max: Number,
    step: Number,
    digits: { type: Number, default: 2 },
  },
  emits: ['change'],
  setup(props, { emit }) {
    return () => h('div', { class: 'mb-1.5' }, [
      h('div', { class: 'flex justify-between' }, [
        h('span', { class: 'text-slate-400' }, props.label),
        h('span', { class: 'text-emerald-400' }, (props.value ?? 0).toFixed(props.digits)),
      ]),
      h('input', {
        type: 'range',
        min: props.min,
        max: props.max,
        step: props.step,
        value: props.value,
        class: 'w-full accent-emerald-400 cursor-pointer',
        onInput: (e) => emit('change', +e.target.value),
      }),
    ]);
  },
};

const Readout = {
  props: { label: String, v: Number, d: { type: Number, default: 2 } },
  setup(props) {
    return () => h('div', { class: 'flex justify-between' }, [
      h('span', {}, props.label),
      h('span', { class: 'text-emerald-400' }, Number.isFinite(props.v) ? props.v.toFixed(props.d) : '-'),
    ]);
  },
};
</script>
