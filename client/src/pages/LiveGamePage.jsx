// src/pages/LiveGamePage.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { suggestNames, saveGameCompleted, fetchTransfers } from '../api';
import {
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
function tokenize(s) {
  return normalize(s).split(/\s+/).filter(Boolean);
}
function multiTokenStartsWithMatch(query, candidate) {
  const qTokens = tokenize(query);
  const cTokens = tokenize(candidate);
  if (!qTokens.length || !cTokens.length) return false;
  // every query token must match the start of at least one candidate token
  return qTokens.every((qt) => cTokens.some((ct) => ct.startsWith(qt)));
}
function longestToken(s) {
  const t = tokenize(s);
  return t.reduce((a, b) => (b.length > a.length ? b : a), '');
}

// -------------------------

const HINTS = [
  { key: 'age', label: "Player's Age", mult: '×0.90' },
  { key: 'nationality', label: 'Nationality', mult: '×0.90' },
  { key: 'position', label: "Player's Position", mult: '×0.80' },
  { key: 'partialImage', label: "Player's Image", mult: '×0.50' },
  { key: 'firstLetter', label: "Player's First Letter", mult: '×0.25' },
];

export default function LiveGamePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();

  // Boot payload: either daily (from GamePage) or normal
  const isDaily = !!location.state?.isDaily;
  const gameData = location.state
    ? {
        id: location.state.id,
        name: location.state.name,
        age: location.state.age,
        nationality: location.state.nationality,
        position: location.state.position,
        photo: location.state.photo,
        funFact: location.state.funFact,
        potentialPoints: location.state.potentialPoints ?? 10000,
        player_id: location.state.id, // keep for safety
      }
    : null;

  // Filters passed only for PostGame
  const filters = location.state?.filters || { potentialPoints: 0 };

  // 2 minutes timer
  const INITIAL_TIME = 120;

  const [guessesLeft, setGuessesLeft] = useState(3);
  const [guess, setGuess] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [highlightIndex, setHighlightIndex] = useState(-1);

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

  // Transfers
  const [transferHistory, setTransferHistory] = useState([]);
  const [loadingTransfers, setLoadingTransfers] = useState(true);

  // -------------------------
  // BOOTSTRAP: get the card
  // -------------------------
  useEffect(() => {
    let mounted = true;

    const bootstrap = async () => {
      try {
        // If navigated with a prepared card in state
        if (location.state && location.state.id && location.state.name) {
          // kick off timer
          timerRef.current = setInterval(() => {
            setTimeSec((t) => {
              if (t <= 1) {
                clearInterval(timerRef.current);
                if (!endedRef.current) {
                  endedRef.current = true;
                  saveGameRecord(false).then(() =>
                    navigate('/postgame', {
                      state: {
                        didWin: false,
                        player: gameData,
                        stats: { pointsEarned: 0, timeSec: INITIAL_TIME, guessesUsed: 3, usedHints },
                        filters,
                        isDaily,
                      },
                      replace: true,
                    })
                  );
                }
              }
              return t - 1;
            });
          }, 1000);

          // load transfers
          const th = await fetchTransfers(gameData.id);
          if (mounted) {
            setTransferHistory(Array.isArray(th) ? th : []);
            setLoadingTransfers(false);
          }
          return;
        }

        // Otherwise we can't start
        throw new Error('No game payload found.');
      } catch (err) {
        console.error('Failed to start game', err);
        alert('Failed to start game. Please go back and try again.');
        navigate('/game', { replace: true });
      }
    };

    bootstrap();

    return () => {
      mounted = false;
      clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state?.id, location.state?.name]);

  // -------------------------
  // Suggestions (wired to player_norm_name)
  // -------------------------
  useEffect(() => {
    let active = true;
    const id = setTimeout(async () => {
      const raw = guess.trim();
      if (!raw) {
        if (active) setSuggestions([]);
        setHighlightIndex(-1);
        return;
      }

      const serverQ = longestToken(raw);
      if (serverQ.length < 2) {
        if (active) setSuggestions([]);
        setHighlightIndex(-1);
        return;
      }

      try {
        const res = await suggestNames(serverQ);
        const list = Array.isArray(res) ? res : [];

        // Prefer searching on player_norm_name
        const filtered = list.filter((item) => {
          const norm =
            item.player_norm_name ||
            item.norm_name ||
            item.normalized ||
            item.name ||
            item.displayName ||
            '';
          return multiTokenStartsWithMatch(raw, norm);
        });

        // shape each suggestion with a consistent display and value
        const shaped = filtered.map((it) => ({
          id: it.id ?? it.player_id ?? it.pid ?? it.name,
          // prefer the real display name if present; fallback to normalized or name
          display:
            it.player_name ||
            it.name ||
            it.displayName ||
            (it.player_norm_name
              ? it.player_norm_name
                  .split(' ')
                  .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                  .join(' ')
              : ''),
          norm:
            it.player_norm_name ||
            it.norm_name ||
            it.normalized ||
            normalize(
              it.player_name || it.name || it.displayName || ''
            ),
        }));

        if (active) {
          setSuggestions(shaped.slice(0, 50)); // allow way more than 5
          setHighlightIndex(shaped.length ? 0 : -1);
        }
      } catch {
        if (active) {
          setSuggestions([]);
          setHighlightIndex(-1);
        }
      }
    }, 200);

    return () => {
      active = false;
      clearTimeout(id);
    };
  }, [guess]);

  // -------------------------
  // Hints / Points
  // -------------------------
  const multipliers = {
    age: 0.9,
    nationality: 0.9,
    position: 0.8,
    partialImage: 0.5,
    firstLetter: 0.25,
  };

  // Treat Transfermarkt generic silhouette as "no real photo" for hint penalty
  const isGenericPhoto = useMemo(() => {
    const url = gameData?.photo || '';
    return /\/default\.jpg(\?|$)/i.test(url);
  }, [gameData?.photo]);

  // Points incl. time decay, hint penalties, and wrong-guess halving
  const points = useMemo(() => {
    const potentialPoints = Number(
      gameData?.potentialPoints || filters?.potentialPoints || 0
    );
    let p = potentialPoints;

    Object.keys(usedHints).forEach((k) => {
      if (!usedHints[k]) return;
      if (k === 'partialImage' && isGenericPhoto) return; // no penalty if generic photo
      p = Math.floor(p * multipliers[k]);
    });

    const timeElapsed = INITIAL_TIME - timeSec;
    const timeDecay = Math.pow(0.99, timeElapsed);
    p = Math.floor(p * timeDecay);

    const wrongAttempts = Math.max(0, 3 - guessesLeft);
    p = Math.floor(p * Math.pow(0.5, wrongAttempts));

    return Math.max(0, p);
  }, [gameData?.potentialPoints, filters?.potentialPoints, usedHints, timeSec, guessesLeft, isGenericPhoto]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Anti-cheat / tab leave → loss
  useEffect(() => {
    const onHide = () => {
      if (document.hidden && !endedRef.current) {
        endedRef.current = true;
        clearInterval(timerRef.current);
        saveGameRecord(false).then(() =>
          navigate('/postgame', {
            state: {
              didWin: false,
              player: gameData,
              stats: { pointsEarned: 0, timeSec: INITIAL_TIME, guessesUsed: 3, usedHints },
              filters,
              isDaily,
            },
            replace: true,
          })
        );
      }
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameData?.id]);

  // Save record helper (FIXED)
  const saveGameRecord = async (won) => {
    try {
      const playerIdNumeric = Number(gameData?.id ?? location.state?.id);
      const payload = {
        // original nested shape (kept for compatibility)
        userId: user?.id || null,
        player: {
          id: playerIdNumeric,
          name: gameData.name,
          nationality: gameData.nationality,
          position: gameData.position,
          age: gameData.age,
          photo: gameData.photo,
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

        // flat mirror (so the server can insert regardless of handler)
        player_id: playerIdNumeric,
        player_name: gameData.name,
        player_photo: gameData.photo,
        player_age: gameData.age,
        player_nationality: gameData.nationality,
        player_position: gameData.position,
        won,
        points: won ? points : 0,
        potential_points: gameData.potentialPoints || filters?.potentialPoints || 10000,
        time_taken_sec: INITIAL_TIME - timeSec,
        guesses_used: 3 - guessesLeft + (won ? 1 : 0),
        hints_used: Object.values(usedHints).filter(Boolean).length,
        is_daily_challenge: !!isDaily,
      };

      const resp = await saveGameCompleted(payload);
      // If your helper returns `{ error }` or `{ data, error }`, catch it here:
      if (resp && resp.error) {
        console.error('[saveGameCompleted] error:', resp.error);
        return null;
      }
      return true;
    } catch (err) {
      console.error('Error in saveGameRecord:', err);
      return null;
    }
  };

  const reveal = (key) => setUsedHints((u) => ({ ...u, [key]: true }));

  const timeColorClass =
    timeSec <= 30 ? 'text-red-600' : timeSec <= 60 ? 'text-yellow-600' : 'text-gray-900';

  // Loading and missing
  if (!location.state || !location.state.id) {
    return (
      <div className="max-w-3xl mx-auto p-4">
        <div className="rounded-xl bg-white shadow p-6 text-center">
          <p className="text-red-600 font-medium">No game payload found.</p>
          <button
            className="mt-3 px-4 py-2 rounded bg-gray-800 text-white"
            onClick={() => navigate('/game')}
          >
            Back to Game
          </button>
        </div>
      </div>
    );
  }

  // -------------------------
  // Submit guess
  // -------------------------
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
            id: gameData.id,
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

    // wrong guess → halve points (handled in `points` useMemo via guessesLeft)
    setIsWrongGuess(true);
    setTimeout(() => setIsWrongGuess(false), 350);

    if (guessesLeft <= 1) {
      endedRef.current = true;
      clearInterval(timerRef.current);
      await saveGameRecord(false);
      navigate('/postgame', {
        state: {
          didWin: false,
          player: {
            id: gameData.id,
            name: gameData.name,
            photo: gameData.photo,
            age: gameData.age,
            nationality: gameData.nationality,
            position: gameData.position,
          },
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
      setGuessesLeft((g) => g - 1);
    }
  };

  // -------------------------
  // UI
  // -------------------------
  return (
    <div className="max-w-5xl mx-auto p-4 space-y-6">
      {/* Warning */}
      <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-amber-800 font-medium text-center">
        ⚠️ Don’t leave this page — leaving will count as a loss.
      </div>

      {/* Header Card */}
      <div className="rounded-xl bg-white shadow p-6">
        <div className="grid md:grid-cols-3 items-center">
          {/* Left: Round type */}
          <div className="flex items-center gap-3 justify-start">
            <Trophy className="h-5 w-5 text-purple-600" />
            <div className="text-sm">
              {isDaily ? (
                <span className="font-semibold text-purple-700">Daily Challenge</span>
              ) : (
                <span className="text-gray-600">Regular Round</span>
              )}
              <div className="text-sm">
                <span className="text-gray-900 text-base">
                  Potential: <span className="font-bold">{gameData.potentialPoints}</span>
                </span>
              </div>
            </div>
          </div>

          {/* Center: Current points (gold) */}
          <div className="flex items-center justify-center">
            <div className="text-2xl font-extrabold text-amber-600">
              Current points: <span>{points}</span>
            </div>
          </div>

          {/* Right: timer + guesses */}
          <div className="flex flex-col items-end gap-1">
            <div className={classNames('flex items-center gap-3 text-2xl font-semibold', timeColorClass)}>
              <AlarmClock className="h-6 w-6" />
              {formatTime(timeSec)}
            </div>
            <div className="text-sm text-gray-600">
              Guesses left: <span className="font-semibold">{guessesLeft}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Hints + Guess + Transfers */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Hints */}
        <div className="rounded-xl bg-white shadow p-6 space-y-4 lg:col-span-1">
          <h3 className="text-lg font-semibold mb-2">Hints</h3>

          <HintButton
            label="Player's Age"
            multiplier="×0.90"
            disabled={usedHints.age || !gameData?.age}
            onClick={() => reveal('age')}
            valueShown={usedHints.age ? String(gameData?.age) : null}
          />
          <HintButton
            label="Nationality"
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
                  style={{ clipPath: 'inset(0 0 34% 0)' }} // top 2/3
                />
              ) : null
            }
          />
          <HintButton
            label="Player's First Letter"
            multiplier="×0.25"
            disabled={usedHints.firstLetter || !gameData?.name}
            onClick={() => reveal('firstLetter')}
            valueShown={usedHints.firstLetter ? String(gameData?.name?.[0]?.toUpperCase() || '') : null}
          />
        </div>

        {/* Guess + Suggestions */}
        <motion.div
          className="rounded-xl bg-white shadow p-6 lg:col-span-2"
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
              if (highlightIndex >= 0 && highlightIndex < suggestions.length) {
                const chosen = suggestions[highlightIndex];
                if (chosen?.display) {
                  submitGuess(chosen.display);
                  return;
                }
              }
              submitGuess(guess);
            }}
            className="space-y-4"
          >
            <input
              type="text"
              value={guess}
              onChange={(e) => {
                setGuess(e.target.value);
                setHighlightIndex(-1);
              }}
              onKeyDown={(e) => {
                if (!suggestions.length) return;
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setHighlightIndex((i) => (i + 1) % suggestions.length);
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setHighlightIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
                } else if (e.key === 'Escape') {
                  setSuggestions([]);
                  setHighlightIndex(-1);
                }
              }}
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
                className="px-4 py-2 rounded bg-red-600 hover:bg-red-700 text-white"
              >
                Give up
              </button>
            </div>
          </form>

          {suggestions?.length ? (
            <ul className="mt-3 border rounded divide-y max-h-56 overflow-auto">
              {suggestions.map((sug, idx) => (
                <li
                  key={sug.id ?? sug.display}
                  className={classNames(
                    'px-3 py-2 cursor-pointer text-sm',
                    idx === highlightIndex ? 'bg-sky-50' : 'hover:bg-gray-50'
                  )}
                  onMouseEnter={() => setHighlightIndex(idx)}
                  onMouseDown={(e) => {
                    // prevent input blur before click handler
                    e.preventDefault();
                  }}
                  onClick={() => {
                    setGuess(sug.display);
                    setSuggestions([]);
                    submitGuess(sug.display);
                  }}
                >
                  {sug.display}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-6 pt-5 border-t">
            <h4 className="font-semibold mb-2">Transfer History</h4>
            {loadingTransfers ? (
              <div className="text-sm text-gray-500">Loading transfers…</div>
            ) : (
              <TransfersList transfers={transferHistory} />
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
}

// -------------------------
// Small UI bits
// -------------------------
function HintButton({ label, multiplier, onClick, disabled, valueShown }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => !disabled && onClick?.()}
      className={classNames(
        'w-full text-left px-3 py-2 rounded border',
        disabled ? 'bg-gray-50 text-gray-400 cursor-not-allowed' : 'hover:bg-gray-50'
      )}
    >
      <div className="flex items-center gap-2 text-sm">
        <Lightbulb className="h-4 w-4 text-amber-500" />
        <span className="font-medium">{label}</span>
        <span className="text-xs text-gray-500">{multiplier}</span>
      </div>
      {valueShown ? <div className="mt-2 text-sm">{valueShown}</div> : null}
    </button>
  );
}

function ClubPill({ logo, name, flag }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      {/* Icon stack: logo above flag */}
      <div className="flex flex-col items-center justify-center gap-1 shrink-0">
        {logo ? <img src={logo} alt="" className="h-6 w-6 rounded-md object-contain" /> : null}
        {flag ? <img src={flag} alt="" className="h-3.5 w-5 rounded-sm object-cover" /> : null}
      </div>
      {/* Name */}
      <span className="text-sm font-medium whitespace-nowrap truncate max-w-[260px] md:max-w-[360px] lg:max-w-[420px]">
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
  let s = String(v);
  // Remove HTML breaks/tags like "<br /><i ...>€2.00m</i>"
  s = s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '');
  // Remove common prefixes like "Loan fee:" or "Fee:"
  s = s.replace(/^\s*(Loan\s*fee:|Fee:)\s*/i, '');
  // Normalize any accidental "$" to "€"
  s = s.replace(/^\$/, '€').replace(/\$/g, '€');
  s = s.trim();
  return s || '—';
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
