// client/src/pages/ProfilePage.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase, uploadAvatar } from '../supabase/client';
import {
  ImagePlus,
  LogOut,
  Filter,
  ChevronDown,
  ChevronUp,
  Star,
  Trash2,
  UsersRound,
  Trophy,
  Clock,
  TrendingUp
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import SelectedChips from '../components/SelectedChips';
import { getLeagues, getSeasons } from '../api';

function classNames(...s) {
  return s.filter(Boolean).join(' ');
}

export default function ProfilePage() {
  const { user, refresh, signOut } = useAuth();
  const navigate = useNavigate();

  const [localStats, setLocalStats] = useState({});
  const [recentGames, setRecentGames] = useState([]);
  const [fullName, setFullName] = useState(
    user?.user_metadata?.full_name ||
    user?.full_name ||
    ''
  );
  const [avatar, setAvatar] = useState(
    user?.user_metadata?.avatar_url ||
    user?.user_metadata?.profile_photo_url ||
    user?.profile_photo_url ||
    ''
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [loadingFilters, setLoadingFilters] = useState(true);
  const [filtersCollapsed, setFiltersCollapsed] = useState(true);
  const [groupedLeagues, setGroupedLeagues] = useState({});
  const [allSeasons, setAllSeasons] = useState([]);
  const [defaultLeagueIds, setDefaultLeagueIds] = useState(user?.default_leagues || []);
  const [defaultSeasons, setDefaultSeasons] = useState(user?.default_seasons || []);
  const [defaultMinApps, setDefaultMinApps] = useState(user?.default_min_appearances || 0);
  const [expandedCountries, setExpandedCountries] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const leagueIdToLabel = useMemo(() => {
    const mapping = {};
    Object.entries(groupedLeagues).forEach(([country, leagues]) => {
      leagues.forEach(league => {
        mapping[league.league_id] = `${country} - ${league.league_name}`;
      });
    });
    const top10 = [
      { id: 39, country: "England", name: "Premier League" },
      { id: 140, country: "Spain", name: "La Liga" },
      { id: 78, country: "Germany", name: "Bundesliga" },
      { id: 135, country: "Italy", name: "Serie A" },
      { id: 61, country: "France", name: "Ligue 1" },
      { id: 88, country: "Netherlands", name: "Eredivisie" },
      { id: 94, country: "Portugal", name: "Primeira Liga" },
      { id: 71, country: "Brazil", name: "Brasileirão" },
      { id: 128, country: "Argentina", name: "Primera División" },
      { id: 253, country: "USA", name: "MLS" }
    ];
    top10.forEach(league => {
      mapping[league.id] = `${league.country} - ${league.name}`;
    });
    return mapping;
  }, [groupedLeagues]);

  const handleTop10Leagues = () => {
    const top10Ids = [39, 140, 78, 135, 61, 88, 94, 71, 128, 253];
    setDefaultLeagueIds(prev => {
      const uniqueIds = new Set([...prev, ...top10Ids]);
      return Array.from(uniqueIds);
    });
  };

  useEffect(() => {
    if (user) {
      setFullName(user.user_metadata?.full_name || user.full_name || '');
      setAvatar(
        user.user_metadata?.avatar_url ||
        user.user_metadata?.profile_photo_url ||
        user.profile_photo_url ||
        ''
      );
    }
  }, [user]);

  // Fetch recent games (20) + ALL games (for stats)
  useEffect(() => {
    const fetchGames = async () => {
      if (!user?.id) return;
      try {
        setLoading(true);

        // Recent 20 for the list
        const { data: games, error: recentErr } = await supabase
          .from('games_records')
          .select('id, player_name, won, points_earned, time_taken_seconds, guesses_attempted, hints_used, created_at, is_daily_challenge')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(20);

        if (recentErr) throw recentErr;
        setRecentGames(games || []);

        // ALL games for stats (no limit)
        const { data: allGames, error: allErr } = await supabase
          .from('games_records')
          .select('won, points_earned, time_taken_seconds')
          .eq('user_id', user.id);

        if (allErr) throw allErr;

        const totalGames = allGames?.length || 0;
        const wonGames = (allGames || []).filter(g => g.won).length;
        const totalPoints = (allGames || []).reduce((sum, g) => sum + (g.points_earned || 0), 0);
        const totalTime = (allGames || []).reduce((sum, g) => sum + (g.time_taken_seconds || 0), 0);

        setLocalStats({
          games_played: totalGames,
          total_points: totalPoints,
          avg_time: totalGames > 0 ? Math.round(totalTime / totalGames) : 0,
          success_rate: totalGames > 0 ? Math.round((wonGames / totalGames) * 100) : 0
        });
      } catch (e) {
        console.error('Error fetching profile stats:', e);
        // Fall back to zeros on error
        setLocalStats({
          games_played: 0,
          total_points: 0,
          avg_time: 0,
          success_rate: 0
        });
        setRecentGames([]);
      } finally {
        setLoading(false);
      }
    };
    fetchGames();
  }, [user?.id]);

  useEffect(() => {
    if (user) {
      setDefaultLeagueIds(user.default_leagues || []);
      setDefaultSeasons(user.default_seasons || []);
      setDefaultMinApps(user.default_min_appearances || 0);
    }
  }, [user]);

  // Load filters (for the "Default Filters" section)
  useEffect(() => {
    let cancelled = false;

    async function loadFilters() {
      try {
        setLoadingFilters(true);
        const leaguesRes = await getLeagues();
        if (!cancelled) {
          setGroupedLeagues(leaguesRes.groupedByCountry || {});
          const initialCollapse = {};
          Object.keys(leaguesRes.groupedByCountry || {}).forEach((c) => (initialCollapse[c] = false));
          setExpandedCountries(initialCollapse);
        }
        const seasonsRes = await getSeasons();
        if (!cancelled) setAllSeasons(seasonsRes.seasons || []);
      } catch (error) {
        console.error('Error loading filters:', error);
      } finally {
        if (!cancelled) setLoadingFilters(false);
      }
    }

    loadFilters();
    return () => { cancelled = true; };
  }, []);

  const handleSignOut = async () => {
    try {
      setLoading(true);
      await signOut();
      navigate('/login');
    } catch (e) {
      console.error('Error signing out:', e);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleNameUpdate = async (e) => {
    e.preventDefault();
    try {
      setError(null);
      setLoading(true);
      const currentMetadata = user?.user_metadata || {};
      const { error: authError } = await supabase.auth.updateUser({
        data: { ...currentMetadata, full_name: fullName }
      });
      if (authError) throw authError;
      const { error: dbError } = await supabase
        .from('users')
        .update({ full_name: fullName })
        .eq('id', user.id);
      if (dbError) throw dbError;
      await refresh();
    } catch (e) {
      console.error('Error updating name:', e);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setError(null);
      setLoading(true);

      const publicUrl = await uploadAvatar(file);
      const { error: authError } = await supabase.auth.updateUser({
        data: { avatar_url: publicUrl, profile_photo_url: publicUrl }
      });
      if (authError) throw authError;

      const { error: updateError } = await supabase
        .from('users')
        .update({ profile_photo_url: publicUrl })
        .eq('id', user.id);
      if (updateError) throw updateError;

      setAvatar(publicUrl);
      await refresh();
    } catch (e) {
      console.error('Error:', e);
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) {
      const hasLeaguesChanged = JSON.stringify(defaultLeagueIds) !== JSON.stringify(user.default_leagues || []);
      const hasSeasonsChanged = JSON.stringify(defaultSeasons) !== JSON.stringify(user.default_seasons || []);
      const hasMinAppsChanged = defaultMinApps !== (user.default_min_appearances || 0);
      setHasChanges(hasLeaguesChanged || hasSeasonsChanged || hasMinAppsChanged);
    }
  }, [defaultLeagueIds, defaultSeasons, defaultMinApps, user]);

  const saveDefaultFilters = async () => {
    try {
      setIsSaving(true);
      setError(null);
      const { error: updateError } = await supabase
        .from('users')
        .update({
          default_leagues: defaultLeagueIds,
          default_seasons: defaultSeasons,
          default_min_appearances: defaultMinApps
        })
        .eq('id', user.id);
      if (updateError) throw updateError;
      await refresh();
      setHasChanges(false);
    } catch (e) {
      console.error('Error saving filters:', e);
      setError(e.message);
    } finally {
      setIsSaving(false);
    }
  };

  const leaguesWithCountry = useMemo(() => {
    const enrichedLeagues = {};
    Object.entries(groupedLeagues).forEach(([country, leagues]) => {
      enrichedLeagues[country] = leagues.map(league => ({ ...league, country_name: country }));
    });
    return enrichedLeagues;
  }, [groupedLeagues]);

  const handleClearLeagues = () => setDefaultLeagueIds([]);
  const toggleCountry = (country) => setExpandedCountries(prev => ({ ...prev, [country]: !prev[country] }));
  const toggleLeague = (leagueId) =>
    setDefaultLeagueIds(prev => (prev.includes(leagueId) ? prev.filter(id => id !== leagueId) : [...prev, leagueId]));
  const handleLast5Seasons = () => setDefaultSeasons(allSeasons.slice(0, 5));
  const handleClearSeasons = () => setDefaultSeasons([]);
  const toggleSeason = (season) =>
    setDefaultSeasons(prev => (prev.includes(season) ? prev.filter(s => s !== season) : [...prev, season]));

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-green-50 to-transparent">
      {/* fixed background so area under the navbar is also greenish */}
      <div className="fixed inset-0 -z-10 bg-gradient-to-b from-green-50 to-transparent" />
      <div className="max-w-5xl mx-auto px-4 pt-8 pb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Left column - Profile Info */}
          <div className="md:col-span-1">
            <div className="bg-white rounded-xl shadow-md transition-all hover:shadow-lg p-6">
              <div className="flex flex-col items-center">
                {/* Avatar with upload */}
                <div className="relative group mb-4">
                  {avatar ? (
                    <img
                      src={avatar}
                      alt="Profile"
                      className="h-24 w-24 rounded-full object-cover border-2 border-gray-200"
                      onError={() => setAvatar('')}
                    />
                  ) : (
                    <div className="h-24 w-24 rounded-full bg-gray-200 flex items-center justify-center border-2 border-gray-200">
                      <span className="text-2xl font-bold text-gray-600">
                        {user?.email?.[0].toUpperCase()}
                      </span>
                    </div>
                  )}
                  <label className="absolute inset-0 flex items-center justify-center rounded-full cursor-pointer bg-black/0 group-hover:bg-black/40 transition-colors">
                    <input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} disabled={loading} />
                    <ImagePlus className="h-6 w-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                  </label>
                </div>

                <div className="w-full space-y-2">
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Enter your name"
                    className="w-full px-3 py-2 border rounded-md"
                  />
                  <button
                    onClick={handleNameUpdate}
                    disabled={loading}
                    className="w-full px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400"
                  >
                    Update Name
                  </button>
                  <button
                    onClick={handleSignOut}
                    disabled={loading}
                    className="w-full inline-flex items-center justify-center px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors disabled:bg-red-400"
                  >
                    <LogOut className="h-5 w-5 mr-2" />
                    {loading ? 'Signing out...' : 'Sign Out'}
                  </button>
                </div>

                {error && <div className="mt-2 text-sm text-red-600">{error}</div>}
              </div>
            </div>
          </div>

          {/* Right column - Stats and other content */}
          <div className="md:col-span-2 space-y-6">
            {/* Stats Card */}
            <div className="bg-white rounded-xl shadow-md transition-all hover:shadow-lg p-6">
              <h2 className="text-xl font-semibold mb-4">Statistics</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="border rounded-lg p-4 text-center">
                  <div className="flex justify-center mb-2 text-yellow-500">
                    <Trophy className="h-6 w-6" />
                  </div>
                  <div className="text-2xl font-semibold">{localStats.total_points || 0}</div>
                  <div className="text-sm text-gray-600">Total Points</div>
                </div>
                <div className="border rounded-lg p-4 text-center">
                  <div className="flex justify-center mb-2 text-green-500">
                    <UsersRound className="h-6 w-6" />
                  </div>
                  <div className="text-2xl font-semibold">{localStats.games_played || 0}</div>
                  <div className="text-sm text-gray-600">Games Played</div>
                </div>
                <div className="border rounded-lg p-4 text-center">
                  <div className="flex justify-center mb-2 text-blue-500">
                    <Clock className="h-6 w-6" />
                  </div>
                  <div className="text-2xl font-semibold">
                    {localStats.avg_time ? `${localStats.avg_time}s` : '0s'}
                  </div>
                  <div className="text-sm text-gray-600">Average Time</div>
                </div>
                <div className="border rounded-lg p-4 text-center">
                  <div className="flex justify-center mb-2 text-purple-500">
                    <TrendingUp className="h-6 w-6" />
                  </div>
                  <div className="text-2xl font-semibold">
                    {localStats.success_rate ? `${localStats.success_rate}%` : '0%'}
                  </div>
                  <div className="text-sm text-gray-600">Success Rate</div>
                </div>
              </div>
            </div>

            {/* Recent Games Card */}
            <div className="bg-white rounded-xl shadow-md transition-all hover:shadow-lg p-6">
              <h2 className="text-xl font-semibold mb-4">Recent Games</h2>
              <div className="h-96 overflow-y-auto pr-1">
                {loading ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-700"></div>
                  </div>
                ) : recentGames.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-gray-500">
                    <div className="mb-2">
                      <Trophy className="h-12 w-12 opacity-30" />
                    </div>
                    <p>No games played yet</p>
                    <p className="text-sm">Start playing to see your game history</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {recentGames.map((game) => (
                      <div
                        key={game.id}
                        className="border rounded-lg p-3 hover:bg-gray-50 transition-colors"
                      >
                        <div className="flex justify-between items-center">
                          <div>
                            {/* Golden name for daily challenge */}
                            <div className={`font-medium ${game.is_daily_challenge ? 'text-yellow-600 font-semibold' : ''}`}>
                              {game.player_name || "Unknown Player"}
                            </div>
                            <div className="text-sm text-gray-500">
                              {new Date(game.created_at).toLocaleDateString()}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className={`font-bold ${game.won ? 'text-green-600' : 'text-red-600'}`}>
                              {game.won ? `+${game.points_earned}` : '0'} pts
                            </div>
                            <div className="text-xs text-gray-500">
                              {game.guesses_attempted} {game.guesses_attempted === 1 ? 'guess' : 'guesses'}
                              {game.is_daily_challenge && ' • Daily Challenge'}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Default Filters Card */}
            <div className="rounded-xl shadow-md transition-all hover:shadow-lg border bg-green-50/60 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Filter className="h-5 w-5 text-green-700" />
                  <h3 className="text-lg font-semibold text-green-900">Default Filters</h3>
                </div>
                <button
                  className="text-gray-600 hover:text-gray-800"
                  onClick={() => setFiltersCollapsed(c => !c)}
                >
                  {filtersCollapsed ? <ChevronDown className="h-5 w-5" /> : <ChevronUp className="h-5 w-5" />}
                </button>
              </div>

              {!filtersCollapsed && !loadingFilters && (
                <div className="mt-4 space-y-6">
                  {/* Leagues Filter */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Star className="h-4 w-4 text-green-700" />
                        <span className="font-medium text-green-900">Leagues Filter</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleTop10Leagues}
                          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
                        >
                          <Star className="h-3 w-3 text-yellow-600" />
                          Top 10
                        </button>
                        <button
                          onClick={handleClearLeagues}
                          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
                        >
                          <Trash2 className="h-3 w-3" />
                          Clear
                        </button>
                      </div>
                    </div>

                    <SelectedChips
                      title="Chosen leagues"
                      items={defaultLeagueIds}
                      onClear={handleClearLeagues}
                      getLabel={(id) => leagueIdToLabel[id] || `Unknown League (${id})`}
                      onRemoveItem={(id) => setDefaultLeagueIds(prev => prev.filter(x => x !== id))}
                      hoverClose
                    />

                    <div className="max-h-96 overflow-y-auto pr-2">
                      {Object.entries(groupedLeagues)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([country, leagues]) => (
                          <div key={country} className="mb-2">
                            <button
                              onClick={() => toggleCountry(country)}
                              className="w-full flex items-center justify-between p-2 hover:bg-green-50 rounded"
                            >
                              <div className="flex items-center gap-2">
                                <img
                                  src={leagues[0].country_flag}
                                  alt={country}
                                  className="w-6 h-4 object-cover rounded"
                                />
                                <span>{country}</span>
                                <span className="text-xs text-gray-500">({leagues.length})</span>
                              </div>
                              {expandedCountries[country] ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </button>

                            {expandedCountries[country] && (
                              <div className="ml-8 space-y-2 mt-2">
                                {leagues.map((league) => (
                                  <label key={league.league_id} className="flex items-center gap-2 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={defaultLeagueIds.includes(league.league_id)}
                                      onChange={() => toggleLeague(league.league_id)}
                                      className="rounded"
                                    />
                                    <img src={league.logo} alt={league.league_name} className="w-5 h-5 object-contain" />
                                    <span className="text-sm">{league.league_name}</span>
                                  </label>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                    </div>
                  </div>

                  {/* Seasons Filter */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
                    <div className="md:col-span-2">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <UsersRound className="h-4 w-4 text-green-700" />
                          <span className="font-medium text-green-900">Season Filter</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={handleLast5Seasons}
                            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
                          >
                            Last 5
                          </button>
                          <button
                            onClick={handleClearSeasons}
                            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
                          >
                            <Trash2 className="h-3 w-3" />
                            Clear
                          </button>
                        </div>
                      </div>

                      <SelectedChips title="Chosen seasons" items={defaultSeasons} onClear={handleClearSeasons} />

                      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mt-2">
                        {allSeasons.map((season) => (
                          <button
                            key={season}
                            onClick={() => toggleSeason(season)}
                            className={classNames(
                              'px-2 py-1 text-sm rounded-md border',
                              defaultSeasons.includes(season)
                                ? 'bg-green-100 border-green-500 text-green-700'
                                : 'bg-white hover:bg-gray-50'
                            )}
                          >
                            {season}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Minimum Appearances */}
                    <div className="flex flex-col items-center">
                      <div className="flex items-center gap-2 mb-2">
                        <UsersRound className="h-4 w-4 text-green-700" />
                        <span className="font-medium text-green-900">Minimum Appearances</span>
                      </div>
                      <input
                        type="number"
                        value={defaultMinApps}
                        onChange={(e) => setDefaultMinApps(parseInt(e.target.value) || 0)}
                        min="0"
                        max="100"
                        className="w-full px-3 py-2 border rounded-md text-center"
                      />
                      <div className="text-xs text-gray-500 text-center mt-1">Minimum appearances in a season</div>
                    </div>
                  </div>

                  <div className="flex justify-end mt-4">
                    <button
                      onClick={saveDefaultFilters}
                      disabled={isSaving || !hasChanges}
                      className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400"
                    >
                      {isSaving ? 'Saving...' : 'Save Filters'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
