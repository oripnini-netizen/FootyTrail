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
  Trophy,     // Added
  User,       // Added
  Calendar    // Added
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
  
  // State declarations
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

  // Add these state declarations after your existing ones
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Single declaration of leagueIdToLabel
  const leagueIdToLabel = useMemo(() => {
    const mapping = {};
    // Add mappings from grouped leagues
    Object.entries(groupedLeagues).forEach(([country, leagues]) => {
      leagues.forEach(league => {
        mapping[league.league_id] = `${country} - ${league.league_name}`;
      });
    });
    // Add top 10 leagues mapping
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

  // Update handleTop10Leagues to use the same top10 array
  const handleTop10Leagues = () => {
    const top10Ids = [39, 140, 78, 135, 61, 88, 94, 71, 128, 253];
    setDefaultLeagueIds(prev => {
      const uniqueIds = new Set([...prev, ...top10Ids]);
      return Array.from(uniqueIds);
    });
  };

  // Update both name and avatar when user data changes
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

  // Add this useEffect to fetch recent games
  useEffect(() => {
    const fetchRecentGames = async () => {
      try {
        const { data, error } = await supabase
          .from('gamesRecords')
          .select('*')
          .eq('user_id', user?.id)
          .order('played_at', { ascending: false })
          .limit(20);

        if (error) throw error;
        setRecentGames(data || []);
      } catch (error) {
        console.error('Error fetching recent games:', error);
      }
    };

    if (user?.id) {
      fetchRecentGames();
    }
  }, [user?.id]);

  // Load default filters on user change
  useEffect(() => {
    if (user) {
      setDefaultLeagueIds(user.default_leagues || []);
      setDefaultSeasons(user.default_seasons || []);
      setDefaultMinApps(user.default_min_appearances || 0);
    }
  }, [user]);

  // Load filters data
  useEffect(() => {
    let cancelled = false;

    async function loadFilters() {
      try {
        setLoadingFilters(true);
        
        // Fetch leagues
        const leaguesRes = await getLeagues();
        if (!cancelled) {
          setGroupedLeagues(leaguesRes.groupedByCountry || {});
          // Initialize collapse state
          const initialCollapse = {};
          Object.keys(leaguesRes.groupedByCountry || {}).forEach((c) => {
            initialCollapse[c] = false;
          });
          setExpandedCountries(initialCollapse);
        }

        // Fetch seasons
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
      await signOut(); // Call the signOut function from AuthContext
      navigate('/login'); // Redirect to login page
    } catch (error) {
      console.error('Error signing out:', error);
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleNameUpdate = async (e) => {
    e.preventDefault();
    try {
      setError(null);
      setLoading(true);

      // Get current user metadata first
      const currentMetadata = user?.user_metadata || {};

      // Update auth metadata while preserving existing metadata
      const { error: authError } = await supabase.auth.updateUser({
        data: { 
          ...currentMetadata,  // Preserve existing metadata
          full_name: fullName 
        }
      });

      if (authError) throw authError;

      // Update users table
      const { error: dbError } = await supabase
        .from('users')
        .update({ full_name: fullName })
        .eq('id', user.id);

      if (dbError) throw dbError;

      await refresh();

    } catch (error) {
      console.error('Error updating name:', error);
      setError(error.message);
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
      console.log('Upload successful, URL:', publicUrl);

      // 1. Update auth user metadata
      const { error: authError } = await supabase.auth.updateUser({
        data: { 
          avatar_url: publicUrl,
          profile_photo_url: publicUrl
        }
      });

      if (authError) throw authError;

      // 2. Update users table directly
      const { error: updateError } = await supabase
        .from('users')
        .update({ profile_photo_url: publicUrl })
        .eq('id', user.id);

      if (updateError) throw updateError;

      // 3. Update local state and refresh user data
      setAvatar(publicUrl);
      await refresh();

    } catch (error) {
      console.error('Error:', error);
      setError(error.message);
    } finally {
      setLoading(false);
    }
  };

  // Add this effect to track filter changes
  useEffect(() => {
    if (user) {
      const hasLeaguesChanged = JSON.stringify(defaultLeagueIds) !== JSON.stringify(user.default_leagues || []);
      const hasSeasonsChanged = JSON.stringify(defaultSeasons) !== JSON.stringify(user.default_seasons || []);
      const hasMinAppsChanged = defaultMinApps !== (user.default_min_appearances || 0);
      
      setHasChanges(hasLeaguesChanged || hasSeasonsChanged || hasMinAppsChanged);
    }
  }, [defaultLeagueIds, defaultSeasons, defaultMinApps, user]);

  // Update the saveDefaultFilters function
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
      
      // Refresh user data to get updated defaults
      await refresh();
      setHasChanges(false);

    } catch (error) {
      console.error('Error saving filters:', error);
      setError(error.message);
    } finally {
      setIsSaving(false);
    }
  };

  // Save default filters
  const saveFiltersButton = (
    <button
      onClick={saveDefaultFilters}
      disabled={isSaving || !hasChanges}
      className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400"
    >
      {isSaving ? 'Saving...' : 'Save Filters'}
    </button>
  );

  // Add this after your state declarations
  const leaguesWithCountry = useMemo(() => {
    const enrichedLeagues = {};
    Object.entries(groupedLeagues).forEach(([country, leagues]) => {
      enrichedLeagues[country] = leagues.map(league => ({
        ...league,
        country_name: country
      }));
    });
    return enrichedLeagues;
  }, [groupedLeagues]);

  // League handlers
  const handleClearLeagues = () => {
    setDefaultLeagueIds([]);
  };

  const toggleCountry = (country) => {
    setExpandedCountries(prev => ({
      ...prev,
      [country]: !prev[country]
    }));
  };

  const toggleLeague = (leagueId) => {
    setDefaultLeagueIds(prev => 
      prev.includes(leagueId)
        ? prev.filter(id => id !== leagueId)
        : [...prev, leagueId]
    );
  };

  // Season handlers
  const handleLast5Seasons = () => {
    const last5 = allSeasons.slice(0, 5);
    setDefaultSeasons(last5);
  };

  const handleClearSeasons = () => {
    setDefaultSeasons([]);
  };

  const toggleSeason = (season) => {
    setDefaultSeasons(prev =>
      prev.includes(season)
        ? prev.filter(s => s !== season)
        : [...prev, season]
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 pt-8 pb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Left column - Profile Info */}
          <div className="md:col-span-1">
            <div className="bg-white rounded-xl shadow-sm p-6">
              <div className="flex flex-col items-center">
                {/* Avatar with upload */}
                <div className="relative group mb-4">
                  {avatar ? (
                    <img 
                      src={avatar} 
                      alt="Profile" 
                      className="h-24 w-24 rounded-full object-cover border-2 border-gray-200"
                      onError={(e) => {
                        console.log('Image failed to load:', avatar);
                        setAvatar('');
                      }}
                    />
                  ) : (
                    <div className="h-24 w-24 rounded-full bg-gray-200 flex items-center justify-center border-2 border-gray-200">
                      <span className="text-2xl font-bold text-gray-600">
                        {user?.email?.[0].toUpperCase()}
                      </span>
                    </div>
                  )}
                  
                  <label className="absolute inset-0 flex items-center justify-center rounded-full cursor-pointer bg-black/0 group-hover:bg-black/40 transition-colors">
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleFileUpload}
                      disabled={loading}
                    />
                    <ImagePlus className="h-6 w-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                  </label>
                </div>

                {/* Name form */}
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

                {error && (
                  <div className="mt-2 text-sm text-red-600">
                    {error}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right column - Stats and other content */}
          <div className="md:col-span-2 space-y-6">
            {/* Stats Card */}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-xl font-semibold mb-4">Statistics</h2>
              <div className="grid grid-cols-2 gap-4">
                <div className="border rounded-lg p-4">
                  <div className="text-sm text-gray-600">Games Played</div>
                  <div className="text-2xl font-semibold">{user?.games_played || 0}</div>
                </div>
                <div className="border rounded-lg p-4">
                  <div className="text-sm text-gray-600">Total Points</div>
                  <div className="text-2xl font-semibold">{user?.total_points || 0}</div>
                </div>
              </div>
            </div>

            {/* Recent Games Card */}
            <div className="bg-white rounded-xl shadow-sm p-6">
              <h2 className="text-xl font-semibold mb-4">Recent Games</h2>
              {loading ? (
                <div className="text-center py-4">Loading...</div>
              ) : (
                <div className="divide-y divide-gray-200">
                  {recentGames.length === 0 ? (
                    <p className="text-gray-500 text-center py-4">No games played yet</p>
                  ) : (
                    recentGames.map((game) => (
                      <div
                        key={game.id}
                        className="py-3 flex items-center justify-between"
                      >
                        <div className="flex items-center space-x-3">
                          <div className="flex-shrink-0">
                            {game.is_daily ? (
                              <Trophy className="h-5 w-5 text-yellow-500" />
                            ) : (
                              <User className="h-5 w-5 text-blue-500" />
                            )}
                          </div>
                          <div>
                            <div className="font-medium">
                              {game.is_daily ? 'Daily Challenge' : 'Practice Game'}
                            </div>
                            <div className="text-sm text-gray-500 flex items-center">
                              <Calendar className="h-4 w-4 mr-1" />
                              {new Date(game.played_at).toLocaleDateString()}
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-semibold text-green-600">
                            +{game.points} pts
                          </div>
                          <div className="text-sm text-gray-500">
                            {game.guesses} {game.guesses === 1 ? 'guess' : 'guesses'}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Default Filters Card */}
            <div className="rounded-xl border bg-green-50/60 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Filter className="h-5 w-5 text-green-700" />
                  <h3 className="text-lg font-semibold text-green-900">Default Filters</h3>
                </div>
                <button
                  className="text-gray-600 hover:text-gray-800"
                  onClick={() => setFiltersCollapsed(c => !c)}
                >
                  {filtersCollapsed ? (
                    <ChevronDown className="h-5 w-5" />
                  ) : (
                    <ChevronUp className="h-5 w-5" />
                  )}
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
                                <span className="text-xs text-gray-500">
                                  ({leagues.length})
                                </span>
                              </div>
                              {expandedCountries[country] ? (
                                <ChevronUp className="h-4 w-4" />
                              ) : (
                                <ChevronDown className="h-4 w-4" />
                              )}
                            </button>

                            {expandedCountries[country] && (
                              <div className="ml-8 space-y-2 mt-2">
                                {leagues.map((league) => (
                                  <label
                                    key={league.league_id}
                                    className="flex items-center gap-2 cursor-pointer"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={defaultLeagueIds.includes(league.league_id)}
                                      onChange={() => toggleLeague(league.league_id)}
                                      className="rounded"
                                    />
                                    <img
                                      src={league.logo}
                                      alt={league.league_name}
                                      className="w-5 h-5 object-contain"
                                    />
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

                      <SelectedChips
                        title="Chosen seasons"
                        items={defaultSeasons}
                        onClear={handleClearSeasons}
                      />

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
                        onChange={(e) => setDefaultMinApps(Math.max(0, e.target.valueAsNumber || 0))}
                        placeholder="Enter minimum appearances"
                        className="w-full px-3 py-2 border rounded-md"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Save button - place this at the bottom of your filters section */}
              <button
                onClick={saveDefaultFilters}
                disabled={isSaving || !hasChanges}
                className={`w-full mt-6 px-4 py-2 rounded-md transition-colors ${
                  !hasChanges 
                    ? 'bg-gray-400 cursor-not-allowed text-white'
                    : isSaving
                    ? 'bg-yellow-500 cursor-wait text-white'
                    : 'bg-green-600 hover:bg-green-700 text-white'
                }`}
              >
                {isSaving 
                  ? 'Saving...' 
                  : hasChanges 
                  ? 'Save Default Filters'
                  : 'Filters Saved'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
