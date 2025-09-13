// mobile/lib/api.js
import Constants from "expo-constants";
import { supabase } from "./supabase";

// Single source of truth for API base URL (from app.json -> expo.extra)
const fromExtra = Constants?.expoConfig?.extra?.EXPO_PUBLIC_API_BASE;
if (!fromExtra) {
  throw new Error("EXPO_PUBLIC_API_BASE is not defined in app.json under expo.extra.");
}
export const API_BASE = String(fromExtra).replace(/\/+$/, "");

// Auth-aware JSON fetch (mirrors web jfetch behavior)
async function jfetch(path, opts = {}) {
  const url = `${API_BASE}${path}`;
  const method = (opts.method || "GET").toUpperCase();
  const headers = { Accept: "application/json", ...(opts.headers || {}) };

  // Forward Supabase session token (as on web)
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      headers.Authorization = `Bearer ${session.access_token}`;
    }
  } catch {
    /* ignore */
  }

  // Only set JSON content-type when there is a body and method != GET
  const body = opts.body;
  if (method !== "GET" && body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(url, { method, headers, body, cache: "no-store" });
  if (!res.ok) {
    let msg = "";
    try { msg = await res.text(); } catch {}
    throw new Error(msg || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

/* === Filters (same endpoints as web) === */
export const getCompetitions = () => jfetch("/filters/competitions");  // grouped by country + top-10
export const getSeasons       = () => jfetch("/filters/seasons");       // distinct seasons (strings)

/* === Pool counts (players_in_seasons) === */
export const getCounts = (filters) =>
  jfetch("/counts", {
    method: "POST",
    body: JSON.stringify(filters || {}),
  });

/* === Random player from players_in_seasons === */
export const getRandomPlayer = (filters, userId = null) => {
  const payload = userId ? { ...filters, userId } : (filters || {});
  return jfetch("/random-player", {
    method: "POST",
    body: JSON.stringify(payload),
  });
};

/* === Limits — match web: /limits/:userId + cache buster === */
export const getLimits = async (userId) => {
  const t = Date.now();
  // Web does fetch(`${API_BASE}/limits/${userId}?t=${Date.now()}`, { cache: 'no-store' })
  return jfetch(`/limits/${encodeURIComponent(userId)}?t=${t}`);
};

/* === Daily challenge === */
export const getDailyChallenge = () => jfetch("/daily");

/* === Name suggestions (used by mobile live-game) === */
export const suggestNames = (query, limit = 50) =>
  jfetch("/suggest-names", {
    method: "POST",
    body: JSON.stringify({ q: String(query || "").trim(), limit }),
  });

/* === Transfers (used by live/postgame) === */
export const fetchTransfers = (playerId) => {
  const id = Number(playerId);
  if (!Number.isFinite(id) || id <= 0) throw new Error("fetchTransfers: valid numeric playerId is required");
  return jfetch(`/players/${id}/transfers`);
};

/* === Persist a completed round (non-elimination path) === */
export const saveGameCompleted = (payload) => {
  if (!payload || typeof payload !== "object") throw new Error("saveGameCompleted: body payload is required");
  return jfetch("/game-completed", { method: "POST", body: JSON.stringify(payload) });
};
