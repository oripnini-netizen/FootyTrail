import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Simple test route
app.get('/api/test', (req, res) => {
  res.json({ message: 'Server is working!' });
});

// Game prompt endpoint
app.post('/api/ai/generate-game-prompt', (req, res) => {
  // Simple test response without OpenAI
  res.json({ 
    prompt: "Can you identify this football legend? Step up to the challenge and test your knowledge!"
  });
});

// Player pool count endpoint
app.get('/api/player-pool-count', (req, res) => {
  res.json({ count: 64380 });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});