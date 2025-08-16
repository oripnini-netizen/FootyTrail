// server/routes/ai.js
import express from 'express';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ---------- Utilities ----------

// Minimal nationality -> Wikipedia language mapping (extend as needed)
const NAT_LANG = {
  // Europe
  Spain: 'es', Mexico: 'es', Argentina: 'es', Colombia: 'es', Chile: 'es', Uruguay: 'es', Peru: 'es', Paraguay: 'es', Bolivia: 'es', Ecuador: 'es', Venezuela: 'es',
  Portugal: 'pt', Brazil: 'pt', 'Cabo Verde': 'pt', Angola: 'pt', Mozambique: 'pt',
  France: 'fr', Belgium: 'fr', Switzerland: 'fr',
  Germany: 'de', Austria: 'de', 'Switzerland (German)': 'de',
  Italy: 'it',
  Netherlands: 'nl', Belgium_NL: 'nl',
  Poland: 'pl',
  Russia: 'ru',
  Ukraine: 'uk',
  Turkey: 'tr',
  Greece: 'el',
  Croatia: 'hr', Serbia: 'sr', Slovenia: 'sl',
  Sweden: 'sv', Norway: 'no', Denmark: 'da', Finland: 'fi',
  Czechia: 'cs', Slovakia: 'sk',
  Romania: 'ro', Bulgaria: 'bg', Hungary: 'hu',
  // Middle East & North Africa
  Israel: 'he',
  Morocco: 'ar', Algeria: 'ar', Tunisia: 'ar', Egypt: 'ar', SaudiArabia: 'ar', 'Saudi Arabia': 'ar', UAE: 'ar', 'United Arab Emirates': 'ar', Iraq: 'ar', Jordan: 'ar', Lebanon: 'ar', Qatar: 'ar',
  // Others common in football
  England: 'en', Scotland: 'en', Wales: 'en', 'Northern Ireland': 'en', Ireland: 'en',
  USA: 'en', Canada: 'en',
};

// Build candidate language list: player’s national language first, then English
function langCandidates(nationality) {
  const key = (nationality || '').trim();
  const first = NAT_LANG[key] || null;
  const langs = [];
  if (first) langs.push(first);
  if (!langs.includes('en')) langs.push('en');
  return langs;
}

function firstSentenceOnly(text = '') {
  const m = text.match(/^[\s\S]*?[.!?](?=\s|$)/);
  return (m ? m[0] : text).trim();
}

// Wikipedia helpers (Node 18+ has global fetch; if you’re on Node 16, install node-fetch)
async function wikiSearch(lang, query) {
  const url = new URL(`https://${lang}.wikipedia.org/w/api.php`);
  url.search = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: query,
    srlimit: '3',
    format: 'json',
    utf8: '1',
    srnamespace: '0',
  }).toString();

  const r = await fetch(url, { headers: { 'user-agent': 'FootyTrail/1.0' } });
  if (!r.ok) return null;
  const data = await r.json();
  const hit = data?.query?.search?.[0];
  if (!hit) return null;
  return { title: hit.title, pageid: hit.pageid };
}

