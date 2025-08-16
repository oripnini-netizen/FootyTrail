// routes/api.js
// Unified backend API routes — STRICT RPC-ONLY (uses aggregated SUM(appearences) RPCs)

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
function normalizeFilters(raw = {}) {
  // Convert arrays to numbers; empty arrays -> null (so SQL "param is null OR ..." works)
  const leaguesArr = Array.isArray(raw.leagues)
    ? raw.leagues.map((x) => Number(x)).filter(Number.isFinite)
    : null;
  const seasonsArr = Array.isArray(raw.seasons)
    ? raw.seasons.map((x) => Number(x)).filter(Number.isFinite)
    : null;

  return {
    leagues: leaguesArr && leaguesArr.length ? leaguesArr : null, // bigint[]
    seasons: seasonsArr && seasonsArr.length ? seasonsArr : null, // bigint[]
    minAppearances: Number(raw.minAppearances) || 0,
  };
}

async function getPlayerCard(playerId) {
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

// ---------- RPC wrappers (aggregated SUM(appearences) logic) ----------
async function rpcCountPlayersAggregated({ leagues, seasons, minAppearances }) {
  const { data, error } = await supabase.rpc('rpc_count_players_sumapps', {
    leagues,             // bigint[] or null
    seasons,             // bigint[] or null
    min_app: minAppearances || 0,
  });
  if (error) throw error;
  return typeof data === 'number' ? data : Number(data);
}

async function rpcGetPlayerIdsAggregated({ leagues, seasons, minAppearances }) {
  const { data, error } = await supabase.rpc('rpc_get_player_ids_sumapps', {
    leagues,             // bigint[] or null
    seasons,             // bigint[] or null
    min_app: minAppearances || 0,
  });
  if (error) throw error;
  // Returned as bigint[]; coerce to Number for JS work
  return (data || []).map((id) => Number(id)).filter(Number.isFinite);
}

async function rpcTotalPlayers() {
  const { data, error } = await supabase.rpc('rpc_total_players');
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

// LEAGUES (unique by league_id, grouped by country)
router.get('/filters/leagues', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from(TABLE_LS)
      .select('league_id, league_name, logo, country_name, country_flag');

    if (error) return res.status(500).json({ error: error.message });

    // dedupe by league_id
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
        league_id: r.league_id,
        league_name: r.league_name,
        logo: r.logo,
        country_flag: r.country_flag,
      });
    }

    // sort leagues within each country
    for (const key of Object.keys(groupedByCountry)) {
      groupedByCountry[key].sort((a, b) => a.league_name.localeCompare(b.league_name));
    }

    // quick tags: popular/first unique names (cap 8)
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
    const { data, error } = await supabase.from(TABLE_LS).select('season_year');
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

// COUNTS (RPC-only; optional user exclusion of last 30 days)
router.post('/counts', async (req, res) => {
  try {
    const filters = normalizeFilters(req.body);
    const userId = req.body?.userId;

    // 1) Base counts via RPC
    let poolCount = await rpcCountPlayersAggregated(filters);
    const totalCount = await rpcTotalPlayers();

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
        // Need exact filtered pool to subtract overlap
        const filteredIds = await rpcGetPlayerIdsAggregated(filters); // numbers
        const filteredSet = new Set(filteredIds);
        let overlap = 0;
        for (const g of recentGames) {
          const pid = Number(g?.player_id);
          if (Number.isFinite(pid) && filteredSet.has(pid)) overlap += 1;
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

// RANDOM PLAYER (RPC-only; build pool -> optional user exclusion -> sample)
router.post('/random-player', async (req, res) => {
  try {
    const filters = normalizeFilters(req.body);
    const userId = req.body?.userId;

    // 1) Eligible pool (after SUM(appearences) >= min_app)
    let poolIds = await rpcGetPlayerIdsAggregated(filters); // numbers

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
        const exclude = new Set(
          recentGames.map((g) => Number(g.player_id)).filter(Number.isFinite)
        );
        poolIds = poolIds.filter((id) => !exclude.has(id));
      }
    }

    if (!poolIds.length) {
      return res.status(400).json({ error: 'No players found with these filters.' });
    }

    // 3) Pick random and return a "card"
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
      transferHistory: card.transferHistory || [],
    });
  } catch (e) {
    console.error('POST /random-player error:', e);
    res.status(500).json({ error: 'Failed to get random player.' });
  }
});

// AUTOCOMPLETE across ALL players (by player_norm_name)
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

// DAILY CHALLENGE
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

router.post('/generate-daily-challenge', async (req, res) => {
  try {
    const { date, filters } = req.body;

    // 1) If not provided, pull default filters
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

    // 2) Build eligible IDs via SUM(appearences) RPC and sample in Node
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

// -------- NEW: LIMITS for a user (games/points + daily status) --------
router.get('/limits/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });

    // Start of "today" in UTC
    const startOfTodayUtc = new Date();
    startOfTodayUtc.setUTCHours(0, 0, 0, 0);

    // Fetch today's games and all-time points
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
      const card = await getPlayerCard(Number(dailyGame.player_id));
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
      // dailyBonus: dailyPlayed ? false : true, // optional if you later want 10+1 display
    });
  } catch (error) {
    console.error('GET /limits/:userId error:', error);
    res.status(500).json({ error: 'Failed to load limits' });
  }
});

// Simple player pool count (kept; not used by main flow)
router.get('/player-pool-count', async (_req, res) => {
  try {
    // You can wire this to rpcTotalPlayers() if you want:
    // const total = await rpcTotalPlayers();
    // return res.json({ count: total });
    res.json({ count: 64380 });
  } catch (error) {
    console.error('Error fetching player pool count:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
