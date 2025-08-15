// routes/game.js
// Uses Supabase RPC functions for speed (with safe REST fallbacks)

import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '../services/supabaseClient.js';
import fetch from 'node-fetch';
import { authRequired } from './middleware.js';

// ---------- Env / Supabase ----------
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const useRpcCounts = process.env.USE_RPC_COUNTS === '1';
const rapidKey = process.env.RAPIDAPI_KEY || '';  // ✅ This should be correct

// Add this debug log to verify the key is loaded
console.log('🔑 Environment check in game.js:');
console.log('- RAPIDAPI_KEY loaded:', rapidKey ? 'Yes' : 'No');
console.log('- Key length:', rapidKey.length);

if (!supabaseUrl || !serviceKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
}

// const sb = createClient(supabaseUrl, serviceKey);
const router = express.Router();

// ---------- Schema ----------
const TABLE_PS = 'players_seasons';
const TABLE_LS = 'leagues_seasons';

const PS = {
  seasonYear: 'season_year',
  playerId: 'player_id',
  playerName: 'player_name',
  playerAge: 'player_age',
  playerNationality: 'player_nationality',
  playerPhoto: 'player_photo',
  playerApps: 'player_appearences', // original spelling in your table
  playerPosition: 'player_position',
  leagueId: 'league_id',
  playerNormName: 'player_norm_name',
  plsId: 'player_league_season_id',
};

const LS = {
  leagueSeasonId: 'league_season_id',
  leagueId: 'league_id',
  leagueName: 'league_name',
  type: 'type',
  logo: 'logo',
  countryName: 'country_name',
  countryFlag: 'country_flag',
  seasonYear: 'season_year',
};

// ---------- RapidAPI transfers ----------
const RAPID_API_HOST = 'api-football-v1.p.rapidapi.com';
const RAPID_API_BASE = `https://${RAPID_API_HOST}/v3`;

// ---------- Helpers ----------
const toNumArr = (v) =>
  Array.isArray(v) ? v.map((x) => Number(x)).filter((n) => !Number.isNaN(n)) : [];

function normalizeFilters(raw) {
  console.log('🔧 normalizeFilters input:', raw); // Debug log
  
  const result = {
    leagues: Array.isArray(raw.leagues) ? raw.leagues.map(Number) : [],
    seasons: Array.isArray(raw.seasons) ? raw.seasons.map(Number) : [],
    minAppearances: Number(raw.minAppearances) || 0,
  };
  
  console.log('🔧 normalizeFilters output:', result); // Debug log
  return result;
}

function applyFilters(q, { leagues = [], seasons = [], minAppearances = 0 }) {
  if (leagues.length) {
    // DB column is BIGINT; supabase-js will coerce strings fine, but be explicit:
    const leagueNums = leagues.map((x) => Number(x)).filter((n) => !Number.isNaN(n));
    q = q.in(PS.leagueId, leagueNums);
  }
  if (seasons.length) q = q.in(PS.seasonYear, seasons);
  if (minAppearances > 0) q = q.gte(PS.playerApps, minAppearances);
  return q;
}

async function fetchTransfers(playerId) {
  if (!rapidKey) return [];
  const url = `${RAPID_API_BASE}/transfers?player=${encodeURIComponent(playerId)}`;
  const res = await fetch(url, {
    headers: {
      'x-rapidapi-host': RAPID_API_HOST,
      'x-rapidapi-key': rapidKey,  // ✅ Fix: use rapidKey instead of RAPIDAPI_KEY
    },
  });
  if (!res.ok) return [];
  const json = await res.json().catch(() => null);
  const list = json?.response?.[0]?.transfers || [];
  const norm = list.map((t) => ({
    date: t?.date ?? null,
    type: t?.type ?? null,
    in: { name: t?.teams?.in?.name ?? null, logo: t?.teams?.in?.logo ?? null },
    out: { name: t?.teams?.out?.name ?? null, logo: t?.teams?.out?.logo ?? null },
  }));
  norm.sort((a, b) => (Date.parse(a.date || 0) - Date.parse(b.date || 0)));
  return norm;
}

