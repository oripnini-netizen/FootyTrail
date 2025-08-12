// routes/game.js
// Uses Supabase RPC functions for speed (with safe REST fallbacks)

import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '../services/supabaseClient.js';
import fetch from 'node-fetch';
import { authRequired } from './middleware.js';

// ---------- Env / Supabase ----------
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // server-only
const useRpcCounts = process.env.USE_RPC_COUNTS === '1';   // prefer RPCs
const rapidKey = process.env.RAPIDAPI_KEY || '';

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

function normalizeFilters(src = {}) {
  const leagues = Array.isArray(src.leagues)
    ? src.leagues.map((x) => String(x)).filter(Boolean)
    : [];
  const seasons = toNumArr(src.seasons);
  const minAppearances = Number(src.minAppearances || 0) || 0;
  return { leagues, seasons, minAppearances };
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
      'x-rapidapi-key': rapidKey,
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
  console.log('=== COUNTS ENDPOINT HIT ==='); // This should always show
  console.log('Raw request body:', req.body);
  
  try {
    const filters = normalizeFilters(req.body);
    console.log('Received filters:', req.body);
    console.log('Normalized filters:', filters);
    console.log('useRpcCounts:', useRpcCounts);
    
    if (useRpcCounts) {
      // Get filtered count
      console.log('Getting filtered count...');
      const poolCount = await countDistinctPlayersRPC({
        leagues: filters.leagues,
        seasons: filters.seasons,
        minAppearances: filters.minAppearances
      });
      
      // Get total count with no filters
      console.log('Getting total count...');
      const totalCount = await countDistinctPlayersRPC({
        leagues: null,
        seasons: null,
        minAppearances: 0
      });
      
      console.log('Final counts:', { poolCount, totalCount });
      return res.json({ poolCount, totalCount });
    } else {
      // REST fallback
      console.log('Using REST fallback...');
      const poolIds = await getDistinctPlayerIdsREST(filters, 20000);
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
    const filters = normalizeFilters(req.body);

    let playerId = null;
    let playerName = null;

    if (useRpcCounts) {
      const pick = await randomPlayerRPC(filters);
      playerId = pick?.id ?? null;
      playerName = pick?.name ?? null;
    }

    if (!playerId) {
      const ids = await getDistinctPlayerIdsREST(filters, 20000);
      if (!ids.length) {
        return res.status(404).json({ error: 'No players found for the selected filters.' });
      }
      playerId = ids[Math.floor(Math.random() * ids.length)];
    }

    const card = await getPlayerCard(playerId);
    const transfers = await fetchTransfers(playerId);

    // NOTE: we still include name for validation on the client,
    // but the client should NOT render it until the player is guessed.
    return res.json({
      id: playerId,
      name: playerName || card?.[PS.playerName] || null, // keep for validation
      age: card?.[PS.playerAge] || null,
      nationality: card?.[PS.playerNationality] || null,
      position: card?.[PS.playerPosition] || null,
      photo: card?.[PS.playerPhoto] || null,
      season_year: card?.[PS.seasonYear] || null,
      league_id: card?.[PS.leagueId] || null,
      transferHistory: transfers,
    });
  } catch (e) {
    console.error('POST /random-player error:', e);
    res.status(500).json({ error: 'Failed to generate random player.' });
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

// Daily + limits placeholders
router.get('/daily', async (_req, res) => {
  res.json({ available: false, player: null, points: 10000 });
});

router.get('/limits', async (_req, res) => {
  res.json({ maxDailyGames: 10, gamesToday: 0, dailyPlayed: false });
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

export default router;
