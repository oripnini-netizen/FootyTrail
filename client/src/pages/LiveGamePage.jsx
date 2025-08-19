// src/pages/LiveGamePage.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Clock,
  AlarmClock,
  Lightbulb,
  Trophy,
  CalendarDays,
  ArrowRight,
  BadgeEuro,
  AlertTriangle,
  CheckCircle2,
  XCircle
} from 'lucide-react';

import { useAuth } from '../context/AuthContext';
import {
  suggestNames,
  saveGameCompleted,
  fetchTransfers,
  API_BASE
} from '../api';
import GuessInput from '../components/GuessInput';

// -------------------------------------------------------
// Utilities
// -------------------------------------------------------
const TWO_MINUTES = 120;

function cx(...s) {
  return s.filter(Boolean).join(' ');
}
function normalize(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}
function tokenize(str) {
  return normalize(str)
    .replace(/[^a-z\s'-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}
function multiTokenStartsWithMatch(queryText, candidateName) {
  const qTokens = tokenize(queryText);
  const cTokens = tokenize(candidateName);
  if (!qTokens.length || !cTokens.length) return false;
  return qTokens.every(qt => cTokens.some(ct => ct.startsWith(qt)));
}
function longestToken(str) {
  const t = tokenize(str).sort((a, b) => b.length - a.length);
  return t[0] || '';
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function euroLabel(raw, feeEur) {
  if (raw && typeof raw === 'string') {
    // normalize accidental $ to €
    return raw.replace(/^\$/, '€');
  }
  if (Number.isFinite(feeEur)) {
    return `€${new Intl.NumberFormat('en-US').format(Math.round(feeEur))}`;
  }
  return '—';
}

// -------------------------------------------------------

export default function LiveGamePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // URL params allow deep link: ?daily=1&pid=<playerId>
  const params = new URLSearchParams(location.search);
  const urlIsDaily = params.get('daily') === '1';
  const urlPid = params.get('pid');

  // Bootstraped game data (from GamePage or fetched for daily)
  const [gameData, setGameData] = useState(null); // { player_id/id, name, photo, nationality, position, age, potentialPoints, isDaily }
  const [isDaily, setIsDaily] = useState(!!location.state?.isDaily || urlIsDaily);
  const [bootError, setBootError] = useState(null);

  // Round state
  const [timeSec, setTimeSec] = useState(TWO_MINUTES);
  const [guessesLeft, setGuessesLeft] = useState(3);
  const [guess, setGuess] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [isWrongGuess, setIsWrongGuess] = useState(false);

  // Hints state
  const [usedHints, setUsedHints] = useState({
    age: false,
    nationality: false,
    position: false,
    partialImage: false,
    firstLetter: false,
  });

  // Points potential declines with time & wrong guesses; hints apply multipliers
  const hintMultipliers = {
    age: 0.95,
    nationality: 0.90,
    position: 0.80,
    partialImage: 0.50,
    firstLetter: 0.25,
  };

  const endedRef = useRef(false);
  const timerRef = useRef(null);

  // Transfers
  const [transferHistory, setTransferHistory] = useState([]);
  const [loadingTransfers, setLoadingTransfers] = useState(false);

  // Filters/potentialPoints passed from GamePage for normal rounds
  const passedFilters = location.state?.filters || {};
  const passedPotential = Number(location.state?.potentialPoints || 0);

  // -------------------------------------------------------
  // Bootstrap logic (keeps all your features, adds robust daily flow)
  // Priority:
  // 1) navigation.state from GamePage
  // 2) ?daily=1&pid=<id>
  // 3) ?daily=1 -> fetch /api/daily-challenge -> then /api/player/:id
  // else -> back to /game
  // -------------------------------------------------------
  useEffect(() => {
    let mounted = true;

    async function boot() {
      try {
        // 1) Navigation state from GamePage (preferred for both normal and daily)
        if (location.state && (location.state.id || location.state.player_id) && location.state.name) {
          if (!mounted) return;
          setIsDaily(Boolean(location.state.isDaily) || urlIsDaily);
          setGameData({
            ...location.state,
            player_id: location.state.player_id || location.state.id,
            potentialPoints:
              Number(location.state.potentialPoints || passedPotential || 10000),
          });
          return;
        }

        // 2) Query params (?daily=1&pid=XYZ)
        if (urlPid) {
          const res = await fetch(`${API_BASE}/player/${encodeURIComponent(urlPid)}`);
          if (!res.ok) throw new Error('Failed to fetch daily player');
          const card = await res.json();
          if (!mounted) return;
          setIsDaily(true);
          setGameData({
            ...card,
            player_id: card.id || card.player_id || urlPid,
            potentialPoints: 10000,
            isDaily: true,
          });
          return;
        }

        // 3) If URL indicates daily but no pid; fetch today’s daily from backend (Supabase daily_challenges)
        if (urlIsDaily) {
          const dcRes = await fetch(`${API_BASE}/daily-challenge`);
          if (!dcRes.ok) throw new Error('Failed to load today’s daily challenge');
          const today = await dcRes.json(); // { challenge_date, player_id, ... }
          if (!today?.player_id) throw new Error('Daily challenge not configured for today');

          const pRes = await fetch(`${API_BASE}/player/${encodeURIComponent(today.player_id)}`);
          if (!pRes.ok) throw new Error('Failed to fetch daily player card');
          const card = await pRes.json();

          if (!mounted) return;
          setIsDaily(true);
          setGameData({
            ...card,
            player_id: card.id || card.player_id || today.player_id,
            potentialPoints: 10000,
            isDaily: true,
          });
          return;
        }

        // 4) Nothing to start a game — return to lobby
        throw new Error('No game payload found.');
      } catch (err) {
        console.error('Failed to start game', err);
        if (!mounted) return;
        setBootError(err.message || 'Failed to start game. Please try again.');
        // after a short pause, go back to /game
        setTimeout(() => navigate('/game', { replace: true }), 1200);
      }
    }

    boot();
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  // -------------------------------------------------------
  // Load transfer history for the player
  // -------------------------------------------------------
  useEffect(() => {
    let cancel = false;
    async function loadTransfers() {
      const pid = parseInt(gameData?.player_id || gameData?.id || 0, 10);
      if (!pid) return;
      try {
        setLoadingTransfers(true);
        const rows = await fetchTransfers(pid);
        if (!cancel) setTransferHistory(Array.isArray(rows) ? rows : []);
      } catch (e) {
        console.error('Error fetching transfers:', e);
        if (!cancel) setTransferHistory([]);
      } finally {
        if (!cancel) setLoadingTransfers(false);
      }
    }
    loadTransfers();
    return () => { cancel = true; };
  }, [gameData?.player_id, gameData?.id]);

  // -------------------------------------------------------
  // Timer (2 minutes). Time color changes at 60s and 30s.
  // -------------------------------------------------------
  const timeColorClass =
    timeSec <= 30 ? 'text-red-600' : timeSec <= 60 ? 'text-yellow-600' : 'text-gray-900';

  useEffect(() => {
    if (!gameData) return;
    const onTimeUp = async () => {
      if (endedRef.current) return;
      endedRef.current = true;
      clearInterval(timerRef.current);
      await saveRecord(false);
      navigate('/postgame', {
        state: {
          didWin: false,
          player: gameData,
          stats: {
            pointsEarned: 0,
            timeSec: TWO_MINUTES,
            guessesUsed: 3,
            usedHints
          },
          filters: location.state?.filters || {},
          isDaily
        },
        replace: true
      });
    };
    const iv = setInterval(() => {
      setTimeSec(prev => {
        if (prev <= 1) {
          clearInterval(iv);
          onTimeUp();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    timerRef.current = iv;
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameData?.player_id, gameData?.id]);

  // -------------------------------------------------------
  // Leaving the tab/page ends the round as loss (anti-cheat)
  // -------------------------------------------------------
  useEffect(() => {
    if (!gameData) return;
    const forfeit = async () => {
      if (endedRef.current) return;
      endedRef.current = true;
      try {
        clearInterval(timerRef.current);
        await saveRecord(false);
      } finally {
        navigate('/game', { replace: true, state: { forfeited: true } });
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') forfeit();
    };
    const onPageHide = () => forfeit();

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [gameData, navigate]);

  // -------------------------------------------------------
  // Calculate points: base -> hints -> time decay -> wrong guess halving
  // -------------------------------------------------------
  const points = useMemo(() => {
    const base =
      Number(gameData?.potentialPoints) ||
      Number(passedPotential) ||
      10000;

    let p = base;

    // hint multipliers
    Object.keys(usedHints).forEach((k) => {
      if (usedHints[k]) p = Math.floor(p * hintMultipliers[k]);
    });

    // time decay (gentle)
    const elapsed = TWO_MINUTES - timeSec;
    p = Math.floor(p * Math.pow(0.99, elapsed));

    // wrong-guess halving
    const wrongAttempts = Math.max(0, 3 - guessesLeft);
    p = Math.floor(p * Math.pow(0.5, wrongAttempts));

    return Math.max(0, p);
  }, [gameData?.potentialPoints, passedPotential, usedHints, timeSec, guessesLeft]);

  // -------------------------------------------------------
  // Suggestions
  // -------------------------------------------------------
  useEffect(() => {
    let active = true;
    const id = setTimeout(async () => {
      const raw = (guess || '').trim();
      if (!raw) {
        if (active) setSuggestions([]);
        return;
      }
      const token = longestToken(raw);
      if (token.length < 2) {
        if (active) setSuggestions([]);
        return;
      }
      try {
        const serverList = await suggestNames(token);
        const filtered = (Array.isArray(serverList) ? serverList : []).filter((row) =>
          multiTokenStartsWithMatch(raw, row.name || row.displayName || '')
        );
        if (active) setSuggestions(filtered.slice(0, 20));
      } catch {
        if (active) setSuggestions([]);
      }
    }, 160); // debounce
    return () => {
      active = false;
      clearTimeout(id);
    };
  }, [guess]);

  // -------------------------------------------------------
  // Actions
  // -------------------------------------------------------
  const submitGuess = async (value) => {
    const val = (value || guess || '').trim();
    if (!val || endedRef.current) return;

    const correct =
      val.toLowerCase() === (gameData?.name || '').trim().toLowerCase();

    if (correct) {
      endedRef.current = true;
      clearInterval(timerRef.current);
      await saveRecord(true);
      navigate('/postgame', {
        state: {
          didWin: true,
          player: {
            name: gameData.name,
            photo: gameData.photo,
            age: gameData.age,
            nationality: gameData.nationality,
            position: gameData.position,
          },
          stats: {
            pointsEarned: points,
            timeSec: TWO_MINUTES - timeSec,
            guessesUsed: 3 - guessesLeft + 1,
            usedHints
          },
          filters: location.state?.filters || {},
          isDaily
        },
        replace: true
      });
      return;
    }

    // wrong guess animation + reduce guesses
    setIsWrongGuess(true);
    setTimeout(() => setIsWrongGuess(false), 350);

    if (guessesLeft - 1 <= 0) {
      // out of guesses
      endedRef.current = true;
      clearInterval(timerRef.current);
      await saveRecord(false);
      navigate('/postgame', {
        state: {
          didWin: false,
          player: gameData,
          stats: {
            pointsEarned: 0,
            timeSec: TWO_MINUTES - timeSec,
            guessesUsed: 3,
            usedHints
          },
          filters: location.state?.filters || {},
          isDaily
        },
        replace: true
      });
    } else {
      setGuessesLeft((prev) => prev - 1);
    }
    setGuess('');
  };

  const giveUp = async () => {
    if (endedRef.current) return;
    endedRef.current = true;
    clearInterval(timerRef.current);
    await saveRecord(false);
    navigate('/postgame', {
      state: {
        didWin: false,
        player: gameData,
        stats: {
          pointsEarned: 0,
          timeSec: TWO_MINUTES - timeSec,
          guessesUsed: 3,
          usedHints
        },
        filters: location.state?.filters || {},
        isDaily
      },
      replace: true
    });
  };

  const saveRecord = async (won) => {
    if (!user?.id || !gameData) return null;
    try {
      const payload = {
        userId: user.id,
        playerData: {
          id: parseInt(gameData.player_id || gameData.id || 0, 10) || 0,
          name: gameData.name || gameData.player_name,
          data: {
            nationality: gameData.nationality,
            position: gameData.position,
            age: gameData.age,
            photo: gameData.photo
          }
        },
        gameStats: {
          won,
          points: won ? points : 0,
          potentialPoints:
            Number(gameData.potentialPoints || passedPotential || 10000),
          timeTaken: TWO_MINUTES - timeSec,
          guessesAttempted: 3 - guessesLeft + (won ? 1 : 0),
          hintsUsed: Object.values(usedHints).filter(Boolean).length,
          isDaily: !!isDaily
        },
        filters: location.state?.filters || {}
      };
      return await saveGameCompleted(payload);
    } catch (err) {
      console.error('Error saving game record:', err);
      return null;
    }
  };

  const reveal = (key) => setUsedHints((u) => ({ ...u, [key]: true }));

  // -------------------------------------------------------
  // Render
  // -------------------------------------------------------
  if (bootError) {
    return (
      <div className="relative min-h-screen bg-gradient-to-b from-green-50 to-transparent">
        <div className="fixed inset-0 -z-10 bg-gradient-to-b from-green-50 to-transparent" />
        <div className="container mx-auto px-4 py-16">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-red-600 mb-2">Failed to start game</h1>
            <p className="text-gray-700">{bootError}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!gameData) {
    return (
      <div className="relative min-h-screen bg-gradient-to-b from-green-50 to-transparent">
        <div className="fixed inset-0 -z-10 bg-gradient-to-b from-green-50 to-transparent" />
        <div className="container mx-auto px-4 py-20">
          <div className="text-center text-gray-600">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600 mx-auto mb-3"></div>
            Preparing round…
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-green-50 to-transparent">
      <div className="fixed inset-0 -z-10 bg-gradient-to-b from-green-50 to-transparent" />

      {/* Anti-cheat banner */}
      <div className="max-w-6xl mx-auto px-4 pt-6">
        <div className="rounded-lg bg-red-50 border border-red-200 text-red-800 font-bold px-4 py-2 text-center flex items-center justify-center gap-2">
          <AlertTriangle className="h-5 w-5" />
          Don’t leave this page while the round is active — leaving will immediately count as a loss.
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Stats row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div className="rounded border bg-white p-4 flex items-center gap-3">
            <Clock className="h-5 w-5 text-gray-700" />
            <div>
              <div className="text-xs text-gray-500">Time Remaining</div>
              <div className={cx('text-lg font-semibold', timeColorClass)}>{formatTime(timeSec)}</div>
            </div>
          </div>
          <div className="rounded border bg-white p-4 flex items-center gap-3">
            <AlarmClock className="h-5 w-5 text-gray-700" />
            <div>
              <div className="text-xs text-gray-500">Guesses Left</div>
              <div className="text-lg font-semibold">{guessesLeft}</div>
            </div>
          </div>
          <div className="rounded border bg-white p-4 flex items-center gap-3">
            <Trophy className="h-5 w-5 text-yellow-600" />
            <div>
              <div className="text-xs text-gray-500">Points</div>
              <div className="text-lg font-semibold text-yellow-700">{points}</div>
            </div>
          </div>
        </div>

        {/* Game & Transfers */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          {/* Input & Hints */}
          <motion.div
            className="rounded-xl border bg-white shadow-sm p-5 lg:col-span-1"
            animate={isWrongGuess ? { x: [-10, 10, -10, 10, 0], transition: { duration: 0.35 } } : {}}
          >
            <h3 className="text-lg font-semibold mb-3">Who are ya?!</h3>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitGuess(guess);
              }}
              className="space-y-4"
            >
              <GuessInput
                value={guess}
                onChange={(v) => setGuess(v)}
                onGuess={submitGuess}
                disabled={endedRef.current}
                placeholder="Type a player's name"
                autoFocus
              />

              {suggestions?.length ? (
                <ul className="border rounded divide-y max-h-56 overflow-auto">
                  {suggestions.map((sug) => (
                    <li
                      key={sug.id ?? sug.name}
                      className="px-3 py-2 hover:bg-gray-50 cursor-pointer text-sm"
                      onClick={() => submitGuess(sug.name)}
                    >
                      {sug.name}
                    </li>
                  ))}
                </ul>
              ) : null}

              <div className="flex gap-3">
                <button
                  type="submit"
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white py-2 px-4 rounded font-medium"
                >
                  Submit Guess
                </button>
                <button
                  type="button"
                  onClick={giveUp}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white py-2 px-4 rounded font-medium"
                >
                  Give Up
                </button>
              </div>
            </form>

            {/* Hints */}
            <div className="mt-6 pt-5 border-t">
              <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <Lightbulb className="h-5 w-5 text-amber-500" />
                Hints (reduce points)
              </h3>
              <div className="grid grid-cols-1 gap-3">
                <HintButton
                  label="Player's Age"
                  multiplier="×0.95"
                  disabled={usedHints.age || !gameData?.age}
                  onClick={() => reveal('age')}
                  valueShown={usedHints.age ? String(gameData?.age) : null}
                />
                <HintButton
                  label="Player's Nationality"
                  multiplier="×0.90"
                  disabled={usedHints.nationality || !gameData?.nationality}
                  onClick={() => reveal('nationality')}
                  valueShown={usedHints.nationality ? String(gameData?.nationality) : null}
                />
                <HintButton
                  label="Player's Position"
                  multiplier="×0.80"
                  disabled={usedHints.position || !gameData?.position}
                  onClick={() => reveal('position')}
                  valueShown={usedHints.position ? String(gameData?.position) : null}
                />
                <HintButton
                  label="Player's Image"
                  multiplier="×0.50"
                  disabled={usedHints.partialImage || !gameData?.photo}
                  onClick={() => reveal('partialImage')}
                  valueShown={
                    usedHints.partialImage ? (
                      <img
                        src={gameData?.photo}
                        alt="Player Hint"
                        className="w-20 h-20 object-cover object-top"
                        style={{ clipPath: 'inset(0 0 50% 0)' }}
                      />
                    ) : null
                  }
                />
                <HintButton
                  label="Player's First Letter"
                  multiplier="×0.25"
                  disabled={usedHints.firstLetter || !gameData?.name}
                  onClick={() => reveal('firstLetter')}
                  valueShown={usedHints.firstLetter ? gameData?.name?.charAt(0) : null}
                />
              </div>
            </div>
          </motion.div>

          {/* Transfers (wide) */}
          <div className="rounded-xl border bg-white shadow-sm p-5 lg:col-span-2">
            <h3 className="text-lg font-semibold mb-4 text-center">Transfer History</h3>
            {loadingTransfers ? (
              <div className="text-center text-gray-500">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
                Loading transfers...
              </div>
            ) : (
              <TransfersList transfers={transferHistory} />
            )}
          </div>
        </div>

        {/* Win/Lose banner (optional) */}
        {endedRef.current && (
          <div className="mt-6">
            {/* Kept intentionally minimal; your PostGamePage handles the summary */}
          </div>
        )}
      </div>
    </div>
  );
}

// -------------------------------------------------------
// Small UI components
// -------------------------------------------------------
function HintButton({ label, multiplier, disabled, onClick, valueShown }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'w-full text-left border rounded p-3 hover:bg-gray-50',
        disabled ? 'opacity-60 cursor-not-allowed' : ''
      )}
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium">{label}</div>
          <div className="text-xs text-gray-500">Using this hint reduces points {multiplier}</div>
        </div>
        {valueShown ? (
          <div className="text-sm px-2 py-1 rounded bg-green-50 border text-green-800">{valueShown}</div>
        ) : null}
      </div>
    </button>
  );
}

function Chip({ children, tone = 'slate' }) {
  const tones = {
    slate: 'bg-slate-50 text-slate-700 border-slate-200',
    green: 'bg-green-50 text-green-700 border-green-200',
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    violet: 'bg-violet-50 text-violet-700 border-violet-200',
  };
  return (
    <span className={cx('inline-flex items-center gap-1 text-xs px-2 py-1 rounded border', tones[tone])}>
      {children}
    </span>
  );
}

function ClubPill({ logo, name, flag, align = 'left' }) {
  return (
    <div className={cx('flex items-center gap-2 min-w-0', align === 'right' ? 'justify-end' : '')}>
      {align === 'left' && (
        <div className="flex flex-col items-center justify-center gap-1 shrink-0">
          {logo ? <img src={logo} alt="" className="h-7 w-7 rounded-md object-contain" /> : null}
          {flag ? <img src={flag} alt="" className="h-3.5 w-5 rounded-sm object-cover" /> : null}
        </div>
      )}
      <span className="text-sm font-medium whitespace-nowrap truncate max-w-[220px] md:max-w-[280px]">
        {name || 'Unknown'}
      </span>
      {align === 'right' && (
        <div className="flex flex-col items-center justify-center gap-1 shrink-0">
          {logo ? <img src={logo} alt="" className="h-7 w-7 rounded-md object-contain" /> : null}
          {flag ? <img src={flag} alt="" className="h-3.5 w-5 rounded-sm object-cover" /> : null}
        </div>
      )}
    </div>
  );
}

function TransfersList({ transfers }) {
  if (!transfers?.length) {
    return <div className="text-sm text-gray-500 text-center">No transfers found.</div>;
  }
  return (
    <ul className="space-y-3">
      {transfers.map((t, idx) => {
        const season = t.season || '—';
        const dateStr = t.transfer_date || t.date || '—';
        const feeText = euroLabel(t.transfer_value || t.valueRaw, t.fee_eur);
        const typeText = t.transfer_type || t.type;

        return (
          <li
            key={`${t.date || t.transfer_date || t.season || 'row'}-${idx}`}
            className="grid grid-cols-12 gap-3 items-center border rounded-lg p-3"
          >
            {/* Season + Date center-aligned */}
            <div className="col-span-12 md:col-span-3 flex flex-col items-center text-center gap-1">
              <Chip tone="violet">
                <CalendarDays className="h-3.5 w-3.5" />
                <span className="font-semibold">{season}</span>
              </Chip>
              <div className="text-xs text-gray-500">{dateStr}</div>
            </div>

            {/* From -> To with logos over flags */}
            <div className="col-span-12 md:col-span-6 flex items-center justify-center gap-3 flex-wrap md:flex-nowrap min-w-0">
              <ClubPill logo={t.team_from_logo || t.out?.logo}
                        name={t.team_from || t.out?.name}
                        flag={t.team_from_flag || t.out?.flag}
                        align="left" />
              <ArrowRight className="h-4 w-4 text-gray-400 shrink-0" />
              <ClubPill logo={t.team_to_logo || t.in?.logo}
                        name={t.team_to || t.in?.name}
                        flag={t.team_to_flag || t.in?.flag}
                        align="right" />
            </div>

            {/* Fee + Type stacked, centered */}
            <div className="col-span-12 md:col-span-3 flex flex-col items-center justify-center gap-1">
              <Chip tone="green">
                <BadgeEuro className="h-3.5 w-3.5" />
                <span>{feeText}</span>
              </Chip>
              {typeText ? <Chip tone="amber">{typeText}</Chip> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