async function getPlayerCard(playerId) {
  const { data, error } = await supabase
    .from(TABLE_PS)
    .select(
      [
        PS.playerId,
        PS.playerName,
        PS.playerAge,
        PS.playerNationality,
        PS.playerPhoto,
        PS.playerPosition,
        PS.seasonYear,
        PS.leagueId,
      ].join(',')
    )
    .eq(PS.playerId, playerId)
    .order(PS.seasonYear, { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

// ---------- REST fallbacks (no RPC) ----------
async function getDistinctPlayerIdsREST(filters, limit = 20000) {
  let q = supabase.from(TABLE_PS)
    .select(PS.playerId)
    .order(PS.playerId, { ascending: true })
    .range(0, limit - 1);
  q = applyFilters(q, filters);
  const { data, error } = await q;
  if (error) throw error;
  const out = [];
  let prev = null;
  for (const r of data || []) {
    const id = r[PS.playerId];
    if (id != null && id !== prev) {
      out.push(id);
      prev = id;
    }
  }
  return out;
}

// ---------- RPC calls (fast path) ----------
// Update the countDistinctPlayersRPC function in routes/game.js
async function countDistinctPlayersRPC({ leagues, seasons, minAppearances }) {
  console.log('RPC called with:', { leagues, seasons, minAppearances });
  
  const rpcParams = {
    leagues: (leagues && leagues.length > 0) ? leagues.map(Number) : null, // Convert to numbers
    seasons: (seasons && seasons.length > 0) ? seasons.map(Number) : null, // Convert to numbers
    min_app: minAppearances || 0,
  };
  
  console.log('RPC params sent to Supabase:', rpcParams);
  
  const { data, error } = await supabase.rpc('rpc_count_players', rpcParams);
  
  if (error) {
    console.error('RPC error:', error);
    throw error;
  }
  
  console.log('RPC returned:', data);
  return typeof data === 'number' ? data : (data?.count ?? 0);
}

async function randomPlayerRPC({ leagues, seasons, minAppearances }) {
  const { data, error } = await supabase.rpc('rpc_random_player', {
    leagues: leagues?.length ? leagues : null,
    seasons: seasons?.length ? seasons : null,
    min_app: minAppearances || 0,
  });
  if (error) throw error;
  if (!data) return null;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.player_id) return null;
  return { id: row.player_id, name: row.player_name ?? null };
}

// Add this function to routes/game.js
async function getDistinctPlayerIdsRPC({ leagues, seasons, minAppearances }) {
  console.log('🔍 RPC: Getting player IDs with filters:', { leagues, seasons, minAppearances });
  
  const { data, error } = await supabase.rpc('rpc_get_player_ids', {
    leagues: (leagues && leagues.length > 0) ? leagues.map(Number) : null,
    seasons: (seasons && seasons.length > 0) ? seasons.map(Number) : null,
    min_app: minAppearances || 0,
  });
  
  if (error) {
    console.error('RPC error getting player IDs:', error);
    throw error;
  }
  
  console.log('🔍 RPC returned:', data?.length, 'player IDs');
  return data || [];
}

// ---------- Routes ----------

// LEAGUES (unique by league_id, grouped by country)
router.get('/filters/leagues', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from(TABLE_LS)
      .select('league_id, league_name, logo, country_name, country_flag');

    if (error) return res.status(500).json({ error: error.message });

    // dedupe by league_id (server-side)
    const byId = new Map();
    for (const r of data || []) {
      const lid = String(r.league_id);
      if (!byId.has(lid)) byId.set(lid, { ...r, league_id: lid });
    }

    // group by country
    const groupedByCountry = {};
    for (const r of byId.values()) {
      const country = r.country_name || 'Unknown';
      if (!groupedByCountry[country]) groupedByCountry[country] = [];
      groupedByCountry[country].push({
        league_id: r.league_id,       // string
        league_name: r.league_name,
        logo: r.logo,
        country_flag: r.country_flag,
      });
    }
    // sort countries and leagues
    for (const key of Object.keys(groupedByCountry)) {
      groupedByCountry[key].sort((a, b) => a.league_name.localeCompare(b.league_name));
    }

    // quick tags: popular unique names (cap at 8)
    const tags = Array.from(
      new Set(Array.from(byId.values()).map((r) => r.league_name))
    ).slice(0, 8);

    res.json({ groupedByCountry, tags });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load leagues.' });
  }
});

// SEASONS (unique + sorted desc)
router.get('/filters/seasons', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from(TABLE_LS)
      .select('season_year');

    if (error) return res.status(500).json({ error: error.message });

    const seasons = Array.from(
      new Set((data || []).map((r) => Number(r.season_year)).filter(Boolean))
    ).sort((a, b) => b - a);

    res.json({ seasons });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load seasons.' });
  }
});

