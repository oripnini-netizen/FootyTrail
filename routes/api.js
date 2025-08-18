// routes/api.js
// Unified backend API routes — STRICT RPC-ONLY
// Now using the *new* schema for pool building (competitions + players_in_seasons)
// and "minimum market value" filters.
// We still use the legacy players_seasons table only to build the player card (photo, etc.).

import express from 'express';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import { authRequired } from './middleware.js';

dotenv.config();

const router = express.Router();

// ---------- Env / Supabase ----------
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const rapidKey = process.env.RAPIDAPI_KEY || '';

if (!supabaseUrl || !serviceKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
}

const supabase = createClient(supabaseUrl, serviceKey);

// ---------- Legacy tables (for player card only) ----------
const TABLE_PS = 'players_seasons';      // legacy
const TABLE_LS = 'leagues_seasons';      // legacy (kept for BC endpoints)

// ---------- New tables (filters + pool) ----------
const TABLE_COMP = 'competitions';
const TABLE_PIS = 'players_in_seasons';

// ---------- Legacy PS column map (for card) ----------
const PS = {
  seasonYear: 'season_year',
  playerId: 'player_id',
  playerName: 'player_name',
  playerAge: 'player_age',
  playerNationality: 'player_nationality',
  playerPhoto: 'player_photo',
  playerPosition: 'player_position',
  leagueId: 'league_id',
};

// ---------- RapidAPI transfers ----------
const RAPID_API_HOST = 'api-football-v1.p.rapidapi.com';
const RAPID_API_BASE = `https://${RAPID_API_HOST}/v3`;

// ---------- Helpers ----------
/**
 * Normalize filters coming from client (new model).
 * competitions: text[]
 * seasons: text[]
 * minMarketValue: number (EUR)
 */
function normalizeNewFilters(raw = {}) {
  const competitionsArr = Array.isArray(raw.competitions)
    ? raw.competitions.map(String).filter(Boolean)
    : null;
  const seasonsArr = Array.isArray(raw.seasons)
    ? raw.seasons.map(String).filter(Boolean)
    : null;

  return {
    competitions: competitionsArr && competitionsArr.length ? competitionsArr : null,
    seasons: seasonsArr && seasonsArr.length ? seasonsArr : null,
    minMarketValue: Number(raw.minMarketValue) || 0,
  };
}

/**
 * Legacy helper (kept so /filters/leagues keeps working for anything else that still calls it).
 */
function normalizeLegacyFilters(raw = {}) {
  const leaguesArr = Array.isArray(raw.leagues)
    ? raw.leagues.map((x) => Number(x)).filter(Number.isFinite)
    : null;
  const seasonsArr = Array.isArray(raw.seasons)
    ? raw.seasons.map((x) => Number(x)).filter(Number.isFinite)
    : null;

  return {
    leagues: leaguesArr && leaguesArr.length ? leaguesArr : null,   // bigint[]
    seasons: seasonsArr && seasonsArr.length ? seasonsArr : null,   // bigint[]
    minAppearances: Number(raw.minAppearances) || 0,
  };
}

