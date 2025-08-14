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
    console.log("Generate player fact endpoint called");
    const { player, transferHistory } = req.body;
    
    // Bail early if no player data
    if (!player || !player.name) {
      return res.status(400).json({ error: 'Player data required' });
    }
    
    console.log("Generating fact for player:", player.name);
    
    // Process transfer history to a readable format
    let transferHistorySummary = "";
    if (transferHistory && transferHistory.length > 0) {
      transferHistorySummary = transferHistory
        .map(t => t.team_name || t.club_name || t.club)
        .filter(Boolean)
        .join(", ");
    }
    
    // Check if OpenAI API key exists
    if (!process.env.OPENAI_API_KEY) {
      console.log("No OpenAI API key found - returning fallback fact");
      return res.status(200).json({ 
        fact: `${player.name} has had a career full of surprising moments that many fans don't know about.`
      });
    }
    
    // Create prompt for OpenAI
    const prompt = `You are a football trivia expert. Your task is to provide a short, single-sentence 'Did you know...' style fun fact about a football player.

Use the following data ONLY to verify you are talking about the correct player. DO NOT simply repeat this information.

Player Data for Verification:
- Name: ${player.name}
- Age: ${player.age || 'Unknown'}
- Position: ${player.position || 'Unknown'}
- Notable Clubs: ${transferHistorySummary || 'Unknown'}

Now, find a NEW and INTERESTING fun fact about ${player.name} from your own knowledge or by searching the web. The fact could be about:
- A famous nickname or unusual habit
- A unique record they hold
- A memorable goal or match moment
- An interesting piece of personal trivia (e.g., family connections, hobbies, education)
- Something surprising about their career path or background

Example: "Did you know that his nickname is 'The Butcher of Amsterdam' due to his aggressive playing style?"

CRITICAL INSTRUCTIONS:
- Do NOT include any source URLs, links, or citations in parentheses
- Do NOT include markdown links like [website](url)
- Do NOT mention where you found the information
- Provide ONLY the fun fact as a clean, single sentence
- Start with "Did you know that" or similar phrasing

Generate the fun fact now:`;

    // Define fallback facts in case OpenAI fails
    const fallbackFacts = [
      `${player.name} has a pre-match ritual that many teammates find unusual but respect as part of their preparation.`,
      `${player.name} almost pursued a completely different career before focusing on football professionally.`,
      `${player.name} holds an interesting record that isn't widely known among casual football fans.`,
      `${player.name} has an unexpected hobby outside of football that helps them maintain mental balance.`,
      `In their youth career, ${player.name} played in a completely different position before finding their current role.`
    ];
    
    try {
      console.log("Sending request to OpenAI...");
      const completion = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: "You are a knowledgeable football/soccer trivia expert." },
          { role: "user", content: prompt }
        ],
        max_tokens: 100,
        temperature: 0.7,
      });

      const factText = completion.choices[0].message.content.trim();
      console.log("Generated OpenAI fact:", factText);
      
      return res.json({ fact: factText });
    } catch (openaiError) {
      console.error('Error with OpenAI:', openaiError);
      // Fall back to random pre-written fact
      const randomFact = fallbackFacts[Math.floor(Math.random() * fallbackFacts.length)];
      console.log("Using fallback fact:", randomFact);
      return res.json({ fact: randomFact });
    }
  } catch (error) {
    console.error('General error in generate-player-fact:', error);
    res.status(500).json({ 
      error: 'Failed to generate player fact',
      fact: `${req.body?.player?.name || 'This player'} has had a remarkable journey through their football career.`
    });
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
            { role: "user", content: "Generate a short, engaging 1-2 sentence prompt to motivate someone to play a football player guessing game by their transfer history. Be enthusiastic and creative. Maximum 120 characters." }
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