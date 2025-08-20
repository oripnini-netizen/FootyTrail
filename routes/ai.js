// server/routes/ai.js
import express from 'express';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ----------------------------- helpers (new) ----------------------------- */
// Choose a fast, low-latency model by default, with env overrides.
const pickModel = (kind = 'fast') => {
  // Allow explicit overrides first
  if (kind === 'fast') {
    return (
      process.env.OPENAI_MODEL_FAST || // optional override
      process.env.OPENAI_RESPONSES_MODEL_FAST || // optional override
      'gpt-4o-mini' // good quality, much faster than gpt-4o/gpt-5
    );
  }
  // quality/default fallback (kept for completeness; not used in changes below)
  return (
    process.env.OPENAI_MODEL_QUALITY ||
    process.env.OPENAI_RESPONSES_MODEL ||
    process.env.OPENAI_MODEL ||
    'gpt-4o'
  );
};

// Simple timeout wrapper. If the model is slow, we bail and use a fallback.
const DEFAULT_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 8000);
function withTimeout(promise, ms = DEFAULT_TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('openai-timeout')), ms)
    ),
  ]);
}

/* ---------------------------- existing helpers --------------------------- */
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

function banterFallback(name = 'this player') {
  const n = name || 'this player';
  const lines = [
    `Did you know that ${n}'s mum never even came to watch him play?`,
    `Did you know that even ${n}'s dad still isn’t sure which club he plays for?`,
    `Did you know that ${n} once nutmegged his own shadow—allegedly?`,
    `Did you know that ${n} flies so far under the radar that scouts need a map?`,
    `Did you know that ${n} is the kind of trivia answer that even quizmasters Google twice?`,
  ];
  return lines[Math.floor(Math.random() * lines.length)];
}

function looksLikeApology(s = '') {
  const t = s.toLowerCase();
  return (
    t.includes("i'm sorry") ||
    t.includes('i am sorry') ||
    t.includes('cannot provide') ||
    t.includes('insufficient data') ||
    t.includes('unable to find')
  );
}

// Safely pick text from Responses API result
function pickOutputText(resp) {
  if (!resp) return '';
  if (typeof resp.output_text === 'string' && resp.output_text.trim()) {
    return resp.output_text.trim();
  }
  if (Array.isArray(resp.output)) {
    for (const item of resp.output) {
      if (item?.content && Array.isArray(item.content)) {
        const txt = item.content
          .filter(c => c.type === 'output_text' || c.type === 'text')
          .map(c => c.text)
          .filter(Boolean)
          .join('\n')
          .trim();
        if (txt) return txt;
      }
    }
  }
  return '';
}