async function getPlayerCard(playerId) {
  // We still build the "card" from the legacy players_seasons table
  const idStr = String(playerId); // player_id column is TEXT
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
    .eq(PS.playerId, idStr)
    .order(PS.seasonYear, { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

// ---------- RPC wrappers (new model) ----------
async function rpcCountPlayersPool({ competitions, seasons, minMarketValue }) {
  const { data, error } = await supabase.rpc('rpc_count_players_pool', {
    competitions,               // text[] or null
    seasons,                    // text[] or null
    min_market_value: minMarketValue || 0,
  });
  if (error) throw error;
  return typeof data === 'number' ? data : Number(data);
}

async function rpcGetPlayerIdsMarket({ competitions, seasons, minMarketValue }) {
  const { data, error } = await supabase.rpc('rpc_get_player_ids_market', {
    competitions,               // text[] or null
    seasons,                    // text[] or null
    min_market_value: minMarketValue || 0,
  });
  if (error) throw error;
  return (data || []).map(String); // player_id text[]
}

async function rpcTotalPlayersDb() {
  const { data, error } = await supabase.rpc('rpc_total_players_db');
  if (error) throw error;
  return typeof data === 'number' ? data : Number(data);
}

// ---------- External Transfers ----------
async function getPlayerTransfers(playerId) {
  try {
    const response = await fetch(
      `${RAPID_API_BASE}/transfers?player=${encodeURIComponent(playerId)}`,
      {
        headers: {
          'X-RapidAPI-Key': rapidKey,
          'X-RapidAPI-Host': RAPID_API_HOST,
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Transfers API error:', response.status, errorText);
      return [];
    }

    const data = await response.json();
    const transfers = data.response?.[0]?.transfers || [];

    const transformed = transfers.map((t) => ({
      date: t?.date || null,
      type: t?.type || null,
      in: {
        name: t?.teams?.in?.name || null,
        logo: t?.teams?.in?.logo || null,
      },
      out: {
        name: t?.teams?.out?.name || null,
        logo: t?.teams?.out?.logo || null,
      },
    }));

    transformed.sort((a, b) => {
      const da = Date.parse(a.date || 0);
      const db = Date.parse(b.date || 0);
      return da - db;
    });

    return transformed;
  } catch (err) {
    console.error('Transfers fetch failed:', err);
    return [];
  }
}

// ---------- Routes ----------

/**
 * NEW FILTERS — competitions grouped by country (from public.competitions)
 */
router.get('/filters/competitions', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from(TABLE_COMP)
      .select('competition_id, competition_name, logo_url, country, flag_url, tier, total_value_eur');

    if (error) return res.status(500).json({ error: error.message });

    // group by country
    const groupedByCountry = {};
    for (const r of data || []) {
      const country = r.country || 'Unknown';
      if (!groupedByCountry[country]) groupedByCountry[country] = [];
      groupedByCountry[country].push({
        competition_id: String(r.competition_id),
        competition_name: r.competition_name,
        logo_url: r.logo_url,
        flag_url: r.flag_url,
        tier: r.tier,
        total_value_eur: r.total_value_eur,
      });
    }

    // sort competitions within each country
    for (const key of Object.keys(groupedByCountry)) {
      groupedByCountry[key].sort((a, b) => a.competition_name.localeCompare(b.competition_name));
    }

    res.json({ groupedByCountry });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load competitions.' });
  }
});

/**
 * NEW FILTERS — seasons (distinct from players_in_seasons, sorted desc)
 */
router.get('/filters/seasons', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from(TABLE_PIS)
      .select('season_id');

    if (error) return res.status(500).json({ error: error.message });

    const seasons = Array.from(
      new Set((data || []).map((r) => String(r.season_id)).filter(Boolean))
    ).sort((a, b) => b.localeCompare(a));

    res.json({ seasons });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load seasons.' });
  }
});

/**
 * LEGACY FILTERS — keep these for backward compatibility elsewhere if needed.
 * (GamePage no longer calls them after this change.)
 */
router.get('/filters/leagues', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from(TABLE_LS)
      .select('league_id, league_name, logo, country_name, country_flag');

    if (error) return res.status(500).json({ error: error.message });

    const byId = new Map();
    for (const r of data || []) {
      const lid = String(r.league_id);
      if (!byId.has(lid)) byId.set(lid, { ...r, league_id: lid });
    }

    const groupedByCountry = {};
    for (const r of byId.values()) {
      const country = r.country_name || 'Unknown';
      if (!groupedByCountry[country]) groupedByCountry[country] = [];
      groupedByCountry[country].push({
        league_id: r.league_id,
        league_name: r.league_name,
        logo: r.logo,
        country_flag: r.country_flag,
      });
    }
    for (const key of Object.keys(groupedByCountry)) {
      groupedByCountry[key].sort((a, b) => a.league_name.localeCompare(b.league_name));
    }

    res.json({ groupedByCountry, tags: [] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load leagues.' });
  }
});

// COUNTS (new model; RPC-only; optional user exclusion of last 30 days)
router.post('/counts', async (req, res) => {
  try {
    const filters = normalizeNewFilters(req.body);
    const userId = req.body?.userId;

    // 1) Base counts via RPC (new model)
    let poolCount = await rpcCountPlayersPool(filters);
    const totalCount = await rpcTotalPlayersDb();

    // 2) Optionally exclude players seen by this user in the last 30 days
    if (userId && poolCount > 0) {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const dateString = thirtyDaysAgo.toISOString();

      const { data: recentGames, error: recentError } = await supabase
        .from('games_records')
        .select('player_id')
        .eq('user_id', userId)
        .gte('created_at', dateString);

      if (!recentError && Array.isArray(recentGames) && recentGames.length) {
        const filteredIds = await rpcGetPlayerIdsMarket(filters); // text[]
        const filteredSet = new Set(filteredIds.map(String));
        let overlap = 0;
        for (const g of recentGames) {
          const pid = String(g?.player_id);
          if (pid && filteredSet.has(pid)) overlap += 1;
        }
        if (overlap > 0) poolCount = Math.max(0, poolCount - overlap);
      }
    }

    return res.json({ poolCount, totalCount });
  } catch (e) {
    console.error('POST /counts error:', e);
    res.status(500).json({ error: 'Failed to count players.' });
  }
});

// RANDOM PLAYER (new model; RPC-only)
router.post('/random-player', async (req, res) => {
  try {
    const filters = normalizeNewFilters(req.body);
    const userId = req.body?.userId;

    // 1) Eligible pool
    let poolIds = await rpcGetPlayerIdsMarket(filters); // text[]

    // 2) Optionally exclude last 30 days for this user
    if (userId && poolIds.length) {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const dateString = thirtyDaysAgo.toISOString();

      const { data: recentGames, error } = await supabase
        .from('games_records')
        .select('player_id')
        .eq('user_id', userId)
        .gte('created_at', dateString);

      if (!error && Array.isArray(recentGames) && recentGames.length) {
        const exclude = new Set(recentGames.map((g) => String(g.player_id)).filter(Boolean));
        poolIds = poolIds.filter((id) => !exclude.has(String(id)));
      }
    }

    if (!poolIds.length) {
      return res.status(400).json({ error: 'No players found with these filters.' });
    }

    // 3) Pick random and return a "card" (still from legacy PS for rich fields)
    const randomId = poolIds[Math.floor(Math.random() * poolIds.length)];
    const card = await getPlayerCard(randomId);
    if (!card) return res.status(500).json({ error: 'Failed to get player data.' });

    return res.json({
      id: card[PS.playerId],
      name: card[PS.playerName],
      age: card[PS.playerAge],
      nationality: card[PS.playerNationality],
      position: card[PS.playerPosition],
      photo: card[PS.playerPhoto] || null,
      transferHistory: [], // fetched elsewhere if needed
    });
  } catch (e) {
    console.error('POST /random-player error:', e);
    res.status(500).json({ error: 'Failed to get random player.' });
  }
});

// AUTOCOMPLETE (kept as before; still uses legacy PS for now)
router.get('/names', async (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim();
    if (!q) return res.json([]);

    const { data, error } = await supabase
      .from(TABLE_PS)
      .select(`player_id, player_norm_name, player_name, player_photo`)
      .ilike('player_norm_name', `%${q}%`)
      .limit(25);

    if (error) return res.status(500).json({ error: error.message });

    const seen = new Set();
    const out = [];
    for (const r of data || []) {
      const id = r.player_id;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        id: String(id),
        norm_name: r.player_norm_name,
        name: r.player_name,
        photo: r.player_photo,
      });
    }
    res.json(out);
  } catch (e) {
    console.error('GET /names error:', e);
    res.status(500).json({ error: 'Failed to get name suggestions.' });
  }
});

