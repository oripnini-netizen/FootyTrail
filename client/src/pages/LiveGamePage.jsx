import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { suggestNames, addGameRecord } from '../api';
import { Clock, AlarmClock, Lightbulb, Trophy } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import confetti from 'canvas-confetti';

/**
 * Live game page
 * - No player image shown
 * - Shows transfer history
 * - Input for guesses with suggestions (suggestNames)
 * - Timer + remaining guesses counter
 * - Live points with hint multipliers:
 *   1) Age x0.95
 *   2) Nationality x0.9
 *   3) Position x0.8
 *   4) Partial image (top half) x0.5   (kept as a placeholder text reveal, no actual image)
 *   5) First letter x0.25
 */

function classNames(...s) {
  return s.filter(Boolean).join(' ');
}

const styles = {
  '@keyframes vibrate': {
    '0%': { transform: 'translateX(0)' },
    '25%': { transform: 'translateX(5px)' },
    '50%': { transform: 'translateX(-5px)' },
    '75%': { transform: 'translateX(5px)' },
    '100%': { transform: 'translateX(0)' }
  },
  wrongGuess: {
    animation: 'vibrate 0.3s linear'
  }
};

export default function LiveGamePage() {
  const location = useLocation();
  const navigate = useNavigate();

  // game payload comes from navigation state
  const game = location.state?.game || null; // { id, name, transferHistory, age, nationality, position, photo }
  const filters = location.state?.filters || { potentialPoints: 0 };
  const isDaily = !!location.state?.isDaily;

  // Redirect back if missing payload
  useEffect(() => {
    if (!game || !game.transferHistory) {
      navigate('/');
    }
  }, [game, navigate]);

  // ---- core state ----
  const INITIAL_TIME = 180; // 3 minutes in seconds
  const [timeSec, setTimeSec] = useState(INITIAL_TIME);
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
  const [guessColor, setGuessColor] = useState('text-gray-700');
  const formRef = useRef(null);

  // multipliers map (only applied once per hint)
  const multipliers = {
    age: 0.95,
    nationality: 0.9,
    position: 0.8,
    partialImage: 0.5,
    firstLetter: 0.25,
  };

  // live points calculation
  const points = useMemo(() => {
    let p = Number(filters?.potentialPoints || 0);
    Object.keys(usedHints).forEach((k) => {
      if (usedHints[k]) p = Math.floor(p * multipliers[k]);
    });
    // small decay by time: 1% per 15 seconds (tunable)
    const decay = Math.min(0.9, Math.floor(timeSec / 15) / 100);
    p = Math.max(0, Math.floor(p * (1 - decay)));
    return p;
  }, [filters?.potentialPoints, usedHints, timeSec]);

  // Timer effect - count down instead of up
  const timerRef = useRef(null);
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setTimeSec((t) => {
        if (t <= 0) {
          clearInterval(timerRef.current);
          endGame(false);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, []);

  // Format time as MM:SS
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // suggestions (debounced)
  useEffect(() => {
    let active = true;
    const id = setTimeout(async () => {
      const q = guess.trim();
      if (!q) {
        if (active) setSuggestions([]);
        return;
      }
      try {
        const res = await suggestNames(q);
        if (active) setSuggestions(res || []);
      } catch {
        if (active) setSuggestions([]);
      }
    }, 200);
    return () => {
      active = false;
      clearTimeout(id);
    };
  }, [guess]);

  const endGame = (didWin) => {
    // In items 7–8 we’ll persist the full record & move to PostGamePage.
    navigate('/post', {
      state: {
        didWin,
        isDaily,
        player: {
          name: game.name,
          photo: game.photo,
          age: game.age,
          nationality: game.nationality,
          position: game.position,
          funFact: game.funFact // if available
        },
        stats: {
          timeSec,
          guessesUsed: 3 - guessesLeft + (didWin ? 1 : 0),
          pointsEarned: didWin ? points : 0,
          usedHints,
          filters,
        },
      },
    });
  };

  const submitGuess = async (value) => {
    if (!value?.trim()) return;
    
    const correct = value.trim().toLowerCase() === game.name.trim().toLowerCase();

    if (correct) {
      clearInterval(timerRef.current);
      const gameData = await saveGameRecord(true);
      navigate('/postgame', { 
        state: { 
          didWin: true,
          player: {
            name: game.name,
            photo: game.photo,
            age: game.age,
            nationality: game.nationality,
            position: game.position,
            funFact: game.funFact // if available
          },
          stats: {
            pointsEarned: points,
            timeSec: INITIAL_TIME - timeSec,
            guessesUsed: 3 - guessesLeft + 1,
            usedHints
          }
        },
        replace: true
      });
      return;
    }

    // Wrong guess handling
    setIsWrongGuess(true);
    setTimeout(() => setIsWrongGuess(false), 500);

    if (guessesLeft - 1 <= 0) {
      clearInterval(timerRef.current);
      const gameData = await saveGameRecord(false);
      navigate('/postgame', {
        state: {
          didWin: false,
          player: game,
          stats: {
            pointsEarned: 0,
            timeSec: INITIAL_TIME - timeSec,
            guessesUsed: 3,
            usedHints
          }
        },
        replace: true
      });
    } else {
      setGuessesLeft(prev => prev - 1);
    }
    setGuess('');
  };

  // Add effect for time running out
  useEffect(() => {
    if (timeSec <= 0) {
      const handleTimeUp = async () => {
        clearInterval(timerRef.current);
        const gameData = await saveGameRecord(false);
        navigate('/postgame', {
          state: {
            didWin: false,
            player: game,
            stats: {
              pointsEarned: 0,
              timeSec: INITIAL_TIME,
              guessesUsed: 3 - guessesLeft,
              usedHints
            }
          },
          replace: true
        });
      };
      handleTimeUp();
    }
  }, [timeSec]);

  const saveGameRecord = async (didWin) => {
    try {
      console.log('Saving game record...');
      const gameRecord = {
        player_id: parseInt(game.id, 10),  // Convert to number
        player_name: game.name,
        player_data: {
          age: game.age,
          nationality: game.nationality,
          position: game.position,
          photo: game.photo,
          transfer_history: game.transferHistory
        },
        is_daily_challenge: Boolean(isDaily),
        guesses_attempted: 3 - guessesLeft + (didWin ? 1 : 0),
        time_taken_seconds: INITIAL_TIME - timeSec,
        points_earned: didWin ? points : 0,
        potential_points: Number(filters?.potentialPoints || 0),
        hints_used: Object.keys(usedHints).filter(k => usedHints[k]).length,
        completed: true,
        won: didWin
      };

      console.log('Sending game record:', gameRecord);
      const savedRecord = await addGameRecord(gameRecord);
      console.log('Game record saved:', savedRecord);
      return savedRecord;
    } catch (error) {
      console.error('Error saving game record:', error);
      alert('Failed to save game record. Your progress may not be recorded.');
      return null;
    }
  };

  // ----- Hint handlers (no hooks inside callbacks) -----
  const revealAge = () => {
    if (usedHints.age || !game?.age) return;
    setUsedHints((u) => ({ ...u, age: true }));
  };
  const revealNationality = () => {
    if (usedHints.nationality || !game?.nationality) return;
    setUsedHints((u) => ({ ...u, nationality: true }));
  };
  const revealPosition = () => {
    if (usedHints.position || !game?.position) return;
    setUsedHints((u) => ({ ...u, position: true }));
  };
  const revealPartialImage = () => {
    if (usedHints.partialImage) return;
    setUsedHints((u) => ({ ...u, partialImage: true }));
  };
  const revealFirstLetter = () => {
    if (usedHints.firstLetter || !game?.name) return;
    setUsedHints((u) => ({ ...u, firstLetter: true }));
  };

  const handleGiveUp = async () => {
    clearInterval(timerRef.current);
    const gameData = await saveGameRecord(false);
    navigate('/postgame', {
      state: {
        didWin: false,
        player: game,
        stats: {
          pointsEarned: 0,
          timeSec: INITIAL_TIME - timeSec,
          guessesUsed: 3 - guessesLeft,
          usedHints
        }
      },
      replace: true
    });
  };

  if (!game) return null;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      {/* Header stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="rounded border bg-white p-4 flex items-center gap-3">
          <Clock className="h-5 w-5 text-gray-700" />
          <div>
            <div className="text-xs text-gray-500">Time Remaining</div>
            <div className="text-lg font-semibold">{formatTime(timeSec)}</div>
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

      {/* Grid container for game cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* Who are ya?! Card with Hints */}
        <motion.div 
          className="rounded-xl border bg-white shadow-sm p-6"
          animate={isWrongGuess ? {
            x: [-10, 10, -10, 10, 0],
            transition: { duration: 0.4 }
          } : {}}
        >
          <h3 className="text-lg font-semibold mb-3">Who are ya?!</h3>
          <form
            ref={formRef}
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
                onClick={handleGiveUp}
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
                  key={sug.id}
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

          {/* Hints Section */}
          <div className="mt-6 pt-6 border-t">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Lightbulb className="h-5 w-5 text-amber-500" />
              Hints (reduce points)
            </h3>

            <div className="grid grid-cols-1 gap-3">
              <HintButton
                label="Player's Age"
                multiplier="×0.95"
                disabled={usedHints.age || !game?.age}
                onClick={revealAge}
                valueShown={usedHints.age ? String(game?.age) : null}
              />
              <HintButton
                label="Player's Nationality"
                multiplier="×0.90"
                disabled={usedHints.nationality || !game?.nationality}
                onClick={revealNationality}
                valueShown={usedHints.nationality ? String(game?.nationality) : null}
              />
              <HintButton
                label="Player's Position"
                multiplier="×0.80"
                disabled={usedHints.position || !game?.position}
                onClick={revealPosition}
                valueShown={usedHints.position ? String(game?.position) : null}
              />
              <HintButton
                label="Player's Image"
                multiplier="×0.50"
                disabled={usedHints.partialImage || !game?.photo}
                onClick={revealPartialImage}
                valueShown={usedHints.partialImage ? (
                  <img 
                    src={game?.photo} 
                    alt="Player Hint"
                    className="w-20 h-20 object-cover object-top"
                    style={{ clipPath: 'inset(0 0 50% 0)' }}
                  />
                ) : null}
              />
              <HintButton
                label="Player's First Letter"
                multiplier="×0.25"
                disabled={usedHints.firstLetter || !game?.name}
                onClick={revealFirstLetter}
                valueShown={usedHints.firstLetter ? game?.name?.charAt(0) : null}
              />
            </div>
          </div>
        </motion.div>

        {/* Transfer History Card */}
        <div className="rounded-xl border bg-white shadow-sm p-6">
          <h3 className="text-lg font-semibold mb-4 text-center">Transfer History</h3>
          <TransfersList transfers={game.transferHistory || []} />
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
          <div className="text-sm px-2 py-1 rounded bg-green-50 border text-green-800">{valueShown}</div>
        ) : null}
      </div>
    </button>
  );
}

function TransfersList({ transfers }) {
  if (!transfers?.length) {
    return <div className="text-sm text-gray-500 text-center">No transfers found.</div>;
  }
  return (
    <ul className="space-y-3">
      {transfers.map((t, idx) => (
        <li key={`${t.date}-${idx}`} className="flex items-center justify-center gap-3 border rounded p-3">
          <div className="w-24 text-sm text-gray-600 text-center">{t.date || '—'}</div>
          <div className="text-xs text-gray-500 w-14 text-center">{t.type || ''}</div>
          <div className="flex items-center justify-center gap-2">
            {t.out?.logo ? <img src={t.out.logo} alt="" className="h-5 w-5 object-contain" /> : null}
            <span className="text-sm">{t.out?.name || 'Unknown'}</span>
            <span className="mx-2 text-gray-400">→</span>
            {t.in?.logo ? <img src={t.in.logo} alt="" className="h-5 w-5 object-contain" /> : null}
            <span className="text-sm">{t.in?.name || 'Unknown'}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
