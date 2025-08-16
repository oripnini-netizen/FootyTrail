import { supabase } from './supabase';

// client/src/api.js
// Single source of truth for API base URL.
// Change REACT_APP_API_BASE in client/.env if your server runs elsewhere.

// Check that your API_BASE is correctly set to port 3001

export const API_BASE =
  process.env.NODE_ENV === 'production'
    ? process.env.REACT_APP_API_BASE?.replace(/\/+$/, '') || 'https://footytrail.up.railway.app/api'
    : 'http://localhost:3001/api'; // Should be 3001

// Add this debug line
console.log('API_BASE:', API_BASE);

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
export async function getLimits(userId) {
  const response = await fetch(`${API_BASE}/limits/${userId}?t=${Date.now()}`, {
    cache: "no-store"
  });
  if (!response.ok) throw new Error("Failed to fetch limits");
  return await response.json();
}
export const getDailyChallenge = () => jfetch('/daily');

/* Optional extras used elsewhere */
export const suggestNames = (q) => jfetch(`/names?q=${encodeURIComponent(q)}`);
export const getProfile = async () => ({});
export const updateProfile = async () => ({});
export const uploadAvatar = async () => ({});
export const saveGame = async () => ({});
export const getGameById = async () => ({});

// Add game completed function
export async function saveGameCompleted(gameData) {
  console.log('Saving game with data:', gameData);
  try {
    const response = await fetch(`${API_BASE}/game-completed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(gameData)
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      console.error('Error response from server:', {
        status: response.status,
        statusText: response.statusText,
        errorData
      });
      throw new Error(errorData?.error || errorData?.message || response.statusText || 'Error saving game record');
    }
    
    return response.json();
  } catch (error) {
    console.error('Error in saveGameCompleted:', error);
    throw error;
  }
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

export const getGamePrompt = () => jfetch('/ai/generate-game-prompt', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({})
});


export const generateDailyChallenge = async (payload) => {
  const response = await fetch(`${API_BASE}/generate-daily-challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return await response.json();
};