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

// Endpoint to generate game prompts
router.post('/generate-game-prompt', async (req, res) => {
  try {
    console.log("Generate game prompt endpoint called");
    
    // Define an array of engaging football prompts
    const engagingPrompts = [
      "Think you know football? Identify this mystery player and prove your expertise!",
      "A new challenge awaits! Can you guess this football star from the clues?",
      "Football legends hide in the shadows. Bring them to light with your knowledge!",
      "Step up to the plate! This footballing icon is waiting to be discovered.",
      "Your football detective skills are needed! Identify this mystery player.",
      "Can you name this football maestro? Test your knowledge with our next challenge!",
      "From academies to stardom - can you identify this football talent?",
      "Ready for the ultimate test? Name this mystery footballer to earn your points!",
      "The beautiful game has many heroes. Can you recognize this one?",
      "Football trivia masters wanted! Put your skills to the test with this player."
    ];
    
    // Check if OpenAI API key exists and we're not in development mode
    if (process.env.OPENAI_API_KEY && process.env.NODE_ENV === 'production') {
      try {
        console.log("OpenAI API Key found, attempting to generate prompt");
        const completion = await openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages: [
            { role: "system", content: "You are an enthusiastic football expert who creates engaging game prompts." },
            { role: "user", content: "Generate a short, engaging 1-2 sentence prompt to motivate someone to play a football player guessing game. Be enthusiastic and creative. Maximum 120 characters." }
          ],
          max_tokens: 60,
          temperature: 0.8,
        });

        const gamePrompt = completion.choices[0].message.content.trim();
        console.log("Generated OpenAI prompt:", gamePrompt);
        return res.json({ prompt: gamePrompt });
      } catch (openaiError) {
        console.error('Error with OpenAI:', openaiError);
        // Fall back to random pre-written prompt
        const randomPrompt = engagingPrompts[Math.floor(Math.random() * engagingPrompts.length)];
        console.log("Using fallback prompt:", randomPrompt);
        return res.json({ prompt: randomPrompt });
      }
    } else {
      // Simply use a random pre-written prompt for development or when no API key
      const randomPrompt = engagingPrompts[Math.floor(Math.random() * engagingPrompts.length)];
      console.log("Using fallback prompt in development:", randomPrompt);
      return res.json({ prompt: randomPrompt });
    }
  } catch (error) {
    console.error('General error in generate-game-prompt:', error);
    res.status(200).json({ 
      prompt: "Ready to test your football knowledge? Set your filters and start the challenge!"
    });
  }
});

// Export default instead of module.exports
export default router;