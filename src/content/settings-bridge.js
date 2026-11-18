import { DEFAULTS, normalizeSettings } from '../shared/settings.js';

export async function loadSettings() {
  return normalizeSettings(await chrome.storage.sync.get(DEFAULTS));
}

export async function saveSettings(patch) {
  const valid = normalizeSettings({ ...await loadSettings(), ...patch });
  await chrome.storage.sync.set(Object.fromEntries(Object.keys(patch).filter(key => key in DEFAULTS).map(key => [key, valid[key]])));
}

export function watchSettings(callback) {
  const listener = (changes, area) => {
    if (area === 'sync' && Object.keys(changes).some(key => key in DEFAULTS)) {
      loadSettings().then(callback).catch(() => {});
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
