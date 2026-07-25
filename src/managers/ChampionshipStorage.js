// Championship (cup) persistence + scoring.
//
// A championship is a fixed calendar of tracks raced by a fixed roster of
// drivers (the player + AI). Every driver carries points, a spendable money
// balance, cumulative winnings, and their own upgrade state — the whole cup
// survives a browser refresh via localStorage. One active cup at a time.
//
// Mirrors the shape/versioning of HotLapStorage. `money` is spendable (drops
// when buying upgrades); `winnings` is monotonic cumulative earnings (used for
// standings tiebreaks and the results board), so the two diverge as a driver
// shops the pit.

const ACTIVE_KEY = 'championship_active';
const SCORES_KEY = 'championship_scores';
export const CHAMPIONSHIP_SCHEMA_VERSION = 1;
export const MAX_SCORE_RECORDS = 10;

// Points + prize money by finishing position (1-based). 5th and below share the
// consolation tier.
const RACE_AWARDS = [
  { points: 10, purse: 2000 },
  { points: 7, purse: 1000 },
  { points: 4, purse: 500 },
  { points: 2, purse: 250 },
];
const CONSOLATION_AWARD = { points: 1, purse: 150 };

/** Points + purse for a 1-based finishing position. */
export function awardRace(finishPosition) {
  return RACE_AWARDS[finishPosition - 1] ?? CONSOLATION_AWARD;
}

/**
 * Build a fresh active-championship state. `drivers` is the caller-built roster
 * (player + AI); each entry is seeded to stock: 0 points, $0, no upgrades.
 */
export function createChampionship({ initials, calendar, drivers, settings = {} }) {
  return {
    version: CHAMPIONSHIP_SCHEMA_VERSION,
    initials: String(initials ?? '').toUpperCase().slice(0, 5),
    calendar: [...calendar],
    currentRaceIndex: 0,
    // Race settings held constant across the cup (laps, aiCount, aiVehicleKey,
    // reverse) so the series resumes identically after a browser refresh.
    settings: { ...settings },
    drivers: drivers.map((d) => ({
      id: d.id,
      name: d.name,
      isPlayer: !!d.isPlayer,
      vehicleKey: d.vehicleKey ?? null,
      colorKey: d.colorKey ?? null,
      points: 0,
      money: 0,
      winnings: 0,
      upgrades: {},
    })),
  };
}

function isValidActive(s) {
  return s
    && s.version === CHAMPIONSHIP_SCHEMA_VERSION
    && Array.isArray(s.calendar) && s.calendar.length > 0
    && Array.isArray(s.drivers) && s.drivers.length > 0
    && typeof s.currentRaceIndex === 'number';
}

/** The in-progress cup, or null if none/invalid. */
export function loadActiveChampionship() {
  try {
    const raw = localStorage.getItem(ACTIVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return isValidActive(data) ? data : null;
  } catch {
    return null;
  }
}

export function saveActiveChampionship(state) {
  localStorage.setItem(ACTIVE_KEY, JSON.stringify(state));
  return state;
}

export function clearActiveChampionship() {
  localStorage.removeItem(ACTIVE_KEY);
}

/** True once every race on the calendar has been run. */
export function isChampionshipComplete(state) {
  return state.currentRaceIndex >= state.calendar.length;
}

/**
 * Apply one race's finish order to the cup: award points/purse to every driver
 * by their finishing position and advance to the next race. `finishOrder` is an
 * array of driver ids, winner first. Returns a new state (input untouched).
 */
export function applyRaceResult(state, finishOrder) {
  const place = new Map(finishOrder.map((id, idx) => [id, idx + 1]));
  const drivers = state.drivers.map((d) => {
    const pos = place.get(d.id);
    if (!pos) return { ...d };
    const { points, purse } = awardRace(pos);
    return {
      ...d,
      points: d.points + points,
      money: d.money + purse,
      winnings: d.winnings + purse,
    };
  });
  return { ...state, drivers, currentRaceIndex: state.currentRaceIndex + 1 };
}

/**
 * Drivers sorted by standings: points desc, then cumulative winnings desc as a
 * tiebreak. Returns a new sorted array (does not mutate).
 */
export function standings(drivers) {
  return [...drivers].sort(
    (a, b) => b.points - a.points || b.winnings - a.winnings
  );
}

// ── Results board (initials-keyed high scores across finished cups) ──────────

function isValidScore(r) {
  return r && typeof r.initials === 'string' && typeof r.points === 'number';
}

/** Saved cup results, best first. Returns [] if none/invalid. */
export function loadChampionshipScores() {
  try {
    const raw = localStorage.getItem(SCORES_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (data?.version !== CHAMPIONSHIP_SCHEMA_VERSION || !Array.isArray(data.records)) return [];
    return data.records.filter(isValidScore).sort(sortScores).slice(0, MAX_SCORE_RECORDS);
  } catch {
    return [];
  }
}

function sortScores(a, b) {
  return b.points - a.points || b.winnings - a.winnings;
}

/**
 * Insert a finished cup's result into the board. Returns { records, rank }
 * where rank is the 0-based position, or -1 if it didn't make the cut.
 */
export function saveChampionshipScore(record) {
  const existing = loadChampionshipScores();
  const merged = [...existing, record].sort(sortScores);
  const capped = merged.slice(0, MAX_SCORE_RECORDS);
  const rank = capped.indexOf(record);
  if (rank !== -1) {
    localStorage.setItem(
      SCORES_KEY,
      JSON.stringify({ version: CHAMPIONSHIP_SCHEMA_VERSION, records: capped })
    );
  }
  return { records: rank === -1 ? existing : capped, rank };
}
