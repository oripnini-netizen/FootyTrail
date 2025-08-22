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
        potentialPoints: location.state.potentialPoints,
      }
    : null;

  const INITIAL_TIME = 120; // seconds

  // Guess state
  const [guess, setGuess] = useState('');
  const [guessesLeft, setGuessesLeft] = useState(3);
  const [suggestions, setSuggestions] = useState([]);
  const [highlightIndex, setHighlightIndex] = useState(-1);

  // Hints
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
          const { data } = await supabase
            .from('users')
            .select('full_name')
            .eq('id', user.id)
            .maybeSingle();
          if (!cancelled) {
            const dbName = (data?.full_name || '').trim();
            if (dbName) {
              setDisplayName(dbName);
            } else if (user?.email) {
              const local = String(user.email).split('@')[0] || '';
              setDisplayName(local ? local : 'Player');
            }
          }
        } else if (user?.email && !cancelled) {
          const local = String(user.email).split('@')[0] || '';
          setDisplayName(local ? local : 'Player');
        }
      } catch (e) {
        if (!cancelled) setDisplayName('Player');
      }
    }
    loadFullName();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Bootstrap game
  useEffect(() => {
    let mounted = true;

    const bootstrap = async () => {
      try {
        if (location.state?.id) {
          // start timer
          timerRef.current = setInterval(() => {
            setTimeSec((t) => {
              if (t <= 1) {
                clearInterval(timerRef.current);
                if (!endedRef.current) {
                  endedRef.current = true;
                  (async () => {
                    await saveGameRecord(false);
                    navigate('/post-game', {
                      state: {
                        won: false,
                        isDaily,
                        playerName: gameData.name,
                        displayName,
                        elapsedSeconds: INITIAL_TIME,
                        potentialPoints: gameData.potentialPoints,
                        finalPoints: 0,
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
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Suggest names
  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const q = guess.trim();
        if (!q || q.length < 2) {
          setSuggestions([]);
          return;
        }
        const res = await suggestNames(q);
        if (cancelled) return;

        // Basic ranking help to nudge better matches up
        const longest = longestToken(q);
        const scored = (Array.isArray(res) ? res : []).map((r) => ({
          ...r,
          _score:
            (multiTokenStartsWithMatch(q, r.display) ? 2 : 0) +
            (normalize(r.display).includes(longest) ? 1 : 0),
        }));
        scored.sort((a, b) => b._score - a._score);
        setSuggestions(scored.slice(0, 8));
      } catch (e) {
        if (!cancelled) setSuggestions([]);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [guess]);

  // Derived hint multipliers
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
      gameData?.potentialPoints || 0
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
  }, [gameData?.potentialPoints, usedHints, multipliers, timeSec, guessesLeft, isGenericPhoto]);

  // Reveal hint payloads
  const ageValue = usedHints.age ? gameData?.age ?? null : null;
  const nationalityValue = usedHints.nationality ? gameData?.nationality ?? null : null;
  const positionValue = usedHints.position ? gameData?.position ?? null : null;
  const firstLetterValue =
    usedHints.firstLetter && gameData?.name ? gameData.name.trim()[0] : null;
  const partialImageValue = usedHints.partialImage ? gameData?.photo ?? null : null;

  // Save result
  const saveGameRecord = async (won) => {
    try {
      const elapsedSeconds = INITIAL_TIME - timeSec;
      const finalPoints = won ? points : 0;

      const playerData = {
        id: gameData.id,
        name: gameData.name,
        age: gameData.age,
        nationality: gameData.nationality,
        position: gameData.position,
        photo: gameData.photo,
      };

      const gameStats = {
        isDaily,
        elapsedSeconds,
        guessesUsed: 3 - guessesLeft,
        usedHints,
        potentialPoints: gameData.potentialPoints,
        finalPoints,
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
            onClick={() => navigate('/game')}
            className="mt-3 px-4 py-2 rounded bg-gray-900 text-white"
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  const formatTime = (t) => {
    const mm = Math.floor(t / 60)
      .toString()
      .padStart(1, '0');
    const ss = (t % 60).toString().padStart(2, '0');
    return `${mm}:${ss}`;
  };

  const onSubmitGuess = (e) => {
    e.preventDefault();
    const val = guess.trim();
    if (!val) return;
    submitGuess(val);
  };

  const submitGuess = async (submitted) => {
    try {
      if (endedRef.current) return;
      // Correct?
      if (normalize(submitted) === normalize(gameData.name)) {
        endedRef.current = true;
        clearInterval(timerRef.current);
        await saveGameRecord(true);
        navigate('/post-game', {
          state: {
            won: true,
            isDaily,
            playerName: gameData.name,
            displayName,
            elapsedSeconds: INITIAL_TIME - timeSec,
            potentialPoints: gameData.potentialPoints,
            finalPoints: points,
          },
          replace: true,
        });
        return;
      }

      // Wrong guess
      setIsWrongGuess(true);
      setTimeout(() => setIsWrongGuess(false), 400);
      if (guessesLeft <= 1) {
        // No guesses left -> lose
        endedRef.current = true;
        clearInterval(timerRef.current);
        await saveGameRecord(false);
        navigate('/post-game', {
          state: {
            won: false,
            isDaily,
            playerName: gameData.name,
            displayName,
            elapsedSeconds: INITIAL_TIME - timeSec,
            potentialPoints: gameData.potentialPoints,
            finalPoints: 0,
          },
          replace: true,
        });
      } else {
        setGuessesLeft((g) => g - 1);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const onGiveUp = async () => {
    if (endedRef.current) return;
    endedRef.current = true;
    clearInterval(timerRef.current);
    await saveGameRecord(false);
    navigate('/post-game', {
      state: {
        won: false,
        isDaily,
        playerName: gameData.name,
        displayName,
        elapsedSeconds: INITIAL_TIME - timeSec,
        potentialPoints: gameData.potentialPoints,
        finalPoints: 0,
      },
      replace: true,
    });
  };

  // -------------------------
  // UI
  // -------------------------
  return (
    <div className="max-w-5xl mx-auto p-4 space-y-6">
      {/* Notice */}
      <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-amber-800 font-medium text-center">
        ⚠️ Don’t leave this page — leaving or switching windows will count as a loss.
      </div>

      {/* Points Card (Responsive) */}
      {/* Mobile: split into 3 cards stacked. Desktop: keep original single grid card. */}
      {/* MOBILE VERSION */}
      <div className="md:hidden space-y-3">
        {/* 1) Game type + Potential */}
        <div className="rounded-xl bg-white shadow p-6">
          <div className="flex items-center gap-3">
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
        </div>

        {/* Sticky container holding 2) Time+Guesses and 3) Live points */}
        <div className="sticky top-2 z-30 space-y-3">
          {/* 2) Time left + Guesses left */}
          <div className="rounded-xl bg-white shadow p-6">
            <div className="flex items-center justify-between">
              <div className={classNames('flex items-center gap-3 text-2xl font-semibold', timeColorClass)}>
                <AlarmClock className="h-6 w-6" />
                {formatTime(timeSec)}
              </div>
              <div className="text-sm text-gray-600">
                Guesses left: <span className="font-semibold">{guessesLeft}</span>
              </div>
            </div>
          </div>

          {/* 3) Live points (current points) */}
          <div className="rounded-xl bg-white shadow p-6">
            <div className="text-2xl font-extrabold text-amber-600 text-center">
              Current points: <span>{points}</span>
            </div>
          </div>
        </div>
      </div>

      {/* DESKTOP VERSION */}
      <div className="hidden md:block rounded-xl bg-white shadow p-6">
        <div className="grid md:grid-cols-3 items-center">
          {/* Center: Current points (gold) */}
          <div className="flex items-center justify-center md:order-2">
            <div className="text-2xl font-extrabold text-amber-600">
              Current points: <span>{points}</span>
            </div>
          </div>

          {/* Left: Round type + Potential */}
          <div className="flex items-center gap-3 justify-start md:order-1 mt-3 md:mt-0">
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

          {/* Right: timer + guesses */}
          <div className="flex flex-col items-end gap-1 md:order-3 mt-3 md:mt-0">
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

      {/* CONTENT AREA:
          Mobile (default): order-1 Guess, order-2 Transfer, order-3 Hints
          Desktop (lg+): Hints (col 1), Guess (cols 2-3), Transfer hidden (Transfers shown inside Guess) */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Guess + Suggestions (Search bar card) */}
        <motion.div
          className="rounded-xl bg-white shadow p-6 lg:col-span-2 order-1 lg:order-2"
          animate={
            isWrongGuess
              ? { x: [-10, 10, -10, 10, 0], transition: { duration: 0.4 } }
              : {}
          }
        >
          <h3 className="text-lg font-semibold mb-3">Who are ya?!</h3>

          <form onSubmit={onSubmitGuess} className="space-y-4">
            <input
              type="text"
              value={guess}
              onChange={(e) => {
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
                onClick={() => setSuggestions([])}
              >
                Submit Guess
              </button>
              <button
                type="button"
                className="bg-red-600 hover:bg-red-700 text-white py-2 px-4 rounded font-medium"
                onClick={onGiveUp}
              >
                Give up
              </button>
            </div>
          </form>

          {/* Suggestions dropdown */}
          {suggestions.length ? (
            <ul className="mt-3 border rounded-lg divide-y max-h-64 overflow-auto">
              {suggestions.map((sug, i) => (
                <li
                  key={sug.id ?? `${sug.display}-${i}`}
                  className={classNames(
                    'px-3 py-2 text-sm cursor-pointer',
                    i === highlightIndex ? 'bg-gray-100' : ''
                  )}
                  onMouseDown={(e) => {
                    e.preventDefault();
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
            <NoCopySection>
              {loadingTransfers ? (
                <div className="text-sm text-gray-500">Loading transfers…</div>
              ) : (
                <TransfersList transfers={transferHistory} />
              )}
            </NoCopySection>
          </div>
        </motion.div>

        {/* Transfer History (MOBILE-ONLY separate card — sits between Guess and Hints) */}
        <div className="rounded-xl bg-white shadow p-6 order-2 lg:order-3 block lg:hidden">
          <h4 className="font-semibold mb-2">Transfer History</h4>
          <NoCopySection>
            {loadingTransfers ? (
              <div className="text-sm text-gray-500">Loading transfers…</div>
            ) : (
              <TransfersList transfers={transferHistory} />
            )}
          </NoCopySection>
        </div>

        {/* Hints (left column on desktop, last card on mobile) */}
        <div className="rounded-xl bg-white shadow p-6 order-3 lg:order-1">
          <h3 className="text-lg font-semibold mb-3">Hints</h3>
          <div className="space-y-3">
            <HintButton
              label="Player's Age"
              multiplier="×0.90"
              disabled={usedHints.age}
              valueShown={ageValue}
              onClick={() => reveal('age')}
            />
            <HintButton
              label="Nationality"
              multiplier="×0.90"
              disabled={usedHints.nationality}
              valueShown={nationalityValue}
              onClick={() => reveal('nationality')}
            />
            <HintButton
              label="Position"
              multiplier="×0.80"
              disabled={usedHints.position}
              valueShown={positionValue}
              onClick={() => reveal('position')}
            />
            <HintButton
              label="Player's Image"
              multiplier="×0.50"
              disabled={usedHints.partialImage}
              valueShown={partialImageValue ? 'revealed' : ''}
              onClick={() => reveal('partialImage')}
            />
            <HintButton
              label="First letter of the name"
              multiplier="×0.25"
              disabled={usedHints.firstLetter}
              valueShown={firstLetterValue}
              onClick={() => reveal('firstLetter')}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

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
        <span className="ml-auto text-xs text-gray-500">{multiplier}</span>
      </div>

      {/* revealed value */}
      {hasValue ? (
        <div className="mt-2">
          {label === "Player's Image" ? (
            <div className="flex items-center justify-center">
              <img
                src={valueShown && valueShown !== 'revealed' ? valueShown : undefined}
                alt=""
                className="max-h-40 rounded-lg"
              />
            </div>
          ) : (
            <div className="px-2 py-1 rounded bg-white border inline-block text-sm">
              {String(valueShown)}
            </div>
          )}
        </div>
      ) : null}
    </button>
  );
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
            <div className="col-span-12 md:col-span-3 flex flex-col items-center gap-1">
              <Chip tone="amber">
                <BadgeEuro className="h-3.5 w-3.5" />
                <span className="font-semibold">{fee || '—'}</span>
              </Chip>
              <div className="text-xs text-gray-500 select-none">
                {t.type || '—'}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Chip({ tone = 'gray', children }) {
  const tones = {
    gray: 'bg-gray-100 text-gray-800 border-gray-200',
    amber: 'bg-amber-100 text-amber-800 border-amber-200',
    violet: 'bg-violet-100 text-violet-800 border-violet-200',
  };
  return (
    <span className={classNames('px-2 py-1 rounded border text-xs inline-flex items-center gap-1', tones[tone])}>
      {children}
    </span>
  );
}

function ClubPill({ logo, name, flag }) {
  return (
    <div className="inline-flex items-center gap-2 max-w-[44%] min-w-0">
      {logo ? (
        <img src={logo} alt="" className="h-5 w-5 rounded-sm object-cover border" />
      ) : null}
      <span className="text-sm font-medium truncate">{name || '—'}</span>
      {flag ? <img src={flag} alt="" className="h-3 w-5 object-cover rounded-sm border" /> : null}
    </div>
  );
}

/**
 * Prevents copying / selecting nested content (hints & transfers).
 */
function NoCopySection({ children }) {
  return (
    <div
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
