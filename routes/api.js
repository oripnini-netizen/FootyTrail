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
    const { leagues, seasons, minAppearances, userId } = req.body;
    
    // Perform count query to Supabase (this is a simplified example)
    const { count: poolCount, error } = await supabase
      .from('players')
      .select('*', { count: 'exact', head: true })
      .in('league_id', leagues || [])
      .in('season', seasons || [])
      .gte('appearances', minAppearances || 0);
      
    if (error) throw error;
    
    // Get total count for reference
    const { count: totalCount, error: totalError } = await supabase
      .from('players')
      .select('*', { count: 'exact', head: true });
      
    if (totalError) throw totalError;
    
    res.json({ poolCount: poolCount || 0, totalCount: totalCount || 0 });
  } catch (error) {
    console.error('Error calculating counts:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get player limits
router.get('/limits/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Query Supabase for user game limits
    const { data, error } = await supabase
      .from('users')
      .select('games_played_today, points_today, points_total, daily_played')
      .eq('id', userId)
      .single();
      
    if (error) throw error;
    
    res.json({
      gamesToday: data.games_played_today || 0,
      pointsToday: data.points_today || 0,
      pointsTotal: data.points_total || 0,
      dailyPlayed: data.daily_played || false
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
      .rpc('get_random_player', {
        p_leagues: leagues || [],
        p_seasons: seasons || [],
        p_min_appearances: minAppearances || 0
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

export default router;