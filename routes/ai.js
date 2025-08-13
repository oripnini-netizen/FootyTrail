// Convert to ES module syntax
import express from 'express';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();

// Configure OpenAI with newer SDK
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Endpoint to generate player facts
router.post('/generate-player-fact', async (req, res) => {
  try {
    const { player, transferHistory } = req.body;
    
    // Prepare context for the AI
    let clubs = [];
    if (Array.isArray(transferHistory)) {
      clubs = transferHistory.map(t => t.club_name || t.club || '').filter(Boolean);
    }
    
    const clubsText = clubs.length ? `who played for these clubs: ${clubs.join(', ')}` : '';
    
    // Prepare prompt based on available data
    const prompt = `Generate an interesting and little-known fact about footballer ${player.name || 'this player'} ${clubsText}. 
    Make it engaging and concise (max 2 sentences). If you don't have specific information, create a plausible and entertaining football-related fact.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You are a knowledgeable football expert who provides interesting facts about players." },
        { role: "user", content: prompt }
      ],
      max_tokens: 100,
      temperature: 0.7,
    });

    const fact = completion.choices[0].message.content.trim();
    console.log("Generated fact:", fact); // For debugging
    res.json({ fact });
  } catch (error) {
    console.error('Error generating player fact:', error);
    res.status(500).json({ error: 'Failed to generate player fact', details: error.message });
  }
});

// Export default instead of module.exports
export default router;