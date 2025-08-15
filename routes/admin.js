// routes/admin.js
// Admin endpoints for Daily Challenge generation

import express from 'express';
import { supabase } from '../services/supabaseClient.js';

const router = express.Router();

// Normalize filters from client
function normalizeFilters(raw = {}) {
  const leagues = Array.isArray(raw.leagues) ? raw.leagues.map((x) => Number(x)).filter(n => !Number.isNaN(n)) : null;
  const seasons = Array.isArray(raw.seasons) ? raw.seasons.map((x) => Number(x)).filter(n => !Number.isNaN(n)) : null;
  const min_app = Number(raw.appearances || raw.minAppearances || 0) || 0;
  return { leagues, seasons, min_app };
}

// Helper: fetch player_name if RPC returns only id
async function getPlayerNameById(playerId) {
  const { data, error } = await supabase
    .from('players_seasons')
    .select('player_name')
    .eq('player_id', playerId)
    .limit(1);
  if (error) throw error;
  return data?.[0]?.player_name || null;
}

/**
 * POST /api/admin/generate-daily-challenge
 * body: { date: 'YYYY-MM-DD', filters: { leagues:[], seasons:[], appearances:number } }
 * effect: upsert into daily_challenges(challenge_date, player_id, player_name)
 */
router.post('/generate-daily-challenge', async (req, res) => {
  try {
    const { date, filters } = req.body || {};
    if (!date) return res.status(400).json({ success: false, error: 'Missing required field: date' });

    // 1) Pick a random eligible player (prefer RPC; fall back to REST)
    const f = normalizeFilters(filters);

    // Try RPC first (your codebase already uses similar RPCs in game routes)
    // RPC signature assumed: rpc_random_player(leagues bigint[]|null, seasons int[]|null, min_app int)
    let picked = null;
    const { data: rpcData, error: rpcErr } = await supabase.rpc('rpc_random_player', {
      leagues: f.leagues?.length ? f.leagues : null,
      seasons: f.seasons?.length ? f.seasons : null,
      min_app: f.min_app,
    });

    if (!rpcErr && rpcData) {
      const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
      if (row?.player_id) {
        picked = {
          player_id: Number(row.player_id),
          player_name: row.player_name || null,
        };
      }
    }

    // Fallback: sample one player_id from players_seasons with filters
    if (!picked) {
      let q = supabase
        .from('players_seasons')
        .select('player_id, player_name')
        .limit(5000); // limit to avoid huge payload

      if (f.leagues?.length) q = q.in('league_id', f.leagues);
      if (f.seasons?.length) q = q.in('season_year', f.seasons);
      if (f.min_app > 0) q = q.gte('player_appearences', f.min_app);

      const { data, error } = await q;
      if (error) throw error;

      if (!data || data.length === 0) {
        return res.status(400).json({ success: false, error: 'No eligible players match these filters.' });
      }
      const rand = data[Math.floor(Math.random() * data.length)];
      picked = { player_id: Number(rand.player_id), player_name: rand.player_name || null };
    }

    // Ensure we have player_name
    if (!picked.player_name) {
      picked.player_name = await getPlayerNameById(picked.player_id);
    }

    if (!picked.player_name) {
      return res.status(500).json({ success: false, error: 'Failed to resolve player_name for chosen player.' });
    }

    // 2) Upsert into daily_challenges
    const payload = {
      challenge_date: date,
      player_id: picked.player_id,
      player_name: picked.player_name,
    };

    const { error: upsertErr } = await supabase
      .from('daily_challenges')
      .upsert(payload, { onConflict: 'challenge_date' });

    if (upsertErr) {
      return res.status(500).json({ success: false, error: upsertErr.message });
    }

    return res.json({ success: true, date, player_id: picked.player_id, player_name: picked.player_name });
  } catch (e) {
    console.error('generate-daily-challenge error:', e);
    return res.status(500).json({ success: false, error: e.message || String(e) });
  }
});

export default router;