async function wikiSummary(lang, title) {
  const slug = encodeURIComponent(title.replace(/\s/g, '_'));
  const r = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${slug}`, {
    headers: { 'user-agent': 'FootyTrail/1.0' }
  });
  if (!r.ok) return null;
  const data = await r.json();
  // extract: main text; description: short tag line
  const extract = (data?.extract || '').trim();
  const description = (data?.description || '').trim();
  return { extract, description, title: data?.title || title, lang };
}

// Try national language first, then English; collect up to two summaries
async function researchPlayer(name, nationality) {
  const langs = langCandidates(nationality);
  const snippets = [];

  for (const lang of langs) {
    try {
      const hit = await wikiSearch(lang, name);
      if (!hit) continue;
      const sum = await wikiSummary(lang, hit.title);
      if (!sum) continue;

      // Keep it short; capture first ~2 sentences to feed model
      const first = firstSentenceOnly(sum.extract);
      let remainder = sum.extract.slice(first.length).trim();
      remainder = firstSentenceOnly(remainder);

      const text = [sum.description, first, remainder].filter(Boolean).join(' ');
      if (text) {
        snippets.push(`[${lang}] ${text}`);
      }
      // Two snippets are usually enough; stop early if both languages worked
      if (snippets.length >= 2) break;
    } catch (_) {
      // pass
    }
  }

  return snippets;
}

// Clean & enforce output style
function normalizeDidYouKnowSentence(s, name) {
  if (!s) return '';
  let out = firstSentenceOnly(s).trim();

  // Remove URLs/citations
  out = out.replace(/\bhttps?:\/\/\S+/gi, '').trim();
  out = out.replace(/\s*\([^)]*\)\s*$/g, '').trim();

  // Ensure it begins with "Did you know"
  if (!/^did you know/i.test(out)) {
    // If the sentence already includes the name but starts some other way, just prepend
    const lc = out.charAt(0).toLowerCase() + out.slice(1);
    out = `Did you know that ${lc}`;
  }
  if (!/[.!?]$/.test(out)) out += '.';

  // Prefer mentioning the player’s name if omitted
  if (name && !new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(out)) {
    // Try to inject name after "Did you know that"
    out = out.replace(/^Did you know that\s*/i, `Did you know that ${name} `);
  }

  return out;
}

// ---------- Endpoints ----------

// POST /api/ai/generate-player-fact
// body: { player: { name, nationality, position, age }, transferHistory: [...] }
router.post('/generate-player-fact', async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
    }

    const { player, transferHistory } = req.body || {};
    const name = player?.name?.trim();
    if (!name) return res.status(400).json({ error: 'Player data required: name' });

    // 1) Web research (Wikipedia; national language first, then English)
    const snippets = await researchPlayer(name, player?.nationality || '');

    // If we found nothing useful, fail (client shows nothing; no fallback text)
    if (!snippets.length) {
      return res.status(502).json({ error: 'No research snippets found' });
    }

    // Make a compact “verification only” block (to anchor the right person)
    const clubs = Array.from(
      new Set(
        (transferHistory || [])
          .map(t => t?.toClub || t?.fromClub || t?.club || t?.to || t?.from || t?.team_name || t?.club_name)
          .filter(Boolean)
          .map(String)
          .map(s => s.trim())
      )
    ).slice(0, 10);
    const transferSummary = clubs.length ? clubs.join(', ') : 'N/A';

    // 2) Ask LLM to produce one sentence ONLY from research snippets (no invention)
    const system = `You are a football trivia assistant.
Use ONLY the "Research Snippets" provided to craft one interesting, single-sentence fun fact about the player.
Do NOT invent facts. If the snippets don't contain anything notable, say nothing (return empty content). 
No links, no citations, no markdown—just one clean sentence starting with "Did you know that".`;

    const userPrompt = `
Verification (DO NOT repeat this unless it helps you choose among snippets):
- Name: ${name}
- Age: ${player?.age ?? 'Unknown'}
- Position: ${player?.position ?? 'Unknown'}
- Notable Clubs (from transfers): ${transferSummary}

Research Snippets (use these as your ONLY factual source):
${snippets.map((s, i) => `- ${s}`).join('\n')}

Now write ONE short sentence beginning with "Did you know that". No links, no sources, no extra sentences.`.trim();

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.4,   // lower temperature to reduce generic fluff
      max_tokens: 80,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userPrompt }
      ],
    });

    let fact = completion?.choices?.[0]?.message?.content?.trim() || '';
    fact = normalizeDidYouKnowSentence(fact, name);

    if (!fact) return res.status(502).json({ error: 'LLM returned empty content' });

    return res.json({ fact });
  } catch (err) {
    console.error('AI fact error:', err);
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
      model: 'gpt-4o-mini',
      temperature: 0.8,
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
    console.error('AI prompt error:', err);
    return res.status(500).json({ error: 'Failed to generate prompt' });
  }
});

export default router;
