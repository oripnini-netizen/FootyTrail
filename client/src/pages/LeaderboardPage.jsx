// client/src/pages/LeaderboardPage.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabase';
import { Trophy, Clock, Award, X } from 'lucide-react';

// order tabs as Today, Week, Month, All Time
const tabs = ['Today', 'Week', 'Month', 'All Time'];
const metrics = ['Total Points', 'Points/Game'];

const PERIOD_TO_START = (now, tab) => {
  if (tab === 'Today') return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (tab === 'Week') { const d = new Date(now); d.setDate(now.getDate() - 7); return d; }
  if (tab === 'Month') { const d = new Date(now); d.setMonth(now.getMonth() - 1); return d; }
  return null;
};

// Helper to check if a timestamp is "today" (local time)
const isToday = (isoOrDate) => {
  const d = new Date(isoOrDate);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
};

export default function LeaderboardPage() {
  // default tab is Today
  const [tab, setTab] = useState('Today');
  const [metric, setMetric] = useState('Total Points');
  const [loading, setLoading] = useState(true);
  const [dailyChampions, setDailyChampions] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);

  // Modal state
  const [openUser, setOpenUser] = useState(null); // { userId, name, profilePhoto, memberSince }
  const [userGames, setUserGames] = useState([]);
  const [userStats, setUserStats] = useState({ totalPoints: 0, games: 0, avgTime: 0, successRate: 0 });
  const [loadingUser, setLoadingUser] = useState(false);

  useEffect(() => {
    async function fetchAll() {
      try {
        setLoading(true);

        // ===== Daily Champions (today only) =====
        const todayStart = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
        const { data: daily } = await supabase
          .from('games_records')
          .select('id, user_id, points_earned, player_name, created_at, won')
          .eq('is_daily_challenge', true)
          .gte('created_at', todayStart)
          .eq('won', true)
          .order('points_earned', { ascending: false })
          .limit(10);

        if (daily?.length) {
          const ids = Array.from(new Set(daily.map(d => d.user_id)));
          const { data: dailyUsers } = await supabase
            .from('users')
            .select('id, full_name, profile_photo_url, created_at')
            .in('id', ids);

          const map = {};
          (dailyUsers || []).forEach(u => { map[u.id] = u; });
          setDailyChampions(
            daily.map(d => ({
              ...d,
              user: map[d.user_id] || { full_name: 'Unknown Player' },
            }))
          );
        } else {
          setDailyChampions([]);
        }

        // ===== Leaderboard (fast path) =====
        const now = new Date();
        const start = PERIOD_TO_START(now, tab);
        const startIso = start ? start.toISOString() : null;

        // 1) Pull all relevant non-elimination games (single query)
        // IMPORTANT: treat NULL as non-elimination too.
        let grQuery = supabase
          .from('games_records')
          .select('user_id, points_earned, time_taken_seconds, won, created_at')
          .or('is_elimination_game.is.null,is_elimination_game.eq.false');

        if (startIso) grQuery = grQuery.gte('created_at', startIso);
        const { data: gamesRows, error: gamesErr } = await grQuery;
        if (gamesErr) throw gamesErr;

        // Aggregate base (non-elimination) stats by user
        const baseByUser = new Map();
        for (const g of (gamesRows || [])) {
          const uid = g.user_id;
          let acc = baseByUser.get(uid);
          if (!acc) {
            acc = { gamesCount: 0, basePoints: 0, totalTime: 0, wins: 0 };
            baseByUser.set(uid, acc);
          }
          acc.gamesCount += 1;
          acc.basePoints += (g.points_earned || 0);
          acc.totalTime += (g.time_taken_seconds || 0);
          if (g.won) acc.wins += 1;
        }

        // 2) Pull all relevant point_transactions (single query)
        let txQuery = supabase
          .from('point_transactions')
          .select('user_id, amount, created_at');
        if (startIso) txQuery = txQuery.gte('created_at', startIso);
        const { data: txRows, error: txErr } = await txQuery;
        if (txErr) throw txErr;

        // Aggregate transactions by user
        const txByUser = new Map();
        for (const t of (txRows || [])) {
          const uid = t.user_id;
          const amt = Number(t.amount || 0);
          txByUser.set(uid, (txByUser.get(uid) || 0) + amt);
        }

        // Union of user IDs that appear in games or transactions
        const involvedUserIds = Array.from(new Set([
          ...baseByUser.keys(),
          ...txByUser.keys(),
        ]));

        // 3) Fetch only these users for display (single query)
        let users = [];
        if (involvedUserIds.length > 0) {
          const { data: usersData, error: usersErr } = await supabase
            .from('users')
            .select('id, full_name, profile_photo_url, created_at')
            .in('id', involvedUserIds);
          if (usersErr) throw usersErr;
          users = usersData || [];
        }

        const userMap = new Map(users.map(u => [u.id, u]));

        // Build rows (and hide users with 0 games in timeframe)
        const rows = [];
        for (const uid of involvedUserIds) {
          const u = userMap.get(uid);
          const base = baseByUser.get(uid) || { gamesCount: 0, basePoints: 0, totalTime: 0, wins: 0 };
          const txSum = txByUser.get(uid) || 0;
          const totalPoints = base.basePoints + txSum;

          if (base.gamesCount === 0) continue; // keep the "no 0-games users" rule

          rows.push({
            userId: uid,
            name: u?.full_name || 'Unknown Player',
            profilePhoto: u?.profile_photo_url || '',
            memberSince: u?.created_at ? new Date(u.created_at).toLocaleDateString() : '—',
            points: totalPoints,
            gamesCount: base.gamesCount,
            avgTime: base.gamesCount ? Math.round(base.totalTime / base.gamesCount) : 0,
            successRate: base.gamesCount ? Math.round((base.wins / base.gamesCount) * 100) : 0,
            avgPoints: base.gamesCount ? Math.round(totalPoints / base.gamesCount) : totalPoints
          });
        }

        // Sort
        rows.sort((a, b) => (metric === 'Total Points' ? b.points - a.points : b.avgPoints - a.avgPoints));
        setLeaderboard(rows);
      } catch (e) {
        console.error('Error fetching leaderboard:', e);
        setLeaderboard([]);
        setDailyChampions([]);
      } finally {
        setLoading(false);
      }
    }

    fetchAll();
  }, [tab, metric]);

  const onRowClick = async (player) => {
    // player = { userId, name, profilePhoto, memberSince }
    setOpenUser(player);
    setUserGames([]);
    setUserStats({ totalPoints: 0, games: 0, avgTime: 0, successRate: 0 });
    setLoadingUser(true);
    try {
      // Recent 20 for the list — INCLUDE elimination games, but show a badge and purple title
      const { data: games } = await supabase
        .from('games_records')
        .select('id, player_name, won, points_earned, time_taken_seconds, guesses_attempted, hints_used, created_at, is_daily_challenge, is_elimination_game')
        .eq('user_id', player.userId)
        .order('created_at', { ascending: false })
        .limit(20);

      setUserGames(games || []);

      // ALL games for stats — EXCLUDE elimination games for base portion (NULL treated as non-elim)
      const { data: allGames } = await supabase
        .from('games_records')
        .select('won, points_earned, time_taken_seconds')
        .eq('user_id', player.userId)
        .or('is_elimination_game.is.null,is_elimination_game.eq.false');

      const total = allGames?.length || 0;
      const basePts = (allGames || []).reduce((s, g) => s + (g.points_earned || 0), 0);
      const wins = (allGames || []).filter(g => g.won).length;
      const time = (allGames || []).reduce((s, g) => s + (g.time_taken_seconds || 0), 0);

      // Lifetime net from point_transactions
      const { data: txs } = await supabase
        .from('point_transactions')
        .select('amount')
        .eq('user_id', player.userId);

      const txPts = (txs || []).reduce((s, t) => s + Number(t.amount || 0), 0);

      setUserStats({
        totalPoints: basePts + txPts,
        games: total,
        avgTime: total ? Math.round(time / total) : 0,
        successRate: total ? Math.round((wins / total) * 100) : 0
      });
    } finally {
      setLoadingUser(false);
    }
  };

  const getMedalComponent = (index) => {
    if (index === 0) return <Trophy className="h-6 w-6 text-yellow-500" />;
    if (index === 1) return <Award className="h-6 w-6 text-gray-400" />;
    if (index === 2) return <Award className="h-6 w-6 text-amber-700" />;
    return <div className="flex h-6 w-6 items-center justify-center font-bold text-gray-500">{index + 1}</div>;
  };

  const formatTime = (seconds) => {
    const s = Number(seconds) || 0;
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-green-50 to-transparent">
      <div className="fixed inset-0 -z-10 bg-gradient-to-b from-green-50 to-transparent" />
      <div className="mx-auto max-w-6xl px-4 pb-16 pt-12">
        {/* Daily Champions */}
        <div className="mb-6 rounded-xl border border-yellow-300 bg-yellow-50">
          <div className="border-b border-yellow-200 px-5 py-3 text-center text-lg font-semibold text-amber-800">
            <span className="mr-2">☆</span> Today's Daily Challenge Champions
          </div>
          {loading ? (
            <div className="flex h-36 items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-t-2 border-yellow-600"></div>
            </div>
          ) : dailyChampions.length === 0 ? (
            <div className="flex h-36 flex-col items-center justify-center text-gray-500">
              <div className="mb-2 text-5xl">⭐</div>
              <div className="text-lg font-medium">No champions yet today!</div>
              <div className="text-gray-500">Be the first to conquer today's daily challenge.</div>
            </div>
          ) : (
            <div className="p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                {dailyChampions.map((c, index) => {
                  const userObj = {
                    userId: c.user_id,
                    name: c.user?.full_name || 'Unknown Player',
                    profilePhoto: c.user?.profile_photo_url || '',
                    memberSince: c.user?.created_at ? new Date(c.user.created_at).toLocaleDateString() : '—',
                  };
                  return (
                    <div key={c.id} className="flex items-center gap-3 rounded-lg border border-yellow-200 bg-white p-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-yellow-100 text-lg font-bold text-yellow-800">
                        {index + 1}
                      </div>
                      <div className="flex items-center gap-3">
                        {c.user?.profile_photo_url ? (
                          <img src={c.user.profile_photo_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                        ) : (
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100 text-green-800">
                            {(c.user?.full_name || '?')[0]}
                          </div>
                        )}
                        <div>
                          <button
                            type="button"
                            className="font-medium text-left text-gray-900 hover:underline"
                            title="View recent games"
                            onClick={() => onRowClick(userObj)}
                          >
                            {c.user?.full_name || 'Unknown Player'}
                          </button>
                          <div className="text-sm text-yellow-700">{c.points_earned} points</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Filters */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {tabs.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-md px-3 py-1.5 text-sm ${tab === t ? 'bg-green-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            >
              {t}
            </button>
          ))}
          <div className="mx-2 h-5 w-px bg-gray-300" />
          {metrics.map(m => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              className={`rounded-md px-3 py-1.5 text-sm ${metric === m ? 'bg-gray-800 text-white' : 'bg-white text-gray-700 ring-1 ring-gray-300 hover:bg-gray-50'}`}
            >
              {m}
            </button>
          ))}
        </div>

        {/* Rankings */}
        <div>
          <h2 className="heading-3 mb-4 text-green-800">Overall Rankings</h2>
          {loading ? (
            <div className="flex h-36 items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-green-600"></div>
            </div>
          ) : leaderboard.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white p-6 text-center shadow-sm">
              <div className="text-gray-500">No leaderboard data available for the selected time period.</div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full rounded-xl border-collapse border border-gray-200 bg-white shadow-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50 text-left text-sm font-medium text-gray-600">
                    <th className="px-4 py-3">#</th>
                    <th className="px-4 py-3">Player</th>
                    <th className="px-4 py-3 text-right">{metric === 'Total Points' ? 'Points' : 'Pts/Game'}</th>
                    <th className="px-4 py-3 text-center">Games</th>
                    <th className="hidden px-4 py-3 text-center sm:table-cell">Avg Time</th>
                    <th className="hidden px-4 py-3 text-right sm:table-cell">Success %</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((p, index) => (
                    <tr
                      key={p.userId}
                      className="cursor-pointer border-b border-gray-200 hover:bg-gray-50"
                      onClick={() => onRowClick(p)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center">{getMedalComponent(index)}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {p.profilePhoto ? (
                            <img src={p.profilePhoto} alt="" className="h-8 w-8 rounded-full object-cover" />
                          ) : (
                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100 text-green-800">
                              {p.name?.[0] || '?'}
                            </div>
                          )}
                          <div>
                            {/* Name is explicitly clickable; now black */}
                            <button
                              type="button"
                              title="View recent games"
                              onClick={(e) => { e.stopPropagation(); onRowClick(p); }}
                              className="font-medium text-left text-gray-900 hover:underline focus:outline-none"
                            >
                              {p.name}
                            </button>
                            <div className="text-xs text-gray-500">Member since {p.memberSince}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="font-bold text-green-600">
                          {metric === 'Total Points' ? Number(p.points || 0).toLocaleString() : p.avgPoints}
                        </div>
                        <div className="text-xs text-gray-500">points</div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="font-medium">{p.gamesCount}</div>
                        <div className="text-xs text-gray-500">Games</div>
                      </td>
                      <td className="hidden px-4 py-3 text-center sm:table-cell">
                        <div className="flex items-center justify-center gap-1">
                          <Clock className="h-3 w-3 text-gray-500" />
                          <span>{formatTime(p.avgTime)}</span>
                        </div>
                        <div className="text-xs text-gray-500">Avg Time</div>
                      </td>
                      <td className="hidden px-4 py-3 text-right sm:table-cell">
                        <div className="font-medium">{p.successRate}%</div>
                        <div className="text-xs text-gray-500">Success</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* User modal */}
      {openUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="flex items-center gap-3">
                {openUser.profilePhoto ? (
                  <img src={openUser.profilePhoto} alt="" className="h-10 w-10 rounded-full object-cover" />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100 text-green-800">
                    {openUser.name?.[0] || '?'}
                  </div>
                )}
                <div>
                  <div className="font-semibold">{openUser.name}</div>
                  <div className="text-xs text-gray-500">Member since {openUser.memberSince || '—'}</div>
                </div>
              </div>
              <button className="rounded-full p-1 hover:bg-gray-100" onClick={() => setOpenUser(null)}>
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Stats are ALL-TIME, EXCLUDING elimination games for base points + PLUS transactions */}
            <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4">
              <div className="rounded border p-3 text-center">
                <div className="text-xs text-gray-500">Total Points</div>
                <div className="text-lg font-semibold text-green-700">{userStats.totalPoints?.toLocaleString?.() || 0}</div>
              </div>
              <div className="rounded border p-3 text-center">
                <div className="text-xs text-gray-500">Games</div>
                <div className="text-lg font-semibold">{userStats.games || 0}</div>
              </div>
              <div className="rounded border p-3 text-center">
                <div className="text-xs text-gray-500">Avg Time</div>
                <div className="text-lg font-semibold">{userStats.avgTime || 0}s</div>
              </div>
              <div className="rounded border p-3 text-center">
                <div className="text-xs text-gray-500">Success</div>
                <div className="text-lg font-semibold">{userStats.successRate || 0}%</div>
              </div>
            </div>

            {/* Recent 20 list */}
            <div className="max-h-96 overflow-y-auto px-4 pb-4">
              {loadingUser ? (
                <div className="flex h-32 items-center justify-center">
                  <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-green-700" />
                </div>
              ) : userGames.length === 0 ? (
                <div className="p-6 text-center text-gray-500">No recent games.</div>
              ) : (
                <div className="space-y-3">
                  {userGames.map(g => {
                    // mask today's daily challenge player name
                    const maskedName =
                      g.is_daily_challenge && isToday(g.created_at)
                        ? 'Daily Challenge Player'
                        : (g.player_name || 'Unknown Player');

                    return (
                      <div key={g.id} className="rounded border p-3">
                        <div className="flex items-center justify-between">
                          <div>
                            {/* add purple title when elimination (daily remains yellow) */}
                            <div className={`font-medium ${
                              g.is_daily_challenge
                                ? 'font-semibold text-yellow-600'
                                : (g.is_elimination_game ? 'font-semibold text-purple-600' : '')
                            }`}>
                              {maskedName}
                            </div>
                            <div className="text-xs text-gray-500">{new Date(g.created_at).toLocaleString()}</div>
                          </div>
                          <div className="text-right">
                            <div className={`font-semibold ${g.won ? 'text-green-600' : 'text-red-600'}`}>
                              {g.won ? `+${g.points_earned}` : '0'} pts
                            </div>
                            <div className="text-xs text-gray-500">
                              {g.guesses_attempted} {g.guesses_attempted === 1 ? 'guess' : 'guesses'}
                              {g.is_daily_challenge && ' • Daily'}
                              {g.is_elimination_game && ' • Elimination'}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
