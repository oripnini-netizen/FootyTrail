// client/src/state/gamePageCache.js
// Simple per-tab, in-memory cache. Empties on hard reload/new tab.
let cache = null;

export function saveGamePageCache(next) {
  cache = { ...next };
}

export function loadGamePageCache() {
  return cache;
}

export function clearGamePageCache() {
  cache = null;
}