// --- lightweight country name -> ISO-2 map & normalizer ---
const ISO2_MAP = (() => {
  const m = new Map(
    Object.entries({
      // Common football nationalities + synonyms
      'united states': 'US', usa: 'US', 'u.s.': 'US', 'u.s.a.': 'US', america: 'US',
      'england': 'GB', 'scotland': 'GB', 'wales': 'GB', 'northern ireland': 'GB', 'united kingdom': 'GB', uk: 'GB', britain: 'GB',
      'ireland': 'IE', 'republic of ireland': 'IE',
      'israel': 'IL',
      'spain': 'ES',
      'france': 'FR',
      'germany': 'DE',
      'italy': 'IT',
      'portugal': 'PT',
      'netherlands': 'NL', holland: 'NL',
      'belgium': 'BE',
      'switzerland': 'CH',
      'austria': 'AT',
      'poland': 'PL',
      'czech republic': 'CZ', 'czechia': 'CZ',
      'slovakia': 'SK',
      'hungary': 'HU',
      'romania': 'RO',
      'bulgaria': 'BG',
      'croatia': 'HR',
      'serbia': 'RS',
      'bosnia': 'BA', 'bosnia and herzegovina': 'BA',
      'albania': 'AL',
      'slovenia': 'SI',
      'north macedonia': 'MK', macedonia: 'MK',
      'greece': 'GR',
      'turkey': 'TR',
      'russia': 'RU',
      'ukraine': 'UA',
      'belarus': 'BY',
      'sweden': 'SE',
      'norway': 'NO',
      'denmark': 'DK',
      'finland': 'FI',
      'iceland': 'IS',
      'estonia': 'EE',
      'latvia': 'LV',
      'lithuania': 'LT',
      'morocco': 'MA',
      'algeria': 'DZ',
      'tunisia': 'TN',
      'egypt': 'EG',
      'ghana': 'GH',
      'nigeria': 'NG',
      'senegal': 'SN',
      'cameroon': 'CM',
      'ivory coast': 'CI', "cote d'ivoire": 'CI', 'côte d’ivoire': 'CI', 'côte d\'ivoire': 'CI',
      'dr congo': 'CD', 'democratic republic of the congo': 'CD',
      'congo': 'CG', 'republic of the congo': 'CG',
      'south africa': 'ZA',
      'ethiopia': 'ET',
      'kenya': 'KE',
      'tanzania': 'TZ',
      'uganda': 'UG',
      'mozambique': 'MZ',
      'zambia': 'ZM',
      'zimbabwe': 'ZW',
      'angola': 'AO',
      'cape verde': 'CV', 'cabo verde': 'CV',
      'mexico': 'MX',
      'canada': 'CA',
      'argentina': 'AR',
      'brazil': 'BR',
      'uruguay': 'UY',
      'chile': 'CL',
      'peru': 'PE',
      'paraguay': 'PY',
      'bolivia': 'BO',
      'colombia': 'CO',
      'venezuela': 'VE',
      'ecuador': 'EC',
      'australia': 'AU',
      'new zealand': 'NZ',
      'japan': 'JP',
      'south korea': 'KR', 'korea republic': 'KR',
      'north korea': 'KP',
      'china': 'CN',
      'india': 'IN',
      'iran': 'IR',
      'iraq': 'IQ',
      'saudi arabia': 'SA',
      'qatar': 'QA',
      'united arab emirates': 'AE', uae: 'AE',
      'bahrain': 'BH',
      'kuwait': 'KW',
      'oman': 'OM',
      'jordan': 'JO',
      'lebanon': 'LB',
      'syria': 'SY',
      'armenia': 'AM',
      'georgia': 'GE',
      'azerbaijan': 'AZ',
      'kazakhstan': 'KZ',
      'pakistan': 'PK',
      'bangladesh': 'BD',
      'thailand': 'TH',
      'vietnam': 'VN',
      'indonesia': 'ID',
      'malaysia': 'MY',
      'singapore': 'SG',
      'philippines': 'PH',
      'kosovo': 'XK', // not officially ISO-2, but widely used; acceptable for location hinting
      'palestine': 'PS',
      'morocco': 'MA',
      'tunisia': 'TN',
    })
  );
  return m;
})();

function normCountryName(s = '') {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z\s\-’']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Attempt to get ISO-2 code from:
 * 1) Fast local map
 * 2) Tiny Responses API call with web_search to resolve the code
 */
async function getIso2FromNationality(nationality, modelForLookup = 'gpt-5') {
  if (!nationality) return null;
  const key = normCountryName(nationality);
  if (!key) return null;

  const mapped = ISO2_MAP.get(key);
  if (mapped) return mapped;

  // Fallback: ask the model (with web search) for the ISO 3166-1 alpha-2 code
  try {
    const resp = await openai.responses.create({
      model: modelForLookup,
      temperature: 0,
      tools: [{ type: 'web_search_preview' }],
      instructions:
        'Return ONLY the ISO 3166-1 alpha-2 code for the country name provided. No extra text.',
      input: `Country name: "${nationality}"`,
    });
    const out = pickOutputText(resp).toUpperCase().trim();
    const m = out.match(/^[A-Z]{2}$/);
    if (m) return m[0];
  } catch (err) {
    // ignore and fall through
  }
  return null;
}

/* ----------------------------- routes (changed) ----------------------------- */

