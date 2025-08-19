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

function secondsToClock(s = 0) {
  const n = Math.max(0, Math.floor(Number(s) || 0));
  const mm = String(Math.floor(n / 60)).padStart(2, '0');
  const ss = String(n % 60).padStart(2, '0');
  return `${mm}:${ss}`;
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

    const model = process.env.OPENAI_MODEL || 'gpt-4o';
    const transferHistorySummary = summarizeClubs(transferHistory);

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
- An interesting piece of personal trivia (e.g., family, hobbies, education)
- Something surprising about their career path or background

CRITICAL INSTRUCTIONS:
- Do NOT include any source URLs, links, or citations
- Do NOT mention where you found the information
- Provide ONLY the fun fact as a clean, single sentence
- Start with "Did you know that" or similar phrasing
`.trim();

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

// POST /api/ai/game-outro
// Generate a single-sentence end-of-round line (praise/tease) based on performance.
router.post('/game-outro', async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
    }

    const {
      won,
      points = 0,
      guesses = 0,
      timeSeconds = 0,
      playerName,
      isDaily = false,
    } = req.body || {};

    const result = won ? 'win' : 'loss';
    const timeClock = secondsToClock(timeSeconds);

    // Clear, strict instruction set to keep output crisp & single-sentence
    const messages = [
      {
        role: 'system',
        content:
`You are a witty football quiz commentator.
Write EXACTLY ONE sentence reacting to the user's round outcome.
Tone:
- If win: celebratory and concise.
- If loss: cheeky but encouraging.
Content constraints:
- 1 single sentence only (max ~22 words).
- No emojis, no hashtags, no URLs or sources.
- You MAY mention the player's name once if provided.
- Avoid filler like "overall", "in conclusion", etc.`
      },
      {
        role: 'user',
        content:
`Round summary:
- Result: ${result}
- Mode: ${isDaily ? 'Daily Challenge' : 'Regular'}
- Points: ${points}
- Guesses used: ${guesses}
- Time: ${timeClock}
- Player: ${playerName || 'N/A'}

Write the one-sentence outro now.`
      }
    ];

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      temperature: 0.8,
      max_tokens: 50,
      messages,
    });

    const line = firstSentenceOnly(completion?.choices?.[0]?.message?.content?.trim() || '');
    if (!line) {
      return res.status(502).json({ error: 'LLM returned empty content' });
    }
    res.json({ line });
  } catch (err) {
    const safe = {
      name: err?.name,
      status: err?.status,
      statusText: err?.statusText,
      code: err?.code,
      message: err?.message,
      details: err?.response?.data || err?.data || null,
    };
    console.error('[AI game-outro error]', safe);
    return res.status(500).json({ error: 'Failed to generate outro' });
  }
});

export default router;