// Counts: pool + total (RPC preferred) — return { poolCount, totalCount }
// Update the /counts route in routes/game.js
router.post('/counts', async (req, res) => {
  console.log('=== COUNTS ENDPOINT HIT ===');
  console.log('Raw request body:', req.body);
  
  try {
    const filters = normalizeFilters(req.body);
    console.log('Normalized filters:', filters);
    
    // Extract userId directly from req.body (NOT from filters)
    const userId = req.body.userId;
    console.log('👤 User ID from request:', userId);
    
    let poolCount, totalCount;
    
    if (useRpcCounts) {
      // Get filtered count
      console.log('Getting filtered count...');
      poolCount = await countDistinctPlayersRPC({
        leagues: filters.leagues,
        seasons: filters.seasons,
        min_app: filters.minAppearances
      });
      console.log('Initial pool count:', poolCount);
      
      // Get total count with no filters
      console.log('Getting total count...');
      totalCount = await countDistinctPlayersRPC({
        leagues: null,
        seasons: null,
        min_app: 0
      });
      
      // Add this explicit check for userId
      if (userId) {
        console.log('👤 Processing exclusions for user:', userId);
        
        // Calculate date 30 days ago
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const dateString = thirtyDaysAgo.toISOString();
        console.log('👤 Excluding games played since:', dateString);
        
        // Check if player_id is numeric and adjust query accordingly
        const { data: recentGames, error: recentError } = await supabase
          .from('games_records')
          .select('player_id')  // player_id is integer in database
          .eq('user_id', userId)
          .gte('created_at', dateString);
        
        if (recentError) {
          console.error('👤 Error fetching recent games:', recentError);
        } else {
          console.log(`👤 Found ${recentGames?.length || 0} recent games:`, recentGames);
          
          if (recentGames && recentGames.length > 0) {
            // Extract player IDs that aren't null
            const recentPlayerIds = recentGames
              .map(game => game.player_id)
              .filter(Boolean);
            
            console.log(`👤 Extracted ${recentPlayerIds.length} valid player IDs:`, recentPlayerIds);
            
            if (recentPlayerIds.length > 0) {
              // Get ALL player IDs that match current filters
              const filteredIds = await getDistinctPlayerIdsRPC(filters);
              
              // Convert filteredIds to numbers for comparison with database integer IDs
              const filteredIdsAsNumbers = filteredIds.map(id => 
                typeof id === 'string' ? parseInt(id, 10) : id
              );
              
              console.log('👤 Sample filtered IDs:', filteredIdsAsNumbers.slice(0, 3));
              
              // Find overlap - both should be numbers now
              const recentInPool = recentPlayerIds.filter(recentId => 
                filteredIdsAsNumbers.includes(recentId)
              ).length;
              
              console.log(`👤 Found ${recentInPool} recent players in current pool`);
              
              // Subtract from pool count
              if (recentInPool > 0) {
                const oldCount = poolCount;
                poolCount = Math.max(0, poolCount - recentInPool);
                console.log(`👤 Adjusted pool count: ${oldCount} → ${poolCount}`);
              }
            }
          } else {
            console.log('👤 No recent games found for this user');
          }
        }
      } else {
        console.log('👤 No userId provided, skipping exclusions');
      }
      
      console.log('Final counts:', { poolCount, totalCount });
      return res.json({ poolCount, totalCount });
    } else {
      // REST fallback - similar logic with string conversion
      console.log('Using REST fallback...');
      const allPoolIds = await getDistinctPlayerIdsREST(filters, 20000);
      let poolIds = [...allPoolIds]; // Make a copy
      
      // Filter out recently played players for REST fallback
      if (userId) {
        console.log('👤 REST: Adjusting pool count for user:', userId);
        
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        const { data: recentGames } = await supabase
          .from('games_records')
          .select('player_id')
          .eq('user_id', userId)
          .gte('created_at', thirtyDaysAgo.toISOString());
        
        if (recentGames && recentGames.length > 0) {
          const recentPlayerIds = recentGames
            .map(game => game.player_id)
            .filter(id => id !== null);
          
          if (recentPlayerIds.length > 0) {
            // Convert string IDs to numbers for comparison
            const poolIdsAsNumbers = poolIds.map(id => parseInt(id, 10));
            
            // Filter out recently played players
            const originalCount = poolIds.length;
            poolIds = poolIdsAsNumbers.filter(id => !recentPlayerIds.includes(id)).map(String);
            console.log(`👤 REST: Excluded ${originalCount - poolIds.length} recently played players from count`);
          }
        }
      }
      
      const totalIds = await getDistinctPlayerIdsREST({}, 20000);
      const result = { poolCount: poolIds.length, totalCount: totalIds.length };
      console.log('REST result:', result);
      return res.json(result);
    }
  } catch (e) {
    console.error('POST /counts error:', e);
    res.status(500).json({ error: 'Failed to count players.' });
  }
});

