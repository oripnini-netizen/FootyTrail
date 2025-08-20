// routes/api.js
// Backend API routes — STRICT RPC-ONLY for DB work
// Built entirely on NEW players_in_seasons (no players_seasons fallback).
// Transfer history proxied from Transfermarkt CE (no RapidAPI).

import express from 'express';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import { authRequired } from './middleware.js';

dotenv.config();

const router = express.Router();

// ---------- Env / Supabase ----------
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
}
const supabase = createClient(supabaseUrl, serviceKey);

// ---------- UTC+2 helpers ----------
const TZ_PLUS2_MIN = 120;
const TZ_PLUS2_MS  = TZ_PLUS2_MIN * 60 * 1000;

/** Returns YYYY-MM-DD string for "today" in UTC+2. */
function dateStringUTCPlus2(d = new Date()) {
  const plus2 = new Date(d.getTime() + TZ_PLUS2_MS);
  return plus2.toISOString().slice(0, 10);
}

/** Returns a Date (UTC) representing the start of today in UTC+2. */
function startOfTodayUTCForUTCPlus2(d = new Date()) {
  const plus2 = new Date(d.getTime() + TZ_PLUS2_MS);
  const startPlus2 = new Date(plus2);
  startPlus2.setUTCHours(0, 0, 0, 0);
  // Convert that UTC+2 midnight back to actual UTC time:
  return new Date(startPlus2.getTime() - TZ_PLUS2_MS);
}

// ---------- Tables (new model) ----------
const TABLE_COMP   = 'competitions';
const TABLE_PIS    = 'players_in_seasons';
const TABLE_NOTIFS = 'notifications'; // for navbar unread checks
// (Legacy list endpoint only)
const TABLE_LS     = 'leagues_seasons';

// ---------- Helpers ----------
/** Try to safely stringify a value that might be a scalar or an object. */
function toIdString(v) {
  if (v == null) return null;
  if (typeof v === 'object') {
    const guess =
      v.player_id ?? v.id ?? v.value ?? v.competition_id ?? v.season_id ?? null;
    return guess != null ? String(guess) : String(v);
  }
  return String(v);
}

/** Normalize filters coming from client (new model). */
function normalizeNewFilters(raw = {}) {
  const competitionsArr = Array.isArray(raw.competitions)
    ? raw.competitions.map(toIdString).filter(Boolean)
    : null;

  const seasonsArr = Array.isArray(raw.seasons)
    ? raw.seasons.map(toIdString).filter(Boolean)
    : null;

  return {
    competitions: competitionsArr && competitionsArr.length ? competitionsArr : null,
    seasons: seasonsArr && seasonsArr.length ? seasonsArr : null,
    minMarketValue: Number(raw.minMarketValue) || 0,
  };
}

function parseAgeFromDobAge(dobAge) {
  if (!dobAge) return null;
  const m = String(dobAge).match(/\((\d{1,2})\)/);
  return m ? Number(m[1]) : null;
}

// ---------- Player card from players_in_seasons ----------
async function getPlayerCardFromPIS(playerId) {
  const pid = toIdString(playerId);
  if (!pid) return null;

  const { data, error } = await supabase
    .from(TABLE_PIS)
    .select(
      'player_id, player_name, player_position, player_nationality, player_dob_age, player_photo, season_id'
    )
    .eq('player_id', pid)
    .order('season_id', { ascending: false })
    .limit(1);

  if (error) throw error;
  const row = data?.[0];
  if (!row) return null;

  return {
    id: String(row.player_id),
    name: row.player_name || null,
    nationality: row.player_nationality || null,
    position: row.player_position || null,
    age: parseAgeFromDobAge(row.player_dob_age),
    season_id: row.season_id || null,
    photo: row.player_photo || null,
  };
}

// ---------- RPC wrappers (new model) ----------
async function rpcCountPlayersPool({ competitions, seasons, minMarketValue }) {
  const { data, error } = await supabase.rpc('rpc_count_players_pool', {
    competitions,
    seasons,
    min_market_value: minMarketValue || 0,
  });
  if (error) throw error;
  return typeof data === 'number' ? data : Number(data);
}

