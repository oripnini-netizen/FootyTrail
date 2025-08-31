// client/src/pages/AboutPage.jsx
import React from 'react';
import { Trophy, Clock, Filter, Target, Users, Shield, Award, Lightbulb, Axe } from 'lucide-react';

export default function AboutPage() {
  return (
    <div className="relative min-h-screen bg-gradient-to-b from-green-50 to-transparent pb-16">
      {/* fixed background so the area under the navbar is green too */}
      <div className="fixed inset-0 -z-10 bg-gradient-to-b from-green-50 to-transparent" />

      <div className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-4xl font-bold text-center text-green-900 mb-1">
          About <span className="text-yellow-500">FootyTrail</span>
        </h1>
        <p className="text-center text-lg text-green-700 mb-8">
          Test your football knowledge in the ultimate transfer-history guessing game. Can you
          identify the stars (and hidden gems) from their career moves alone?
        </p>

        {/* === Feature Cards moved to the TOP === */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
          <div className="bg-white rounded-xl shadow-md transition-all hover:shadow-lg p-5 flex flex-col items-center text-center">
            <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center mb-3">
              <Target className="h-8 w-8 text-green-600" />
            </div>
            <h3 className="font-semibold text-lg text-green-800 mb-2">Daily Challenge</h3>
            <p className="text-gray-600">One global player per day. Guess right to earn a bonus game.</p>
          </div>

          <div className="bg-white rounded-xl shadow-md transition-all hover:shadow-lg p-5 flex flex-col items-center text-center">
            <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center mb-3">
              <Shield className="h-8 w-8 text-green-600" />
            </div>
            <h3 className="font-semibold text-lg text-green-800 mb-2">Regular Game</h3>
            <p className="text-gray-600">Play up to 10 games a day with fully customizable difficulty.</p>
          </div>

          <div className="bg-white rounded-xl shadow-md transition-all hover:shadow-lg p-5 flex flex-col items-center text-center">
            <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center mb-3">
              <Users className="h-8 w-8 text-green-600" />
            </div>
            <h3 className="font-semibold text-lg text-green-800 mb-2">Private Leagues</h3>
            <p className="text-gray-600">Challenge friends; daily totals decide matchday wins.</p>
          </div>

          {/* NEW: Elimination Challenges card */}
          <div className="bg-white rounded-xl shadow-md transition-all hover:shadow-lg p-5 flex flex-col items-center text-center">
            <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center mb-3">
              <Axe className="h-8 w-8 text-green-600" />
            </div>
            <h3 className="font-semibold text-lg text-green-800 mb-2">Elimination Challenges</h3>
            <p className="text-gray-600">Survive round by round with friends—lowest totals get knocked out on elimination rounds.</p>
          </div>

          <div className="bg-white rounded-xl shadow-md transition-all hover:shadow-lg p-5 flex flex-col items-center text-center">
            <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center mb-3">
              <Clock className="h-8 w-8 text-green-600" />
            </div>
            <h3 className="font-semibold text-lg text-green-800 mb-2">Time Pressure</h3>
            <p className="text-gray-600">3 minutes and 3 guesses—points decay over time.</p>
          </div>

          <div className="bg-white rounded-xl shadow-md transition-all hover:shadow-lg p-5 flex flex-col items-center text-center">
            <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center mb-3">
              <Filter className="h-8 w-8 text-green-600" />
            </div>
            <h3 className="font-semibold text-lg text-green-800 mb-2">Advanced Filters</h3>
            <p className="text-gray-600">Pick competitions, seasons, and a minimum market value to tune difficulty.</p>
          </div>

          <div className="bg-white rounded-xl shadow-md transition-all hover:shadow-lg p-5 flex flex-col items-center text-center">
            <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center mb-3">
              <Lightbulb className="h-8 w-8 text-green-600" />
            </div>
            <h3 className="font-semibold text-lg text-green-800 mb-2">Strategic Hints</h3>
            <p className="text-gray-600">Age, citizenship, position & image hints—use wisely to preserve points.</p>
          </div>
        </section>

        {/* How It Works */}
        <section className="mb-8 bg-white rounded-xl shadow-md transition-all hover:shadow-lg p-6">
          <h2 className="flex items-center gap-2 text-2xl font-semibold text-green-800 mb-4">
            <Trophy className="h-6 w-6 text-yellow-500" /> How It Works
          </h2>
          <p className="mb-5 text-gray-700">
            FootyTrail challenges you to identify professional football players using only their transfer history.
            Each day, you get <strong>10 regular attempts</strong> and <strong>one Daily Challenge attempt</strong>.
            Win the Daily Challenge to unlock a bonus 11th game.
          </p>

          <div className="rounded-lg border border-green-100 bg-green-50 p-4 text-gray-700 mb-6">
            <p className="mb-2 font-medium">Game Modes:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>Daily Challenge:</strong> Everyone faces the same player. Guess correctly to earn a bonus game!
              </li>
              <li>
                <strong>Regular Game:</strong> Customize difficulty with <em>competitions</em>, <em>seasons</em>, and a
                <em> minimum market value</em> filter.
              </li>
              <li><strong>Rules:</strong> 3 minutes & 3 guesses per player in all modes.</li>
              {/* NEW: Elimination Challenges mode reference */}
              <li>
                <strong>Elimination Challenges:</strong> Create survival-style tournaments with friends. Scores accumulate across rounds and the lowest totals are eliminated on designated elimination rounds.
              </li>
            </ul>
          </div>
          
          <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-gray-700">
            <p className="mb-2 font-medium">Advanced Filtering:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong>Competitions:</strong> Choose from professional competitions worldwide.</li>
              <li><strong>Seasons:</strong> Focus your search on specific seasons.</li>
              <li>
                <strong>Minimum Market Value (€):</strong> Only include players whose market value (max across the selected
                seasons) meets or exceeds your threshold.
              </li>
              <li><strong>Profile Defaults:</strong> Save your preferred filters to auto-apply for new games.</li>
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
                <li>Include more competitions for larger player pools and higher potential points.</li>
                <li>Set a lower <strong>minimum market value</strong> for tougher pools and more points.</li>
                <li>Use hints sparingly—first letter hint costs the most.</li>
                <li>Guess quickly to minimize time penalties.</li>
                <li>Win the Daily Challenge to earn a bonus regular game.</li>
              </ul>
            </div>

            <div>
              <h3 className="font-semibold text-green-700 mb-2">League Strategy:</h3>
              <ul className="list-disc pl-6 space-y-2 text-gray-700">
                <li>Consistency beats spikes; your daily total decides league match results.</li>
                <li>Balance safer picks with occasional high-risk plays when chasing points.</li>
                <li>Watch opponents’ typical scores to plan your approach.</li>
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
            In regular games, your base points depend on the size of your filtered player pool
            (<strong>5 points per player</strong>). Daily challenges start at a fixed <strong>10,000 points</strong>.
            Your final score is then modified by hints, wrong guesses, and time.
          </p>

          <div className="overflow-hidden">
            <table className="w-full mb-5">
              <tbody>
                <tr>
                  <td className="py-2 pr-4 text-gray-700">Base points (5 pts per player in filtered pool)</td>
                  <td className="py-2">
                    <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm">Variable</span>
                  </td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 text-gray-700">Daily Challenge base points</td>
                  <td className="py-2">
                    <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm">10,000</span>
                  </td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 text-gray-700">Age hint</td>
                  <td className="py-2"><span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm">×0.90</span></td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 text-gray-700">Nationality hint</td>
                  <td className="py-2"><span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm">×0.90</span></td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 text-gray-700">Position hint</td>
                  <td className="py-2"><span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm">×0.80</span></td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 text-gray-700">Player image hint</td>
                  <td className="py-2"><span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm">×0.50</span></td>
                </tr>
                 <tr>
                  <td className="py-2 pr-4 text-gray-700">First letter hint</td>
                  <td className="py-2"><span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm">×0.25</span></td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 text-gray-700">Wrong guess penalty</td>
                  <td className="py-2">
                    <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm">
                      Current points are halved per wrong guess
                    </span>
                  </td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 text-gray-700">Time penalty</td>
                  <td className="py-2">
                    <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm">
                      Points decay over time
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>

            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4 text-sm text-gray-700">
              <p>
                <strong>Example:</strong> 500 players in pool → 2,500 base points. Hints, wrong guesses (halving), and time
                will adjust your final score—play smart to maximize it!
              </p>
            </div>
          </div>
        </section>

        {/* Private Leagues (details) */}
        <section className="mb-8 bg-white rounded-xl shadow-md transition-all hover:shadow-lg p-6">
          <h2 className="flex items-center gap-2 text-2xl font-semibold text-green-800 mb-4">
            <Users className="h-6 w-6 text-blue-500" /> Private Leagues
          </h2>
          
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-5 text-gray-700">
            <ul className="list-disc pl-6 space-y-2">
              <li>Create leagues with 2–20 friends - a bot will be added for odd number of participants.</li>
              <li>Your total daily points are compared head-to-head with your opponent’s.</li>
              <li>Win = 3 points, Draw = 1 point each. League tables update live through the day.</li>
              <li>League play is independent of global rankings.</li>
              <li>Fixtures are generated automatically for the whole schedule.</li>
            </ul>
          </div>
        </section>

        {/* NEW: Contact Us */}
        <section className="mb-8 bg-white rounded-xl shadow-md transition-all hover:shadow-lg p-6">
          <h2 className="text-2xl font-semibold text-green-800 mb-3">Contact & Support</h2>
          <p className="text-gray-700">
            Found a bug, want to request additional leagues, have feedback, or ran into any other issue?
            Drop us a line at{' '}
            <a href="mailto:footy.trail.app@gmail.com" className="text-green-700 underline">
              footy.trail.app@gmail.com
            </a>.
          </p>
        </section>

        {/* NEW: Site Policy & Legal */}
        <section className="mb-8 bg-white rounded-xl shadow-md transition-all hover:shadow-lg p-6">
          <h2 className="text-2xl font-semibold text-green-800 mb-3">Site Policy & Legal</h2>
          <div className="space-y-3 text-gray-700">
            <p>
              <strong>Unofficial Fan Project:</strong> FootyTrail is a fan-made game and is not affiliated with, endorsed by,
              or sponsored by any football league, club, player, or governing body. Logos, names, and other marks may be
              the property of their respective owners and are used for identification purposes only.
            </p>
            <p>
              <strong>Data Accuracy:</strong> We strive to keep all information up to date, but we can’t guarantee accuracy,
              completeness, or availability at all times. The app is provided on an “as is” and “as available” basis, without
              warranties of any kind.
            </p>
            <p>
              <strong>Fair Use & Takedowns:</strong> If you believe any content infringes your rights, please contact us at{' '}
              <a href="mailto:footy.trail.app@gmail.com" className="text-green-700 underline">
                footy.trail.app@gmail.com
              </a>{' '}
              with details, and we’ll review and address it promptly.
            </p>
            <p>
              <strong>Privacy:</strong> We collect only the information necessary to operate the game (e.g., account and gameplay
              data). We don’t sell personal information. For any privacy questions or data deletion requests, email{' '}
              <a href="mailto:footy.trail.app@gmail.com" className="text-green-700 underline">
                footy.trail.app@gmail.com
              </a>.
            </p>
            <p>
              <strong>No Gambling:</strong> FootyTrail is for entertainment purposes only and does not support wagering or betting.
            </p>
            <p>
              <strong>Age Requirement:</strong> By using FootyTrail, you confirm that you are at least 13 years old (or the age of
              digital consent in your jurisdiction).
            </p>
            <p>
              <strong>Limitation of Liability:</strong> To the fullest extent permitted by law, FootyTrail and its creators are not
              liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of the app.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
