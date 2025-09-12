// mobile/lib/api.js
import Constants from "expo-constants";

// Strict: read from app.json → expo.extra (no env and no fallbacks)
const fromExtra = Constants?.expoConfig?.extra?.EXPO_PUBLIC_API_BASE;
if (!fromExtra) {
  throw new Error(
    "EXPO_PUBLIC_API_BASE is not defined in app.json under expo.extra."
  );
}
export const API_BASE = String(fromExtra).replace(/\/+$/, "");
console.log("[API] BASE =", API_BASE);

// Minimal JSON fetch helper (no alternative code paths)
async function j(url, opts = {}) {
  const method = (opts.method || "GET").toUpperCase();
  const { headers: hdrs, body, ...rest } = opts || {};

  // Do not set Content-Type for GET
  const headers = {
    Accept: "application/json",
    ...(method !== "GET" && body ? { "Content-Type": "application/json" } : {}),
    ...hdrs,
  };

  let res;
  try {
    res = await fetch(url, { method, headers, body, cache: "no-store", ...rest });
  } catch (e) {
    throw new Error(`Network error: ${e?.message || e}`);
  }

  let data;
  let raw = null;
  try {
    data = await res.json();
  } catch {
    try {
      raw = await res.text();
    } catch { /* ignore */ }
  }

  if (!res.ok) {
    const detail =
      (data && (data.message || data.error)) ||
      (raw && raw.slice(0, 300)) ||
      `${res.status} ${res.statusText}`;
    throw new Error(`HTTP ${res.status}: ${detail}`);
  }

  return data ?? raw;
}

// -------- Existing API calls (left as-is) --------
export async function getCompetitions() {
  return j(`${API_BASE}/competitions`);
}

export async function getSeasons() {
  return j(`${API_BASE}/seasons`);
}

/**
 * Counts the player pool for the current filters.
 * payload: { competitions: string[]|number[], seasons: string[], minMarketValue: number, minAppearances: number, userId: string }
 */
export async function getCounts(payload) {
  const body = JSON.stringify(payload || {});
  console.log("[getCounts] POST", `${API_BASE}/counts`, payload);
  const out = await j(`${API_BASE}/counts`, { method: "POST", body });
  console.log("[getCounts] POST OK ->", out);
  return out;
}

export async function getRandomPlayer(payload, userId) {
  return j(`${API_BASE}/random-player`, {
    method: "POST",
    body: JSON.stringify({ ...payload, userId }),
  });
}

export async function getDailyChallenge() {
  return j(`${API_BASE}/daily`);
}

export async function getLimits(userId) {
  return j(`${API_BASE}/limits?userId=${encodeURIComponent(userId)}`);
}

// -------- New API calls expected by Live Game (parity with web) --------

// Name suggestions for the guess input
export async function suggestNames(query, limit = 50) {
  return j(`${API_BASE}/suggest-names`, {
    method: "POST",
    body: JSON.stringify({ q: String(query || "").trim(), limit }),
  });
}

// Player transfer history (used in Live Game + Postgame)
export async function fetchTransfers(playerId) {
  const id = Number(playerId);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error("fetchTransfers: valid numeric playerId is required");
  }
  // If your backend path differs, tell me and I’ll match it.
  return j(`${API_BASE}/players/${id}/transfers`);
}

// Persist a completed round (non-elimination path)
export async function saveGameCompleted(body) {
  if (!body || typeof body !== "object") {
    throw new Error("saveGameCompleted: body payload is required");
  }
  return j(`${API_BASE}/game-completed`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
