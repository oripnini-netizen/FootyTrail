// client/src/pages/PostGamePage.jsx
import React, { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import confetti from 'canvas-confetti';
import {
  User as UserIcon,
  Trophy,
  Clock,
  Target,
  Lightbulb,
  Info as InfoIcon
} from 'lucide-react';

export default function PostGamePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { didWin, player, stats } = location.state || {};

  // Trigger confetti on win
  useEffect(() => {
    if (didWin) {
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 }
      });
    }
  }, [didWin]);

  // Redirect to game page if no state
  if (!location.state) {
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
      <div className="bg-white rounded-xl shadow-sm p-6">
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

        {/* Fun Fact */}
        <div className="bg-blue-50 rounded-lg p-4 mb-6">
          <h3 className="font-semibold mb-2 flex items-center gap-2">
            <InfoIcon className="h-5 w-5 text-blue-600" />
            Fun Fact
          </h3>
          <p className="text-gray-700">{player?.funFact || buildFallbackFact(player)}</p>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button
            onClick={() => navigate('/game')}
            className="flex-1 bg-gray-100 hover:bg-gray-200 py-2 rounded-lg font-medium"
          >
            New Game
          </button>
          <button
            onClick={() => navigate('/game', {
              state: { replayWithPreviousFilters: true }
            })}
            className="flex-1 bg-green-600 hover:bg-green-700 text-white py-2 rounded-lg font-medium"
          >
            Play Again (Same Filters)
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

function buildFallbackFact(p) {
  const parts = [];
  if (p.player_name) parts.push(p.player_name);
  if (p.player_nationality) parts.push(`from ${p.player_nationality}`);
  const base = parts.join(' ');
  const hops = (p.transferHistory || []).length;
  return `${base || 'This player'} has been involved in ${hops} transfers recorded in our dataset.`;
}
