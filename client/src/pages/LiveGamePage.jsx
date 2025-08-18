import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { suggestNames, saveGameCompleted, fetchTransfers } from '../api';
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

function classNames(...s) {
  return s.filter(Boolean).join(' ');
}

// -------------------------
// Name matching helpers
// -------------------------
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
  return qTokens.every((qt) => cTokens.some((ct) => ct.startsWith(qt)));
}
function longestToken(str) {
  const t = tokenize(str).sort((a, b) => b.length - a.length);
  return t[0] || '';
}

export default function LiveGamePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();

  // 2 minutes timer
  const INITIAL_TIME = 120;

  const [guessesLeft, setGuessesLeft] = useState(3);
  const [guess, setGuess] = useState('');
  const [suggestions, setSuggestions] = useState([]);

  const [usedHints, setUsedHints] = useState({
    age: false,
    nationality: false,
    position: false,
    partialImage: false,
    firstLetter: false,
  });
  const [isWrongGuess, setIsWrongGuess] = useState(false);

  const [timeSec, setTimeSec] = useState(INITIAL_TIME);
  const timerRef = useRef(null);
  const endedRef = useRef(false);

  const game = location.state || null;
  const filters = location.state?.filters || { potentialPoints: 0 };
  const isDaily = !!location.state?.isDaily;

  // Transfers
  const [transferHistory, setTransferHistory] = useState([]);
  const [loadingTransfers, setLoadingTransfers] = useState(true);

  useEffect(() => {
    const load = async () => {
      if (!game?.id) return;
      try {
        setLoadingTransfers(true);
        const transfers = await fetchTransfers(game.id);
        setTransferHistory(Array.isArray(transfers) ? transfers : []);
      } catch (e) {
        console.error('❌ Error fetching transfers:', e);
        setTransferHistory([]);
      } finally {
        setLoadingTransfers(false);
      }
    };
    load();
  }, [game?.id]);

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
    const potentialPoints = Number(game?.potentialPoints || filters?.potentialPoints || 0);
    let p = potentialPoints;

    Object.keys(usedHints).forEach((k) => {
      if (usedHints[k]) p = Math.floor(p * multipliers[k]);
    });

    const timeElapsed = INITIAL_TIME - timeSec;
    const timeDecay = Math.pow(0.99, timeElapsed);
    p = Math.floor(p * timeDecay);

    const wrongAttempts = Math.max(0, 3 - guessesLeft);
    p = Math.floor(p * Math.pow(0.5, wrongAttempts));

    return Math.max(0, p);
  }, [game?.potentialPoints, filters?.potentialPoints, usedHints, timeSec, guessesLeft]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Anti-cheat: leaving/blur/hidden => auto-loss
  useEffect(() => {
    if (!game?.id) return;

    const forfeitAndExit = async () => {
      if (endedRef.current) return;
      endedRef.current = true;
      try {
        clearInterval(timerRef.current);
        await saveGameRecord(false);
      } catch {
        /* ignore */
      } finally {
        navigate('/game', { replace: true, state: { forfeited: true } });
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') forfeitAndExit();
    };
    const onBlur = () => {
      forfeitAndExit();
    };
    const onPageHide = () => {
      forfeitAndExit();
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('pagehide', onPageHide);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [game?.id, navigate]);

  // Timer
  useEffect(() => {
    if (!game?.id) return;
    const handleTimeUp = async () => {
      if (endedRef.current) return;
      endedRef.current = true;
      clearInterval(timerRef.current);
      await saveGameRecord(false);
      navigate('/postgame', {
        state: {
          didWin: false,
          player: game,
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
  }, [game?.id]); // eslint-disable-line

  // Suggestions
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

  // Guard
  useEffect(() => {
    if (!game || !game.id || !game.name) {
      setTimeout(() => navigate('/game'), 0);
      return;
    }
  }, []); // eslint-disable-line

  const submitGuess = async (value) => {
    if (!value?.trim() || endedRef.current) return;
    const correct =
      value.trim().toLowerCase() === (game.name || '').trim().toLowerCase();

    if (correct) {
      endedRef.current = true;
      clearInterval(timerRef.current);
      await saveGameRecord(true);
      navigate('/postgame', {
        state: {
          didWin: true,
          player: {
            name: game.name,
            photo: game.photo,
            age: game.age,
            nationality: game.nationality,
            position: game.position,
            funFact: game.funFact,
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
          player: game,
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
    if (!user?.id) return null;
    try {
      return await saveGameCompleted({
        userId: user.id,
        playerData: {
          id: parseInt(game.player_id || game.id, 10) || 0,
          name: game.name || game.player_name,
          data: {
            nationality: game.nationality,
            position: game.position,
            age: game.age,
            photo: game.photo,
          },
        },
        gameStats: {
          won,
          points: won ? points : 0,
          potentialPoints: game.potentialPoints || filters?.potentialPoints || 10000,
          timeTaken: INITIAL_TIME - timeSec,
          guessesAttempted: 3 - guessesLeft + (won ? 1 : 0),
          hintsUsed: Object.values(usedHints).filter(Boolean).length,
          isDaily: !!game.isDaily,
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

  if (!game || !game.id) {
    return (
      <div className="relative min-h-screen bg-gradient-to-b from-green-50 to-transparent">
        <div className="fixed inset-0 -z-10 bg-gradient-to-b from-green-50 to-transparent" />
        <div className="container mx-auto px-4 py-8">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-red-600 mb-4">No Game Data Found</h1>
            <p className="mb-4">Redirecting to game setup...</p>
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
              <div className={classNames('text-lg font-semibold', timeColorClass)}>
                {formatTime(timeSec)}
              </div>
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
            animate={
              isWrongGuess
                ? { x: [-10, 10, -10, 10, 0], transition: { duration: 0.4 } }
                : {}
            }
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
                          player: game,
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
                  disabled={usedHints.age || !game?.age}
                  onClick={() => reveal('age')}
                  valueShown={usedHints.age ? String(game?.age) : null}
                />
                <HintButton
                  label="Player's Nationality"
                  multiplier="×0.90"
                  disabled={usedHints.nationality || !game?.nationality}
                  onClick={() => reveal('nationality')}
                  valueShown={usedHints.nationality ? String(game?.nationality) : null}
                />
                <HintButton
                  label="Player's Position"
                  multiplier="×0.80"
                  disabled={usedHints.position || !game?.position}
                  onClick={() => reveal('position')}
                  valueShown={usedHints.position ? String(game?.position) : null}
                />
                <HintButton
                  label="Player's Image"
                  multiplier="×0.50"
                  disabled={usedHints.partialImage || !game?.photo}
                  onClick={() => reveal('partialImage')}
                  valueShown={
                    usedHints.partialImage ? (
                      <img
                        src={game?.photo}
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
                  disabled={usedHints.firstLetter || !game?.name}
                  onClick={() => reveal('firstLetter')}
                  valueShown={usedHints.firstLetter ? game?.name?.charAt(0) : null}
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
      className={classNames(
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
          <div className="text-sm px-2 py-1 rounded bg-green-50 border text-green-800">
            {valueShown}
          </div>
        ) : null}
      </div>
    </button>
  );
}

// -------------------------
// Transfer List (new UI)
// -------------------------
function ClubPill({ logo, name, flag }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      {/* Icon stack: logo above flag */}
      <div className="flex flex-col items-center justify-center gap-1 shrink-0">
        {logo ? <img src={logo} alt="" className="h-6 w-6 rounded-md object-contain" /> : null}
        {flag ? <img src={flag} alt="" className="h-3.5 w-5 rounded-sm object-cover" /> : null}
      </div>
      {/* Name */}
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
    <span className={classNames('inline-flex items-center gap-1 text-xs px-2 py-1 rounded border', tones[tone])}>
      {children}
    </span>
  );
}

function formatFee(raw) {
  const v = raw ?? '';
  if (!v) return '—';
  // Keep already-formatted strings (e.g. "€10m", "Free transfer", "Loan")
  // and normalize any accidental "$" to "€".
  return String(v).replace(/^\$/, '€');
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
            {/* Season + Date (centered vertical stack) */}
            <div className="col-span-12 md:col-span-3 flex flex-col items-center text-center gap-1">
              <Chip tone="violet">
                <CalendarDays className="h-3.5 w-3.5" />
                <span className="font-semibold">{t.season || '—'}</span>
              </Chip>
              <div className="text-xs text-gray-500">{t.date || '—'}</div>
            </div>

            {/* From → To (names have max width + truncate) */}
            <div className="col-span-12 md:col-span-6 flex items-center justify-center gap-3 flex-wrap md:flex-nowrap min-w-0">
              <ClubPill logo={t.out?.logo} name={t.out?.name} flag={t.out?.flag} />
              <ArrowRight className="h-4 w-4 text-gray-400 shrink-0" />
              <ClubPill logo={t.in?.logo} name={t.in?.name} flag={t.in?.flag} />
            </div>

            {/* Value + Type (stacked & centered) */}
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
