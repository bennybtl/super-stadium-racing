const STORAGE_KEYS = {
  controls: 'settings.controls',
  audio: 'settings.audio',
  display: 'settings.display',
};

export const DEFAULT_CONTROLS_SETTINGS = {
  driving: {
    Gas: 'KeyW',
    'Brake/Reverse': 'KeyS',
    'Steer Left': 'KeyA',
    'Steer Right': 'KeyD',
    'Use Nitro': 'KeyQ',
    'Reset Truck': 'KeyR',
    'Cycle Camera': 'KeyC',
    'Toggle Debug': 'Backslash',
    'Toggle Photo Mode': 'KeyP',
    'Zoom In': 'Equal',
    'Zoom Out': 'Minus',
  },
  editor: {
    'Move Forward': 'W',
    'Move Backward': 'S',
    'Move Left': 'D',
    'Move Right': 'A',
    'Zoom Out': '_',
    'Zoom In': '=',
    'Rotate Left': 'Q',
    'Rotate Right': 'E',
    'Fast Move(hold)': 'Shift',
    Delete: 'Backspace',
    Duplicate: 'Ctrl + D',
    Undo: 'Ctrl + Z',
    Redo: 'Ctrl + Shift + Z',
    'Add Feature': 'Space',
    'Toggle Snap': 'G',
    'Snap Size': 'Shift + G',
  },
};

export const DEFAULT_AUDIO_SETTINGS = {
  engine: 80,
  effects: 80,
  music: 0,
};

export const DEFAULT_DISPLAY_SETTINGS = {
  shadow: 'medium',
  lights: 4,
};

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function readStorageObject(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function normalizeControlsSettings(candidate) {
  return {
    driving: {
      ...DEFAULT_CONTROLS_SETTINGS.driving,
      ...(candidate?.driving || {}),
    },
    editor: {
      ...DEFAULT_CONTROLS_SETTINGS.editor,
      ...(candidate?.editor || {}),
    },
  };
}

function normalizeAudioSettings(candidate) {
  return {
    engine: clamp(candidate?.engine ?? DEFAULT_AUDIO_SETTINGS.engine, 0, 100),
    effects: clamp(candidate?.effects ?? DEFAULT_AUDIO_SETTINGS.effects, 0, 100),
    music: clamp(candidate?.music ?? DEFAULT_AUDIO_SETTINGS.music, 0, 100),
  };
}

function normalizeDisplaySettings(candidate) {
  const shadow = candidate?.shadow;
  const lights = Number(candidate?.lights);
  const validShadow = shadow === 'off' || shadow === 'low' || shadow === 'medium' || shadow === 'high';
  const validLights = lights === 1 || lights === 2 || lights === 4;

  return {
    shadow: validShadow ? shadow : DEFAULT_DISPLAY_SETTINGS.shadow,
    lights: validLights ? lights : DEFAULT_DISPLAY_SETTINGS.lights,
  };
}

function writeStorageObject(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function loadControlsSettings() {
  return normalizeControlsSettings(readStorageObject(STORAGE_KEYS.controls));
}

export function saveControlsSettings(value) {
  writeStorageObject(STORAGE_KEYS.controls, normalizeControlsSettings(value));
}

export function loadAudioSettings() {
  return normalizeAudioSettings(readStorageObject(STORAGE_KEYS.audio));
}

export function saveAudioSettings(value) {
  const normalized = normalizeAudioSettings(value);
  writeStorageObject(STORAGE_KEYS.audio, normalized);

  // Broadcast so live systems (e.g. AudioManager) can react immediately.
  window.dispatchEvent(new CustomEvent('offroad:audio-settings-changed', {
    detail: normalized,
  }));
}

export function loadDisplaySettings() {
  return normalizeDisplaySettings(readStorageObject(STORAGE_KEYS.display));
}

export function saveDisplaySettings(value) {
  const normalized = normalizeDisplaySettings(value);
  writeStorageObject(STORAGE_KEYS.display, normalized);

  window.dispatchEvent(new CustomEvent('offroad:display-settings-changed', {
    detail: normalized,
  }));
}

export function getDefaultControlsSettings() {
  return deepClone(DEFAULT_CONTROLS_SETTINGS);
}

export function initializeSettingsStorage() {
  const controls = loadControlsSettings();
  const audio = loadAudioSettings();
  const display = loadDisplaySettings();

  saveControlsSettings(controls);
  saveAudioSettings(audio);
  saveDisplaySettings(display);

  return { controls, audio, display };
}
