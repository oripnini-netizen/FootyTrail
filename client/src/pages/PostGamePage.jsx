// client/src/pages/PostGamePage.jsx
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, useAnimate } from 'framer-motion';
import confetti from 'canvas-confetti';
import { toPng } from 'html-to-image';
import {
  User as UserIcon,
  Trophy,
  Clock,
  Target,
  ArrowLeft,
  Share2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../supabase';
import { getRandomPlayer, API_BASE, getGamePrompt } from '../api';
import {
  loadPostGameCache,
  savePostGameCache,
  clearPostGameCache,
} from '../state/postGameCache';

const REGULAR_START_POINTS = 6000;

/* =========================
   UTC day boundary helpers
   ========================= */
function toUtcMidnight(dateLike) {
  const d =
    typeof dateLike === 'string'
      ? new Date(`${dateLike}T00:00:00.000Z`)
      : new Date(dateLike);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function todayUtcMidnight() {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
}
function dayRangeUtc(dateStr) {
  const start = toUtcMidnight(dateStr);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}
function msUntilNextUtcMidnight() {
  const now = new Date();
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  );
  return next.getTime() - now.getTime();
}
function CountdownToTomorrow() {
  const [timeLeft, setTimeLeft] = useState(format(msUntilNextUtcMidnight()));
  useEffect(() => {
    const id = setInterval(
      () => setTimeLeft(format(msUntilNextUtcMidnight())),
      1000
    );
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
  const { didWin, player, stats, filters, isDaily } = location.state || {};
  const { user } = useAuth();

  const prevPotentialPoints =
    location.state?.potentialPoints ??
    location.state?.prevPotentialPoints ??
    location.state?.potential_points ??
    filters?.potentialPoints ??
    null;

  const [loading, setLoading] = useState(false);
  const [gamesLeft, setGamesLeft] = useState(null);

  const [aiGeneratedFact, setAiGeneratedFact] = useState('');
  const [outroLine, setOutroLine] = useState('');
  const [pageReady, setPageReady] = useState(false);

  const [scope, animate] = useAnimate();

  // For sharing we capture only the card
  const cardRef = useRef(null);
  const actionsRef = useRef(null);
  const shareBusyRef = useRef(false);

  // cache guards
  const hasRestoredRef = useRef(false);
  const restoredFromCacheRef = useRef(false);

  const playerKey = getPlayerKey(player);

  const [displayName, setDisplayName] = useState(null);

  useEffect(() => {
    if (didWin) {
      confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
    }
  }, [didWin]);

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
      } catch {}
    };
    sequence();
  }, [didWin, pageReady, animate]);

  // Restore from cache
  useLayoutEffect(() => {
    if (hasRestoredRef.current) return;

    const cached = loadPostGameCache();
    if (cached && cached.playerKey === playerKey) {
      try {
        if (typeof cached.aiGeneratedFact === 'string')
          setAiGeneratedFact(cached.aiGeneratedFact);
        if (typeof cached.gamesLeft === 'number')
          setGamesLeft(cached.gamesLeft);
        if (typeof cached.outroLine === 'string')
          setOutroLine(cached.outroLine);
        setPageReady(true);
        requestAnimationFrame(() => window.scrollTo(0, cached.scrollY || 0));
        setTimeout(() => window.scrollTo(0, cached.scrollY || 0), 0);
        restoredFromCacheRef.current = true;
      } catch {
        clearPostGameCache();
      }
    }

    hasRestoredRef.current = true;
  }, [playerKey]);

  // Save cache
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
    document.addEventListener('visibilitychange', onVisibility, {
      passive: true,
    });
    window.addEventListener('pagehide', saveNow, { passive: true });

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', saveNow);
      saveNow();
    };
  }, [playerKey, aiGeneratedFact, outroLine, gamesLeft]);

  // Load display name
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
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // Games left (UTC)
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
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // AI content
  useEffect(() => {
    if (!player) {
      navigate('/game', { replace: true });
      return;
    }
    if (restoredFromCacheRef.current && (aiGeneratedFact || outroLine)) {
      setPageReady(true);
      return;
    }

    const fetchAll = async () => {
      let fact = '';
      let outro = '';

      try {
        const transfers = player.transfers || player.transferHistory || [];
        const res = await fetch(`${API_BASE}/ai/generate-player-fact`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            player: {
              name: player.name || player.player_name || 'Unknown Player',
              nationality:
                player.nationality || player.player_nationality || '',
              position: player.position || player.player_position || '',
              age: player.age || player.player_age || '',
            },
            transferHistory: transfers,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          fact =
            data && typeof data.fact === 'string' ? data.fact.trim() : '';
        }
      } catch {}

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
        } catch {}

        if (!line) {
          try {
            const res2 = await fetch(`${API_BASE}/ai/game-outro`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                didWin,
                stats,
                playerName: player?.name,
                isDaily: !!isDaily,
              }),
            });
            if (res2.ok) {
              const data = await res2.json();
              line =
                data && typeof data.line === 'string'
                  ? data.line.trim()
                  : '';
            }
          } catch {}
        }

        if (!line) {
          line = localOutroLine({ didWin: !!didWin, stats, player });
        }

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
      setPageReady(true);

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

  useEffect(() => {
    if (outroLine && displayName) {
      setOutroLine((prev) => personalizeUserNameInLine(prev, displayName));
    }
  }, [displayName]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!player) navigate('/game', { replace: true });
  }, [player, navigate]);

  // ------- Play again with SAME FILTERS -------
  const playAgainWithSameFilters = async () => {
    if (loading || gamesLeft <= 0) return;
    setLoading(true);
    try {
      const competitions =
        filters?.competitions && Array.isArray(filters.competitions)
          ? filters.competitions
          : [];
      const seasons =
        filters?.seasons && Array.isArray(filters.seasons) ? filters.seasons : [];
      const minMarketValue =
        Number(filters?.minMarketValue ?? filters?.min_market_value ?? 0) || 0;

      const prevPot = Number(prevPotentialPoints);
      if (!Number.isFinite(prevPot) || prevPot <= 0) {
        alert(
          'Could not determine the previous round’s pool size. Please start from the Game page.'
        );
        setLoading(false);
        return;
      }
      if (prevPot <= 5) {
        alert(
          'No players left in the pool with those filters. Please adjust your selection.'
        );
        setLoading(false);
        return;
      }

      const nextPotential = prevPot - 5;

      const nextCard = await getRandomPlayer(
        { competitions, seasons, minMarketValue },
        user?.id
      );

      clearPostGameCache();

      navigate('/live', {
        state: {
          ...nextCard,
          isDaily: false,
          filters: { competitions, seasons, minMarketValue },
          potentialPoints: nextPotential,
          fromPostGame: true,
        },
        replace: true,
      });
    } catch (error) {
      console.error('Error starting new game:', error);
      alert('Failed to start a new game. Please try again.');
      setLoading(false);
    }
  };

  // ---- Share: capture card, share/upload, or download fallback ----
  const onShare = async () => {
    if (shareBusyRef.current) return;
    shareBusyRef.current = true;

    try {
      const node = cardRef?.current;
      if (!node) throw new Error('Game card element not found');

      // Hide the actions buttons so they won't appear in the capture
      const actionsEl = actionsRef?.current;
      const prevActionsVisibility = actionsEl ? actionsEl.style.visibility : '';
      if (actionsEl) actionsEl.style.visibility = 'hidden';

      // Filter that EXCLUDES any cross-origin <img> from the render to prevent iOS/Canvas taint
      const filter = (n) => {
        if (!(n instanceof Element)) return true;
        if (n.tagName === 'IMG') {
          const src = n.getAttribute('src') || '';
          try {
            const u = new URL(src, window.location.href);
            if (u.origin !== window.location.origin) return false; // skip
          } catch {
            return false; // bad URL -> skip
          }
        }
        return true;
      };

      const dataUrl = await toPng(node, {
        pixelRatio: 2,
        cacheBust: true,
        backgroundColor: '#ffffff',
        filter,
      });

      if (actionsEl) actionsEl.style.visibility = prevActionsVisibility;

      const file = await dataUrlToFile(dataUrl, `footytrail-${Date.now()}.png`);
      const shareText = buildShareText({ didWin, player });

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ text: shareText, files: [file] });
      } else {
        let publicUrl = '';
        try {
          if (supabase?.storage)
            publicUrl = await uploadToSupabaseImage(file, user?.id);
        } catch (e) {
          console.warn('Supabase upload failed, falling back to download.', e);
        }

        const text = `${shareText}${publicUrl ? `\n${publicUrl}` : ''}`.trim();
        const waUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
        window.open(waUrl, '_blank', 'noopener,noreferrer');

        if (!publicUrl && document.hasFocus()) {
          const a = document.createElement('a');
          a.href = dataUrl;
          a.download = `footytrail-${Date.now()}.png`;
          a.click();
          alert(
            'Could not share directly. Image downloaded—send it via WhatsApp manually.'
          );
        }
      }
    } catch (e) {
      console.error('Share failed:', e);
      alert(
        `Sorry—something went wrong preparing the share image.${
          e?.message ? `\n\nDetails: ${e.message}` : ''
        }`
      );
    } finally {
      shareBusyRef.current = false;
    }
  };

  // ----- Loading screen -----
  if (!pageReady) return <LoadingBounceLogo />;
  if (!player) return null;

  const pdata = player || {};
  const photo = pdata.player_photo || pdata.photo || null;

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-green-50 to-transparent">
      <div className="fixed inset-0 -z-10 bg-gradient-to-b from-green-50 to-transparent" />
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="max-w-4xl mx-auto px-4 py-8"
      >
        <div ref={cardRef} className="bg-white rounded-xl shadow-sm p-6">
          {/* Dynamic top banner */}
          <div
            ref={scope}
            className={`${
              didWin
                ? 'bg-green-50 border border-green-200'
                : 'bg-red-50 border border-red-200'
            } rounded-lg p-3 mb-6 text-center`}
          >
            <h2
              className={`text-xl font-bold ${
                didWin ? 'text-green-700' : 'text-red-700'
              }`}
            >
              {outroLine ||
                (didWin
                  ? 'Great job! You guessed it!'
                  : `Not quite! The player was ${player?.name}`)}
            </h2>
          </div>

          {/* Player Info */}
          <div className="flex gap-6 mb-6">
            {photo ? (
              <img
                src={photo}
                alt={player.name}
                className="w-32 h-32 object-cover rounded-lg"
              />
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

          {/* AI Fact */}
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
            <StatCard
              label="Points Earned"
              value={stats?.pointsEarned}
              icon={<Trophy className="h-5 w-5 text-yellow-600" />}
            />
            <StatCard
              label="Time Taken"
              value={`${stats?.timeSec}s`}
              icon={<Clock className="h-5 w-5 text-blue-600" />}
            />
            <StatCard
              label="Guesses Used"
              value={stats?.guessesUsed}
              icon={<Target className="h-5 w-5 text-green-600" />}
            />
            <StatCard
              label="Hints Used"
              value={
                Object.values(stats?.usedHints || {}).filter(Boolean).length
              }
              icon={<Target className="h-5 w-5 text-amber-600" />}
            />
          </div>

          {/* Actions (hidden during image capture) */}
          <div ref={actionsRef} className="flex gap-3">
            {!isDaily && (
              <>
                <button
                  onClick={() => {
                    clearPostGameCache();
                    navigate('/game');
                  }}
                  className="flex-none bg-gray-100 hover:bg-gray-200 p-2 rounded-lg"
                  title="Back to Game Setup"
                >
                  <ArrowLeft className="h-5 w-5 text-gray-700" />
                </button>
                <button
                  onClick={onShare}
                  className="flex-none bg-indigo-600 hover:bg-indigo-700 text-white px-3 rounded-lg flex items-center gap-2"
                  title="Share to WhatsApp"
                >
                  <Share2 className="h-4 w-4" />
                  Share
                </button>
                <button
                  onClick={playAgainWithSameFilters}
                  disabled={loading || gamesLeft <= 0}
                  className={`flex-1 ${
                    gamesLeft <= 0
                      ? 'bg-gray-300 cursor-not-allowed'
                      : 'bg-green-600 hover:bg-green-700'
                  } text-white py-2 rounded-lg font-medium flex items-center justify-center`}
                >
                  {loading ? (
                    'Loading...'
                  ) : (
                    <>
                      Play Again (Same Filters){' '}
                      <span className="ml-1 text-sm">
                        {gamesLeft !== null ? `(${gamesLeft} left)` : ''}
                      </span>
                    </>
                  )}
                </button>
              </>
            )}

            {isDaily && (
              <div className="w-full flex flex-col items-center text-center">
                <div className="text-xl font-bold text-yellow-700 mb-2">
                  This was today's Daily Challenge!
                </div>
                <div className="text-lg text-gray-700">
                  {didWin ? (
                    <>
                      Congratulations! You won the daily challenge and earned{' '}
                      <span className="font-bold text-green-700">
                        10,000 points
                      </span>
                      !
                      <br />
                      <span className="text-green-700 font-semibold">
                        You also earned an extra game for today!
                      </span>
                    </>
                  ) : (
                    'Better luck next time! Try again tomorrow for another chance at 10,000 points.'
                  )}
                </div>
                <div className="mt-2 text-sm text-gray-500">
                  Next daily challenge in <CountdownToTomorrow />
                </div>
                <div className="mt-4 flex gap-3">
                  <button
                    onClick={onShare}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-2 rounded-lg flex items-center gap-2"
                    title="Share to WhatsApp"
                  >
                    <Share2 className="h-4 w-4" />
                    Share
                  </button>
                  <button
                    onClick={() => {
                      clearPostGameCache();
                      navigate('/game');
                    }}
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
  return String(p.id ?? p.player_id ?? p.player_league_season_id ?? p.name ?? '');
}

function personalizeUserNameInLine(line, displayName) {
  if (!line || !displayName) return line;
  let out = line.replace(/\bPlayer\b/g, displayName);
  try {
    out = out.replace(/(?<!\bthe\s)\bplayer\b/gi, displayName);
  } catch {
    out = out.replace(/(^|[.,!?\-\s])player\b/gi, (m, p1) => `${p1}${displayName}`);
  }
  return out;
}

function localOutroLine({ didWin, stats, player }) {
  const name = player?.name || 'the player';
  const t = Number(stats?.timeSec || 0);
  const g = Number(stats?.guessesUsed || 0);
  const hints = Object.values(stats?.usedHints || {}).filter(Boolean).length;

  if (didWin) {
    if (t <= 30 && g <= 2)
      return `Lightning! You nailed ${name} in ${t}s with just ${g} guess${
        g === 1 ? '' : 'es'
      } ⚡`;
    if (g === 1) return `Perfect memory! ${name} in a single guess — sensational 🎯`;
    if (hints === 0) return `Pure skill! You cracked ${name} with no hints used 👏`;
    return `Well played — ${name} solved in ${g} guess${
      g === 1 ? '' : 'es'
    } after ${t}s ✅`;
  } else {
    if (g >= 6) return `Close, but not quite — ${name} slipped away after ${g} guesses 😬`;
    if (hints >= 2) return `Even with hints, ${name} stayed elusive — tough one! 😵`;
    return `So close! ${name} was the answer — tomorrow’s your day 💪`;
  }
}

function buildShareHTML({ didWin, outroLine, player, stats, aiGeneratedFact }) {
  const color = didWin ? '#166534' : '#991b1b';
  const badgeBG = didWin ? '#dcfce7' : '#fee2e2';
  const factHTML = aiGeneratedFact
    ? `<div style="background:#eff6ff;padding:12px;border-radius:10px;margin:16px 0;">
         <div style="font-style:italic;color:#111827;">${escapeHTML(aiGeneratedFact)}</div>
         <div style="margin-top:6px;font-size:11px;color:#6b7280;">And now you'll have to google that to see if I made it all up...</div>
       </div>`
    : '';

  return `
  <div style="max-width:720px;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Helvetica,Arial,sans-serif;line-height:1.5;background:#ffffff;border-radius:12px;padding:16px;border:1px solid #e5e7eb;">
    <div style="text-align:center;background:${badgeBG};border:1px solid #e5e7eb;padding:10px;border-radius:10px;margin-bottom:16px;">
      <div style="font-weight:700;color:${color};font-size:18px;">${escapeHTML(
        outroLine ||
          (didWin
            ? 'Great job! You guessed it!'
            : `Not quite! The player was ${player?.name || ''}`)
      )}</div>
    </div>

    <div style="display:flex;gap:16px;margin-bottom:16px;align-items:center;">
      ${player?.photo || player?.player_photo
        ? `<img src="${player.photo || player.player_photo}" alt="${escapeHTML(
            player?.name || ''
          )}" style="width:96px;height:96px;border-radius:10px;object-fit:cover;border:1px solid #e5e7eb;" />`
        : `<div style="width:96px;height:96px;border-radius:10px;background:#f3f4f6;display:flex;align-items:center;justify-content:center;color:#9ca3af;">👤</div>`
      }
      <div>
        <div style="font-weight:800;font-size:20px;margin-bottom:6px;">${escapeHTML(
          player?.name || ''
        )}</div>
        <div style="color:#4b5563;font-size:14px;">Age: ${escapeHTML(
          String(player?.age ?? '—')
        )}</div>
        <div style="color:#4b5563;font-size:14px;">Nationality: ${escapeHTML(
          player?.nationality || '—'
        )}</div>
        <div style="color:#4b5563;font-size:14px;">Position: ${escapeHTML(
          player?.position || '—'
        )}</div>
      </div>
    </div>

    ${factHTML}

    <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;">
      ${shareStat('Points Earned', String(stats?.pointsEarned ?? '—'))}
      ${shareStat('Time Taken', `${String(stats?.timeSec ?? '—')}s`)}
      ${shareStat('Guesses Used', String(stats?.guessesUsed ?? '—'))}
      ${shareStat(
        'Hints Used',
        String(Object.values(stats?.usedHints || {}).filter(Boolean).length)
      )}
    </div>
  </div>`;
}

function shareStat(label, value) {
  return `<div style="border:1px solid #e5e7eb;border-radius:10px;padding:10px;">
      <div style="color:#6b7280;font-size:12px;margin-bottom:4px;">${escapeHTML(
        label
      )}</div>
      <div style="font-weight:700;font-size:18px;color:#111827;">${escapeHTML(
        value
      )}</div>
    </div>`;
}

/** NEW: Short, engaging WhatsApp text instead of repeating the card details */
function buildShareText({ didWin, player }) {
  const outcome = didWin ? 'succeeded phenomenally' : 'failed miserably';
  const name = player?.name ? ` — ${player.name}` : '';
  return `Look at the player I just ${outcome} to identify on FootyTrail${name}!\nCome join the fun at https://footy-trail.vercel.app`;
}