// Random player (RPC preferred)
router.post('/random-player', async (req, res) => {
  try {
    console.log('🎲 Raw request body for random player:', req.body);
    
    const filters = normalizeFilters(req.body);
    console.log('🎲 Getting random player with filters:', filters);
    
    // Add this section right after normalizing filters
    // Extract userId from filters
    const userId = req.body.userId;
    let playerIds;
    
    if (useRpcCounts) {
      // Get ALL player IDs that match the filters
      playerIds = await getDistinctPlayerIdsRPC(filters);
      
      // NEW CODE: Filter out recently played players
      if (userId) {
        console.log('🧠 User ID provided:', userId);
        console.log('🧠 Excluding recently played players (30-day cooldown)');
        
        // Calculate date 30 days ago
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const dateString = thirtyDaysAgo.toISOString();
        
        // Get recently played player IDs for this user
        const { data: recentGames, error } = await supabase
          .from('games_records')
          .select('player_id')
          .eq('user_id', userId)
          .gte('created_at', dateString);
        
        if (error) {
          console.error('🧠 Error fetching recent games:', error);
        } else {
          console.log(`🧠 Found ${recentGames?.length || 0} recent games`);
          
          if (recentGames && recentGames.length > 0) {
            // Extract player IDs that aren't null
            const recentPlayerIds = recentGames
              .map(game => game.player_id)
              .filter(Boolean);
            
            console.log(`🧠 Extracted ${recentPlayerIds.length} player IDs:`, recentPlayerIds);
            
            if (recentPlayerIds.length > 0) {
              console.log(`🧠 Found ${recentPlayerIds.length} recently played players to exclude`);
              
              // Convert playerIds to numbers for accurate comparison with database integers
              const playerIdsAsNumbers = playerIds.map(id => 
                typeof id === 'string' ? parseInt(id, 10) : id
              );
              
              // Remove recently played players from the pool
              const originalCount = playerIdsAsNumbers.length;
              playerIds = playerIdsAsNumbers
                .filter(id => !recentPlayerIds.includes(id))
                .map(String); // Convert back to strings if your code expects strings
              
              console.log(`🧠 Filtered pool now has ${playerIds.length} players (removed ${originalCount - playerIds.length})`);
            }
          } else {
            console.log('🧠 No recent games found for this user');
          }
        }
      }
      
      console.log('🎯 Found player IDs:', playerIds?.length, 'players');
      
      if (!playerIds || playerIds.length === 0) {
        return res.status(400).json({ error: 'No players found with these filters.' });
      }
      
      // Rest of your existing code
      const randomId = playerIds[Math.floor(Math.random() * playerIds.length)];
      console.log('🎪 Selected random player ID:', randomId);
      
      // Get the full player card for this ID
      const card = await getPlayerCard(randomId);
      if (!card) {
        return res.status(500).json({ error: 'Failed to get player data.' });
      }
      
      console.log('✅ Returning player:', card[PS.playerName], 'from leagues:', card.leagues);
      
      // Format the response
      return res.json({
        id: card[PS.playerId],
        name: card[PS.playerName],
        age: card[PS.playerAge],
        nationality: card[PS.playerNationality], 
        position: card[PS.playerPosition],
        photo: card[PS.playerPhoto] || null,
        transferHistory: card.transferHistory || []
      });
    }
    
    // ALSO UPDATE THE REST FALLBACK PATH:
    
    // REST fallback
    playerIds = await getDistinctPlayerIdsREST(filters, 20000);
    
    // NEW CODE: Filter out recently played players in REST path
    if (userId) {
      console.log('🧠 REST: User ID provided:', userId);
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const { data: recentGames } = await supabase
        .from('games_records')
        .select('player_id')
        .eq('user_id', userId)
        .gte('created_at', thirtyDaysAgo.toISOString());
      
      if (recentGames && recentGames.length > 0) {
        const recentPlayerIds = recentGames
          .map(game => game.player_id)
          .filter(id => id !== null);
        
        if (recentPlayerIds.length > 0) {
          console.log(`🧠 REST: Excluding ${recentPlayerIds.length} recently played players`);
          playerIds = playerIds.filter(id => !recentPlayerIds.includes(id));
          console.log(`🧠 REST: Pool now has ${playerIds.length} players`);
        }
      }
    }
    
    console.log('🎯 REST: Found player IDs:', playerIds?.length, 'players');
    
    // Rest of your existing REST fallback code...
    
  } catch (e) {
    console.error('POST /random-player error:', e);
    res.status(500).json({ error: 'Failed to get random player.' });
  }
});


