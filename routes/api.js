// New file for backend API routes

import express from 'express';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { getPlayerCard } from './game.js';

dotenv.config();

const router = express.Router();

// Create Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Get leagues
router.get('/filters/leagues', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('leagues')
      .select('*');
      
    if (error) throw error;
    
    // Group leagues by country
    const groupedByCountry = {};
    const tags = [];
    
    data.forEach(league => {
      const country = league.country || 'Unknown';
      if (!groupedByCountry[country]) {
        groupedByCountry[country] = [];
      }
      groupedByCountry[country].push(league);
      
      // Add popular leagues to tags
      if (league.is_popular) {
        tags.push({
          id: league.league_id,
          name: league.league_name,
          type: 'league'
        });
      }
    });
    
    res.json({
      groupedByCountry,
      tags
    });
  } catch (error) {
    console.error('Error fetching leagues:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get seasons
router.get('/filters/seasons', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('seasons')
      .select('season')
      .order('season', { ascending: false });
      
    if (error) throw error;
    
    const seasons = data.map(item => item.season);
    res.json({ seasons });
  } catch (error) {
    console.error('Error fetching seasons:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get counts
router.post('/counts', async (req, res) => {
  try {
    const { leagues, seasons, minAppearances } = req.body;

    // Use the RPC for filtered count
    const { data: poolData, error: poolError } = await supabase
      .rpc('rpc_count_players', {
        leagues: leagues && leagues.length > 0 ? leagues.map(Number) : null,
        seasons: seasons && seasons.length > 0 ? seasons.map(Number) : null,
        min_app: minAppearances || 0,
      });

    if (poolError) throw poolError;

    // Use the RPC for total count (no filters)
    const { data: totalData, error: totalError } = await supabase
      .rpc('rpc_count_players', {
        leagues: null,
        seasons: null,
        min_app: 0,
      });

    if (totalError) throw totalError;

    res.json({
      poolCount: typeof poolData === 'number' ? poolData : (poolData?.count ?? 0),
      totalCount: typeof totalData === 'number' ? totalData : (totalData?.count ?? 0),
    });
  } catch (error) {
    console.error('Error calculating counts:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get player limits
router.get('/limits/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const today = new Date().toISOString().split('T')[0];

    // Get today's games
    const { data: todayGames, error: gamesError } = await supabase
      .from('games_records')
      .select('points_earned')
      .eq('user_id', userId)
      .gte('created_at', `${today}T00:00:00Z`)
      .lt('created_at', `${today}T23:59:59Z`);

    if (gamesError) throw gamesError;

    // Get total points
    const { data: totalPoints, error: totalError } = await supabase
      .from('games_records')
      .select('points_earned')
      .eq('user_id', userId);

    if (totalError) throw totalError;

    // Get today's daily challenge record
    const { data: dailyGames, error: dailyError } = await supabase
      .from('games_records')
      .select('won, player_id, player_name, player_data')
      .eq('user_id', userId)
      .eq('is_daily_challenge', true)
      .gte('created_at', `${today}T00:00:00Z`)
      .lt('created_at', `${today}T23:59:59Z`)
      .order('created_at', { ascending: false })
      .limit(1);

    if (dailyError) throw dailyError;
    const dailyGame = dailyGames && dailyGames.length > 0 ? dailyGames[0] : null;

    const gamesToday = todayGames?.length || 0;
    const pointsToday = todayGames?.reduce((sum, game) => sum + (game.points_earned || 0), 0) || 0;
    const pointsTotal = totalPoints?.reduce((sum, game) => sum + (game.points_earned || 0), 0) || 0;

    res.set('Cache-Control', 'no-store');
    res.json({
      gamesToday,
      pointsToday,
      pointsTotal,
      dailyPlayed: !!dailyGame,
      dailyWin: dailyGame?.won ?? null,
      dailyPlayerName: dailyGame?.player_name ?? null,
      dailyPlayerPhoto: dailyGame?.player_data?.photo ?? null,
    });
  } catch (error) {
    console.error('Error fetching limits:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get daily challenge
router.get('/daily', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    // Query Supabase for today's challenge
    const { data, error } = await supabase
      .from('daily_challenges')
      .select('*')
      .eq('challenge_date', today)
      .single();
      
    if (error) {
      if (error.code === 'PGRST116') {
        // No daily challenge found
        return res.json(null);
      }
      throw error;
    }
    
    res.json(data);
  } catch (error) {
    console.error('Error fetching daily challenge:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get random player
router.post('/random-player', async (req, res) => {
  try {
    const { leagues, seasons, minAppearances, userId } = req.body;
    
    // Query Supabase for random player matching criteria
    const { data, error } = await supabase
      .rpc('rpc_random_player', {
        leagues: leagues || [],
        seasons: seasons || [],
        min_app: minAppearances || 0
      });
      
    if (error) throw error;
    
    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'No player found with these criteria' });
    }
    
    res.json(data[0]);
  } catch (error) {
    console.error('Error getting random player:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get player pool count
router.get('/player-pool-count', async (req, res) => {
  try {
    // For simplicity, return a hardcoded value
    // In a real implementation, you would query your database
    res.json({ count: 64380 });
  } catch (error) {
    console.error('Error fetching player pool count:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get player data by ID (for daily challenge and regular games)
router.get('/player/:playerId', async (req, res) => {
  try {
    const { playerId } = req.params;
    const card = await getPlayerCard(playerId); // Use your helper
    if (!card) {
      return res.status(404).json({ error: 'Player not found' });
    }
    res.json(card);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Generate daily challenge
router.post('/generate-daily-challenge', async (req, res) => {
  try {
    const { date, filters } = req.body;

    // 1. Get filters from daily_challenge_settings if not provided
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

    // 2. Get a random player using your RPC or query
    const { data: playerData, error: playerError } = await supabase
  .rpc('rpc_random_player', {
    leagues: challengeFilters.leagues || [],
    seasons: challengeFilters.seasons || [],
    min_app: challengeFilters.appearances || 0
  });

    if (playerError) throw playerError;
    if (!playerData || playerData.length === 0) {
      return res.status(404).json({ success: false, error: 'No player found for these filters.' });
    }
    const player = playerData[0];

    // 3. Insert into daily_challenges table
    const { error: insertError } = await supabase
      .from('daily_challenges')
      .upsert({
        challenge_date: date,
        player_id: player.player_id,
        player_name: player.player_name,
        created_at: new Date().toISOString()
      });

    if (insertError) throw insertError;

    res.json({ success: true });
  } catch (error) {
    console.error('Error generating daily challenge:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;