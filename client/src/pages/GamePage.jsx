// src/pages/GamePage.jsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  getLeagues,
  getSeasons,
  getCounts,
  getRandomPlayer,
  getDailyChallenge,
  getLimits,
} from '../api';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

// lucide icons
import {
  Trophy,
  UsersRound,
  Star,
  Trash2,
  Filter,
  ChevronDown,
  ChevronUp,
  Sparkles,
  PlayCircle,
  Info,
  Aperture,
  Bell,
  TableProperties,
  UserSearch,  // Add this import
} from 'lucide-react';

function classNames(...s) {
  return s.filter(Boolean).join(' ');
}

export default function GamePage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // Initialize state with empty arrays/objects to prevent undefined
  const [daily, setDaily] = useState(null);
  const [loadingFilters, setLoadingFilters] = useState(true);
  const [collapsed, setCollapsed] = useState(true);
  const [groupedLeagues, setGroupedLeagues] = useState({});
  const [allSeasons, setAllSeasons] = useState([]);
  const [selectedLeagueIds, setSelectedLeagueIds] = useState([]);
  const [selectedSeasons, setSelectedSeasons] = useState([]);
  const [minApps, setMinApps] = useState(0);

  // Add these new state declarations
  const [leagueTags, setLeagueTags] = useState([]);
  const [expandedCountries, setExpandedCountries] = useState({});

  // Initialize with user defaults when available
  useEffect(() => {
    if (user) {
      setSelectedLeagueIds(user.default_leagues || []);
      setSelectedSeasons(user.default_seasons || []);
      setMinApps(user.default_min_appearances || 0);
    }
  }, [user]);

  // Counts
  const [poolCount, setPoolCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const potentialPoints = useMemo(() => poolCount * 5, [poolCount]);

  // Daily challenge state
  const [limits, setLimits] = useState({ gamesToday: 0, dailyPlayed: false });

  // ---------- Load filters + limits + daily card ----------
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoadingFilters(true);

        // leagues
        const leaguesRes = await getLeagues(); // { groupedByCountry, tags }
        if (!cancelled) {
          setGroupedLeagues(leaguesRes.groupedByCountry || {});
          setLeagueTags(leaguesRes.tags || []);
          // initialize collapse state (all collapsed)
          const initialCollapse = {};
          Object.keys(leaguesRes.groupedByCountry || {}).forEach((c) => {
            initialCollapse[c] = false;
          });
          setExpandedCountries(initialCollapse);
        }

        // seasons
        const seasonsRes = await getSeasons(); // { seasons: [2025, 2024, ...] }
        if (!cancelled) setAllSeasons(seasonsRes.seasons || []);

        // user limits + daily
        if (user?.id) {
          const lim = await getLimits(user.id);
          if (!cancelled) setLimits(lim);
        }
        const d = await getDailyChallenge().catch(() => null);
        if (!cancelled) setDaily(d || null);
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) setLoadingFilters(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // ---------- Recompute counts whenever filters change ----------
  useEffect(() => {
    let cancelled = false;

    async function recalc() {
      try {
        const payload = {
          leagues: selectedLeagueIds,
          seasons: selectedSeasons,
          minAppearances: Number(minApps) || 0,
        };
        
        console.log('Sending filters for count:', payload); // Debug log
        
        const { poolCount: filteredCount, totalCount: dbTotal } = await getCounts(payload);
        
        if (!cancelled) {
          // poolCount should be the filtered count (left side)
          // totalCount should be the total database count (right side)
          setPoolCount(filteredCount || 0);  // This is the filtered count
          setTotalCount(dbTotal || 0);       // This is the total in DB
        }
      } catch (e) {
        console.error('Error getting counts:', e);
        if (!cancelled) {
          setPoolCount(0);
          setTotalCount(0);
        }
      }
    }

    if (!loadingFilters) recalc();
    return () => { cancelled = true; };
  }, [loadingFilters, selectedLeagueIds, selectedSeasons, minApps]);

  // Build label map: league_id -> "Country - League Name"
  const leagueIdToLabel = useMemo(() => {
    const map = {};
    Object.entries(groupedLeagues || {}).forEach(([country, leagues]) => {
      (leagues || []).forEach((l) => {
        map[String(l.league_id)] = `${country} - ${l.league_name}`;
      });
    });
    return map;
  }, [groupedLeagues]);

  // ---------- Helpers for selection ----------
  const toggleLeague = (id) => {
    setSelectedLeagueIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const clearLeagues = () => setSelectedLeagueIds([]);
  const top10Leagues = () =>
    setSelectedLeagueIds(['128', '144', '39', '40', '61', '78', '135', '88', '140', '94']);

  const clearSeasons = () => setSelectedSeasons([]);
  const last5Seasons = () => setSelectedSeasons(allSeasons.slice(0, 5)); // seasons already sorted desc

  const goToLiveGame = (gamePayload, isDaily = false) => {
    navigate('/live', {
      state: {
        game: gamePayload,
        filters: {
          leagues: selectedLeagueIds,
          seasons: selectedSeasons,
          minAppearances: Number(minApps) || 0,
          potentialPoints,
        },
        isDaily,
      },
    });
  };

  // ---------- Start regular game ----------
  const onStartGame = async () => {
    try {
      const payload = {
        leagues: selectedLeagueIds,
        seasons: selectedSeasons,
        minAppearances: Number(minApps) || 0,
      };
      const p = await getRandomPlayer(payload);
      goToLiveGame(p, false);
    } catch (e) {
      alert(e.message || 'Failed to start game');
    }
  };

  // ---------- UI pieces ----------
  const SelectedChips = ({
    title,
    items,
    onClear,
    getLabel,
    onRemoveItem,
    hoverClose = false
  }) => {
    if (!items?.length) return null;
    return (
      <div className="mb-2">
        <div className="text-xs text-gray-600 mb-1">{title}</div>
        <div className="flex flex-wrap gap-2">
          {items.map((t) => {
            const label = getLabel ? getLabel(t) : String(t);
            return (
              <span
                key={String(t)}
                className={classNames(
                  'group relative inline-flex items-center gap-2 px-2 py-1 rounded-full text-xs bg-green-100 text-green-800',
                  hoverClose && 'pr-6'
                )}
              >
                {label}
                {hoverClose && onRemoveItem && (
                  <button
                    type="button"
                    onClick={() => onRemoveItem(t)}
                    className="absolute right-0 top-0 bottom-0 hidden group-hover:flex items-center justify-center w-5 text-red-600 hover:text-red-700"
                    title="Remove"
                  >
                    ×
                  </button>
                )}
              </span>
            );
          })}
          <button
            onClick={onClear}
            className="text-xs text-gray-600 underline hover:text-gray-800"
          >
            Clear
          </button>
        </div>
      </div>
    );
  };

  const LeaguesPicker = () => {
    if (loadingFilters) {
      return <div className="text-sm text-gray-500">Loading leagues…</div>;
    }
    const countries = Object.keys(groupedLeagues);
    if (countries.length === 0) {
      return <div className="text-sm text-gray-500">No leagues available.</div>;
    }
    return (
      <div className="border rounded-md">
        {/* QUICK TAGS ROW REMOVED AS REQUESTED */}

        {/* collapsible country list (default collapsed) */}
        <div className="max-h-64 overflow-auto divide-y">
          {countries.sort().map((country) => {
            const leagues = groupedLeagues[country] || [];
            const flag = leagues[0]?.country_flag;
            const expanded = !!expandedCountries[country];

            return (
              <div key={country} className="p-2">
                <button
                  type="button"
                  className="w-full flex items-center gap-2 mb-1"
                  onClick={() =>
                    setExpandedCountries((prev) => ({ ...prev, [country]: !prev[country] }))
                  }
                >
                  {flag ? (
                    <img src={flag} alt="" className="h-4 w-6 object-cover rounded-sm border" />
                  ) : (
                    <span className="h-4 w-6" />
                  )}
                  <div className="font-medium text-left flex-1">{country}</div>
                  <div className="text-xs text-gray-500">({leagues.length})</div>
                  <span className="ml-2">
                    {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </span>
                </button>

                {expanded && (
                  <div className="pl-8 space-y-2">
                    {leagues.map((l) => {
                      const checked = selectedLeagueIds.includes(String(l.league_id));
                      return (
                        <label
                          key={String(l.league_id)}
                          className={classNames(
                            'flex items-center gap-2 rounded border p-2 cursor-pointer',
                            checked ? 'bg-green-50 border-green-300' : 'bg-white hover:bg-gray-50'
                          )}
                          onClick={() => toggleLeague(String(l.league_id))}
                        >
                          {l.logo ? (
                            <img src={l.logo} alt="" className="h-5 w-5 object-contain" />
                          ) : (
                            <div className="h-5 w-5" />
                          )}
                          <span className="text-sm">{l.league_name}</span>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => { }}
                            className="ml-auto"
                          />
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const SeasonsPicker = () => {
    if (loadingFilters) return <div className="text-sm text-gray-500">Loading seasons…</div>;
    if (!allSeasons.length) return <div className="text-sm text-gray-500">No seasons available.</div>;
    return (
      <div className="border rounded-md p-2 bg-white">
        <div className="grid grid-cols-3 sm:grid-cols-6 md:grid-cols-8 gap-2">
          {allSeasons.map((y) => {
            const checked = selectedSeasons.includes(y);
            return (
              <label
                key={y}
                className={classNames(
                  'text-sm px-3 py-1 rounded border cursor-pointer text-center',
                  checked ? 'bg-green-50 border-green-300' : 'bg-white hover:bg-gray-50'
                )}
                onClick={() =>
                  setSelectedSeasons((prev) =>
                    prev.includes(y) ? prev.filter((s) => s !== y) : [...prev, y]
                  )
                }
              >
                {y}
                <input type="checkbox" checked={checked} onChange={() => { }} className="hidden" />
              </label>
            );
          })}
        </div>
      </div>
    );
  };

  // derive a max-games display (fallback 10)
  const maxGames = 10 + (limits?.dailyBonus ? 1 : 0);
  const pointsToday = limits?.pointsToday ?? 0;
  const pointsTotal = limits?.pointsTotal ?? 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {/* Daily Challenge Card */}
        <div className="bg-white rounded-xl shadow-sm p-6 text-center">
          <div className="flex justify-center mb-4">
            <Star className="h-8 w-8 text-yellow-400" />
          </div>
          <h2 className="text-xl font-semibold mb-2">Daily Challenge</h2>
          <p className="text-gray-600">
            {daily ? daily.name : "Today's daily challenge is not available yet. Please check back later."}
          </p>
        </div>

        {/* Progress Stats Card */}
        <div className="bg-white rounded-xl shadow-sm p-6 grid grid-cols-3 gap-4">
          <div className="text-center">
            <div className="text-xl font-bold">
              {limits.gamesToday || 0}/10
            </div>
            <div className="text-sm text-gray-600">Daily Progress</div>
          </div>
          <div className="text-center">
            <div className="text-xl font-bold text-green-600">
              {limits.pointsToday || 0}
            </div>
            <div className="text-sm text-gray-600">Daily Points</div>
          </div>
          <div className="text-center">
            <div className="text-xl font-bold text-blue-600">
              {limits.pointsTotal || 0}
            </div>
            <div className="text-sm text-gray-600">Total Points</div>
          </div>
        </div>

        {/* Game Setup Card */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex justify-center mb-6">
            <UserSearch className="h-16 w-16 text-gray-400" />
          </div>
          <p className="text-center text-gray-600 mb-6">
            Your next challenge is here. Calibrate your filters and start scouting.
          </p>

          {/* Player Pool Stats */}
          <div className="bg-yellow-50 rounded-lg p-4 mb-6">
            <div className="flex justify-between items-center">
              <div>
                <div className="text-lg font-semibold text-yellow-800">
                  {potentialPoints}
                </div>
                <div className="text-sm text-yellow-600">
                  Potential Points
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-semibold text-yellow-800">
                  {poolCount} / {totalCount}
                </div>
                <div className="text-sm text-yellow-600">
                  Player Pool
                </div>
              </div>
            </div>
          </div>

          {/* Start Game Button */}
          <button
            onClick={onStartGame}
            disabled={loadingFilters || totalCount === 0}
            className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-400 
                       text-white rounded-lg py-3 font-semibold flex items-center 
                       justify-center gap-2 mb-6"
          >
            <PlayCircle className="h-5 w-5" />
            Start Game!
          </button>

          {/* Selected Filters Display */}
          <div className="mb-4">
            <div className="text-sm text-gray-600 mb-2">Leagues</div>
            <SelectedChips
              items={selectedLeagueIds}
              onClear={() => setSelectedLeagueIds([])}
              getLabel={(id) => leagueIdToLabel[id] || `Unknown League (${id})`}
              onRemoveItem={(id) => setSelectedLeagueIds(prev => prev.filter(x => x !== id))}
              hoverClose
            />

            <div className="text-sm text-gray-600 mt-3 mb-2">Seasons</div>
            <SelectedChips
              items={selectedSeasons}
              onClear={() => setSelectedSeasons([])}
              onRemoveItem={(season) => setSelectedSeasons(prev => prev.filter(x => x !== season))}
              hoverClose
            />
          </div>

          {/* Difficulty Filters Section */}
          <div className="border rounded-xl">
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="w-full flex items-center justify-between p-4"
            >
              <div className="flex items-center gap-2">
                <Filter className="h-5 w-5 text-gray-600" />
                <span className="font-medium">Difficulty Filters</span>
              </div>
              {collapsed ? (
                <ChevronDown className="h-5 w-5" />
              ) : (
                <ChevronUp className="h-5 w-5" />
              )}
            </button>

            {!collapsed && (
              <div className="p-4 border-t space-y-4">
                {/* Keep your existing filter components here */}
                <div className="mb-4">
                  <div className="text-sm font-medium text-gray-700 mb-2">
                    Select Seasons
                  </div>
                  <SeasonsPicker />
                </div>

                {/* Leagues picker (show if options available) */}
                {Object.keys(groupedLeagues).length > 0 && (
                  <div>
                    <div className="text-sm font-medium text-gray-700 mb-2">
                      Select Leagues
                    </div>
                    <LeaguesPicker />
                  </div>
                )}

                {/* Minimum appearances input */}
                <div>
                  <div className="text-sm font-medium text-gray-700 mb-2">
                    Minimum Appearances
                  </div>
                  <input
                    type="number"
                    value={minApps}
                    onChange={(e) => setMinApps(Math.max(0, Number(e.target.value)))}
                    className="w-full p-2 border rounded-md focus:ring-1 focus:ring-green-500 focus:outline-none"
                    min="0"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