// Autocomplete across ALL players (by player_norm_name)
router.get('/names', async (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim();
    if (!q) return res.json([]);

    const { data, error } = await supabase
      .from(TABLE_PS)
      .select(`${PS.playerId}, ${PS.playerNormName}, ${PS.playerName}, ${PS.playerPhoto}`)
      .ilike(PS.playerNormName, `%${q}%`)
      .limit(25);

    if (error) return res.status(500).json({ error: error.message });

    const seen = new Set();
    const out = [];
    for (const r of data || []) {
      const id = r[PS.playerId];
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        id: String(id),
        norm_name: r[PS.playerNormName],
        name: r[PS.playerName],
        photo: r[PS.playerPhoto],
      });
    }
    res.json(out);
  } catch (e) {
    console.error('GET /names error:', e);
    res.status(500).json({ error: 'Failed to get name suggestions.' });
  }
});

// Add game record
router.post('/games', authRequired, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('games_records')
      .insert([{
        ...req.body,
        user_id: req.user.id,
        created_at: new Date().toISOString()
      }])
      .select()
      .single();

    if (error) {
      console.error('Supabase error:', error);
      throw error;
    }

    res.json(data);
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ 
      error: 'Failed to save game record',
      details: error.message 
    });
  }
});

// Add this route to routes/game.js
router.get('/transfers/:playerId', async (req, res) => {
  try {
    const { playerId } = req.params;
    console.log('🔍 Fetching transfers for player:', playerId);
    
    // This should call your external API or database to get transfers
    // You might need to implement this based on your transfer data source
    const transfers = await getPlayerTransfers(playerId);
    
    res.json({ transfers: transfers || [] });
  } catch (error) {
    console.error('❌ Error fetching transfers:', error);
    res.status(500).json({ error: 'Failed to fetch transfers', transfers: [] });
  }
});

// Fix the getPlayerTransfers function in routes/game.js
async function getPlayerTransfers(playerId) {
  try {
    console.log('🔍 Fetching transfers from API for player:', playerId);
    console.log('🔑 Using API key:', rapidKey ? 'Key available' : 'No key found');
    console.log('🔑 API key length:', rapidKey.length);
    
    // Use the correct RapidAPI format (not api-sports.io directly)
    const response = await fetch(`https://api-football-v1.p.rapidapi.com/v3/transfers?player=${playerId}`, {
      headers: {
        'X-RapidAPI-Key': rapidKey,
        'X-RapidAPI-Host': 'api-football-v1.p.rapidapi.com'  // ✅ Use the correct host
      }
    });
    
    console.log('🌐 API Response status:', response.status);
    console.log('🌐 API Response headers:', Object.fromEntries(response.headers));
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ API response not ok:', response.status, response.statusText);
      console.error('❌ Error response body:', errorText);
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    
    const data = await response.json();
    console.log('📋 Raw API data:', JSON.stringify(data, null, 2));
    
    // Check if there's an error in the API response
    if (data.errors && data.errors.length > 0) {
      console.error('❌ API returned errors:', data.errors);
      return [];
    }
    
    const transfers = data.response?.[0]?.transfers || [];
    console.log('📋 Extracted transfers:', transfers.length, 'transfers found');
    
    // Transform the data to match your expected format
    const transformedTransfers = transfers.map(t => ({
      date: t?.date || null,
      type: t?.type || null,
      in: { 
        name: t?.teams?.in?.name || null, 
        logo: t?.teams?.in?.logo || null 
      },
      out: { 
        name: t?.teams?.out?.name || null, 
        logo: t?.teams?.out?.logo || null 
      },
    }));
    
    // Sort by date (oldest first)
    transformedTransfers.sort((a, b) => {
      const dateA = Date.parse(a.date || 0);
      const dateB = Date.parse(b.date || 0);
      return dateA - dateB;
    });
    
    console.log('✅ Returning transformed transfers:', transformedTransfers);
    return transformedTransfers;
    
  } catch (error) {
    console.error('❌ Error fetching transfers from external API:', error);
    return [];
  }
}

export default router;
export { getPlayerCard };