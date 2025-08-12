// client/src/pages/AboutPage.jsx
import React from 'react';

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 pb-16 pt-20">
      <h1 className="mb-2 text-center text-4xl font-extrabold">
        About <span className="text-yellow-600">FootyTrail</span>
      </h1>
      <p className="mb-10 text-center text-lg text-gray-700">
        Test your football knowledge in the ultimate transfer history guessing game.
        Can you identify the world's greatest players from their career moves alone?
      </p>

      <section className="mb-6 rounded-xl border border-yellow-200 bg-yellow-50 p-5">
        <h2 className="mb-3 flex items-center gap-2 text-2xl font-semibold text-green-800">
          <span role="img" aria-label="trophy">🏆</span> How It Works
        </h2>
        <p className="mb-4 text-gray-700">
          FootyTrail challenges you to identify professional football players using only their transfer history.
          Each day, you get <strong>10 regular attempts</strong> and <strong>one Daily Challenge attempt</strong>.
        </p>

        <div className="rounded-lg border border-green-100 bg-green-50 p-4 text-sm text-gray-700">
          <p className="mb-1"><strong>Game Modes:</strong></p>
          <ul className="list-disc pl-6">
            <li className="mb-1">
              <strong>Daily Challenge:</strong> A single player is chosen for everyone.
              Guess correctly to earn a bonus 10,000 points.
            </li>
            <li className="mb-1">
              <strong>Regular Game:</strong> Customize difficulty with advanced filters and play up to 10 games per day.
            </li>
            <li className="mb-1">
              <strong>Private Leagues:</strong> Create leagues with friends where daily scores determine match winners (coming soon).
            </li>
            <li><strong>Rules:</strong> 3 minutes & 3 guesses per player in all modes.</li>
          </ul>
        </div>
      </section>

      <section className="rounded-xl border border-blue-200 bg-blue-50 p-5">
        <h3 className="mb-3 text-xl font-semibold text-blue-900">Advanced Filtering:</h3>
        <ul className="list-disc space-y-2 pl-6 text-gray-700">
          <li><strong>League Selection:</strong> Choose from top professional leagues worldwide.</li>
          <li><strong>Season Filter:</strong> Narrow your pool by specific seasons.</li>
          <li><strong>Minimum Appearances:</strong> Set a threshold for player appearances across selected leagues & seasons.</li>
          <li><strong>Profile Defaults:</strong> Save preferred filters to auto-apply to new games.</li>
        </ul>
      </section>
    </div>
  );
}
