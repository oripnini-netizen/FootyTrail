import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
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

export default function LiveGamePage() {
  const location = useLocation();
  const navigate = useNavigate();

  // All your existing hooks...
  const [currentGuess, setCurrentGuess] = useState('');
  const [guessesAttempted, setGuessesAttempted] = useState(0);
  const [hintsUsed, setHintsUsed] = useState(0);
  const [gameCompleted, setGameCompleted] = useState(false);
  const [gameWon, setGameWon] = useState(false);
  const [showingHints, setShowingHints] = useState({});
  const [timeStarted, setTimeStarted] = useState(Date.now());
  const inputRef = useRef(null);
  const confettiCanvasRef = useRef(null);

  // Game state
  const INITIAL_TIME = 180;
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
  const timerRef = useRef(null);

  // Add state for transfer history loading
  const [transferHistory, setTransferHistory] = useState([]);
  const [loadingTransfers, setLoadingTransfers] = useState(true);

  // Extract game data
  const game = location.state || null;
  const filters = location.state?.filters || { potentialPoints: 0 };
  const isDaily = !!location.state?.isDaily;

  console.log('🏃 LiveGamePage loaded with state:', location.state);
  console.log('🏆 Starting with potential points:', filters?.potentialPoints);
  console.log('🔍 Game data debug:', {
  directPotentialPoints: game?.potentialPoints, // Should be 6800
  filtersPotentialPoints: filters?.potentialPoints, // Should also be 6800
  filtersObject: filters,
  entireGameData: game
});

  // Add useEffect to fetch transfer history
  useEffect(() => {
    const fetchTransfers = async () => {
      if (!game?.id) return;
      
      try {
        setLoadingTransfers(true);
        console.log('🔄 Fetching transfers for player:', game.id);
        
        // Import the fetchTransfers function
        const { fetchTransfers: getTransfers } = await import('../api');
        const transfers = await getTransfers(game.id);
        
        console.log('📋 Received transfers:', transfers);
        setTransferHistory(transfers || []);
      } catch (error) {
        console.error('❌ Error fetching transfers:', error);
        setTransferHistory([]); // Fallback to empty array
      } finally {
        setLoadingTransfers(false);
      }
    };

    fetchTransfers();
  }, [game?.id]);

  // Multipliers map
  const multipliers = {
    age: 0.95,
    nationality: 0.9,
    position: 0.8,
    partialImage: 0.5,
    firstLetter: 0.25,
  };

  // Live points calculation
  const points = useMemo(() => {
    // Get potential points from either location
    const potentialPoints = Number(game?.potentialPoints || filters?.potentialPoints || 0);
    
    console.log('🏆 Points calculation starting with:', potentialPoints);
    
    // Start with full potential points
    let p = potentialPoints;
    
    // Apply hint multipliers
    Object.keys(usedHints).forEach((k) => {
      if (usedHints[k]) p = Math.floor(p * multipliers[k]);
    });
    
    // Apply a very light time decay: 0.99 every second that has elapsed
    const timeElapsed = INITIAL_TIME - timeSec; // Time that has passed
    const timeDecay = Math.pow(0.99, timeElapsed); // 0.99^timeElapsed
    p = Math.max(0, Math.floor(p * timeDecay));
    
    return p;
  }, [game?.potentialPoints, filters?.potentialPoints, usedHints, timeSec]);

  // Format time as MM:SS
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Timer effect - count down
  useEffect(() => {
    // Only start timer if we have valid game data
    if (!game?.id) return;
    
    console.log('🕐 Starting timer...');
    
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
    
    const interval = setInterval(() => {
      setTimeSec((prevTime) => {
        if (prevTime <= 1) {
          console.log('⏰ Time up!');
          clearInterval(interval);
          handleTimeUp();
          return 0;
        }
        return prevTime - 1;
      });
    }, 1000);

    // Store interval reference
    timerRef.current = interval;

    // Cleanup function
    return () => {
      console.log('🛑 Cleaning up timer...');
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [game?.id]); // Only depend on game.id, not the entire game object

  // Suggestions (debounced)
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

  // Validation effect
  useEffect(() => {
    if (!game || !game.id || !game.name) {
      console.log('🏃 Invalid game data, redirecting to /game');
      // Use setTimeout to prevent navigation during render
      setTimeout(() => {
        navigate('/game');
      }, 0);
      return;
    }
    console.log('🏃 Game data is valid, starting game...');
  }, []); // Empty dependency array - only run once on mount

  // Early return if no valid game data
  if (!game || !game.id) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-600 mb-4">
            No Game Data Found
          </h1>
          <p className="mb-4">Redirecting to game setup...</p>
        </div>
      </div>
    );
  }

  // Game functions
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
            funFact: game.funFact
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

  const saveGameRecord = async (didWin) => {
    try {
      console.log('Saving game record...');
      const gameRecord = {
        player_id: parseInt(game.id, 10),
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

  // Hint handlers
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
          {loadingTransfers ? (
            <div className="text-center text-gray-500">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
              Loading transfers...
            </div>
          ) : (
            <TransfersList transfers={transferHistory} />
          )
          }
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
