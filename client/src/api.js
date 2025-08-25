// client/src/api.js
import { supabase } from './supabase';

// Single source of truth for API base URL.
export const API_BASE =
  process.env.NODE_ENV === 'production'
    ? (process.env.REACT_APP_API_BASE?.replace(/\/+$/, '') || 'https://footytrail.up.railway.app/api')
    : 'http://localhost:3001/api';

async function jfetch(path, opts = {}) {
  // Forward the Supabase session token to the server (for any RLS-protected routes)
  const { data: { session } } = await supabase.auth.getSession();
  if (!opts.headers) opts.headers = {};
  if (session?.access_token) {
    opts.headers['Authorization'] = `Bearer ${session.access_token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, opts);
  if (!res.ok) {
    let msg = '';
    try { msg = await res.text(); } catch {}
    throw new Error(msg || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

/* === Filters (new datasource) === */
export const getCompetitions = () => jfetch('/filters/competitions');   // grouped by country + top-10
export const getSeasons       = () => jfetch('/filters/seasons');        // distinct seasons (strings)

/* === Pool counts (players_in_seasons) === */
export const getCounts = (filters) =>
  jfetch('/counts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(filters || {}),
  });

/* === Random player from players_in_seasons === */
export const getRandomPlayer = (filters, userId = null) => {
  const payload = userId ? { ...filters, userId } : (filters || {});
  return jfetch('/random-player', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
};

export async function getLimits(userId) {
  const res = await fetch(`${API_BASE}/limits/${userId}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch limits');
  return res.json();
}

export const getDailyChallenge = () => jfetch('/daily');

/** Transfer history via backend proxy (Transfermarkt CE API) */
export const fetchTransfers = async (playerId) => {
  try {
    const response = await jfetch(`/transfers/${playerId}`);
    return response.transfers || [];
  } catch (e) {
    console.error('❌ Error fetching transfers:', e);
    return [];
  }
};

export const getGamePrompt = () =>
  jfetch('/ai/generate-game-prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

export const generateDailyChallenge = async (payload) => {
  const res = await fetch(`${API_BASE}/generate-daily-challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json();
};

export async function saveGameCompleted(gameData) {
  const res = await fetch(`${API_BASE}/game-completed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(gameData),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error || err?.message || res.statusText || 'Error saving game record');
  }
  return res.json();
}

/* === Admin: players coverage via Supabase RPC === */
export async function getPlayersCoverage() {
  const { data, error } = await supabase.rpc('players_coverage');
  if (error) throw error;
  return data || [];
}

/* === Suggestions (use Supabase RPC) ===
   Return rows AS-IS so we don't drop fields like player_photo. */
export async function suggestNames(query, limit = 50) {
  const q = typeof query === 'string' ? query : (query?.query || '');
  const lim = typeof query === 'object' && Number.isFinite(query?.limit) ? query.limit : limit;

  const { data, error } = await supabase.rpc('suggest_names', { q, lim });
  if (error) throw error;

  // data rows already include: player_id, player_name, player_norm_name, player_photo
  return Array.isArray(data) ? data : [];
}

export const getProfile    = async () => ({});
export const updateProfile = async () => ({});
export const uploadAvatar  = async () => ({});
export const saveGame      = async () => ({});
export const getGameById   = async () => ({});

export const getGameOutro = async (payload) => {
  const res = await fetch(`${API_BASE}/ai/game-outro`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Failed to generate outro: ${res.status}`);
  }
  return res.json(); // { line: string }
};
