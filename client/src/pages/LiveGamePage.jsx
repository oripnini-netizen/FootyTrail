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
import { supabase } from '../supabase';

function classNames(...s) {
  return s.filter(Boolean).join(' ');
}

// -------------------------
// Name matching helpers (kept in case you want local filtering later)
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
  const [guess, setGuess] = useState(''); // keep string
  const [suggestions, setSuggestions] = useState([]);
  const [highlightIndex, setHighlightIndex] = useState(-1);

  // NEW: refs for auto-scrolling the highlighted suggestion into view
  const listRef = useRef(null);
  const itemRefs = useRef([]);

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

  // -------- username from public.users.full_name (fallbacks to email local-part -> "Player") --------
  const [displayName, setDisplayName] = useState('Player');

  useEffect(() => {
    let cancelled = false;
    async function loadFullName() {
      try {
        // prefer full_name from public.users
        if (user?.id) {
          const { data, error } = await supabase
            .from('users')
            .select('full_name')
            .eq('id', user.id)
            .maybeSingle();
          if (!cancelled) {
            const dbName = (data?.full_name || '').trim();
            if (dbName) {
              setDisplayName(dbName);
              return;
            }
          }
        }
        // fallback: auth email local part
        const emailName = (user?.email || '').split('@')[0]?.trim();
        if (!cancelled) {
          setDisplayName(emailName || 'Player');
        }
      } catch {
        if (!cancelled) {
          const emailName = (user?.email || '').split('@')[0]?.trim();
          setDisplayName(emailName || 'Player');
        }
      }
    }
    loadFullName();
    return () => {
      cancelled = true;
    };
  }, [user?.id, user?.email]);

  // helper to call backend outro with username
  const generateOutro = async (won, pointsValue, guessesUsed, elapsedSec) => {
    try {
      const resp = await fetch('/api/ai/game-outro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          didWin: !!won,
          points: pointsValue,
          guesses: guessesUsed,
          timeSeconds: elapsedSec,
          playerName: gameData?.name || null,
          isDaily: !!isDaily,
          username: displayName, // <-- pass the name from public.users
        }),
      });
      const data = await resp.json();
      return data?.line || null;
    } catch {
      return null;
    }
  };

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
                  (async () => {
                    await saveGameRecord(false);
                    const outroLine = await generateOutro(
                      false,
                      0,
                      3,
                      INITIAL_TIME /* user ran out of time */
                    );
                    navigate('/postgame', {
                      state: {
                        didWin: false,
                        player: gameData,
                        stats: { pointsEarned: 0, timeSec: INITIAL_TIME, guessesUsed: 3, usedHints },
                        filters,
                        isDaily,
                        potentialPoints: gameData?.potentialPoints || filters?.potentialPoints || 0,
                        outroLine: outroLine || null,
                      },
                      replace: true,
                    });
                  })();
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
  // Suggestions (debounced, defensive)
  // -------------------------
  useEffect(() => {
    let active = true;
    const id = setTimeout(async () => {
      // Always coerce to string before trimming
      const raw = typeof guess === 'string' ? guess : String(guess ?? '');
      const q = raw.trim();
      if (!q) {
        if (active) setSuggestions([]);
        return;
      }
      try {
        const res = await suggestNames(q, 50); // ask for more than 5
        if (!active) return;

        // Normalize to { id, display }
        const normalized = (Array.isArray(res) ? res : [])
          .map((r) => {
            if (typeof r === 'string') return { id: r, display: r };
            const idVal =
              r.id ??
              r.player_id ??
              r.pid ??
              r.value ??
              `${r.player_name || r.name || r.display || r.player_norm_name || r.norm || ''}`.toLowerCase();

            const displayVal =
              r.display ??
              r.name ??
              r.player_name ??
              r.norm ??
              r.player_norm_name ??
              '';

            return { id: idVal, display: String(displayVal || '').trim() };
          })
          .filter((x) => x.display); // drop empties

        // De-duplicate by display text
        const seen = new Set();
        const deduped = [];
        for (const s of normalized) {
          const key = s.display.toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            deduped.push(s);
          }
        }

        setSuggestions(deduped);
        // reset item refs length to match
        itemRefs.current = new Array(deduped.length);
      } catch (e) {
        console.error('[suggestNames] failed:', e);
        if (active) setSuggestions([]);
      }
    }, 200);
    return () => {
      active = false;
      clearTimeout(id);
    };
  }, [guess]);

  // NEW: keep highlighted item scrolled into view as you arrow through the list
  useEffect(() => {
    if (highlightIndex < 0 || !listRef.current) return;
    const el = itemRefs.current[highlightIndex];
    if (el && el.scrollIntoView) {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightIndex]);

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

  // Anti-cheat / tab leave → loss  (existing visibilitychange + NEW: window blur)
  useEffect(() => {
    const lose = () => {
      if (endedRef.current) return;
      endedRef.current = true;
      clearInterval(timerRef.current);
      (async () => {
        await saveGameRecord(false);
        const outroLine = await generateOutro(
          false,
          0,
          3,
          INITIAL_TIME - timeSec
        );
        navigate('/postgame', {
          state: {
            didWin: false,
            player: gameData,
            stats: { pointsEarned: 0, timeSec: INITIAL_TIME - timeSec, guessesUsed: 3, usedHints },
            filters,
            isDaily,
            potentialPoints: gameData?.potentialPoints || filters?.potentialPoints || 0,
            outroLine: outroLine || null,
          },
          replace: true,
        });
      })();
    };

    const onHide = () => {
      if (document.hidden) lose();
    };
    const onBlur = () => {
      // opening a new window or switching focus away will blur the current window
      lose();
    };

    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('blur', onBlur);

    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('blur', onBlur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameData?.id, timeSec]);

  // Save record helper (expects { userId, playerData, gameStats })
  const saveGameRecord = async (won) => {
    try {
      const playerIdNumeric = Number(gameData?.id ?? location.state?.id);
      if (!playerIdNumeric || Number.isNaN(playerIdNumeric)) {
        throw new Error('Missing playerData.id in request');
      }

      const playerData = {
        id: playerIdNumeric,
        name: gameData.name,
        nationality: gameData.nationality,
        position: gameData.position,
        age: gameData.age,
        photo: gameData.photo,
      };

      const gameStats = {
        won,
        points: won ? points : 0,
        potentialPoints:
          gameData.potentialPoints || filters?.potentialPoints || 10000,
        timeTaken: INITIAL_TIME - timeSec,
        guessesAttempted: 3 - guessesLeft + (won ? 1 : 0),
        hintsUsed: Object.values(usedHints).filter(Boolean).length,
        isDaily: !!isDaily,
      };

      const body = {
        userId: user?.id || null,
        playerData,
        gameStats,
      };

      const resp = await saveGameCompleted(body);
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
    const v = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
    if (!v || endedRef.current) return;

    const correct = v.toLowerCase() === (gameData?.name || '').trim().toLowerCase();

    if (correct) {
      endedRef.current = true;
      clearInterval(timerRef.current);
      await saveGameRecord(true);

      const elapsed = INITIAL_TIME - timeSec;
      const guessesUsed = 3 - guessesLeft + 1;
      const outroLine = await generateOutro(true, points, guessesUsed, elapsed);

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
            timeSec: elapsed,
            guessesUsed,
            usedHints,
          },
          filters,
          isDaily,
          potentialPoints: gameData?.potentialPoints || filters?.potentialPoints || 0,
          outroLine: outroLine || null,
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

      const elapsed = INITIAL_TIME - timeSec;
      const outroLine = await generateOutro(false, 0, 3, elapsed);

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
            timeSec: elapsed,
            guessesUsed: 3,
            usedHints,
          },
          filters,
          isDaily,
          potentialPoints: gameData?.potentialPoints || filters?.potentialPoints || 0,
          outroLine: outroLine || null,
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
        ⚠️ Don’t leave this page — leaving or switching windows will count as a loss.
      </div>

      {/* Header Card (Points / Type / Timer+Guesses)
          Mobile order: 1) Current points, 2) Game type + Potential, 3) Guesses left (with timer) */}
      <div className="rounded-xl bg-white shadow p-6">
        <div className="grid md:grid-cols-3 items-center">
          {/* Center: Current points (gold) — FIRST on mobile */}
          <div className="flex items-center justify-center order-1 md:order-2">
            <div className="text-2xl font-extrabold text-amber-600">
              Current points: <span>{points}</span>
            </div>
          </div>

          {/* Left: Round type + Potential — SECOND on mobile */}
          <div className="flex items-center gap-3 justify-start order-2 md:order-1 mt-3 md:mt-0">
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

          {/* Right: timer + guesses — THIRD on mobile */}
          <div className="flex flex-col items-end gap-1 order-3 md:order-3 mt-3 md:mt-0">
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

      {/* Transfer History (MOBILE-ONLY card shown above Hints) */}
      <div className="rounded-xl bg-white shadow p-6 block lg:hidden">
        <h4 className="font-semibold mb-2">Transfer History</h4>
        <NoCopySection>
          {loadingTransfers ? (
            <div className="text-sm text-gray-500">Loading transfers…</div>
          ) : (
            <TransfersList transfers={transferHistory} />
          )}
        </NoCopySection>
      </div>

      {/* Hints + Guess (desktop also shows transfers inside Guess) */}
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
                <div className="flex justify-center">
                  <img
                    src={gameData?.photo}
                    alt="Player Hint"
                    className="w-32 h-32 object-cover object-top"
                    style={{ clipPath: 'inset(0 0 34% 0)' }} // show top ~2/3, centered & bigger
                  />
                </div>
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
                // ensure we store a string
                setGuess(typeof e.target.value === 'string' ? e.target.value : String(e.target.value ?? ''));
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
                  (async () => {
                    await saveGameRecord(false);
                    const outroLine = await generateOutro(
                      false,
                      0,
                      3,
                      INITIAL_TIME - timeSec
                    );
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
                        potentialPoints: gameData?.potentialPoints || filters?.potentialPoints || 0,
                        outroLine: outroLine || null,
                      },
                      replace: true,
                    });
                  })();
                }}
                className="px-4 py-2 rounded bg-red-600 hover:bg-red-700 text-white"
              >
                Give up
              </button>
            </div>
          </form>

          {suggestions?.length ? (
            <ul
              ref={listRef}
              className="mt-3 border rounded divide-y max-h-56 overflow-auto"
            >
              {suggestions.map((sug, idx) => (
                <li
                  key={sug.id ?? sug.display ?? idx}
                  ref={(el) => (itemRefs.current[idx] = el)}
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
                    if (!sug?.display) return;
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

          {/* Transfer History (DESKTOP-ONLY inside Guess card to preserve original desktop layout) */}
          <div className="mt-6 pt-5 border-t hidden lg:block">
            <h4 className="font-semibold mb-2">Transfer History</h4>
            {/* NO-COPY wrapper applied ONLY to the transfers area */}
            <NoCopySection>
              {loadingTransfers ? (
                <div className="text-sm text-gray-500">Loading transfers…</div>
              ) : (
                <TransfersList transfers={transferHistory} />
              )}
            </NoCopySection>
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
  const hasValue =
    valueShown !== null && valueShown !== undefined && valueShown !== '';

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => !disabled && onClick?.()}
      className={classNames(
        'w-full text-left px-3 py-3 rounded-lg border transition',
        hasValue
          ? 'bg-emerald-50 border-emerald-200'
          : disabled
          ? 'bg-gray-50 text-gray-400 cursor-not-allowed'
          : 'hover:bg-gray-50'
      )}
    >
      <div
        className={classNames(
          'flex items-center gap-2 text-sm',
          hasValue ? 'text-emerald-800' : ''
        )}
      >
        <Lightbulb
          className={classNames(
            'h-4 w-4',
            hasValue ? 'text-emerald-600' : 'text-amber-500'
          )}
        />
        <span className="font-medium">{label}</span>
        <span
          className={classNames(
            'text-xs',
            hasValue ? 'text-emerald-600' : 'text-gray-500'
          )}
        >
          {multiplier}
        </span>
        {hasValue && (
          <span className="ml-auto text-[10px] uppercase tracking-wider font-semibold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded">
            Revealed
          </span>
        )}
      </div>

      {hasValue ? (
        typeof valueShown === 'string' || typeof valueShown === 'number' ? (
          <div className="mt-2 text-2xl font-extrabold text-emerald-700">
            {valueShown}
          </div>
        ) : (
          <div className="mt-3 overflow-hidden rounded-lg ring-2 ring-emerald-300 inline-block">
            {valueShown}
          </div>
        )
      ) : null}
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
      <span className="text-sm font-medium whitespace-nowrap truncate max-w-[260px] md:max-w-[360px] lg:max-w-[420px] select-none">
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
    <span className={classNames('inline-flex items-center gap-1 text-xs px-2 py-1 rounded border select-none', tones[tone])}>
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
              <div className="text-xs text-gray-500 select-none">{t.date || '—'}</div>
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

/**
 * Wrapper that disables copying/selection/drag/context menu for its children.
 * Applied only to the Transfer History section to prevent cheating.
 */
function NoCopySection({ children }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const prevent = (e) => {
      e.preventDefault();
      e.stopPropagation();
      return false;
    };

    el.addEventListener('copy', prevent);
    el.addEventListener('cut', prevent);
    el.addEventListener('contextmenu', prevent, { capture: true });
    el.addEventListener('dragstart', prevent);
    el.addEventListener('selectstart', prevent);

    return () => {
      el.removeEventListener('copy', prevent);
      el.removeEventListener('cut', prevent);
      el.removeEventListener('contextmenu', prevent, { capture: true });
      el.removeEventListener('dragstart', prevent);
      el.removeEventListener('selectstart', prevent);
    };
  }, []);

  return (
    <div
      ref={ref}
      style={{
        userSelect: 'none',
        WebkitUserSelect: 'none',
        MsUserSelect: 'none',
        MozUserSelect: 'none',
        WebkitTouchCallout: 'none',
      }}
      draggable={false}
      tabIndex={-1}
      className="select-none"
    >
      {children}
    </div>
  );
}
