/**
 * Post-race results rows for RaceMode: finishers in finish order, then every
 * truck that didn't finish (DNF) in truck order. Pure — unit-tested in
 * test/race-results.test.js.
 *
 * Trucks timed out by the DNF grace are in `finishOrder` too (RaceMode's
 * _handleDNF finishes them with a null time), so "no time" is what marks a DNF
 * row — the results screen keys its DNF badge and podium off `dnf`.
 *
 * Vehicle key + driver colour ride along so the results podium can render each
 * finisher's actual truck; colour is serialised to a plain [r,g,b].
 *
 * @param {object[]} finishOrder  truckData entries, in the order they finished
 * @param {object[]} trucks       every truckData in the race
 */
export function buildRaceResultRows(finishOrder, trucks) {
  const identityOf = (td) => {
    const c = td.truck?.diffuseColor;
    return {
      vehicleKey: td.truck?.vehicleDef?.id ?? null,
      color:      c ? [c.r, c.g, c.b] : null,
    };
  };
  const finishedIds = new Set(finishOrder.map(td => td.id));
  const dnfTrucks = trucks.filter(td => !finishedIds.has(td.id));
  return [
    ...finishOrder.map((td, idx) => ({
      id:              td.id,
      name:            td.name,
      isPlayer:        td.isPlayer,
      finishPosition:  idx + 1,
      totalRaceTimeMs: td.gameState.totalRaceTime,
      fastestLapMs:    td.gameState.fastestLap,
      dnf:             td.gameState.totalRaceTime == null,
      ...identityOf(td),
    })),
    ...dnfTrucks.map((td, idx) => ({
      id:              td.id,
      name:            td.name,
      isPlayer:        td.isPlayer,
      finishPosition:  finishOrder.length + idx + 1,
      totalRaceTimeMs: null,
      fastestLapMs:    null,
      dnf:             true,
      ...identityOf(td),
    })),
  ];
}