// SAVE GAME RECORD
router.post('/games', authRequired, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('games_records')
      .insert([
        {
          ...req.body,
          user_id: req.user.id,
          created_at: new Date().toISOString(),
        },
      ])
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({
      error: 'Failed to save game record',
      details: error.message,
    });
  }
});

// TRANSFERS by player
router.get('/transfers/:playerId', async (req, res) => {
  try {
    const { playerId } = req.params;
    const transfers = await getPlayerTransfers(playerId);
    res.json({ transfers: transfers || [] });
  } catch (error) {
    console.error('Error fetching transfers:', error);
    res.status(500).json({ error: 'Failed to fetch transfers', transfers: [] });
  }
});

// DAILY CHALLENGE (unchanged)
router.get('/daily', async (_req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const { data, error } = await supabase
      .from('daily_challenges')
      .select('*')
      .eq('challenge_date', today)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return res.json(null);
      throw error;
    }
    res.json(data);
  } catch (error) {
    console.error('Error fetching daily challenge:', error);
    res.status(500).json({ error: error.message });
  }
});

// GENERATE DAILY (kept legacy for now; can be migrated later if you want)
router.post('/generate-daily-challenge', async (req, res) => {
  try {
    const { date, filters } = req.body;
    let challengeFilters = filters;

    if (!challengeFilters || !challengeFilters.leagues || !challengeFilters.seasons) {
      const { data: settings, error: settingsError } = await supabase
        .from('daily_challenge_settings')
        .select('leagues, seasons, appearances')
        .eq('id', 1)
        .single();
      if (settingsError) throw settingsError;
      challengeFilters = settings;
    }

    // Legacy RPC (sum(appearances))
    const ids = await supabase
      .rpc('rpc_get_player_ids_sumapps', {
        leagues: (challengeFilters.leagues && challengeFilters.leagues.length)
          ? challengeFilters.leagues.map(Number)
          : null,
        seasons: (challengeFilters.seasons && challengeFilters.seasons.length)
          ? challengeFilters.seasons.map(Number)
          : null,
        min_app: challengeFilters.appearances || 0,
      })
      .then(({ data, error }) => {
        if (error) throw error;
        return (data || []).map((n) => Number(n)).filter(Number.isFinite);
      });

    if (!ids.length) {
      return res.status(404).json({ success: false, error: 'No player found for these filters.' });
    }

    const playerId = ids[Math.floor(Math.random() * ids.length)];
    const card = await getPlayerCard(playerId);
    if (!card) return res.status(500).json({ success: false, error: 'Failed to get player data.' });

    const { error: upsertError } = await supabase.from('daily_challenges').upsert({
      challenge_date: date,
      player_id: card[PS.playerId],
      player_name: card[PS.playerName],
      created_at: new Date().toISOString(),
    });
    if (upsertError) throw upsertError;

    res.json({ success: true });
  } catch (error) {
    console.error('Error generating daily challenge:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Player by ID (card)
router.get('/player/:playerId', async (req, res) => {
  try {
    const { playerId } = req.params;
    const card = await getPlayerCard(playerId);
    if (!card) return res.status(404).json({ error: 'Player not found' });
    res.json(card);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -------- LIMITS for a user (unchanged) --------
router.get('/limits/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });

    const startOfTodayUtc = new Date();
    startOfTodayUtc.setUTCHours(0, 0, 0, 0);

    const [{ data: todayGames, error: todayErr }, { data: allGames, error: allErr }] =
      await Promise.all([
        supabase
          .from('games_records')
          .select('points_earned, is_daily_challenge, won, player_id, created_at')
          .eq('user_id', userId)
          .gte('created_at', startOfTodayUtc.toISOString()),
        supabase
          .from('games_records')
          .select('points_earned')
          .eq('user_id', userId),
      ]);

    if (todayErr) throw todayErr;
    if (allErr) throw allErr;

    const gamesToday = (todayGames || []).length;
    const pointsToday = (todayGames || []).reduce(
      (sum, g) => sum + (Number(g.points_earned) || 0),
      0
    );
    const pointsTotal = (allGames || []).reduce(
      (sum, g) => sum + (Number(g.points_earned) || 0),
      0
    );

    const dailyGame = (todayGames || []).find((g) => g.is_daily_challenge);
    const dailyPlayed = !!dailyGame;
    const dailyWin = !!(dailyGame && dailyGame.won);

    let dailyPlayerName = null;
    let dailyPlayerPhoto = null;
    if (dailyGame?.player_id != null) {
      const card = await getPlayerCard(String(dailyGame.player_id));
      dailyPlayerName = card?.[PS.playerName] || null;
      dailyPlayerPhoto = card?.[PS.playerPhoto] || null;
    }

    res.json({
      gamesToday,
      dailyPlayed,
      dailyWin,
      pointsToday,
      pointsTotal,
      dailyPlayerName,
      dailyPlayerPhoto,
    });
  } catch (error) {
    console.error('GET /limits/:userId error:', error);
    res.status(500).json({ error: 'Failed to load limits' });
  }
});

// Simple player pool count (kept; not used by main flow)
router.get('/player-pool-count', async (_req, res) => {
  try {
    const total = await rpcTotalPlayersDb();
    res.json({ count: total });
  } catch (error) {
    console.error('Error fetching player pool count:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