// POST /api/ai/generate-player-fact  (now uses fast model + timeout)
router.post('/generate-player-fact', async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
    }

    const { player, transferHistory } = req.body || {};
    const name = player?.name?.trim();
    if (!name) return res.status(400).json({ error: 'Player data required: name' });

    // use fast model
    const model = pickModel('fast');
    const transferHistorySummary = summarizeClubs(transferHistory);

    // Resolve location country code:
    let countryCode = (player?.country || '').toUpperCase().slice(0, 2) || null;
    if (!countryCode && player?.nationality) {
      // we keep the same helper, passing the chosen model
      countryCode = await getIso2FromNationality(player.nationality, model);
    }

    const instructions = `You are a football trivia expert. 
Return EXACTLY ONE short, single-sentence "Did you know..." fun fact about the given player.
- Use the provided player details ONLY to verify you're discussing the correct person; do NOT repeat them.
- You may search the web to find a unique, interesting fact.
- Absolutely NO URLs, citations, or mentions of sources.
- Start with "Did you know that" (or equivalent) and end with punctuation.
- If you truly cannot find a fact, DO NOT apologize — instead return a playful, tongue-in-cheek single sentence starting with "Did you know that" about how obscure the player is (light banter, no insults).`;

    const userPrompt = `
Player Data for Verification:
- Name: ${name}
- Age: ${player?.age ?? 'Unknown'}
- Position: ${player?.position ?? 'Unknown'}
- Nationality: ${player?.nationality ?? 'Unknown'}
- Notable Clubs: ${transferHistorySummary}

Find a NEW and INTERESTING fact about ${name}.
Return ONE sentence only, as instructed.`.trim();

    // Configure web_search with approximate location based on resolved ISO-2 (if present)
    const tools = [
      countryCode
        ? {
            type: 'web_search_preview',
            user_location: { type: 'approximate', country: countryCode },
          }
        : { type: 'web_search_preview' },
    ];

    const response = await withTimeout(
      openai.responses.create({
        model,
        temperature: 0.6,
        max_output_tokens: 120,
        tools,
        instructions,
        input: userPrompt,
      })
    );

    let factRaw = pickOutputText(response);
    let fact = normalizeDidYouKnowSentence(factRaw, name);

    if (!fact || looksLikeApology(fact)) {
      fact = banterFallback(name);
    }
    return res.json({ fact });
  } catch (err) {
    const name = req?.body?.player?.name || 'this player';
    // On timeout/any failure: return banter so UI stays snappy
    if (err && err.message === 'openai-timeout') {
      return res.status(200).json({ fact: banterFallback(name) });
    }
    const safe = {
      name: err?.name,
      status: err?.status,
      statusText: err?.statusText,
      code: err?.code,
      message: err?.message,
      details: err?.response?.data || err?.data || null,
    };
    console.error('[AI fact error]', safe);
    return res.status(200).json({ fact: banterFallback(name) });
  }
});

// POST /api/ai/game-outro  (now uses fast model + timeout)
router.post('/game-outro', async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
    }

    const {
      didWin,
      points = 0,
      guesses = 0,
      timeSeconds = 0,
      playerName,
      isDaily = false,
    } = req.body || {};

    const result = didWin ? 'win' : 'loss';
    const timeClock = secondsToClock(timeSeconds);

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
- No mentioning the player's name.
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

    const completion = await withTimeout(
      openai.chat.completions.create({
        model: pickModel('fast'),
        temperature: 0.7,
        max_tokens: 50,
        messages,
      })
    );

    const line = firstSentenceOnly(completion?.choices?.[0]?.message?.content?.trim() || '');
    if (!line) {
      return res.status(502).json({ error: 'LLM returned empty content' });
    }
    res.json({ line });
  } catch (err) {
    if (err && err.message === 'openai-timeout') {
      // Short, deterministic fallback to keep UX instant
      return res.json({
        line: 'Solid round—quick thinking and sharp instincts. Ready for another shot at glory?',
      });
    }
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

/* ----------------------------- routes (unchanged) ----------------------------- */

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
            `You are a hype commentator for a football players guessing game by their transfer history. Write one short, punchy, single-sentence prompt (max ~20 words) to motivate the user to start a new round. No emojis, no hashtags.`
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

// POST /api/ai/generate-daily-prompt
router.post('/generate-daily-prompt', async (_req, res) => {
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
`Write ONE short, punchy sentence to hype today's Daily Challenge in a football transfer-history guessing game.
The daily round features a *top-tier* player: think Top 10 European leagues, recent seasons only, and a high market value.
Keep it energetic, 20 words or fewer, no emojis, no hashtags.`
        }
      ],
    });
    const raw = completion?.choices?.[0]?.message?.content?.trim() || '';
    return res.json({ prompt: firstSentenceOnly(raw) || 'Guess today’s elite star from the top leagues and grab 10,000 points plus an extra game!' });
  } catch (err) {
    const safe = {
      name: err?.name,
      status: err?.status,
      statusText: err?.statusText,
      code: err?.code,
      message: err?.message,
      details: err?.response?.data || err?.data || null,
    };
    console.error('[AI daily prompt error]', safe);
    return res.status(200).json({ prompt: 'Guess today’s elite star from the top leagues and grab 10,000 points plus an extra game!' });
  }
});

export default router;
