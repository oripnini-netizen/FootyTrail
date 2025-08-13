// client/src/pages/AboutPage.jsx
import React from 'react';
import { Trophy, Clock, Filter, Target, Users, Shield, Award, Lightbulb } from 'lucide-react';

export default function AboutPage() {
  return (
    <div className="bg-gradient-to-b from-green-50 to-transparent min-h-screen pb-16">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-4xl font-bold text-center text-green-900 mb-1">
          About <span className="text-yellow-500">FootyTrail</span>
        </h1>
        <p className="text-center text-lg text-green-700 mb-10">
          Test your football knowledge in the ultimate transfer history guessing game. Can you
          identify the world's greatest players or complete unknowns from their career moves alone?
        </p>

        {/* How It Works */}
        <section className="mb-8 bg-white rounded-xl shadow-md transition-all hover:shadow-lg p-6">
          <h2 className="flex items-center gap-2 text-2xl font-semibold text-green-800 mb-4">
            <Trophy className="h-6 w-6 text-yellow-500" /> How It Works
          </h2>
          <p className="mb-5 text-gray-700">
            FootyTrail challenges you to identify professional football players using only their transfer history.
            Each day, you get <strong>10 regular attempts</strong> and <strong>one Daily Challenge attempt</strong>.
          </p>

          <div className="rounded-lg border border-green-100 bg-green-50 p-4 text-gray-700 mb-6">
            <p className="mb-2 font-medium">Game Modes:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>Daily Challenge:</strong> A single player is chosen for everyone. Guess correctly to earn a bonus 11th regular game attempt!
              </li>
              <li>
                <strong>Regular Game:</strong> Customize the difficulty with advanced filters and play up to 10 games per day.
              </li>
              <li>
                <strong>Private Leagues:</strong> Create leagues with friends where your daily FootyTrail scores determine match winners!
              </li>
              <li><strong>Rules:</strong> 3 minutes & 3 guesses per player in all modes.</li>
            </ul>
          </div>
          
          <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-gray-700">
            <p className="mb-2 font-medium">Advanced Filtering:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong>League Selection:</strong> Choose from top professional leagues worldwide</li>
              <li><strong>Season Filter:</strong> Focus on specific seasons to narrow your player pool</li>
              <li><strong>Minimum Appearances:</strong> Set a threshold for player appearances across your selected leagues and seasons</li>
              <li><strong>Profile Defaults:</strong> Save your preferred filters to automatically apply them to new games</li>
            </ul>
          </div>
        </section>

        {/* Pro Tips */}
        <section className="mb-8 bg-white rounded-xl shadow-md transition-all hover:shadow-lg p-6">
          <h2 className="flex items-center gap-2 text-2xl font-semibold text-green-800 mb-4">
            <Lightbulb className="h-6 w-6 text-yellow-500" /> Pro Tips
          </h2>

          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h3 className="font-semibold text-green-700 mb-2">Maximize Points:</h3>
              <ul className="list-disc pl-6 space-y-2 text-gray-700">
                <li>Include more leagues for larger player pools and potential points.</li>
                <li>Set higher minimum appearance requirements to increase base points.</li>
                <li>Focus on specific seasons to narrow the field strategically.</li>
                <li>Use hints strategically - player image hint cuts points most.</li>
                <li>Guess quickly to minimize time penalties.</li>
                <li>Win the Daily Challenge for an extra game attempt.</li>
              </ul>
            </div>

            <div>
              <h3 className="font-semibold text-green-700 mb-2">League Strategy:</h3>
              <ul className="list-disc pl-6 space-y-2 text-gray-700">
                <li>Consistency beats high single-game scores in leagues.</li>
                <li>Your total daily points from all games count toward matches.</li>
                <li>Balance risk-taking with guaranteed points.</li>
                <li>Consider your opponent's usual performance level.</li>
                <li>Every game contributes to your league match score.</li>
              </ul>
            </div>
          </div>
        </section>

        {/* Scoring System */}
        <section className="mb-8 bg-white rounded-xl shadow-md transition-all hover:shadow-lg p-6">
          <h2 className="flex items-center gap-2 text-2xl font-semibold text-green-800 mb-4">
            <Award className="h-6 w-6 text-yellow-500" /> Scoring System
          </h2>
          
          <p className="mb-4 text-gray-700">
            Your points are calculated based on multiple factors. In regular games, your base points depend on the size of your filtered player pool (5 points per player). Daily challenges start with a fixed 10,000 points. Your final score is then modified by various factors:
          </p>

          <div className="overflow-hidden">
            <table className="w-full mb-5">
              <tbody>
                <tr>
                  <td className="py-2 pr-4 text-gray-700">Base points (5 pts per player in filtered pool)</td>
                  <td className="py-2"><span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm">Variable</span></td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 text-gray-700">Daily Challenge base points</td>
                  <td className="py-2"><span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm">10,000</span></td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 text-gray-700">Age hint</td>
                  <td className="py-2"><span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm">×0.9</span></td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 text-gray-700">Citizenship hint</td>
                  <td className="py-2"><span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm">×0.85</span></td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 text-gray-700">Position hint</td>
                  <td className="py-2"><span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm">×0.75</span></td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 text-gray-700">Player image hint</td>
                  <td className="py-2"><span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm">×0.5</span></td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 text-gray-700">Wrong guess penalty</td>
                  <td className="py-2"><span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm">-2 per wrong guess</span></td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 text-gray-700">Time penalty</td>
                  <td className="py-2"><span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm">×0.95 every 5 seconds</span></td>
                </tr>
              </tbody>
            </table>

            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4 text-sm text-gray-700">
              <p>
                <strong>Example:</strong> 500 players in pool (2,500 base points) → use hints → wrong guesses and time penalties → final score could range from 0 to 2,500 points depending on your performance.
              </p>
            </div>
          </div>
        </section>

        {/* Private Leagues */}
        <section className="mb-8 bg-white rounded-xl shadow-md transition-all hover:shadow-lg p-6">
          <h2 className="flex items-center gap-2 text-2xl font-semibold text-green-800 mb-4">
            <Users className="h-6 w-6 text-blue-500" /> Private Leagues
          </h2>
          
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-5 text-gray-700">
            <ul className="list-disc pl-6 space-y-2">
              <li>Create leagues with 2-20 friends using their FootyTrail email addresses</li>
              <li>Each match day, your total daily points are compared against your opponent's</li>
              <li>Higher daily score wins the match (3 points), draws earn 1 point each</li>
              <li>Your regular game performance and global rankings are completely unaffected</li>
              <li>Leagues run automatically with fixtures generated for the entire season</li>
            </ul>
          </div>
        </section>

        {/* Game Features Grid */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="bg-white rounded-xl shadow-md transition-all hover:shadow-lg p-5 flex flex-col items-center text-center">
            <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center mb-3">
              <Target className="h-8 w-8 text-green-600" />
            </div>
            <h3 className="font-semibold text-lg text-green-800 mb-2">Daily Challenge</h3>
            <p className="text-gray-600">One chance per day to guess a global player and climb the daily leaderboard.</p>
          </div>

          <div className="bg-white rounded-xl shadow-md transition-all hover:shadow-lg p-5 flex flex-col items-center text-center">
            <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center mb-3">
              <Shield className="h-8 w-8 text-green-600" />
            </div>
            <h3 className="font-semibold text-lg text-green-800 mb-2">Regular Game</h3>
            <p className="text-gray-600">10 chances per day to prove your football knowledge with custom filters.</p>
          </div>

          <div className="bg-white rounded-xl shadow-md transition-all hover:shadow-lg p-5 flex flex-col items-center text-center">
            <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center mb-3">
              <Users className="h-8 w-8 text-green-600" />
            </div>
            <h3 className="font-semibold text-lg text-green-800 mb-2">Private Leagues</h3>
            <p className="text-gray-600">Create leagues with friends where daily scores determine match winners.</p>
          </div>

          <div className="bg-white rounded-xl shadow-md transition-all hover:shadow-lg p-5 flex flex-col items-center text-center">
            <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center mb-3">
              <Clock className="h-8 w-8 text-green-600" />
            </div>
            <h3 className="font-semibold text-lg text-green-800 mb-2">Time Pressure</h3>
            <p className="text-gray-600">3 minutes to guess each player with points decreasing over time.</p>
          </div>

          <div className="bg-white rounded-xl shadow-md transition-all hover:shadow-lg p-5 flex flex-col items-center text-center">
            <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center mb-3">
              <Filter className="h-8 w-8 text-green-600" />
            </div>
            <h3 className="font-semibold text-lg text-green-800 mb-2">Advanced Filters</h3>
            <p className="text-gray-600">Filter by leagues, seasons, and minimum player appearances for precise difficulty control.</p>
          </div>

          <div className="bg-white rounded-xl shadow-md transition-all hover:shadow-lg p-5 flex flex-col items-center text-center">
            <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center mb-3">
              <Lightbulb className="h-8 w-8 text-green-600" />
            </div>
            <h3 className="font-semibold text-lg text-green-800 mb-2">Strategic Hints</h3>
            <p className="text-gray-600">Use age, citizenship, position, and image hints wisely.</p>
          </div>
        </section>
      </div>
    </div>
  );
}
