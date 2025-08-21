// client/src/pages/PostGamePage.jsx
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, useAnimate } from 'framer-motion';
import confetti from 'canvas-confetti';
import {
  User as UserIcon,
  Trophy,
  Clock,
  Target,
  ArrowLeft,
  Share2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../supabase/client';
import { getRandomPlayer, API_BASE, getGamePrompt } from '../api';
import {
  loadPostGameCache,
  savePostGameCache,
  clearPostGameCache,
} from '../state/postGameCache';

const REGULAR_START_POINTS = 6000; // kept for safety, but not used for "play again" anymore

/* =========================
   UTC day boundary helpers
   ========================= */
function toUtcMidnight(dateLike) {
  const d = typeof dateLike === 'string' ? new Date(`${dateLike}T00:00:00.000Z`) : new Date(dateLike);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function todayUtcMidnight() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
function dayRangeUtc(dateStr) {
  const start = toUtcMidnight(dateStr);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}
/** Robust “time until next UTC midnight” */
function msUntilNextUtcMidnight() {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return next.getTime() - now.getTime();
}
function CountdownToTomorrow() {
  const [timeLeft, setTimeLeft] = useState(format(msUntilNextUtcMidnight()));
  useEffect(() => {
    const id = setInterval(() => setTimeLeft(format(msUntilNextUtcMidnight())), 1000);
    return () => clearInterval(id);
  }, []);
  function format(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
    const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
    const s = String(totalSec % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
  }
  return <span>{timeLeft}</span>;
}

export default function PostGamePage() {
  const navigate = useNavigate();
  const location = useLocation();
  // NOTE: we no longer alias here; instead we read from multiple possible keys below
  const { didWin, player, stats, filters, isDaily } = location.state || {};
  const { user } = useAuth();

  // NEW: read previous potential points from several possible places
  const prevPotentialPoints =
    location.state?.potentialPoints ??
    location.state?.prevPotentialPoints ??
    location.state?.potential_points ??
    filters?.potentialPoints ??
    null;

  const [loading, setLoading] = useState(false);
  const [gamesLeft, setGamesLeft] = useState(null);

  // LLM-only fact (still shown when available)
  const [aiGeneratedFact, setAiGeneratedFact] = useState('');

  // Dynamic banner line (LLM first; has graceful local fallback)
  const [outroLine, setOutroLine] = useState('');

  // Gate the entire page until fact is ready (so no “generating...” flashes)
  const [pageReady, setPageReady] = useState(false);

  const [scope, animate] = useAnimate();

  // For “share” (copy) we capture only the card (minus buttons)
  const cardRef = useRef(null);
  const actionsRef = useRef(null);

  // ---- cache guards ----
  const hasRestoredRef = useRef(false);
  const restoredFromCacheRef = useRef(false);

  const playerKey = getPlayerKey(player); // used to validate cache belongs to this result

  // Personal display name resolved from public.users (fallback to auth metadata/email)
  const [displayName, setDisplayName] = useState(null);

  // Fire confetti only for wins (first real render)
  useEffect(() => {
    if (didWin) {
      confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
    }
  }, [didWin]);

  // Shake animation only on losses after page mounts
  useEffect(() => {
    if (didWin) return;
    if (!pageReady) return;
    if (!scope.current) return;

    const sequence = async () => {
      try {
        await animate(scope.current, { x: -5 }, { duration: 0.05 });
        await animate(scope.current, { x: 5 }, { duration: 0.05 });
        await animate(scope.current, { x: -5 }, { duration: 0.05 });
        await animate(scope.current, { x: 5 }, { duration: 0.05 });
        await animate(scope.current, { x: -3 }, { duration: 0.05 });
        await animate(scope.current, { x: 3 }, { duration: 0.05 });
        await animate(scope.current, { x: -2 }, { duration: 0.05 });
        await animate(scope.current, { x: 2 }, { duration: 0.05 });
        await animate(scope.current, { x: 0 }, { duration: 0.05 });
      } catch { /* StrictMode double-invoke safe */ }
    };
    sequence();
  }, [didWin, pageReady, animate]);

  // ---------- Restore from cache instantly ----------
  useLayoutEffect(() => {
    if (hasRestoredRef.current) return;

    const cached = loadPostGameCache();
    if (cached && cached.playerKey === playerKey) {
      try {
        if (typeof cached.aiGeneratedFact === 'string') {
          setAiGeneratedFact(cached.aiGeneratedFact);
        }
        if (typeof cached.gamesLeft === 'number') {
          setGamesLeft(cached.gamesLeft);
        }
        if (typeof cached.outroLine === 'string') {
          setOutroLine(cached.outroLine);
        }
        // Show page right away
        setPageReady(true);

        // Restore scroll gently
        requestAnimationFrame(() => window.scrollTo(0, cached.scrollY || 0));
        setTimeout(() => window.scrollTo(0, cached.scrollY || 0), 0);

        restoredFromCacheRef.current = true;
      } catch {
        clearPostGameCache();
      }
    }

    hasRestoredRef.current = true;
  }, [playerKey]);

  // Save cache on unmount / tab hide
  useEffect(() => {
    const saveNow = () => {
      savePostGameCache({
        playerKey,
        aiGeneratedFact,
        outroLine,
        gamesLeft,
        scrollY: window.scrollY,
      });
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') saveNow();
    };
    document.addEventListener('visibilitychange', onVisibility, { passive: true });
    window.addEventListener('pagehide', saveNow, { passive: true });

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', saveNow);
      saveNow();
    };
  }, [playerKey, aiGeneratedFact, outroLine, gamesLeft]);

  // ---------- Resolve the user's display name from public.users (exactly "Ori Pnini" in your case) ----------
  useEffect(() => {
    let cancelled = false;
    async function loadName() {
      if (!user?.id) return;
      try {
        const { data, error } = await supabase
          .from('users')
          .select('full_name')
          .eq('id', user.id)
          .single();
        if (error) throw error;
        if (!cancelled) {
          const name =
            data?.full_name ||
            user?.user_metadata?.full_name ||
            (user?.email ? user.email.split('@')[0] : null) ||
            null;
          setDisplayName(name);
        }
      } catch {
        if (!cancelled) {
          const name =
            user?.user_metadata?.full_name ||
            (user?.email ? user.email.split('@')[0] : null) ||
            null;
          setDisplayName(name);
        }
      }
    }
    loadName();
    return () => { cancelled = true; };
  }, [user?.id]);

  // ---------- Fetch "games left" — now using UTC day range ----------
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    async function fetchGamesLeftUtc() {
      try {
        const todayISO = todayUtcMidnight().toISOString().slice(0, 10);
        const { start, end } = dayRangeUtc(todayISO);
        const { data, error } = await supabase
          .from('games_records')
          .select('id')
          .eq('user_id', user.id)
          .eq('is_daily_challenge', false)
          .gte('created_at', start)
          .lt('created_at', end);
        if (error) throw error;
        if (!cancelled) {
          const remaining = 10 - (data?.length || 0);
          setGamesLeft(Math.max(0, remaining));
        }
      } catch {
        if (!cancelled) setGamesLeft(null);
      }
    }

    fetchGamesLeftUtc();
    return () => { cancelled = true; };
  }, [user?.id]);

  // ---------- AI bits: fun fact + outro line ----------
  useEffect(() => {
    if (!player) {
      navigate('/game', { replace: true });
      return;
    }

    // If we restored both from cache, just show the page.
    if (restoredFromCacheRef.current && (aiGeneratedFact || outroLine)) {
      setPageReady(true);
      return;
    }

    const fetchAll = async () => {
      let fact = '';
      let outro = '';

      // 1) Fun fact
      try {
        const transfers = player.transfers || player.transferHistory || [];
        const res = await fetch(`${API_BASE}/ai/generate-player-fact`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            player: {
              name: player.name || player.player_name || 'Unknown Player',
              nationality: player.nationality || player.player_nationality || '',
              position: player.position || player.player_position || '',
              age: player.age || player.player_age || ''
            },
            transferHistory: transfers
          }),
        });
        if (res.ok) {
          const data = await res.json();
          fact = (data && typeof data.fact === 'string') ? data.fact.trim() : '';
        }
      } catch { /* ignore */ }

      // 2) Dynamic top banner line (LLM endpoint if present; otherwise rich local fallback)
      try {
        let line = '';
        try {
          if (typeof getGamePrompt === 'function') {
            const promptRes = await getGamePrompt({
              mode: 'postgame',
              didWin: !!didWin,
              stats: stats || {},
              player: {
                name: player?.name,
                position: player?.position,
                nationality: player?.nationality,
              },
            });
            if (promptRes && typeof promptRes.text === 'string') {
              line = promptRes.text.trim();
            }
          }
        } catch { /* ignore */ }

        // Fallback endpoint (note: if your server returns 405 for POST here, we’ll skip it and use local fallback)
        if (!line) {
          try {
            const res2 = await fetch(`${API_BASE}/ai/game-outro`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                didWin,
                stats,
                playerName: player?.name,
                isDaily: !!isDaily
              }),
            });
            if (res2.ok) {
              const data = await res2.json();
              line = (data && typeof data.line === 'string') ? data.line.trim() : '';
            }
          } catch { /* ignore network errors */ }
        }

        if (!line) {
          line = localOutroLine({ didWin: !!didWin, stats, player });
        }

        // *** PERSONALIZE: replace a generic "Player/player" with the user's full_name ***
        const nameForLine =
          displayName ||
          user?.full_name ||
          user?.user_metadata?.full_name ||
          (user?.email ? user.email.split('@')[0] : null) ||
          'Player';
        outro = personalizeUserNameInLine(line, nameForLine);
      } catch {
        const fallbackLine = localOutroLine({ didWin: !!didWin, stats, player });
        const nameForLine =
          displayName ||
          user?.full_name ||
          user?.user_metadata?.full_name ||
          (user?.email ? user.email.split('@')[0] : null) ||
          'Player';
        outro = personalizeUserNameInLine(fallbackLine, nameForLine);
      }

      setAiGeneratedFact(fact);
      setOutroLine(outro);

      // Page is ready to show
      setPageReady(true);

      // persist to cache
      savePostGameCache({
        playerKey,
        aiGeneratedFact: fact,
        outroLine: outro,
        gamesLeft,
        scrollY: window.scrollY,
      });
    };

    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerKey, displayName]);

  // If displayName arrives a bit later, re-personalize the already-built line
  useEffect(() => {
    if (outroLine && displayName) {
      setOutroLine((prev) => personalizeUserNameInLine(prev, displayName));
    }
  }, [displayName]); // eslint-disable-line react-hooks/exhaustive-deps

  // If user somehow hits this without state, redirect
  useEffect(() => {
    if (!player) navigate('/game', { replace: true });
  }, [player, navigate]);

  // ------- Play again with SAME FILTERS and next potential points = previous - 5 -------
  const playAgainWithSameFilters = async () => {
    if (loading || gamesLeft <= 0) return;
    setLoading(true);
    try {
      // Map filters from previous round (support both legacy & new keys)
      const competitions =
        (filters?.competitions && Array.isArray(filters.competitions)) ? filters.competitions : [];
      const seasons =
        (filters?.seasons && Array.isArray(filters.seasons)) ? filters.seasons : [];
      const minMarketValue =
        Number(filters?.minMarketValue ?? filters?.min_market_value ?? 0) || 0;

      // Previous potential (from LiveGamePage -> PostGamePage state, with robust fallbacks)
      const prevPot = Number(prevPotentialPoints);
      if (!Number.isFinite(prevPot) || prevPot <= 0) {
        alert("Could not determine the previous round’s pool size. Please start from the Game page.");
        setLoading(false);
        return;
      }
      // If pool was 1 player (prevPot = 5), block restart with same filters
      if (prevPot <= 5) {
        alert('No players left in the pool with those filters. Please adjust your selection.');
        setLoading(false);
        return;
      }

      const nextPotential = prevPot - 5;

      const nextCard = await getRandomPlayer(
        { competitions, seasons, minMarketValue },
        user?.id
      );

      // clear cache because we are starting a new game
      clearPostGameCache();

      navigate('/live', {
        state: {
          ...nextCard,
          isDaily: false,
          // persist exactly the same filters
          filters: { competitions, seasons, minMarketValue },
          // next round starts with previous potential - 5
          potentialPoints: nextPotential,
          fromPostGame: true,
        },
        replace: true
      });
    } catch (error) {
      console.error('Error starting new game:', error);
      alert('Failed to start a new game. Please try again.');
      setLoading(false);
    }
  };

  // ---- Share card (copy to clipboard as rich HTML; fallback to plain text) ----
  const onShare = async () => {
    try {
      const html = buildShareHTML({ didWin, outroLine, player, stats, aiGeneratedFact });
      const text = buildShareText({ didWin, outroLine, player, stats, aiGeneratedFact });

      if (navigator.clipboard && 'write' in navigator.clipboard && window.ClipboardItem) {
        const blobHTML = new Blob([html], { type: 'text/html' });
        const blobText = new Blob([text], { type: 'text/plain' });
        await navigator.clipboard.write([new window.ClipboardItem({
          'text/html': blobHTML,
          'text/plain': blobText,
        })]);
        alert('Post-game card copied to clipboard!');
        return;
      }

      // Fallback: copy text
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        alert('Post-game summary copied to clipboard!');
        return;
      }

      alert('Sorry, your browser blocked clipboard access.');
    } catch (e) {
      console.error('Share failed:', e);
      alert('Could not copy the card. Please try again.');
    }
  };

  // ----- Loading screen while page prepares -----
  if (!pageReady) {
    return <LoadingBounceLogo />;
  }

  if (!player) return null; // redirect handler above will take care

  const pdata = player || {};
  const photo = pdata.player_photo || pdata.photo || null;

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-green-50 to-transparent">
      <div className="fixed inset-0 -z-10 bg-gradient-to-b from-green-50 to-transparent" />
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-4xl mx-auto px-4 py-8">
        <div ref={cardRef} className="bg-white rounded-xl shadow-sm p-6" >
          {/* Dynamic top banner (LLM if available) */}
          <div
            ref={scope}
            className={`${didWin ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'} rounded-lg p-3 mb-6 text-center`}
          >
            <h2 className={`text-xl font-bold ${didWin ? 'text-green-700' : 'text-red-700'}`}>
              {outroLine || (didWin ? 'Great job! You guessed it!' : `Not quite! The player was ${player?.name}`)}
            </h2>
          </div>

          {/* Player Info */}
          <div className="flex gap-6 mb-6">
            {photo ? (
              <img src={photo} alt={player.name} className="w-32 h-32 object-cover rounded-lg" />
            ) : (
              <div className="w-32 h-32 bg-gray-100 rounded-lg flex items-center justify-center">
                <UserIcon className="w-12 h-12 text-gray-400" />
              </div>
            )}
            <div>
              <h1 className="text-2xl font-bold mb-2">{player?.name}</h1>
              <div className="space-y-1 text-gray-600">
                <p>Age: {player?.age}</p>
                <p>Nationality: {player?.nationality}</p>
                <p>Position: {player?.position}</p>
              </div>
            </div>
          </div>

          {/* AI Fact (title removed as requested) */}
          {aiGeneratedFact && (
            <div className="bg-blue-50 rounded-lg p-4 mb-6">
              <p className="italic text-gray-800">{aiGeneratedFact}</p>
              <p className="mt-2 text-xs text-gray-500">
                And now you'll have to google that to see if I made it all up...
              </p>
            </div>
          )}

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <StatCard label="Points Earned" value={stats?.pointsEarned} icon={<Trophy className="h-5 w-5 text-yellow-600" />} />
            <StatCard label="Time Taken" value={`${stats?.timeSec}s`} icon={<Clock className="h-5 w-5 text-blue-600" />} />
            <StatCard label="Guesses Used" value={stats?.guessesUsed} icon={<Target className="h-5 w-5 text-green-600" />} />
            <StatCard label="Hints Used" value={Object.values(stats?.usedHints || {}).filter(Boolean).length} icon={<Target className="h-5 w-5 text-amber-600" />} />
          </div>

          {/* Actions (not included in “Share” HTML) */}
          <div ref={actionsRef} className="flex gap-3">
            {!isDaily && (
              <>
                <button
                  onClick={() => { clearPostGameCache(); navigate('/game'); }}
                  className="flex-none bg-gray-100 hover:bg-gray-200 p-2 rounded-lg"
                  title="Back to Game Setup"
                >
                  <ArrowLeft className="h-5 w-5 text-gray-700" />
                </button>
                <button
                  onClick={onShare}
                  className="flex-none bg-indigo-600 hover:bg-indigo-700 text-white px-3 rounded-lg flex items-center gap-2"
                  title="Copy post-game card"
                >
                  <Share2 className="h-4 w-4" />
                  Share
                </button>
                <button
                  onClick={playAgainWithSameFilters}
                  disabled={loading || gamesLeft <= 0}
                  className={`flex-1 ${gamesLeft <= 0 ? 'bg-gray-300 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700'} text-white py-2 rounded-lg font-medium flex items-center justify-center`}
                >
                  {loading ? 'Loading...' : <>Play Again (Same Filters) <span className="ml-1 text-sm">{gamesLeft !== null ? `(${gamesLeft} left)` : ''}</span></>}
                </button>
              </>
            )}

            {isDaily && (
              <div className="w-full flex flex-col items-center text-center">
                <div className="text-xl font-bold text-yellow-700 mb-2">This was today's Daily Challenge!</div>
                <div className="text-lg text-gray-700">
                  {didWin
                    ? <>Congratulations! You won the daily challenge and earned <span className="font-bold text-green-700">10,000 points</span>!<br /><span className="text-green-700 font-semibold">You also earned an extra game for today!</span></>
                    : 'Better luck next time! Try again tomorrow for another chance at 10,000 points.'}
                </div>
                {/* UTC-based countdown here */}
                <div className="mt-2 text-sm text-gray-500">Next daily challenge in <CountdownToTomorrow /></div>
                <div className="mt-4 flex gap-3">
                  <button
                    onClick={onShare}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-2 rounded-lg flex items-center gap-2"
                    title="Copy post-game card"
                  >
                    <Share2 className="h-4 w-4" />
                    Share
                  </button>
                  <button
                    onClick={() => { clearPostGameCache(); navigate('/game'); }}
                    className="bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded-lg"
                  >
                    Back to Game Setup
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function StatCard({ label, value, icon }) {
  return (
    <div className="border rounded-lg p-3">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <div className="text-sm text-gray-600">{label}</div>
      </div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  );
}

// ---- helpers ----
function getPlayerKey(p) {
  if (!p) return '';
  return String(
    p.id ??
    p.player_id ??
    p.player_league_season_id ??
    p.name ??
    ''
  );
}

/** Replace generic “Player/player” with the user's display name (avoids touching phrases like “the player” when possible) */
function personalizeUserNameInLine(line, displayName) {
  if (!line || !displayName) return line;

  // 1) Replace capitalized 'Player' as a stand-alone word (most LLM outputs use this)
  let out = line.replace(/\bPlayer\b/g, displayName);

  // 2) Also replace stand-alone 'player' (case-insensitive) when not part of "the player"
  //    Modern JS engines support lookbehind; if not, the replace simply won’t happen.
  try {
    out = out.replace(/(?<!\bthe\s)\bplayer\b/gi, displayName);
  } catch {
    // Fallback: best-effort heuristic to catch common salutations like "Hey, player", "Well played, player"
    out = out.replace(/(^|[.,!?\-\s])player\b/gi, (m, p1) => `${p1}${displayName}`);
  }

  return out;
}

/** Local, rich fallback line if LLM endpoint isn’t available */
function localOutroLine({ didWin, stats, player }) {
  const name = player?.name || 'the player';
  const t = Number(stats?.timeSec || 0);
  const g = Number(stats?.guessesUsed || 0);
  const hints = Object.values(stats?.usedHints || {}).filter(Boolean).length;

  if (didWin) {
    if (t <= 30 && g <= 2) return `Lightning! You nailed ${name} in ${t}s with just ${g} guess${g === 1 ? '' : 'es'} ⚡`;
    if (g === 1) return `Perfect memory! ${name} in a single guess — sensational 🎯`;
    if (hints === 0) return `Pure skill! You cracked ${name} with no hints used 👏`;
    return `Well played — ${name} solved in ${g} guess${g === 1 ? '' : 'es'} after ${t}s ✅`;
  } else {
    if (g >= 6) return `Close, but not quite — ${name} slipped away after ${g} guesses 😬`;
    if (hints >= 2) return `Even with hints, ${name} stayed elusive — tough one! 😵`;
    return `So close! ${name} was the answer — tomorrow’s your day 💪`;
  }
}

/** Build a rich HTML snippet for clipboard share (no buttons included) */
function buildShareHTML({ didWin, outroLine, player, stats, aiGeneratedFact }) {
  const color = didWin ? '#166534' : '#991b1b'; // green-700 / red-700
  const badgeBG = didWin ? '#dcfce7' : '#fee2e2'; // green-100 / red-100
  const factHTML = aiGeneratedFact
    ? `<div style="background:#eff6ff;padding:12px;border-radius:10px;margin:16px 0;">
         <div style="font-style:italic;color:#111827;">${escapeHTML(aiGeneratedFact)}</div>
         <div style="margin-top:6px;font-size:11px;color:#6b7280;">And now you'll have to google that to see if I made it all up...</div>
       </div>`
    : '';

  return `
  <div style="max-width:720px;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Helvetica,Arial,sans-serif;line-height:1.5;background:#ffffff;border-radius:12px;padding:16px;border:1px solid #e5e7eb;">
    <div style="text-align:center;background:${badgeBG};border:1px solid #e5e7eb;padding:10px;border-radius:10px;margin-bottom:16px;">
      <div style="font-weight:700;color:${color};font-size:18px;">${escapeHTML(outroLine || (didWin ? 'Great job! You guessed it!' : `Not quite! The player was ${player?.name || ''}`))}</div>
    </div>

    <div style="display:flex;gap:16px;margin-bottom:16px;align-items:center;">
      ${player?.photo || player?.player_photo
        ? `<img src="${player.photo || player.player_photo}" alt="${escapeHTML(player?.name || '')}" style="width:96px;height:96px;border-radius:10px;object-fit:cover;border:1px solid #e5e7eb;" />`
        : `<div style="width:96px;height:96px;border-radius:10px;background:#f3f4f6;display:flex;align-items:center;justify-content:center;color:#9ca3af;">👤</div>`
      }
      <div>
        <div style="font-weight:800;font-size:20px;margin-bottom:6px;">${escapeHTML(player?.name || '')}</div>
        <div style="color:#4b5563;font-size:14px;">Age: ${escapeHTML(String(player?.age ?? '—'))}</div>
        <div style="color:#4b5563;font-size:14px;">Nationality: ${escapeHTML(player?.nationality || '—')}</div>
        <div style="color:#4b5563;font-size:14px;">Position: ${escapeHTML(player?.position || '—')}</div>
      </div>
    </div>

    ${factHTML}

    <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;">
      ${shareStat('Points Earned', String(stats?.pointsEarned ?? '—'))}
      ${shareStat('Time Taken', `${String(stats?.timeSec ?? '—')}s`)}
      ${shareStat('Guesses Used', String(stats?.guessesUsed ?? '—'))}
      ${shareStat('Hints Used', String(Object.values(stats?.usedHints || {}).filter(Boolean).length))}
    </div>
  </div>`;
}

function shareStat(label, value) {
  return `<div style="border:1px solid #e5e7eb;border-radius:10px;padding:10px;">
      <div style="color:#6b7280;font-size:12px;margin-bottom:4px;">${escapeHTML(label)}</div>
      <div style="font-weight:700;font-size:18px;color:#111827;">${escapeHTML(value)}</div>
    </div>`;
}

function buildShareText({ didWin, outroLine, player, stats, aiGeneratedFact }) {
  const lines = [];
  lines.push(outroLine || (didWin ? 'Great job! You guessed it!' : `Not quite! The player was ${player?.name || ''}`));
  lines.push('');
  lines.push(`${player?.name || ''}`);
  lines.push(`Age: ${player?.age ?? '—'}`);
  lines.push(`Nationality: ${player?.nationality || '—'}`);
  lines.push(`Position: ${player?.position || '—'}`);
  if (aiGeneratedFact) {
    lines.push('');
    lines.push(`Fun fact: ${aiGeneratedFact}`);
  }
  lines.push('');
  lines.push(`Points Earned: ${stats?.pointsEarned ?? '—'}`);
  lines.push(`Time Taken: ${stats?.timeSec ?? '—'}s`);
  lines.push(`Guesses Used: ${stats?.guessesUsed ?? '—'}`);
  lines.push(`Hints Used: ${Object.values(stats?.usedHints || {}).filter(Boolean).length}`);
  return lines.join('\n');
}

function escapeHTML(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Full-screen loader with the app logo slowly spinning + bouncing left↔right */
function LoadingBounceLogo() {
  return (
    <div className="fixed inset-0 z-50 bg-gradient-to-b from-green-50 to-transparent">
      {/* The track area */}
      <div className="absolute inset-0">
        {/* Horizontally moving + lightly bouncing Y */}
        <motion.div
          className="absolute left-1/2 -translate-x-1/2"
          style={{ top: '40vh' }}
          animate={{
            x: ['-40vw', '40vw', '-40vw'],
            y: [0, -10, 0, -10, 0], // subtle vertical bounce
          }}
          transition={{
            times: [0, 0.5, 1],
            duration: 6,
            ease: 'easeInOut',
            repeat: Infinity,
          }}
        >
          {/* Spinning logo */}
          <motion.img
            src="/footytrail_logo.png"
            alt="FootyTrail"
            className="w-20 h-20 select-none"
            draggable="false"
            aria-label="Loading"
            role="img"
            animate={{ rotate: 360 }}
            transition={{
              repeat: Infinity,
              duration: 8,
              ease: 'linear',
            }}
          />
        </motion.div>
      </div>
    </div>
  );
}
