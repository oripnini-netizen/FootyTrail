// client/src/state/postGameCache.js

const KEY = 'ft_postgame_cache_v1';

export function loadPostGameCache() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function savePostGameCache(payload) {
  try {
    localStorage.setItem(KEY, JSON.stringify(payload || {}));
  } catch {
    // ignore
  }
}

export function clearPostGameCache() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
