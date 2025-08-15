// index.js — Node server entry point (ESM)

// 1) Preload .env BEFORE anything else (side‑effect import)
import 'dotenv/config';

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import gameRouter from './routes/game.js';
import apiRoutes from './routes/api.js';
import aiRoutes from './routes/ai.js'; // Import the AI routes
import { createClient } from '@supabase/supabase-js';
import morgan from 'morgan';

// Initialize with service role key (keep this secure on the server only!)
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Add this in your index.js or wherever you start the server
console.log('Environment check:');
console.log('USE_RPC_COUNTS:', process.env.USE_RPC_COUNTS);
console.log('SUPABASE_URL:', process.env.SUPABASE_URL ? 'Set' : 'Not set');

// 2) Create app
const app = express();
const PORT = process.env.PORT || 3001;

// 3) CORS (allow any localhost port; send cookies if needed)
app.use(
  cors({
    origin: [
      'http://localhost:3000',         // Local development
      'http://localhost:3001',         // Frontend on different port (CRA default)
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3001',
      'https://footy-trail.vercel.app', // Production frontend
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization']
  })
);

// 4) JSON body parsing
app.use(express.json());
app.use(morgan('dev'));

// 5) Routes (now safe to import — env is loaded)
app.use('/api', gameRouter);  // Changed from '/api/game' to '/api'
app.use('/api', apiRoutes);
app.use('/api/ai', aiRoutes); // Register the AI routes

// 6) Static files (optional)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, 'public')));

// Add this with your other routes (before starting the server)
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Add this debugging middleware to verify requests are reaching the server
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// When a game is completed
app.post('/api/game-completed', async (req, res) => {
  try {
    console.log('Game completed request received:', req.body);
    const { userId, playerData, gameStats } = req.body;
    
    console.log('Extracted data:', { userId, playerData, gameStats });
    
    // Validate the input data
    if (!userId) {
      console.error('Missing userId in request');
      return res.status(400).json({ error: 'Missing userId in request' });
    }
    
    if (!playerData || !playerData.id) {
      console.error('Missing playerData.id in request');
      return res.status(400).json({ error: 'Missing playerData.id in request' });
    }
    
    // Validate the user exists
    console.log('Checking if user exists:', userId);
    const { data: user, error: userError } = await supabaseAdmin
      .from('profiles') // Try 'profiles' table instead of 'users'
      .select('id')
      .eq('id', userId)
      .single();
      
    if (userError) {
      console.error('Error finding user in profiles table:', userError);
      // Try auth.users table instead
      console.log('Trying auth.users table instead...');
      const { data: authUser, error: authError } = await supabaseAdmin
        .auth.admin.getUserById(userId);
      
      if (authError) {
        console.error('Error finding user in auth.users table:', authError);
        console.log('User not found in both tables but continuing with game record insertion anyway');
      } else {
        console.log('User found in auth.users table:', authUser);
      }
    } else {
      console.log('User found in profiles table:', user);
    }
    
    // Now unconditionally try to insert the game record, regardless of user validation
    try {
      const recordToInsert = {
        user_id: userId,
        player_id: parseInt(playerData.id, 10) || 0, // Convert to number, fallback to 0
        player_name: playerData.name || 'Unknown Player',
        player_data: playerData.data || {}, // Use the player data from the request
        won: gameStats.won || false,
        points_earned: gameStats.points || 0,
        potential_points: gameStats.potentialPoints || 10000, // Use potential points from request
        time_taken_seconds: gameStats.timeTaken || 0,
        guesses_attempted: gameStats.guessesAttempted || 0,
        hints_used: gameStats.hintsUsed || 0,
        is_daily_challenge: gameStats.isDaily || false,
        created_at: new Date().toISOString()
      };
      
      // Save the game record using admin privileges
      console.log('Inserting game record:', recordToInsert);
      console.log('Player ID type:', typeof recordToInsert.player_id);
      
      const { data, error } = await supabaseAdmin
        .from('games_records')
        .insert([recordToInsert])
        .select();
        
      if (error) {
        console.error('Error saving game record:', error);
        console.error('Error details:', error.details);
        console.error('Error hint:', error.hint);
        console.error('Error message:', error.message);
        
        // Try once more with a string ID if the numeric conversion failed
        if (error.code === '23502' || error.message.includes('null value in column')) {
          console.log('Trying again with fallback player_id and ensuring all required fields are present...');
          
          // Make sure player_id is a number and all required fields are present
          recordToInsert.player_id = 0; // Fallback to a default player ID
          recordToInsert.player_data = recordToInsert.player_data || {}; // Ensure player_data exists
          recordToInsert.potential_points = recordToInsert.potential_points || 10000; // Ensure potential_points exists
          
          const { data: retryData, error: retryError } = await supabaseAdmin
            .from('games_records')
            .insert([recordToInsert])
            .select();
            
          if (retryError) {
            console.error('Second attempt failed:', retryError);
            return res.status(500).json({ 
              error: 'Failed to save game record on second attempt', 
              details: retryError.message,
              code: retryError.code
            });
          }
          
          console.log('Game record saved successfully on second attempt:', retryData);
          return res.json({ success: true, record: retryData[0] });
        }
        
        return res.status(500).json({ 
          error: 'Failed to save game record', 
          details: error.message,
          code: error.code
        });
      }
      
      console.log('Game record saved successfully:', data);
      res.json({ success: true, record: data[0] });
    } catch (insertErr) {
      console.error('Error during game record insertion:', insertErr);
      res.status(500).json({ 
        error: 'Failed to insert game record',
        message: insertErr.message
      });
    }
  } catch (err) {
    console.error('Game completion error:', err);
    console.error('Stack trace:', err.stack);
    res.status(500).json({ 
      error: 'Server error',
      message: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});

// 7) Start server with automatic port fallback
const desiredPort = Number(process.env.PORT) || 3000;

function startOn(port) {
  const server = app.listen(port, () => {
    const actual = server.address().port;
    console.log(`✅ Server running on http://localhost:${actual}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`⚠️ Port ${port} in use, trying a random free port...`);
      startOn(0); // 0 = pick any free port
    } else {
      console.error('Server error:', err);
      process.exit(1);
    }
  });
}

const server = app.listen(PORT, () => {
  const actualPort = server.address().port;
  console.log(`🚀 Server running on http://localhost:${actualPort}`);
  console.log(`📝 API available at http://localhost:${actualPort}/api`);
  if (process.env.OPENAI_API_KEY) {
    console.log('✅ OpenAI API key found');
  } else {
    console.log('❌ OpenAI API key missing!');
  }
});