function escapeHTML(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Convert a data URL to a File object */
async function dataUrlToFile(dataUrl, filename) {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return new File([blob], filename, { type: 'image/png' });
}

/** Upload an image File to Supabase Storage (bucket: "shares") and return its public URL */
async function uploadToSupabaseImage(file, userId) {
  const uid = userId || 'anon';
  const path = `whatsapp/${uid}/${Date.now()}.png`;

  const { error: uploadError } = await supabase.storage
    .from('shares')
    .upload(path, file, { contentType: 'image/png', upsert: true });
  if (uploadError) throw uploadError;

  const { data: pub } = supabase.storage.from('shares').getPublicUrl(path);
  return pub?.publicUrl;
}

/** Full-screen loader */
function LoadingBounceLogo() {
  return (
    <div className="fixed inset-0 z-50 bg-gradient-to-b from-green-50 to-transparent">
      <div className="absolute inset-0">
        <motion.div
          className="absolute left-1/2 -translate-x-1/2"
          style={{ top: '40vh' }}
          animate={{ x: ['-40vw', '40vw', '-40vw'], y: [0, -10, 0, -10, 0] }}
          transition={{
            times: [0, 0.5, 1],
            duration: 6,
            ease: 'easeInOut',
            repeat: Infinity,
          }}
        >
          <motion.img
            src="/footytrail_logo.png"
            alt="FootyTrail"
            className="w-20 h-20 select-none"
            draggable="false"
            aria-label="Loading"
            role="img"
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 8, ease: 'linear' }}
          />
        </motion.div>
      </div>
    </div>
  );
}
