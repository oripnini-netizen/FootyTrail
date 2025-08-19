// src/pages/LiveGamePage.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { suggestNames, saveGameCompleted, fetchTransfers, API_BASE } from '../api';
import {
  Clock,
  AlarmClock,
  Lightbulb,
  Trophy,
  CalendarDays,
  ArrowRight,
  BadgeEuro,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useAuth } from '../context/AuthContext';

// ----------------------------------
// small helpers
// ----------------------------------
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

// ----------------------------------

export default function LiveGamePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();

  // URL params for daily link support
  const params = new URLSearchParams(location.search);
  const urlIsDaily = params.get('daily') === '1';
  const fixedPid = params.get('pid');

  // Game bootstrap state (can arrive via navigation.state or be fetched)
  const [gameData, setGameData] = useState(null);
  const [bootError, setBootError] = useState(null);
  const [isDaily, setIsDaily] = useState(!!location.state?.isDaily || urlIsDaily);

  // Filters/potentialPoints passed from GamePage (for normal rounds)
  const filters = location.state?.filters || { potentialPoints: 0 };

  // round controls
  const INITIAL_TIME = 120; // 2 minutes
  const [timeSec, setTimeSec] = useState(INITIAL_TIME);
  const [guessesLeft, setGuessesLeft] = useState(3);
  const [guess, setGuess] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [isWrongGuess, setIsWrongGuess] = useState(false);
  const [usedHints, setUsedHints] = useState({
    age: false,
    nationality: false,
    position: false,
    partialImage: false,
    firstLetter: false,
  });

  const endedRef = useRef(false);
  const timerRef = useRef(null);

  // transfers
  const [transferHistory, setTransferHistory] = useState([]);
  const [loadingTransfers, setLoadingTransfers] = useState(true);

  // -------------------------
  // BOOTSTRAP: get the card
  // -------------------------
  useEffect(() => {
    let mounted = true;

    const bootstrap = async () => {
      try {
        // (1) If a prepared game object was passed via navigation state (normal rounds)
        // Accept common shapes: { id, name, ... } or { player_id, name, ... }
        if (location.state && (location.state.id || location.state.player_id) && location.state.name) {
          if (!mounted) return;
          setGameData(location.state);
          setIsDaily(!!location.state.isDaily || urlIsDaily);
          return;
        }

        // (2) If a fixed player id arrived via the daily link: ?daily=1&pid=xxxx
        if (fixedPid) {
          const res = await fetch(`${API_BASE}/player/${fixedPid}`);
          if (!res.ok) throw new Error('Failed to fetch daily player');
          const card = await res.json(); // { id, name, age, nationality, position, photo }
          const normalized = {
            ...card,
            player_id: card.id,
            potentialPoints: 10000, // fallback if not supplied
            isDaily: true,
          };
          if (!mounted) return;
          setGameData(normalized);
          setIsDaily(true);
          return;
        }

        // (3) Fallback for daily: if ?daily=1 but there is no pid or state,
        // ask the backend who today’s player is, then fetch the card.
        if (urlIsDaily) {
          const dc = await fetch(`${API_BASE}/daily-challenge`);
          if (!dc.ok) throw new Error('Failed to load daily challenge');
          const today = await dc.json(); // expect { challenge_date, player_id, ... }
          if (!today?.player_id) throw new Error('Daily challenge has no player');

          const res = await fetch(`${API_BASE}/player/${today.player_id}`);
          if (!res.ok) throw new Error('Failed to fetch daily player');
          const card = await res.json();
          const normalized = {
            ...card,
            player_id: card.id,
            potentialPoints: 10000,
            isDaily: true,
          };
          if (!mounted) return;
          setGameData(normalized);
          setIsDaily(true);
          return;
        }

        // (4) Nothing to start with
        throw new Error('No game payload found.');
      } catch (err) {
        console.error('Failed to start game', err);
        if (!mounted) return;
        setBootError(err.message || 'Failed to start game. Please try again.');
      }
    };

    bootstrap();
    return () => {
      mounted = false;
    };
  }, [location.state, fixedPid, urlIsDaily]);

  // Load transfers once we have a player id
  useEffect(() => {
    const load = async () => {
      const pid = parseInt(gameData?.player_id || gameData?.id || 0, 10);
      if (!pid) return;
      try {
        setLoadingTransfers(true);
        const transfers = await fetchTransfers(pid);
        setTransferHistory(Array.isArray(transfers) ? transfers : []);
      } catch (e) {
        console.error('❌ Error fetching transfers:', e);
        setTransferHistory([]);
      } finally {
        setLoadingTransfers(false);
      }
    };
    load();
  }, [gameData?.id, gameData?.player_id]);

  // Hint multipliers
  const multipliers = {
    age: 0.95,
    nationality: 0.9,
    position: 0.8,
    partialImage: 0.5,
    firstLetter: 0.25,
  };

  // Points incl. time decay, hint penalties, and wrong-guess halving
  const points = useMemo(() => {
    const base = Number(gameData?.potentialPoints || filters?.potentialPoints || 0);
    let p = base;

    Object.keys(usedHints).forEach((k) => {
      if (usedHints[k]) p = Math.floor(p * multipliers[k]);
    });

    const timeElapsed = INITIAL_TIME - timeSec;
    const timeDecay = Math.pow(0.99, timeElapsed); // gentle decay per second
    p = Math.floor(p * timeDecay);

    const wrongAttempts = Math.max(0, 3 - guessesLeft);
    p = Math.floor(p * Math.pow(0.5, wrongAttempts));

    return Math.max(0, p);
  }, [gameData?.potentialPoints, filters?.potentialPoints, usedHints, timeSec, guessesLeft]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Anti-cheat: leaving/blur/hidden => auto-loss
  useEffect(() => {
    if (!gameData?.id && !gameData?.player_id) return;

    const forfeitAndExit = async () => {
      if (endedRef.current) return;
      endedRef.current = true;
      try {
        clearInterval(timerRef.current);
        await saveGameRecord(false);
      } catch {/* ignore */} finally {
        navigate('/game', { replace: true, state: { forfeited: true } });
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') forfeitAndExit();
    };
    const onBlur = () => forfeitAndExit();
    const onPageHide = () => forfeitAndExit();

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [gameData?.id, gameData?.player_id, navigate]);

  // Timer
  useEffect(() => {
    if (!gameData?.id && !gameData?.player_id) return;
    const handleTimeUp = async () => {
      if (endedRef.current) return;
      endedRef.current = true;
      clearInterval(timerRef.current);
      await saveGameRecord(false);
      navigate('/postgame', {
        state: {
          didWin: false,
          player: gameData,
          stats: { pointsEarned: 0, timeSec: INITIAL_TIME, guessesUsed: 3, usedHints },
          filters,
          isDaily,
        },
        replace: true,
      });
    };
    const interval = setInterval(() => {
      setTimeSec((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          handleTimeUp();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    timerRef.current = interval;
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [gameData?.id, gameData?.player_id]); // eslint-disable-line

  // Suggestions (client filtering on top of server list)
  useEffect(() => {
    let active = true;
    const id = setTimeout(async () => {
      const raw = guess.trim();
      if (!raw) {
        if (active) setSuggestions([]);
        return;
      }

      const serverQ = longestToken(raw);
      if (serverQ.length < 2) {
        if (active) setSuggestions([]);
        return;
      }

      try {
        const res = await suggestNames(serverQ);
        const list = Array.isArray(res) ? res : [];
        const filtered = list.filter((item) =>
          multiTokenStartsWithMatch(raw, item.name || item.displayName || '')
        );
        if (active) setSuggestions(filtered.slice(0, 20));
      } catch {
        if (active) setSuggestions([]);
      }
    }, 200);
    return () => {
      active = false;
      clearTimeout(id);
    };
  }, [guess]);

  // If bootstrap failed, show a small error then go back
  useEffect(() => {
    if (bootError) {
      const t = setTimeout(() => navigate('/game'), 1200);
      return () => clearTimeout(t);
    }
  }, [bootError, navigate]);

  // ----------------------------------
  // actions
  // ----------------------------------
  const submitGuess = async (value) => {
    if (!value?.trim() || endedRef.current) return;
    const correct =
      value.trim().toLowerCase() === (gameData?.name || '').trim().toLowerCase();

    if (correct) {
      endedRef.current = true;
      clearInterval(timerRef.current);
      await saveGameRecord(true);
      navigate('/postgame', {
        state: {
          didWin: true,
          player: {
            name: gameData.name,
            photo: gameData.photo,
            age: gameData.age,
            nationality: gameData.nationality,
            position: gameData.position,
            funFact: gameData.funFact,
          },
          stats: {
            pointsEarned: points,
            timeSec: INITIAL_TIME - timeSec,
            guessesUsed: 3 - guessesLeft + 1,
            usedHints,
          },
          filters,
          isDaily,
        },
        replace: true,
      });
      return;
    }

    setIsWrongGuess(true);
    setTimeout(() => setIsWrongGuess(false), 500);

    if (guessesLeft - 1 <= 0) {
      endedRef.current = true;
      clearInterval(timerRef.current);
      await saveGameRecord(false);
      navigate('/postgame', {
        state: {
          didWin: false,
          player: gameData,
          stats: {
            pointsEarned: 0,
            timeSec: INITIAL_TIME - timeSec,
            guessesUsed: 3,
            usedHints,
          },
          filters,
          isDaily,
        },
        replace: true,
      });
    } else {
      setGuessesLeft((prev) => prev - 1);
    }
    setGuess('');
  };

  const saveGameRecord = async (won) => {
    if (!user?.id || !gameData) return null;
    try {
      return await saveGameCompleted({
        userId: user.id,
        playerData: {
          id: parseInt(gameData.player_id || gameData.id, 10) || 0,
          name: gameData.name || gameData.player_name,
          data: {
            nationality: gameData.nationality,
            position: gameData.position,
            age: gameData.age,
            photo: gameData.photo,
          },
        },
        gameStats: {
          won,
          points: won ? points : 0,
          potentialPoints: gameData.potentialPoints || filters?.potentialPoints || 10000,
          timeTaken: INITIAL_TIME - timeSec,
          guessesAttempted: 3 - guessesLeft + (won ? 1 : 0),
          hintsUsed: Object.values(usedHints).filter(Boolean).length,
          isDaily: !!isDaily,
        },
      });
    } catch (err) {
      console.error('Error in saveGameRecord:', err);
      return null;
    }
  };

  const reveal = (key) => setUsedHints((u) => ({ ...u, [key]: true }));

  const timeColorClass =
    timeSec <= 30 ? 'text-red-600' : timeSec <= 60 ? 'text-yellow-600' : 'text-gray-900';

  // ----------------------------------
  // render
  // ----------------------------------
  if (bootError) {
    return (
      <div className="relative min-h-screen bg-gradient-to-b from-green-50 to-transparent">
        <div className="fixed inset-0 -z-10 bg-gradient-to-b from-green-50 to-transparent" />
        <div className="container mx-auto px-4 py-8">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-red-600 mb-4">Failed to start game</h1>
            <p className="mb-4 text-gray-700">{bootError}</p>
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
        <div className="rounded-lg bg-red-50 border border-red-200 text-red-800 font-bold px-4 py-2 text-center">
          Don’t leave this page while the round is active — leaving will
          immediately count as a loss.
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Stats */}
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

        {/* Game input + Transfers */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          {/* Hints / Input (narrow column) */}
          <motion.div
            className="rounded-xl border bg-white shadow-sm p-5 lg:col-span-1"
            animate={isWrongGuess ? { x: [-10, 10, -10, 10, 0], transition: { duration: 0.4 } } : {}}
          >
            <h3 className="text-lg font-semibold mb-3">Who are ya?!</h3>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitGuess(guess);
              }}
              className="space-y-4"
            >
              <input
                type="text"
                value={guess}
                onChange={(e) => setGuess(e.target.value)}
                placeholder="Type a player's name"
                className="w-full px-4 py-3 rounded border"
                autoFocus
              />
              <div className="flex gap-3">
                <button
                  type="submit"
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white py-2 px-4 rounded font-medium"
                >
                  Submit Guess
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (endedRef.current) return;
                    endedRef.current = true;
                    clearInterval(timerRef.current);
                    saveGameRecord(false).then(() =>
                      navigate('/postgame', {
                        state: {
                          didWin: false,
                          player: gameData,
                          stats: {
                            pointsEarned: 0,
                            timeSec: INITIAL_TIME - timeSec,
                            guessesUsed: 3,
                            usedHints,
                          },
                          filters,
                          isDaily,
                        },
                        replace: true,
                      })
                    );
                  }}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white py-2 px-4 rounded font-medium"
                >
                  Give Up
                </button>
              </div>
            </form>

            {suggestions?.length ? (
              <ul className="mt-3 border rounded divide-y max-h-56 overflow-auto">
                {suggestions.map((sug) => (
                  <li
                    key={sug.id ?? sug.name}
                    className="px-3 py-2 hover:bg-gray-50 cursor-pointer text-sm"
                    onClick={() => {
                      setGuess(sug.name);
                      submitGuess(sug.name);
                    }}
                  >
                    {sug.name}
                  </li>
                ))}
              </ul>
            ) : null}

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

          {/* Transfers (wide column) */}
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
      </div>
    </div>
  );
}

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

// ----------------------------------
// Transfer list UI
// ----------------------------------
function ClubPill({ logo, name, flag }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="flex flex-col items-center justify-center gap-1 shrink-0">
        {logo ? <img src={logo} alt="" className="h-6 w-6 rounded-md object-contain" /> : null}
        {flag ? <img src={flag} alt="" className="h-3.5 w-5 rounded-sm object-cover" /> : null}
      </div>
      <span className="text-sm font-medium whitespace-nowrap truncate max-w-[220px] md:max-w-[280px]">
        {name || 'Unknown'}
      </span>
    </div>
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
function formatFee(raw) {
  const v = raw ?? '';
  if (!v) return '—';
  return String(v).replace(/^\$/, '€'); // normalize any accidental dollar to euro
}
function TransfersList({ transfers }) {
  if (!transfers?.length) {
    return <div className="text-sm text-gray-500 text-center">No transfers found.</div>;
  }
  return (
    <ul className="space-y-3">
      {transfers.map((t, idx) => {
        const fee = t.valueRaw ?? '';
        return (
          <li
            key={`${t.date || t.season || 'row'}-${idx}`}
            className="grid grid-cols-12 gap-3 items-center border rounded-lg p-3"
          >
            {/* Season + Date */}
            <div className="col-span-12 md:col-span-3 flex flex-col items-center text-center gap-1">
              <Chip tone="violet">
                <CalendarDays className="h-3.5 w-3.5" />
                <span className="font-semibold">{t.season || '—'}</span>
              </Chip>
              <div className="text-xs text-gray-500">{t.date || '—'}</div>
            </div>

            {/* From -> To */}
            <div className="col-span-12 md:col-span-6 flex items-center justify-center gap-3 flex-wrap md:flex-nowrap min-w-0">
              <ClubPill logo={t.out?.logo} name={t.out?.name} flag={t.out?.flag} />
              <ArrowRight className="h-4 w-4 text-gray-400 shrink-0" />
              <ClubPill logo={t.in?.logo} name={t.in?.name} flag={t.in?.flag} />
            </div>

            {/* Value + Type */}
            <div className="col-span-12 md:col-span-3 flex flex-col items-center justify-center gap-1">
              <Chip tone="green">
                <BadgeEuro className="h-3.5 w-3.5" />
                <span>{formatFee(fee)}</span>
              </Chip>
              {t.type ? <Chip tone="amber">{t.type}</Chip> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
