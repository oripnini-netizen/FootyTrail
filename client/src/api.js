import { supabase } from './supabase';

// client/src/api.js
// Single source of truth for API base URL.
// Change REACT_APP_API_BASE in client/.env if your server runs elsewhere.

const API_BASE =
  process.env.REACT_APP_API_BASE?.replace(/\/+$/, '') || 'http://localhost:3000/api';

async function jfetch(path, opts = {}) {
  const { data: { session }, error } = await supabase.auth.getSession();
  
  if (!opts.headers) opts.headers = {};
  if (session?.access_token) {
    opts.headers['Authorization'] = `Bearer ${session.access_token}`;
  }
  
  console.log('jfetch called with:', { path, opts }); // Debug log
  
  const res = await fetch(`${API_BASE}${path}`, opts);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/* === Public API === */
export const getLeagues = () => jfetch('/filters/leagues');
export const getSeasons = () => jfetch('/filters/seasons');
export const getCounts = (filters) =>
  jfetch('/counts', { 
    method: 'POST', 
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(filters) 
  });
export const getRandomPlayer = (filters, userId = null) => {
  console.log('🎯 getRandomPlayer called with filters:', filters, 'userId:', userId);
  
  // Include userId in the filters object if provided
  const filtersWithUser = userId ? { ...filters, userId } : filters;
  
  return jfetch('/random-player', { 
    method: 'POST', 
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(filtersWithUser) 
  });
};
export const getLimits = (userId) => jfetch(`/limits?userId=${userId}`);
export const getDailyChallenge = () => jfetch('/daily');

/* Optional extras used elsewhere */
export const suggestNames = (q) => jfetch(`/names?q=${encodeURIComponent(q)}`);
export const getProfile = async () => ({});
export const updateProfile = async () => ({});
export const uploadAvatar = async () => ({});
export const saveGame = async () => ({});
export const getGameById = async () => ({});
export async function addGameRecord(gameRecord) {
  return jfetch('/games', {  // Changed back to original path
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(gameRecord)
  });
}

// Add this to client/src/api.js
export const fetchTransfers = async (playerId) => {
  try {
    console.log('🔍 Fetching transfers for player ID:', playerId);
    const response = await jfetch(`/transfers/${playerId}`);
    console.log('📋 Transfers API response:', response);
    return response.transfers || [];
  } catch (error) {
    console.error('❌ Error fetching transfers:', error);
    return [];
  }
};
