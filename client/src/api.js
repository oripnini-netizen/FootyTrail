// client/src/api.js
import { supabase } from './supabase';

// Single source of truth for API base URL.
export const API_BASE =
  process.env.NODE_ENV === 'production'
    ? process.env.REACT_APP_API_BASE?.replace(/\/+$/, '') || 'https://footytrail.up.railway.app/api'
    : 'http://localhost:3001/api';

console.log('API_BASE:', API_BASE);

async function jfetch(path, opts = {}) {
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

/* === Legacy leagues (kept for pages still importing getLeagues) === */
export const getLeagues = () => jfetch('/filters/leagues');

/* === New filters === */
export const getCompetitions = () => jfetch('/filters/competitions');
export const getSeasons       = () => jfetch('/filters/seasons');

/* === Pool counts (new model) === */
export const getCounts = (filters) =>
  jfetch('/counts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(filters),
  });

/* === Random player (new model) === */
export const getRandomPlayer = (filters, userId = null) => {
  const filtersWithUser = userId ? { ...filters, userId } : filters;
  return jfetch('/random-player', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(filtersWithUser),
  });
};

/* === Limits & daily === */
export async function getLimits(userId) {
  const response = await fetch(`${API_BASE}/limits/${userId}?t=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error('Failed to fetch limits');
  return await response.json();
}

export const getDailyChallenge = () => jfetch('/daily');

/* === Names, profile, uploads (unchanged placeholders) === */
export const suggestNames  = (q) => jfetch(`/names?q=${encodeURIComponent(q)}`);
export const getProfile    = async () => ({});
export const updateProfile = async () => ({});
export const uploadAvatar  = async () => ({});
export const saveGame      = async () => ({});
export const getGameById   = async () => ({});

export async function saveGameCompleted(gameData) {
  const response = await fetch(`${API_BASE}/game-completed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(gameData),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(errorData?.error || errorData?.message || response.statusText || 'Error saving game record');
  }
  return response.json();
}

export const fetchTransfers = async (playerId) => {
  try {
    const response = await jfetch(`/transfers/${playerId}`);
    return response.transfers || [];
  } catch (error) {
    console.error('❌ Error fetching transfers:', error);
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
  const response = await fetch(`${API_BASE}/generate-daily-challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return await response.json();
};
