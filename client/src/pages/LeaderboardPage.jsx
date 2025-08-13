// client/src/pages/LeaderboardPage.jsx
import React, { useState, useEffect } from 'react';
import { supabase } from '../supabase/client';
import { Trophy, Clock, Target, Award } from 'lucide-react';

const tabs = ['All Time', 'Month', 'Week', 'Today'];
const metrics = ['Total Points', 'Points/Game'];

export default function LeaderboardPage() {
  const [tab, setTab] = useState('All Time');
  const [metric, setMetric] = useState('Total Points');
  const [loading, setLoading] = useState(true);
  const [dailyChampions, setDailyChampions] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);

  // Fetch leaderboard data based on the selected tab and metric
  useEffect(() => {
    async function fetchLeaderboard() {
      try {
        setLoading(true);
        console.log('Fetching leaderboard data for tab:', tab);
        
        // Create date filters based on selected tab
        const now = new Date();
        let startDate = null;
        
        if (tab === 'Today') {
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        } else if (tab === 'Week') {
          startDate = new Date(now);
          startDate.setDate(now.getDate() - 7);
        } else if (tab === 'Month') {
          startDate = new Date(now);
          startDate.setMonth(now.getMonth() - 1);
        }
        
        // Format date for Supabase query
        const startDateIso = startDate ? startDate.toISOString() : null;
        console.log('Using start date:', startDateIso);
        
        // Fetch daily challenge champions for today
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        const { data: dailyData, error: dailyError } = await supabase
          .from('games_records')
          .select('*, users(full_name, profile_photo_url)') // Correct join syntax
          .eq('is_daily_challenge', true)
          .gte('played_at', todayStart)
          .eq('won', true)
          .order('points_earned', { ascending: false })
          .limit(10);
          
        if (dailyError) {
          console.error('Error fetching daily champions:', dailyError);
        } else {
          console.log('Daily champions data:', dailyData);
          setDailyChampions(dailyData || []);
        }
        
        // Fetch user data with aggregations
        let query = supabase.rpc('get_leaderboard');
        
        // Apply date filter if needed
        if (startDateIso) {
          query = query.gte('played_at', startDateIso);
        }
        
        // Sort by appropriate column
        const sortColumn = metric === 'Total Points' ? 'total_points' : 'avg_points';
        query = query.order(sortColumn, { ascending: false });
        
        const { data, error } = await query;
        
        if (error) {
          console.error('Leaderboard query error:', error);
          
          // Fallback approach if the RPC isn't available
          console.log('Trying fallback approach...');
          
          // First get distinct users with their game stats
          const { data: userData, error: userError } = await supabase
            .from('games_records')
            .select(`
              user_id,
              users(full_name, profile_photo_url, member_since)
            `)
            .eq('user_id', supabase.auth.user()?.id) // Just for testing with current user
            
          if (userError) throw userError;
          
          // For each user, get their stats
          const enrichedUsers = [];
          
          for (const user of userData) {
            // Get stats for this user
            let statsQuery = supabase
              .from('games_records')
              .select('*')
              .eq('user_id', user.user_id);
              
            if (startDateIso) {
              statsQuery = statsQuery.gte('played_at', startDateIso);
            }
            
            const { data: stats, error: statsError } = await statsQuery;
            
            if (statsError) continue;
            
            // Calculate metrics
            const points = stats.reduce((sum, game) => sum + (game.points_earned || 0), 0);
            const gamesCount = stats.length;
            const wins = stats.filter(game => game.won).length;
            const totalTime = stats.reduce((sum, game) => sum + (game.time_taken_seconds || 0), 0);
            
            enrichedUsers.push({
              userId: user.user_id,
              name: user.users?.full_name || 'Unknown Player',
              profilePhoto: user.users?.profile_photo_url,
              memberSince: user.users?.member_since ? new Date(user.users.member_since).toLocaleDateString() : 'Unknown',
              points: points,
              gamesCount: gamesCount,
              avgTime: gamesCount > 0 ? Math.round(totalTime / gamesCount) : 0,
              successRate: gamesCount > 0 ? Math.round((wins / gamesCount) * 100) : 0,
              avgPoints: gamesCount > 0 ? Math.round(points / gamesCount) : 0
            });
          }
          
          // Sort the users
          enrichedUsers.sort((a, b) => {
            if (metric === 'Total Points') {
              return b.points - a.points;
            } else {
              return b.avgPoints - a.avgPoints;
            }
          });
          
          setLeaderboard(enrichedUsers);
        } else {
          console.log('Leaderboard data received:', data);
          
          // Transform the data to match our UI needs
          const transformedData = (data || []).map(row => ({
            userId: row.user_id,
            name: row.full_name || 'Unknown Player',
            profilePhoto: row.profile_photo_url,
            memberSince: row.member_since ? new Date(row.member_since).toLocaleDateString() : 'Unknown',
            points: row.total_points || 0,
            gamesCount: row.games_count || 0, 
            avgTime: row.avg_time || 0,
            successRate: row.success_rate || 0,
            avgPoints: row.avg_points || 0
          }));
          
          setLeaderboard(transformedData);
        }
      } catch (error) {
        console.error('Error fetching leaderboard data:', error);
        // Set empty leaderboard to avoid showing loading forever
        setLeaderboard([]);
      } finally {
        setLoading(false);
      }
    }
    
    fetchLeaderboard();
  }, [tab, metric]);

  // Helper function to determine medal color/type
  const getMedalComponent = (index) => {
    if (index === 0) return <Trophy className="h-6 w-6 text-yellow-500" />;
    if (index === 1) return <Award className="h-6 w-6 text-gray-400" />;
    if (index === 2) return <Award className="h-6 w-6 text-amber-700" />;
    return <div className="flex h-6 w-6 items-center justify-center font-bold text-gray-500">{index + 1}</div>;
  };
  
  // Format seconds to MM:SS
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-12">
      <h1 className="heading-1 mb-6 flex items-center gap-2 text-green-900">
        <Trophy className="h-8 w-8 text-yellow-500" /> Leaderboard
      </h1>

      {/* Daily Challenge Champions Section */}
      <div className="mb-6 rounded-xl border border-yellow-300 bg-yellow-50">
        {/* Center the title */}
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
              {dailyChampions.map((champion, index) => (
                <div key={champion.id} className="flex items-center gap-3 rounded-lg border border-yellow-200 bg-white p-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-yellow-100 text-lg font-bold text-yellow-800">
                    {index + 1}
                  </div>
                  <div>
                    <div className="font-medium">{champion.users?.full_name || 'Unknown Player'}</div>
                    <div className="text-sm text-yellow-700">{champion.points_earned} points</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Time Period & Metric Filters */}
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

      {/* Overall Rankings */}
      <div>
        <h2 className="heading-3 mb-4 text-green-800">Overall Rankings</h2>
        
        {loading ? (
          <div className="flex h-36 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-t-2 border-green-600"></div>
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
                  <th className="px-4 py-3 text-right">
                    {metric === 'Total Points' ? 'Points' : 'Pts/Game'}
                  </th>
                  <th className="px-4 py-3 text-center">Games</th>
                  <th className="hidden px-4 py-3 text-center sm:table-cell">Avg Time</th>
                  <th className="hidden px-4 py-3 text-right sm:table-cell">Success %</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((player, index) => (
                  <tr key={player.userId} className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center">
                        {getMedalComponent(index)}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {player.profilePhoto ? (
                          <img 
                            src={player.profilePhoto} 
                            alt="" 
                            className="h-8 w-8 rounded-full object-cover"
                            onError={(e) => {
                              e.target.onerror = null;
                              e.target.src = 'https://via.placeholder.com/40?text=' + player.name[0];
                            }}
                          />
                        ) : (
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100 text-green-800">
                            {player.name[0]}
                          </div>
                        )}
                        <div>
                          <div className="font-medium">{player.name}</div>
                          <div className="text-xs text-gray-500">Member since {player.memberSince}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="font-bold text-green-600">
                        {metric === 'Total Points' ? player.points.toLocaleString() : player.avgPoints}
                      </div>
                      <div className="text-xs text-gray-500">points</div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="font-medium">{player.gamesCount}</div>
                      <div className="text-xs text-gray-500">Games</div>
                    </td>
                    <td className="hidden px-4 py-3 text-center sm:table-cell">
                      <div className="flex items-center justify-center gap-1">
                        <Clock className="h-3 w-3 text-gray-500" />
                        <span>{formatTime(player.avgTime)}</span>
                      </div>
                      <div className="text-xs text-gray-500">Avg Time</div>
                    </td>
                    <td className="hidden px-4 py-3 text-right sm:table-cell">
                      <div className="font-medium">{player.successRate}%</div>
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
  );
}
