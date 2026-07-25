const STORAGE_KEY = 'player_upgrades';

/**
 * Available upgrades.
 * Each level purchased adds `statDelta` to the player truck's state property.
 */
export const UPGRADES = [
  {
    id: 'topSpeed',
    label: 'Top Speed',
    description: 'Raises maximum speed',
    cost: 1000,
    maxLevel: 6,
    statKey: 'maxSpeed',
    statDelta: 2,
  },
  {
    id: 'acceleration',
    label: 'Acceleration',
    description: 'Stronger engine, faster response',
    cost: 750,
    maxLevel: 6,
    statKey: 'acceleration',
    statDelta: 2,
  },
  {
    id: 'tires',
    label: 'Tires',
    description: 'Better grip through corners',
    cost: 500,
    maxLevel: 6,
    statKey: 'grip',
    statDelta: 0.006,
  },
  {
    id: 'suspension',
    label: 'Suspension',
    description: 'Improved handling and stability',
    cost: 500,
    maxLevel: 6,
    statKey: 'suspension',
    statDelta: null,
  },
  {
    id: 'nitro',
    label: 'Nitro',
    description: 'Add a nitro boost to your stock.',
    cost: 200,
    statKey: null,
    statDelta: 1,
  },
];

function normalizeUpgradeState(candidate) {
  const normalized = { nitroCount: 5 };
  if (!candidate || typeof candidate !== 'object') return normalized;

  for (const u of UPGRADES) {
    if (u.id === 'nitro') continue;
    const raw = Number(candidate[u.id]);
    if (Number.isFinite(raw) && raw > 0) {
      normalized[u.id] = Math.min(u.maxLevel, Math.floor(raw));
    }
  }

  const rawNitro = Number(candidate.nitroCount);
  if (Number.isFinite(rawNitro) && rawNitro >= 0) {
    normalized.nitroCount = Math.min(99, Math.floor(rawNitro));
  }

  return normalized;
}

export function loadPlayerUpgrades() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return normalizeUpgradeState(null);
    return normalizeUpgradeState(JSON.parse(raw));
  } catch {
    return normalizeUpgradeState(null);
  }
}

export function savePlayerUpgrades(upgrades) {
  const normalized = normalizeUpgradeState(upgrades);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

/**
 * Pure economy core: attempt to buy one level of `upgradeId` against an
 * in-memory wallet. Touches no storage — callers own persistence (the global
 * single-race store, or per-driver championship state).
 *
 * @param {object} upgrades  Normalized upgrade state (flat: { topSpeed, …, nitroCount }).
 * @param {number} money     Available balance.
 * @param {string} upgradeId Upgrade to purchase.
 * @returns {{ ok: boolean, reason?: string, upgrades: object, money: number }}
 *          On failure, `upgrades`/`money` are returned unchanged.
 */
export function applyPurchase(upgrades, money, upgradeId) {
  const state = normalizeUpgradeState(upgrades);
  const upgrade = UPGRADES.find((u) => u.id === upgradeId);
  if (!upgrade) return { ok: false, reason: 'Unknown upgrade', upgrades: state, money };

  const isNitro = upgradeId === 'nitro';
  const key = isNitro ? 'nitroCount' : upgradeId;
  const maxLevel = isNitro ? 99 : upgrade.maxLevel;
  const level = state[key] ?? (isNitro ? 5 : 0);

  if (level >= maxLevel) return { ok: false, reason: 'Already maxed', upgrades: state, money };
  if (money < upgrade.cost) return { ok: false, reason: 'Not enough money', upgrades: state, money };

  const next = normalizeUpgradeState({ ...state, [key]: level + 1 });
  return { ok: true, upgrades: next, money: money - upgrade.cost };
}

export function incrementUpgradeLevel(upgradeId) {
  const upgrade = UPGRADES.find((u) => u.id === upgradeId);
  if (!upgrade) return { ok: false, reason: 'Unknown upgrade' };

  const state = loadPlayerUpgrades();

  if (upgradeId === 'nitro') {
    const current = state.nitroCount ?? 5;
    if (current >= 99) return { ok: false, reason: 'Already at maximum (99)' };
    state.nitroCount = current + 1;
    savePlayerUpgrades(state);
    return { ok: true, upgrades: state };
  }

  const currentLevel = state[upgradeId] ?? 0;
  if (currentLevel >= upgrade.maxLevel) return { ok: false, reason: 'Already maxed' };

  state[upgradeId] = currentLevel + 1;
  savePlayerUpgrades(state);
  return { ok: true, upgrades: state };
}

export function resetPlayerUpgrades() {
  localStorage.removeItem(STORAGE_KEY);
  return loadPlayerUpgrades();
}

export function getUpgradeCatalog({ balance = 0, ignoreBalance = false, upgrades = null } = {}) {
  // `upgrades` lets a caller (e.g. a championship driver) supply an explicit
  // upgrade state; otherwise fall back to the global single-race store.
  const purchased = upgrades ? normalizeUpgradeState(upgrades) : loadPlayerUpgrades();
  return UPGRADES.map((u) => {
    if (u.id === 'nitro') {
      const count = purchased.nitroCount ?? 5;
      return {
        ...u,
        level: count,
        maxLevel: 99,
        affordable: (ignoreBalance || balance >= u.cost) && count < 99,
      };
    }

    const level = purchased[u.id] ?? 0;
    return {
      ...u,
      level,
      affordable: (ignoreBalance || balance >= u.cost) && level < u.maxLevel,
    };
  });
}
