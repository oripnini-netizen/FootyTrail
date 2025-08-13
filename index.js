// index.js — Node server entry point (ESM)

// 1) Preload .env BEFORE anything else (side‑effect import)
import 'dotenv/config';

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import gameRouter from './routes/game.js';
import aiRoutes from './routes/ai.js'; // Import the AI routes

// Add this in your index.js or wherever you start the server
console.log('Environment check:');
console.log('USE_RPC_COUNTS:', process.env.USE_RPC_COUNTS);
console.log('SUPABASE_URL:', process.env.SUPABASE_URL ? 'Set' : 'Not set');

// 2) Create app
const app = express();

// 3) CORS (allow any localhost port; send cookies if needed)
app.use(
  cors({
    origin: [/^http:\/\/localhost:\d+$/],
    credentials: true,
  })
);

// 4) JSON body parsing
app.use(express.json());

// 5) Routes (now safe to import — env is loaded)
app.use('/api', gameRouter);  // Changed from '/api/game' to '/api'
app.use('/api/ai', aiRoutes); // Register the AI routes

// 6) Static files (optional)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, 'public')));

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

startOn(desiredPort);