async function rpcGetPlayerIdsMarket({ competitions, seasons, minMarketValue }) {
  const { data, error } = await supabase.rpc('rpc_get_player_ids_market', {
    competitions,
    seasons,
    min_market_value: minMarketValue || 0,
  });
  if (error) throw error;

  return (data || [])
    .map((row) => {
      if (typeof row === 'object' && row !== null) {
        return toIdString(row.player_id ?? row);
      }
      return toIdString(row);
    })
    .filter(Boolean);
}

async function rpcTotalPlayersDb() {
  const { data, error } = await supabase.rpc('rpc_total_players_db');
  if (error) throw error;
  return typeof data === 'number' ? data : Number(data);
}

// ---------- Transfermarkt CE API proxy ----------
function standardizeFee(feeRaw = '') {
  const x = (feeRaw || '').toLowerCase();
  if (!x) return null;
  if (x.includes('free')) return 'Free transfer';
  if (x.includes('end of')) return 'End of loan';
  if (x.includes('fee') && x.includes('loan')) return 'Paid loan';
  if (x.includes('loan')) return 'Loan';
  if (/[mk]|th\./.test(x)) return 'Transfer';
  return null;
}

function cleanFeeText(str) {
  if (!str) return null;
  const txt = String(str).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return txt || null;
}

const transfersCache = new Map(); // key: playerId -> { ts, data }
const TRANSFERS_TTL_MS = 10 * 60 * 1000;

