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
  TrendingUp,
  CheckSquare,
  CalendarClock
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import SelectedChips from '../components/SelectedChips';
import { getCompetitions, getSeasons } from '../api';

function classNames(...s) {
  return s.filter(Boolean).join(' ');
}
const fmtCurrency = (n) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(n || 0));

function Section({ title, icon, collapsed, onToggle, actions, children }) {
  // Header actions won't toggle collapse.
  return (
    <div className="rounded-lg border bg-white/60">
      <div className="flex items-center justify-between px-3 py-2">
        <button type="button" onClick={onToggle} className="inline-flex items-center gap-2">
          {icon}
          <span className="font-medium text-green-900">{title}</span>
          {collapsed ? <ChevronDown className="h-4 w-4 ml-1" /> : <ChevronUp className="h-4 w-4 ml-1" />}
        </button>
        <div className="flex items-center gap-2">{actions}</div>
      </div>
      {!collapsed && <div className="p-3 pt-0">{children}</div>}
    </div>
  );
}

function PresetButton({ onClick, children, title, active = false }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      title={title}
      className={classNames(
        'inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border transition-colors',
        active
          ? 'bg-green-600 text-white border-green-700'
          : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
      )}
    >
      {children}
    </button>
  );
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
  const [compCollapsed, setCompCollapsed] = useState(false);
  const [seasonsCollapsed, setSeasonsCollapsed] = useState(false);
  const [mvCollapsed, setMvCollapsed] = useState(false);

  // NEW model state
  const [groupedCompetitions, setGroupedCompetitions] = useState({});
  const [allSeasons, setAllSeasons] = useState([]);
  const [defaultCompetitionIds, setDefaultCompetitionIds] = useState(
    user?.default_competitions || user?.default_leagues || []
  );
  const [defaultSeasons, setDefaultSeasons] = useState(user?.default_seasons || []);
  const [defaultMinMarket, setDefaultMinMarket] = useState(
    (user?.default_min_market_value ?? user?.default_min_appearances ?? 0) || 0
  );
  const [expandedCountries, setExpandedCountries] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const competitionIdToLabel = useMemo(() => {
    const mapping = {};
    Object.entries(groupedCompetitions).forEach(([country, comps]) => {
      (comps || []).forEach(c => {
        mapping[String(c.competition_id)] = `${country} - ${c.competition_name}`;
      });
    });
    return mapping;
  }, [groupedCompetitions]);

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
        const { data: games, error: recentErr } = await supabase
          .from('games_records')
          .select('id, player_name, won, points_earned, time_taken_seconds, guesses_attempted, hints_used, created_at, is_daily_challenge')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(20);

        if (recentErr) throw recentErr;
        setRecentGames(games || []);

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
        setLocalStats({ games_played: 0, total_points: 0, avg_time: 0, success_rate: 0 });
        setRecentGames([]);
      } finally {
        setLoading(false);
      }
    };
    fetchGames();
  }, [user?.id]);

  useEffect(() => {
    if (user) {
      setDefaultCompetitionIds(user.default_competitions || user.default_leagues || []);
      setDefaultSeasons(user.default_seasons || []);
      setDefaultMinMarket((user.default_min_market_value ?? user.default_min_appearances ?? 0) || 0);
    }
  }, [user]);

  // Load filters (NEW model)
  useEffect(() => {
    let cancelled = false;
    async function loadFilters() {
      try {
        setLoadingFilters(true);
        const compsRes = await getCompetitions();
        if (!cancelled) {
          const grouped = compsRes.groupedByCountry || {};
          setGroupedCompetitions(grouped);
          const initialCollapse = {};
          Object.keys(grouped).forEach((c) => (initialCollapse[c] = false));
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
      const hasCompsChanged   = JSON.stringify(defaultCompetitionIds) !== JSON.stringify(user.default_competitions || user.default_leagues || []);
      const hasSeasonsChanged = JSON.stringify(defaultSeasons) !== JSON.stringify(user.default_seasons || []);
      const hasMinChanged     = Number(defaultMinMarket) !== Number(user.default_min_market_value ?? user.default_min_appearances ?? 0);
      setHasChanges(hasCompsChanged || hasSeasonsChanged || hasMinChanged);
    }
  }, [defaultCompetitionIds, defaultSeasons, defaultMinMarket, user]);

  const saveDefaultFilters = async () => {
    try {
      setIsSaving(true);
      setError(null);
      const { error: updateError } = await supabase
        .from('users')
        .update({
          default_competitions: defaultCompetitionIds,
          default_seasons: defaultSeasons,
          default_min_market_value: Number(defaultMinMarket) || 0
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

  const competitionsWithCountry = useMemo(() => {
    const enriched = {};
    Object.entries(groupedCompetitions).forEach(([country, comps]) => {
      enriched[country] = (comps || []).map(c => ({ ...c, country_name: country }));
    });
    return enriched;
  }, [groupedCompetitions]);

  const toggleCountry = (country) => setExpandedCountries(prev => ({ ...prev, [country]: !prev[country] }));
  const toggleCompetition = (competitionId) =>
    setDefaultCompetitionIds(prev => (prev.includes(competitionId) ? prev.filter(id => id !== competitionId) : [...prev, competitionId]));

  const handleClearCompetitions = () => setDefaultCompetitionIds([]);
  const handleSelectAllCompetitions = () => {
    const all = [];
    Object.values(competitionsWithCountry).forEach(arr => (arr || []).forEach(c => all.push(String(c.competition_id))));
    setDefaultCompetitionIds(all);
  };

  const top10Ids = useMemo(() => {
    const arr = [];
    Object.values(competitionsWithCountry).forEach(arrC => (arrC || []).forEach(c => arr.push(c)));
    arr.sort((a, b) => (Number(b.total_value_eur || 0) - Number(a.total_value_eur || 0)));
    return arr.slice(0, 10).map(c => String(c.competition_id));
  }, [competitionsWithCountry]);
  const handleTop10Competitions = () => setDefaultCompetitionIds(top10Ids);

  const handleLast5Seasons = () => setDefaultSeasons(allSeasons.slice(0, 5));
  const handleClearSeasons = () => setDefaultSeasons([]);
  const handleSelectAllSeasons = () => setDefaultSeasons(allSeasons);
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

            {/* Default Filters Card (NEW model) */}
            <div className="rounded-xl shadow-md transition-all hover:shadow-lg border bg-green-50/60 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Filter className="h-5 w-5 text-green-700" />
                  <h3 className="text-lg font-semibold text-green-900">Default Filters</h3>
                </div>
                <button className="text-gray-600 hover:text-gray-800" onClick={() => setFiltersCollapsed(c => !c)} type="button">
                  {filtersCollapsed ? <ChevronDown className="h-5 w-5" /> : <ChevronUp className="h-5 w-5" />}
                </button>
              </div>

              {!filtersCollapsed && !loadingFilters && (
                <div className="mt-4 space-y-6">
                  {/* Competitions */}
                  <Section
                    title="Competitions"
                    icon={<Star className="h-4 w-4 text-green-700" />}
                    collapsed={compCollapsed}
                    onToggle={() => setCompCollapsed(v => !v)}
                    actions={
                      <div className="flex items-center gap-2">
                        <button onClick={handleTop10Competitions} type="button" className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50">
                          <Star className="h-3 w-3" /> Top 10
                        </button>
                        <button onClick={handleSelectAllCompetitions} type="button" className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50">
                          <CheckSquare className="h-3 w-3" /> Select All
                        </button>
                        <button onClick={handleClearCompetitions} type="button" className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50">
                          <Trash2 className="h-3 w-3" />Clear All
                        </button>
                      </div>
                    }
                  >
                    <SelectedChips
                      title="Chosen competitions"
                      items={defaultCompetitionIds}
                      onClear={handleClearCompetitions}
                      getLabel={(id) => competitionIdToLabel[id] || `Competition (${id})`}
                      onRemoveItem={(id) => setDefaultCompetitionIds(prev => prev.filter(x => x !== id))}
                      hoverClose
                    />
                    <div className="max-h-96 overflow-y-auto pr-2">
                      {Object.entries(competitionsWithCountry)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([country, comps]) => (
                          <div key={country} className="mb-2">
                            <button
                              type="button"
                              onClick={() => toggleCountry(country)}
                              className="w-full flex items-center justify-between p-2 hover:bg-green-50 rounded"
                            >
                              <div className="flex items-center gap-2">
                                {comps[0]?.flag_url && (
                                  <img src={comps[0].flag_url} alt={country} className="w-6 h-4 object-cover rounded" />
                                )}
                                <span>{country}</span>
                                <span className="text-xs text-gray-500">({comps.length})</span>
                              </div>
                              {expandedCountries[country] ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </button>

                            {expandedCountries[country] && (
                              <div className="ml-8 space-y-2 mt-2">
                                {comps.map((c) => (
                                  <label key={c.competition_id} className="flex items-center gap-2 cursor-pointer" onClick={(e) => e.stopPropagation()}>
                                    <input
                                      type="checkbox"
                                      checked={defaultCompetitionIds.includes(String(c.competition_id))}
                                      onChange={() => toggleCompetition(String(c.competition_id))}
                                      className="rounded"
                                    />
                                    {c.logo_url && <img src={c.logo_url} alt={c.competition_name} className="w-5 h-5 object-contain" />}
                                    <span className="text-sm">{c.competition_name}</span>
                                  </label>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                    </div>
                  </Section>

                  {/* Seasons */}
                  <Section
                    title="Seasons"
                    icon={<UsersRound className="h-4 w-4 text-green-700" />}
                    collapsed={seasonsCollapsed}
                    onToggle={() => setSeasonsCollapsed(v => !v)}
                    actions={
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={handleLast5Seasons} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50">
                          <CalendarClock className="h-3 w-3" /> Last 5
                        </button>
                        <button type="button" onClick={handleSelectAllSeasons} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50">
                          <CheckSquare className="h-3 w-3" /> Select All
                        </button>
                        <button type="button" onClick={handleClearSeasons} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50">
                          <Trash2 className="h-3 w-3" />Clear All
                        </button>
                      </div>
                    }
                  >
                    <SelectedChips title="Chosen seasons" items={defaultSeasons} onClear={handleClearSeasons} />
                    <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mt-2">
                      {allSeasons.map((season) => (
                        <button
                          key={season}
                          type="button"
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
                  </Section>

                  {/* Min Market Value (€) — step 100k + presets */}
                  <Section
                    title="Minimum Market Value (€)"
                    icon={<UsersRound className="h-4 w-4 text-green-700" />}
                    collapsed={mvCollapsed}
                    onToggle={() => setMvCollapsed(v => !v)}
                  >
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center gap-3">
                        <input
                          type="number"
                          value={defaultMinMarket}
                          onChange={(e) => setDefaultMinMarket(parseInt(e.target.value) || 0)}
                          min="0"
                          step="100000"
                          className="w-40 border rounded-md px-2 py-1 text-center"
                        />
                        <div className="text-sm text-gray-600">Current: {fmtCurrency(defaultMinMarket)}</div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <PresetButton title="Clear" onClick={() => setDefaultMinMarket(0)} active={defaultMinMarket === 0}>
                          <Trash2 size={14} /> Clear
                        </PresetButton>
                        <PresetButton onClick={() => setDefaultMinMarket(100000)} active={defaultMinMarket === 100000}>
                          <Star size={14} /> 100K €
                        </PresetButton>
                        <PresetButton onClick={() => setDefaultMinMarket(500000)} active={defaultMinMarket === 500000}>
                          <Star size={14} /> 500K €
                        </PresetButton>
                        <PresetButton onClick={() => setDefaultMinMarket(1000000)} active={defaultMinMarket === 1000000}>
                          <Star size={14} /> 1M €
                        </PresetButton>
                        <PresetButton onClick={() => setDefaultMinMarket(5000000)} active={defaultMinMarket === 5000000}>
                          <Star size={14} /> 5M €
                        </PresetButton>
                        <PresetButton onClick={() => setDefaultMinMarket(10000000)} active={defaultMinMarket === 10000000}>
                          <Star size={14} /> 10M €
                        </PresetButton>
                        <PresetButton onClick={() => setDefaultMinMarket(25000000)} active={defaultMinMarket === 25000000}>
                          <Star size={14} /> 25M €
                        </PresetButton>
                        <PresetButton onClick={() => setDefaultMinMarket(50000000)} active={defaultMinMarket === 50000000}>
                          <Star size={14} /> 50M €
                        </PresetButton>
                      </div>
                    </div>
                  </Section>

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
