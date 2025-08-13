// client/src/pages/PostGamePage.jsx
import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import confetti from 'canvas-confetti';
import {
  User as UserIcon,
  Trophy,
  Clock,
  Target,
  Lightbulb,
  Info as InfoIcon,
  ArrowLeft,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../supabase/client';

export default function PostGamePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { didWin, player, stats, filters } = location.state || {};
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [gamesLeft, setGamesLeft] = useState(null);
  const [aiGeneratedFact, setAiGeneratedFact] = useState('');
  const [factLoading, setFactLoading] = useState(false);

  // Confetti effect for wins
  useEffect(() => {
    if (didWin) {
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
      });
    }
  }, [didWin]);

  // Fetch remaining games count - moved outside any conditional blocks
  useEffect(() => {
    async function fetchGamesLeft() {
      if (!user?.id) return;

      try {
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format

        const { data, error } = await supabase
          .from('games_records')
          .select('id')
          .eq('user_id', user.id)
          .eq('is_daily_challenge', false)
          .gte('created_at', `${today}T00:00:00`)
          .lte('created_at', `${today}T23:59:59`);

        if (error) throw error;

        // Standard daily quota is 10 games
        const remaining = 10 - (data?.length || 0);
        setGamesLeft(Math.max(0, remaining));
      } catch (error) {
        console.error('Error fetching games left:', error);
        // Default to unknown if there's an error
        setGamesLeft('?');
      }
    }

    fetchGamesLeft();
  }, [user?.id]);

  // Get AI-generated fact about the player
  useEffect(() => {
    const getAIFact = async () => {
      if (!player) return;

      setFactLoading(true);
      try {
        console.log("Fetching AI fact for player:", player.name);
        
        // Prepare transfer history data
        const transfers = player.transfers || player.transferHistory || [];
        console.log("Transfer data:", transfers);

        const response = await fetch('/api/ai/generate-player-fact', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            player: {
              name: player.name || player.player_name || "Unknown Player",
              nationality: player.nationality || player.player_nationality,
              position: player.position || player.player_position,
              age: player.age || player.player_age
            },
            transferHistory: transfers
          }),
        });

        console.log("API response status:", response.status);
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error("API error response:", errorText);
          throw new Error(`Failed to generate fact: ${response.status} ${errorText}`);
        }

        const data = await response.json();
        console.log("API response data:", data);
        
        if (data.fact && typeof data.fact === 'string' && data.fact.trim().length > 0) {
          setAiGeneratedFact(data.fact);
        } else {
          console.error("Received invalid fact format from API:", data);
          throw new Error('Received empty fact from API');
        }
      } catch (error) {
        console.error('Error fetching AI fact:', error);
        // Fall back to static fact if AI generation fails
        setAiGeneratedFact(buildFallbackFact(player));
      } finally {
        setFactLoading(false);
      }
    };

    getAIFact();
  }, [player]);

  // Function to play again with same filters
  const playAgainWithSameFilters = async () => {
    if (loading || gamesLeft <= 0) return;

    setLoading(true);
    try {
      // Navigate to LiveGamePage with the existing filters
      navigate('/live-game', {
        state: {
          filters: filters || {},
          fromPostGame: true, // Flag to indicate this is a direct play again
        },
      });
    } catch (error) {
      console.error('Error starting new game:', error);
      setLoading(false);
    }
  };

  // If we have no data, redirect back to the game page
  if (!player) {
    navigate('/game');
    return null;
  }

  const pdata = player || {};
  const photo = pdata.player_photo || pdata.photo || null;
  const fact = player.player_fact || buildFallbackFact(pdata);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="max-w-4xl mx-auto px-4 py-8"
    >
      <div
        className={`bg-white rounded-xl shadow-sm p-6 ${
          !didWin ? 'border-red-200' : ''
        }`}
      >
        {/* Game Result Banner */}
        {didWin ? (
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-6 text-center">
            <h2 className="text-xl font-bold text-green-700">
              <Trophy className="inline-block w-6 h-6 mr-1 mb-1" />
              Great job! You guessed it!
            </h2>
          </div>
        ) : (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-6 text-center">
            <h2 className="text-xl font-bold text-red-700">
              <Target className="inline-block w-6 h-6 mr-1 mb-1" />
              Not quite! The player was {player?.name}
            </h2>
          </div>
        )}

        {/* Player Info */}
        <div className="flex gap-6 mb-6">
          {player?.photo ? (
            <img
              src={player.photo}
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

        {/* Game Stats */}
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
            value={Object.values(stats?.usedHints || {}).filter(Boolean).length}
            icon={<Lightbulb className="h-5 w-5 text-amber-600" />}
          />
        </div>

        {/* Fun Fact / AI Insight */}
        <div className="bg-blue-50 rounded-lg p-4 mb-6">
          <h3 className="font-semibold mb-2 flex items-center text-blue-700">
            <Lightbulb className="h-5 w-5 mr-1 text-blue-600" />
            Did you know that
          </h3>
          {factLoading ? (
            <div className="flex items-center justify-center py-2">
              <div className="animate-pulse text-blue-500">Loading interesting fact...</div>
            </div>
          ) : (
            <>
              <p className="italic text-gray-700">
                {aiGeneratedFact || buildFallbackFact(player)}
              </p>
              <p className="text-xs text-gray-500 mt-2">
                And now you'll have to google it to see if I made it all up...
              </p>
            </>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button
            onClick={() => navigate('/game')}
            className="flex-none bg-gray-100 hover:bg-gray-200 p-2 rounded-lg"
            title="Back to Game Setup"
          >
            <ArrowLeft className="h-5 w-5 text-gray-700" />
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
              <span className="flex items-center">
                <svg
                  className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  ></circle>
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  ></path>
                </svg>
                Loading...
              </span>
            ) : (
              <>
                Play Again (Same Filters)
                <span className="ml-1 text-sm">
                  {gamesLeft !== null ? `(${gamesLeft} left)` : ''}
                </span>
              </>
            )}
          </button>
        </div>
      </div>
    </motion.div>
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

// Update the buildFallbackFact function
function buildFallbackFact(p) {
  if (!p) return "This player has a fascinating career trajectory with multiple unexpected transfers.";
  
  const name = p.name || p.player_name || "This player";
  const nationality = p.nationality || p.player_nationality;
  const position = p.position || p.player_position;
  
  const facts = [
    `${name} is known for having exceptional technical abilities that often surprised teammates in training.`,
    `${name} almost signed for a completely different club before a last-minute change of heart.`,
    `${name} once scored a remarkable goal from nearly the halfway line in a friendly match that wasn't televised.`,
    `Before becoming a professional, ${name} was actually considering a completely different career path.`
  ];
  
  if (nationality) {
    facts.push(`Despite representing ${nationality}, ${name} was eligible to play for another country through family heritage.`);
  }
  
  if (position) {
    facts.push(`Though known as a ${position}, ${name} actually started playing in a completely different position during youth career.`);
  }
  
  // Return a random fact from our array
  return facts[Math.floor(Math.random() * facts.length)];
}
