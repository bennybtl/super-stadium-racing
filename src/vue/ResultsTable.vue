<template>
  <table class="mx-auto w-full max-w-[860px] border-collapse">
    <thead>
      <tr class="menu-text text-sm tracking-[0.2em] text-slate-300">
        <th class="px-3 pb-2 text-left">Pos</th>
        <th class="px-3 pb-2 text-left">Driver</th>
        <th
          v-for="col in columns"
          :key="col.key"
          class="px-3 pb-2"
          :class="col.align === 'right' ? 'text-right' : 'text-left'"
        >{{ col.label }}</th>
      </tr>
    </thead>
    <tbody>
      <tr
        v-for="(row, i) in rows"
        :key="row.id"
        class="results-row menu-text text-xl"
        :class="row.isPlayer ? 'bg-[#ffe066]/15' : ''"
        :style="{ animationDelay: `${startDelayMs + i * staggerMs}ms` }"
      >
        <td
          class="whitespace-nowrap border-l-4 px-3 py-1.5 text-2xl"
          :class="[row.isPlayer ? 'border-[#ffe066]' : 'border-transparent', positionClass(row)]"
        >{{ ordinal(row.position) }}</td>
        <td class="px-3 py-1.5" :class="row.dnf ? 'text-slate-400' : 'text-white'">
          {{ row.name }}
          <span v-if="row.dnf" class="ml-2 text-base text-[#ff6b6b]">DNF</span>
        </td>
        <td
          v-for="col in columns"
          :key="col.key"
          class="whitespace-nowrap px-3 py-1.5 tabular-nums"
          :class="[
            col.align === 'right' ? 'text-right' : 'text-left',
            row.dnf ? 'text-slate-500' : 'text-white',
          ]"
        >{{ row.values[col.key] }}</td>
      </tr>
    </tbody>
  </table>
</template>

<script setup>
/**
 * Standings table in the menu style (heavy italic caps, black outline), shared
 * by the single-race results and the championship-complete screens.
 *
 * Rows cascade in once the podium reveal has played (RacePodium3D drops 1st at
 * ~2.8 s); the player's row gets a yellow bar and tint, DNF rows are muted.
 */
defineProps({
  // [{ key, label, align?: 'left' | 'right' }]
  columns: { type: Array, required: true },
  // [{ id, position, name, isPlayer, dnf, values: { [col.key]: string } }]
  rows: { type: Array, required: true },
  startDelayMs: { type: Number, default: 2900 },
  staggerMs: { type: Number, default: 80 },
});

function ordinal(n) {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th');
  return `${n}${s}`;
}

function positionClass(row) {
  if (row.dnf) return 'text-slate-500';
  if (row.position === 1) return 'text-[#ffd24a]';
  if (row.position === 2) return 'text-slate-200';
  if (row.position === 3) return 'text-[#e0975a]';
  return 'text-slate-400';
}
</script>
