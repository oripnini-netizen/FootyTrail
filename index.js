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
    const { userId, playerData, gameStats } = req.body;
    
    // Validate the user exists
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('id', userId)
      .single();
      
    if (userError || !user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Save the game record using admin privileges
    const { data, error } = await supabaseAdmin
      .from('games_records')
      .insert([{
        user_id: userId,
        player_id: playerData.id,
        player_name: playerData.name,
        won: gameStats.won,
        points_earned: gameStats.points,
        time_taken_seconds: gameStats.timeTaken,
        guesses_attempted: gameStats.guessesAttempted,
        hints_used: gameStats.hintsUsed,
        is_daily_challenge: gameStats.isDaily,
        created_at: new Date().toISOString()
      }])
      .select();
      
    if (error) {
      console.error('Error saving game record:', error);
      return res.status(500).json({ error: 'Failed to save game record' });
    }
    
    res.json({ success: true, record: data[0] });
  } catch (err) {
    console.error('Game completion error:', err);
    res.status(500).json({ error: 'Server error' });
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