async function getTransfermarktTransfers(playerId) {
  const now = Date.now();
  const cached = transfersCache.get(playerId);
  if (cached && now - cached.ts < TRANSFERS_TTL_MS) return cached.data;

  const url = `https://www.transfermarkt.com/ceapi/transferHistory/list/${encodeURIComponent(
    playerId
  )}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36',
      Accept: 'application/json,text/plain,*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: 'https://www.transfermarkt.com/',
    },
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    console.error('Transfermarkt CE API error', res.status, txt);
    return [];
  }

  const json = await res.json().catch(() => null);
  const rawTransfers = json?.transfers || [];

  const normalized = rawTransfers.map((t) => {
    const inTeam  = t?.to   || {};
    const outTeam = t?.from || {};
    const dateStr = t?.dateUnformatted
      ? new Date(t.dateUnformatted).toISOString().slice(0, 10)
      : null;

    const feeClean = cleanFeeText(t?.fee);
    return {
      season: t?.season || null,
      date: dateStr,
      type: standardizeFee(feeClean),
      valueRaw: feeClean,
      in:  { name: inTeam.clubName || null,  logo: inTeam['clubEmblem-2x'] || inTeam.clubEmblem || null,  flag: inTeam.countryFlag || null },
      out: { name: outTeam.clubName || null, logo: outTeam['clubEmblem-2x'] || outTeam.clubEmblem || null, flag: outTeam.countryFlag || null },
    };
  });

  normalized.sort((a, b) => Date.parse(a.date || 0) - Date.parse(b.date || 0));
  transfersCache.set(playerId, { ts: now, data: normalized });
  return normalized;
}

// ---------- Filters endpoints ----------
router.get('/filters/competitions', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from(TABLE_COMP)
      .select('competition_id, competition_name, logo_url, country, flag_url, tier, total_value_eur');

    if (error) return res.status(500).json({ error: error.message });

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
    for (const key of Object.keys(groupedByCountry)) {
      groupedByCountry[key].sort((a, b) => a.competition_name.localeCompare(b.competition_name));
    }

    res.json({ groupedByCountry });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load competitions.' });
  }
});

// seasons via RPC (no 1k page limit)
router.get('/filters/seasons', async (_req, res) => {
  try {
    const { data, error } = await supabase.rpc('rpc_distinct_seasons');
    if (error) throw error;
    const seasons = (data || [])
      .map((s) => String(s).trim())
      .filter(Boolean)
      .sort((a, b) => Number(b) - Number(a));
    res.json({ seasons });
  } catch (err) {
    console.error('[filters/seasons] error:', err);
    res.status(500).json({ error: 'Failed to load seasons' });
  }
});

// (legacy, not used by new UI)
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

// ---------- Counts / Random player ----------
router.post('/counts', async (req, res) => {
  try {
    const filters = normalizeNewFilters(req.body);
    const userId  = req.body?.userId;

    // 1) Base counts via RPC
    let poolCount  = await rpcCountPlayersPool(filters);
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
        const filteredIds = await rpcGetPlayerIdsMarket(filters);
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

router.post('/random-player', async (req, res) => {
  try {
    const filters = normalizeNewFilters(req.body);
    const userId  = req.body?.userId;

    // 1) Eligible pool
    let poolIds = await rpcGetPlayerIdsMarket(filters);

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

    // 3) Pick a player that HAS transfer history (retry up to N)
    const maxTries = Math.min(50, poolIds.length);
    for (let i = 0; i < maxTries; i++) {
      const randomId = poolIds[Math.floor(Math.random() * poolIds.length)];
      const transfers = await getTransfermarktTransfers(String(randomId));
      if (!transfers || transfers.length === 0) {
        continue; // try another one
      }
      const card = await getPlayerCardFromPIS(randomId);
      if (!card) continue;

      return res.json({
        id: card.id,
        name: card.name,
        age: card.age,
        nationality: card.nationality,
        position: card.position,
        photo: card.photo,
        transferHistoryCount: transfers.length,
      });
    }

    return res.status(404).json({ error: 'No eligible player with transfer history found.' });
  } catch (e) {
    console.error('POST /random-player error:', e);
    res.status(500).json({ error: 'Failed to get random player.' });
  }
});

// ---------- Name suggestions (players_in_seasons via RPC) ----------
router.get('/names', async (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim();
    const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 100);
    if (!q) return res.json([]);

    // Use the robust RPC you created:
    const { data, error } = await supabase.rpc('suggest_names', { q, lim: limit });
    if (error) throw error;

    // Normalize the shape the UI expects
    const suggestions = (data || []).map((r) => {
      const id   = r.player_id;
      const name = r.player_name || r.player_norm_name || '';
      const norm = r.player_norm_name || '';
      return {
        id,
        name,
        norm,
        label: name,   // <-- add label for UI components
        value: name,   // <-- add value as well (compat with some dropdowns)
      };
    });

    return res.json(suggestions);
  } catch (err) {
    console.error('GET /names error:', err);
    return res.status(500).json({ error: 'Failed to fetch suggestions' });
  }
});


// ---------- Save game ----------
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

// ---------- Transfers by player (Transfermarkt proxy) ----------
router.get('/transfers/:playerId', async (req, res) => {
  try {
    const { playerId } = req.params;
    const transfers = await getTransfermarktTransfers(String(playerId));
    res.json({ transfers: transfers || [] });
  } catch (error) {
    console.error('Error fetching transfers:', error);
    res.status(500).json({ error: 'Failed to fetch transfers', transfers: [] });
  }
});

// ---------- Daily challenge ----------
router.get('/daily', async (_req, res) => {
  try {
    // Use UTC+2 date for "today"
    const today = dateStringUTCPlus2();
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
    // Default to UTC+2 "today" if date not provided
    const date = (req.body?.date || '').toString() || dateStringUTCPlus2();

    let filters = null;
    if (req.body?.filters) {
      filters = normalizeNewFilters(req.body.filters);
    } else {
      const { data: settings, error: settingsError } = await supabase
        .from('daily_challenge_settings')
        .select('competitions, seasons, min_market_value, leagues, seasons as legacy_seasons, appearances')
        .eq('id', 1)
        .single();
      if (settingsError) throw settingsError;

      const competitions =
        settings?.competitions?.length
          ? settings.competitions.map(toIdString)
          : settings?.leagues?.length
          ? settings.leagues.map(toIdString)
          : null;

      const seasons =
        settings?.seasons?.length
          ? settings.seasons.map(toIdString)
          : settings?.legacy_seasons?.length
          ? settings.legacy_seasons.map(toIdString)
          : null;

      const minMarketValue = Number(settings?.min_market_value || 0);
      filters = normalizeNewFilters({ competitions, seasons, minMarketValue });
    }

    const poolIds = await rpcGetPlayerIdsMarket(filters);
    if (!poolIds?.length) {
      return res.status(404).json({ success: false, error: 'No player found for these filters.' });
    }

    const idx =
      Math.abs(Array.from(date).reduce((h, ch) => ((h << 5) - h + ch.charCodeAt(0)) | 0, 0)) % poolIds.length;

    const playerId = poolIds[idx];
    const card = await getPlayerCardFromPIS(playerId);
    if (!card) return res.status(500).json({ success: false, error: 'Failed to get player data.' });

    const { error: upsertError } = await supabase.from('daily_challenges').upsert({
      challenge_date: date,
      player_id: card.id,
      player_name: card.name,
      created_at: new Date().toISOString(),
    });
    if (upsertError) throw upsertError;

    res.json({ success: true });
  } catch (error) {
    console.error('Error generating daily challenge:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ---------- Player by ID ----------
router.get('/player/:playerId', async (req, res) => {
  try {
    const { playerId } = req.params;
    const card = await getPlayerCardFromPIS(playerId);
    if (!card) return res.status(404).json({ error: 'Player not found' });
    res.json(card);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---------- Limits ----------
router.get('/limits/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });

    // Use start-of-today at UTC+2
    const startOfTodayUtc2 = startOfTodayUTCForUTCPlus2();

    const [{ data: todayGames, error: todayErr }, { data: allGames, error: allErr }] =
      await Promise.all([
        supabase
          .from('games_records')
          .select('points_earned, is_daily_challenge, won, player_id, created_at')
          .eq('user_id', userId)
          .gte('created_at', startOfTodayUtc2.toISOString()),
        supabase.from('games_records').select('points_earned').eq('user_id', userId),
      ]);

    if (todayErr) throw todayErr;
    if (allErr) throw allErr;

    const gamesToday  = (todayGames || []).length;
    const pointsToday = (todayGames || []).reduce((sum, g) => sum + (Number(g.points_earned) || 0), 0);
    const pointsTotal = (allGames || []).reduce((sum, g) => sum + (Number(g.points_earned) || 0), 0);

    const dailyGame  = (todayGames || []).find((g) => g.is_daily_challenge);
    const dailyPlayed = !!dailyGame;
    const dailyWin    = !!(dailyGame && dailyGame.won);

    let dailyPlayerName = null;
    let dailyPlayerPhoto = null;
    if (dailyGame?.player_id != null) {
      const card = await getPlayerCardFromPIS(String(dailyGame.player_id));
      dailyPlayerName = card?.name  || null;
      dailyPlayerPhoto = card?.photo || null;
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

// ---------- Misc ----------
router.get('/player-pool-count', async (_req, res) => {
  try {
    const total = await rpcTotalPlayersDb();
    res.json({ count: total });
  } catch (error) {
    console.error('Error fetching player pool count:', error);
    res.status(500).json({ error: error.message });
  }
});

// =====================================================
// League notifications (service-key backed, RLS-agnostic)
// =====================================================
router.get('/leagues/notifications/unread-count/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });

    const { count, error } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    if (error) throw error;
    res.json({ count: count || 0 });
  } catch (err) {
    console.error('GET /leagues/notifications/unread-count error:', err);
    res.status(500).json({ error: 'Failed to load unread count' });
  }
});

router.post('/leagues/notifications/mark-read', async (req, res) => {
  try {
    const userId = req.body?.userId;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });

    const { data, error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('is_read', false)
      .select('id');

    if (error) throw error;
    res.json({ updated: (data || []).length });
  } catch (err) {
    console.error('POST /leagues/notifications/mark-read error:', err);
    res.status(500).json({ error: 'Failed to mark notifications read' });
  }
});

export default router;
