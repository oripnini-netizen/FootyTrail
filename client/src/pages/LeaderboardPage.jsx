// client/src/pages/LeaderboardPage.jsx
import React, { useState } from 'react';

const tabs = ['All Time', 'Month', 'Week', 'Today'];
const metrics = ['Total Points', 'Points/Game'];

export default function LeaderboardPage() {
  const [tab, setTab] = useState('All Time');
  const [metric, setMetric] = useState('Total Points');

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-20">
      <h1 className="mb-6 flex items-center gap-2 text-4xl font-extrabold text-green-900">
        <span role="img" aria-label="trophy">🏆</span> Leaderboard
      </h1>

      <div className="mb-6 rounded-xl border border-yellow-300 bg-yellow-50">
        <div className="border-b border-yellow-200 px-5 py-3 text-lg font-semibold text-amber-800">
          ☆ Today’s Daily Challenge Champions
        </div>
        <div className="flex h-36 items-center justify-center text-gray-500">
          No champions yet today! Be the first to conquer today’s daily challenge.
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {tabs.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1.5 text-sm ${tab === t ? 'bg-black text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
          >
            {t}
          </button>
        ))}
        <div className="mx-2 h-5 w-px bg-gray-300" />
        {metrics.map(m => (
          <button
            key={m}
            onClick={() => setMetric(m)}
            className={`rounded-md px-3 py-1.5 text-sm ${metric === m ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 ring-1 ring-gray-300 hover:bg-gray-50'}`}
          >
            {m}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        {/* Placeholder rows */}
        <div className="text-gray-500">Leaderboard data will appear here.</div>
      </div>
    </div>
  );
}
