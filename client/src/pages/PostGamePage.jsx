// client/src/pages/PostGamePage.jsx
import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, useAnimate } from 'framer-motion';
import confetti from 'canvas-confetti';
import {
  User as UserIcon,
  Trophy,
  Clock,
  Target,
  Lightbulb,
  ArrowLeft,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../supabase/client';
import { getRandomPlayer, API_BASE } from '../api';

export default function PostGamePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { didWin, player, stats, filters, isDaily } = location.state || {};
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [gamesLeft, setGamesLeft] = useState(null);

  // LLM-only fact
  const [aiGeneratedFact, setAiGeneratedFact] = useState('');

  // Gate the entire page until fact is ready (no "generating..." on screen)
  const [pageReady, setPageReady] = useState(false);

  const [scope, animate] = useAnimate();

  useEffect(() => {
    if (didWin) {
      confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
    }
  }, [didWin]);

  // ✅ Run the shake animation ONLY after the card is mounted (pageReady) and the ref exists
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
      } catch (e) {
        // no-op: guard against StrictMode double-invoke during dev
        console.debug('shake animation skipped:', e?.message);
      }
    };
    sequence();
  }, [didWin, pageReady, animate, scope]);

  useEffect(() => {
    async function fetchGamesLeft() {
      if (!user?.id) return;
      try {
        const today = new Date().toISOString().split('T')[0];
        const { data, error } = await supabase
          .from('games_records')
          .select('id')
          .eq('user_id', user.id)
          .eq('is_daily_challenge', false)
          .gte('created_at', `${today}T00:00:00`)
          .lte('created_at', `${today}T23:59:59`);
        if (error) throw error;
        const remaining = 10 - (data?.length || 0);
        setGamesLeft(Math.max(0, remaining));
      } catch (e) {
        console.error('Error fetching games left:', e);
        setGamesLeft(null);
      }
    }
    fetchGamesLeft();
  }, [user?.id]);

  function CountdownToTomorrow() {
    const [timeLeft, setTimeLeft] = useState(getTimeLeft());
    useEffect(() => {
      const interval = setInterval(() => setTimeLeft(getTimeLeft()), 1000);
      return () => clearInterval(interval);
    }, []);
    function getTimeLeft() {
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setHours(24, 0, 0, 0);
      const diff = tomorrow - now;
      const hours = Math.floor(diff / 1000 / 60 / 60);
      const minutes = Math.floor((diff / 1000 / 60) % 60);
      const seconds = Math.floor((diff / 1000) % 60);
      return `${hours}h ${minutes}m ${seconds}s`;
    }
    return <span>{timeLeft}</span>;
  }

  useEffect(() => {
    const getAIFact = async () => {
      if (!player) {
        navigate('/game', { replace: true });
        return;
      }
      try {
        const transfers = player.transfers || player.transferHistory || [];
        const response = await fetch(`${API_BASE}/ai/generate-player-fact`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            player: {
              name: player.name || player.player_name || 'Unknown Player',
              nationality: player.nationality || player.player_nationality || '',
              position: player.position || player.player_position || '',
              age: player.age || player.player_age || ''
            },
            transferHistory: transfers
          }),
        });

        if (!response.ok) throw new Error(`Failed to generate fact: ${response.status}`);
        const data = await response.json();
        const fact = (data && typeof data.fact === 'string') ? data.fact.trim() : '';
        setAiGeneratedFact(fact);
      } catch (error) {
        console.error('Error fetching AI fact:', error);
        setAiGeneratedFact(''); // show nothing if it fails
      } finally {
        // Only show the page now
        setPageReady(true);
      }
    };
    getAIFact();
  }, [player, navigate]);

  const playAgainWithSameFilters = async () => {
    if (loading || gamesLeft <= 0) return;
    setLoading(true);
    try {
      const gameData = await getRandomPlayer(
        {
          leagues: filters?.leagues || [],
          seasons: filters?.seasons || [],
          minAppearances: filters?.minAppearances || 0
        },
        user?.id
      );
      navigate('/live', {
        state: {
          ...gameData,
          isDaily: false,
          filters: filters || {},
          fromPostGame: true,
        },
        replace: true
      });
    } catch (error) {
      console.error('Error starting new game:', error);
      alert('Failed to start a new game. Please try again.');
      setLoading(false);
    }
  };

  if (!player) return null;
  if (!pageReady) return null; // hold the whole page until the fact is ready

  const pdata = player || {};
  const photo = pdata.player_photo || pdata.photo || null;

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-green-50 to-transparent">
      <div className="fixed inset-0 -z-10 bg-gradient-to-b from-green-50 to-transparent" />
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-4xl mx-auto px-4 py-8">
        <div ref={scope} className={`bg-white rounded-xl shadow-sm p-6 ${!didWin ? 'border-red-200' : ''}`}>
          {/* Banner */}
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
            {photo ? (
              <img src={photo} alt={player.name} className="w-32 h-32 object-cover rounded-lg" />
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

          {/* AI Fact (render only if LLM returned something) */}
          {aiGeneratedFact && (
            <div className="bg-blue-50 rounded-lg p-4 mb-6">
              <h3 className="font-semibold mb-2 flex items-center text-blue-700">
                <Lightbulb className="h-5 w-5 mr-1 text-blue-600" />
                Did you know…
              </h3>
              <p className="italic text-gray-700">{aiGeneratedFact}</p>
              <p className="mt-2 text-xs text-gray-500">
                And now you'll have to google that to see if I made it all up...
              </p>
            </div>
          )}

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <StatCard label="Points Earned" value={stats?.pointsEarned} icon={<Trophy className="h-5 w-5 text-yellow-600" />} />
            <StatCard label="Time Taken" value={`${stats?.timeSec}s`} icon={<Clock className="h-5 w-5 text-blue-600" />} />
            <StatCard label="Guesses Used" value={stats?.guessesUsed} icon={<Target className="h-5 w-5 text-green-600" />} />
            <StatCard label="Hints Used" value={Object.values(stats?.usedHints || {}).filter(Boolean).length} icon={<Lightbulb className="h-5 w-5 text-amber-600" />} />
          </div>

          {/* Actions */}
          {!isDaily && (
            <div className="flex gap-3">
              <button onClick={() => navigate('/game')} className="flex-none bg-gray-100 hover:bg-gray-200 p-2 rounded-lg" title="Back to Game Setup">
                <ArrowLeft className="h-5 w-5 text-gray-700" />
              </button>
              <button
                onClick={playAgainWithSameFilters}
                disabled={loading || gamesLeft <= 0}
                className={`flex-1 ${gamesLeft <= 0 ? 'bg-gray-300 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700'} text-white py-2 rounded-lg font-medium flex items-center justify-center`}
              >
                {loading ? 'Loading...' : <>Play Again (Same Filters) <span className="ml-1 text-sm">{gamesLeft !== null ? `(${gamesLeft} left)` : ''}</span></>}
              </button>
            </div>
          )}
          {isDaily && (
            <div className="mt-6 text-center">
              <div className="text-xl font-bold text-yellow-700 mb-2">This was today's Daily Challenge!</div>
              <div className="text-lg text-gray-700">
                {didWin
                  ? <>Congratulations! You won the daily challenge and earned <span className="font-bold text-green-700">10,000 points</span>!<br /><span className="text-green-700 font-semibold">You also earned an extra game for today!</span></>
                  : 'Better luck next time! Try again tomorrow for another chance at 10,000 points.'}
              </div>
              <div className="mt-2 text-sm text-gray-500">Next daily challenge in <CountdownToTomorrow /></div>
              <button onClick={() => navigate('/game')} className="mt-4 bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded-lg">Back to Game Setup</button>
            </div>
          )}
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
