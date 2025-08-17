// server/routes/ai.js
import express from 'express';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---------- helpers ----------
function firstSentenceOnly(text = '') {
  const m = text.match(/^[\s\S]*?[.!?](?=\s|$)/);
  return (m ? m[0] : text).trim();
}

function normalizeDidYouKnowSentence(s, name) {
  if (!s) return '';
  let out = firstSentenceOnly(s).trim();
  // strip urls / citations
  out = out.replace(/\bhttps?:\/\/\S+/gi, '').trim();
  out = out.replace(/\s*\([^)]*\)\s*$/g, '').trim();
  // enforce "Did you know..."
  if (!/^did you know/i.test(out)) {
    const lower = out.charAt(0).toLowerCase() + out.slice(1);
    out = `Did you know that ${lower}`;
  }
  // prefer including the player's name
  if (name && !new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(out)) {
    out = out.replace(/^Did you know that\s*/i, `Did you know that ${name} `);
  }
  if (!/[.!?]$/.test(out)) out += '.';
  return out;
}

function summarizeClubs(transferHistory = []) {
  const clubs = new Set(
    (transferHistory || [])
      .flatMap(t => [
        t?.toClub, t?.fromClub, t?.club,
        t?.to, t?.from,
        t?.team_name, t?.club_name,
        t?.teams?.in?.name, t?.teams?.out?.name,
        t?.to_team, t?.from_team,
        t?.inTeam, t?.outTeam,
      ])
      .filter(Boolean)
      .map(String)
      .map(s => s.trim())
  );
  return Array.from(clubs).slice(0, 10).join(', ') || 'N/A';
}

// ---------- routes ----------

// POST /api/ai/generate-player-fact
// Simple LLM-only generation using chat.completions (no stored Prompt ID).
router.post('/generate-player-fact', async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
    }

    const { player, transferHistory } = req.body || {};
    const name = player?.name?.trim();
    if (!name) return res.status(400).json({ error: 'Player data required: name' });

    const model = process.env.OPENAI_MODEL || 'gpt-4o'; // stronger default; set OPENAI_MODEL to tweak
    const transferHistorySummary = summarizeClubs(transferHistory);

    // Your original prompt, with variables filled in
    const userPrompt = `
You are a football trivia expert. Your task is to provide a short, single-sentence 'Did you know...' style fun fact about a football player.

Use the following data ONLY to verify you are talking about the correct player. DO NOT simply repeat this information.

Player Data for Verification:
- Name: ${name}
- Age: ${player?.age ?? 'Unknown'}
- Position: ${player?.position ?? 'Unknown'}
- Notable Clubs: ${transferHistorySummary}

Now, find a NEW and INTERESTING fun fact about ${name} from your own knowledge. The fact could be about:
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

Generate the fun fact now:`.trim();

    const completion = await openai.chat.completions.create({
      model,
      temperature: 0.7,
      max_tokens: 80,
      messages: [{ role: 'user', content: userPrompt }],
    });

    let fact = completion?.choices?.[0]?.message?.content?.trim() || '';
    fact = normalizeDidYouKnowSentence(fact, name);

    if (!fact) {
      console.error('[AI fact] Empty output from chat.completions response:', JSON.stringify(completion, null, 2));
      return res.status(502).json({ error: 'LLM returned empty content' });
    }

    return res.json({ fact });
  } catch (err) {
    const safe = {
      name: err?.name,
      status: err?.status,
      statusText: err?.statusText,
      code: err?.code,
      message: err?.message,
      details: err?.response?.data || err?.data || null,
    };
    console.error('[AI fact error]', safe);
    return res.status(500).json({ error: 'Failed to generate fact' });
  }
});

// POST /api/ai/generate-game-prompt
router.post('/generate-game-prompt', async (_req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
    }

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      temperature: 0.9,
      max_tokens: 60,
      messages: [
        {
          role: 'user',
          content:
            `You are a hype commentator for a football guessing game. Write one short, punchy, single-sentence prompt (max ~20 words) to motivate the user to start a new round. No emojis, no hashtags.`
        }
      ],
    });

    let prompt = completion?.choices?.[0]?.message?.content?.trim() || '';
    prompt = firstSentenceOnly(prompt);
    return res.json({ prompt });
  } catch (err) {
    const safe = {
      name: err?.name,
      status: err?.status,
      statusText: err?.statusText,
      code: err?.code,
      message: err?.message,
      details: err?.response?.data || err?.data || null,
    };
    console.error('[AI prompt error]', safe);
    return res.status(500).json({ error: 'Failed to generate prompt' });
  }
});

export default router;
