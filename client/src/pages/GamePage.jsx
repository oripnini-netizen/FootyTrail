// src/pages/GamePage.jsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  getLeagues,
  getSeasons,
  getCounts,
  getRandomPlayer,
  getDailyChallenge,
  getLimits,
  getPlayerPoolCount,
  getGamePrompt,
  API_BASE
} from '../api';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';

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
  UserSearch,
} from 'lucide-react';

function classNames(...s) {
  return s.filter(Boolean).join(' ');
}

function CountdownToTomorrow() {
  const [timeLeft, setTimeLeft] = useState(getTimeLeft());

  useEffect(() => {
    const interval = setInterval(() => setTimeLeft(getTimeLeft()), 1000);
    return () => clearInterval(interval);
  }, []);

  function getTimeLeft() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setHours(24, 0, 0, 0);
    const diff = tomorrow - now;
    const hours = Math.floor(diff / 1000 / 60 / 60);
    const minutes = Math.floor((diff / 1000 / 60) % 60);
    const seconds = Math.floor((diff / 1000) % 60);
    return `${hours}h ${minutes}m ${seconds}s`;
  }

  return <span>{timeLeft}</span>;
}

export default function GamePage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // Add this state to track overall page loading
  const [pageReady, setPageReady] = useState(false);

  // Initialize state with empty arrays/objects to prevent undefined
  const [daily, setDaily] = useState(null);
  const [loadingFilters, setLoadingFilters] = useState(true);
  const [collapsed, setCollapsed] = useState(true);
  const [groupedLeagues, setGroupedLeagues] = useState({});
  const [allSeasons, setAllSeasons] = useState([]);
  const [selectedLeagueIds, setSelectedLeagueIds] = useState([]);
  const [selectedSeasons, setSelectedSeasons] = useState([]);
  const [minApps, setMinApps] = useState(0);
  const [loadingCounts, setLoadingCounts] = useState(false);
  const [leagueTags, setLeagueTags] = useState([]);
  const [expandedCountries, setExpandedCountries] = useState({});
  
  // Add isLoading and error state
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [playerPoolCount, setPlayerPoolCount] = useState(0);

  // New state variables for game prompt
  const [gamePrompt, setGamePrompt] = useState("Your next challenge is here. Calibrate your filters and start scouting.");
  const [isLoadingPrompt, setIsLoadingPrompt] = useState(true);

  // Add loading state for daily challenge
  const [dailyLoading, setDailyLoading] = useState(false);

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
  const [gameLoading, setGameLoading] = useState(false);

  // NEW: Start Daily Challenge game
  const onStartDaily = async () => {
    try {
      setDailyLoading(true);

      // 1. Get today's daily challenge record
      const dailyChallenge = await getDailyChallenge();
      if (!dailyChallenge || !dailyChallenge.player_id) {
        alert("No daily challenge available for today.");
        setDailyLoading(false);
        return;
      }

      // 2. Fetch full player data (from backend)
      const res = await fetch(`${API_BASE}/player/${dailyChallenge.player_id}`);
      if (!res.ok) throw new Error('Failed to fetch player data');
      const playerData = await res.json();

      // 3. Map fields to expected names
      const mappedPlayerData = {
        id: playerData.player_id,
        name: playerData.player_name,
        age: playerData.player_age,
        nationality: playerData.player_nationality,
        position: playerData.player_position,
        photo: playerData.player_photo,
        // add any other fields you need
      };

      // 4. Always set potentialPoints to 10,000 for daily challenge
      navigate('/live', {
        state: {
          ...mappedPlayerData,
          isDaily: true,
          filters: { potentialPoints: 10000 },
          potentialPoints: 10000,
        },
        replace: true,
      });
    } catch (err) {
      alert('Failed to start daily challenge. Please try again.');
    } finally {
      setDailyLoading(false);
    }
  };

  // ---------- Load filters + limits + daily card ----------
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoadingFilters(true);
        setPageReady(false); // Ensure page shows loading state

        console.log('🔍 Fetching leagues...');
        const leaguesRes = await getLeagues();
        console.log('📊 Leagues response:', leaguesRes);
        
        // leagues
        if (!cancelled) {
          setGroupedLeagues(leaguesRes.groupedByCountry || {});
          setLeagueTags(leaguesRes.tags || []);
          const initialCollapse = {};
          Object.keys(leaguesRes.groupedByCountry || {}).forEach((c) => {
            initialCollapse[c] = false;
          });
          setExpandedCountries(initialCollapse);
        }

        console.log('🔍 Fetching seasons...');
        const seasonsRes = await getSeasons();
        console.log('📊 Seasons response:', seasonsRes);
        
        // seasons - use the already fetched seasons result
        if (!cancelled) setAllSeasons(seasonsRes.seasons || []);

        // user limits (only if user is available)
        if (user?.id) {
          try {
            const lim = await getLimits(user.id);
            if (!cancelled) setLimits(lim || { gamesToday: 0, dailyPlayed: false, pointsToday: 0, pointsTotal: 0 });
          } catch (limitsError) {
            console.error('Error fetching limits:', limitsError);
            if (!cancelled) setLimits({ gamesToday: 0, dailyPlayed: false, pointsToday: 0, pointsTotal: 0 });
          }
        } else {
          if (!cancelled) setLimits({ gamesToday: 0, dailyPlayed: false, pointsToday: 0, pointsTotal: 0 });
        }

        // daily challenge
        const d = await getDailyChallenge().catch(() => null);
        if (!cancelled) setDaily(d || null);
      } catch (e) {
        console.error('❌ Error loading page data:', e);
      } finally {
        if (!cancelled) setLoadingFilters(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // Update the counts effect to manage pageReady state
  useEffect(() => {
    let cancelled = false;

    async function recalc() {
      try {
        setLoadingCounts(true);
        setPageReady(false); // Keep page in loading state while recalculating
        
        const payload = {
          leagues: selectedLeagueIds,
          seasons: selectedSeasons,
          minAppearances: Number(minApps) || 0,
          userId: user?.id
        };
        
        console.log('🔍 Fetching counts with payload:', payload);
        const countsResult = await getCounts(payload);
        console.log('📊 Counts response:', countsResult);
        
        const { poolCount: filteredCount, totalCount: dbTotal } = countsResult;
        
        if (!cancelled) {
          setPoolCount(filteredCount || 0);
          setTotalCount(dbTotal || 0);
          
          // Now that everything is calculated, we can show the page
          setPageReady(true);
        }
      } catch (e) {
        console.error('❌ Error getting counts:', e);
        if (!cancelled) {
          setPoolCount(0);
          setTotalCount(0);
          setPageReady(true); // Show page even if there's an error
        }
      } finally {
        if (!cancelled) {
          setLoadingCounts(false);
        }
      }
    }

    if (!loadingFilters) recalc();
    else setPageReady(false); // Keep loading state while filters are loading
    
    return () => { cancelled = true; };
  }, [loadingFilters, selectedLeagueIds, selectedSeasons, minApps, user?.id]);

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
          potentialPoints:potentialPoints,
        },
        isDaily,
      },
    });
  };

  // ---------- Start regular game ----------
  const onStartGame = async () => {
    try {
      setGameLoading(true);
      
      // Make sure we're using the current filter state
      const currentFilters = {
        leagues: selectedLeagueIds,
        seasons: selectedSeasons,
        minAppearances: Number(minApps) || 0,
        userId: user?.id  // Add this line
      };
      
      // Pass user ID as second parameter
      const randomPlayer = await getRandomPlayer(currentFilters, user?.id);
      console.log('🎮 Received player:', randomPlayer);
      
      if (!randomPlayer) {
        alert('No players found with current filters. Try adjusting your selection.');
        return;
      }

      // Calculate potential points - Make sure this is working
      const potentialPoints = poolCount * 5; // Direct calculation
      console.log('🎮 Using direct calculation:', potentialPoints);
      
      if (!potentialPoints || potentialPoints <= 0) {
        console.error('❌ Invalid potential points calculated:', potentialPoints);
      }

      const gameData = {
        ...randomPlayer,
        isDaily: false,
        filters: {
          ...currentFilters,
          potentialPoints
        },
        potentialPoints
      };

      console.log('🎮 Final game data:', gameData);
      console.log('🎮 About to navigate to /live');
      console.log('🎮 Potential points being sent:', {
      directPoints: potentialPoints, // Should be 6800
      filtersPoints: currentFilters.potentialPoints, // This might be undefined
      gameData: gameData // Check the entire object
    });

      navigate('/live', {
        state: gameData,
        replace: true 
      });
      
      console.log('🎮 Navigation called successfully');
      
    } catch (error) {
      console.error('Error starting game:', error);
      alert('Failed to start game. Please try again.');
    } finally {
      setGameLoading(false);
    }
  };

  // Calculate potential points function
  const calculatePotentialPoints = (filters) => {
    return poolCount * 5;
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
          {items.map((t, index) => {
            const label = getLabel ? getLabel(t) : String(t);
            return (
              <span
                key={`${String(t)}-${index}`} // Add index to ensure uniqueness
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

  // Add this temporary debug function right before the "Start Game" button
  const debugCurrentFilters = () => {
    console.log('🔍 Current filter state:');
    console.log('- selectedLeagueIds:', selectedLeagueIds);
    console.log('- selectedSeasons:', selectedSeasons);
    console.log('- minApps:', minApps);
  };

  // Add a loading spinner component
  const LoadingSpinner = () => (
    <div className="min-h-screen flex flex-col items-center justify-center">
      <div className="mb-4">
        <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-green-700"></div>
      </div>
      <p className="text-green-700 text-lg font-medium">Loading FootyTrail...</p>
      <p className="text-gray-500 mt-2">Calculating player pool and preparing your challenge</p>
    </div>
  );

  // Player pool count fetch - Using API from your module
  useEffect(() => {
    const fetchPlayerPoolCount = async () => {
      try {
        const data = await getPlayerPoolCount();
        setPlayerPoolCount(data.count);
      } catch (error) {
        console.error("Failed to fetch player pool count:", error);
        setPlayerPoolCount(64380); // Fallback value
      }
    };

    fetchPlayerPoolCount();
  }, []);

  // Add this function for handling the Top 10 leagues button
  const handleTop10Leagues = () => {
    const top10Ids = ['39', '140', '78', '135', '61', '88', '94', '71', '128', '253'];
    setSelectedLeagueIds(prev => {
      const uniqueIds = new Set([...prev, ...top10Ids]);
      return Array.from(uniqueIds);
    });
  };

  // Add this function to toggle country expansion in the leagues list
  const toggleCountry = (country) => {
    setExpandedCountries(prev => ({
      ...prev,
      [country]: !prev[country]
    }));
  };

  // Add this function for handling the Last 5 seasons button
  const handleLast5Seasons = () => {
    setSelectedSeasons(allSeasons.slice(0, 5));
  };

  // New useEffect for fetching the game prompt
  useEffect(() => {
    const fetchGamePrompt = async () => {
      try {
        setIsLoadingPrompt(true);
        console.log("Fetching game prompt from API...");
        
        const response = await fetch(`${API_BASE}/ai/generate-game-prompt`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        });
        
        if (!response.ok) {
          throw new Error(`Failed to fetch game prompt: ${response.status}`);
        }
        
        const data = await response.json();
        console.log("Game prompt received:", data);
        
        if (data.prompt) {
          setGamePrompt(data.prompt);
        }
      } catch (error) {
        console.error('Error fetching game prompt:', error);
        // Keep the default prompt in case of error
      } finally {
        setIsLoadingPrompt(false);
      }
    };
    
    fetchGamePrompt();
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-50 to-transparent">
      {!pageReady ? (
        <LoadingSpinner />
      ) : (
        <motion.div 
          initial={{ opacity: 0 }} 
          animate={{ opacity: 1 }} 
          transition={{ duration: 0.4 }}
          className="max-w-3xl mx-auto px-4 py-8 space-y-6"
        >
          {/* Daily Challenge Card */}
          <div className="bg-white rounded-xl shadow-md transition-all hover:shadow-lg p-6 text-center">
            <div className="flex justify-center mb-4">
              <Star className="h-8 w-8 text-yellow-400" />
            </div>
            <h2 className="text-xl font-semibold mb-2">Daily Challenge</h2>
            <p className="text-gray-600 mb-4">
              {!limits.dailyPlayed
                ? "Today's Daily Challenge is live! Play now for a chance to win 10,000 points and an extra game!"
                : "Next challenge in "}
              {limits.dailyPlayed && <CountdownToTomorrow />}
            </p>
            {daily && (
              <>
                <button
                  className={`inline-flex items-center gap-2 px-6 py-2 rounded-xl font-bold shadow transition-all ${
                    limits.dailyPlayed
                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      : 'bg-gradient-to-r from-yellow-500 to-yellow-700 text-white hover:scale-105'
                  }`}
                  onClick={onStartDaily}
                  disabled={limits.dailyPlayed || dailyLoading}
                >
                  <Sparkles className="h-5 w-5" />
                  {dailyLoading
                    ? "Loading..."
                    : limits.dailyPlayed
                    ? "Already Played"
                    : "Play Daily Challenge"}
                </button>
                {daily && limits.dailyPlayed && (
                  <div className="mt-4 text-sm text-gray-700">
                    {limits.dailyWin
                      ? <>You <span className="font-bold text-green-600">won</span> today's challenge!<br /></>
                      : <>You <span className="font-bold text-red-600">lost</span> today's challenge.<br /></>}
                    The player was <span className="font-bold">{daily.player_name}</span>.
                   </div>
                )}
              </>
            )}
            {daily && limits.dailyPlayed && limits.dailyPlayerPhoto && (
  <div className="flex justify-center mb-2">
    <img
      src={limits.dailyPlayerPhoto}
      alt={limits.dailyPlayerName || daily.player_name}
      className="h-20 w-20 rounded-full border-4 border-yellow-400 object-cover shadow"
    />
  </div>
)}
          </div>

          {/* Progress Stats Card */}
          <div className="bg-white rounded-xl shadow-md transition-all hover:shadow-lg p-6 grid grid-cols-3 gap-4">
            <div className="text-center">
              <div className="text-xl font-bold">
                {`${limits.gamesToday || 0}/10`}
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
          <div className="bg-white rounded-xl shadow-md transition-all hover:shadow-lg p-6">
            <div className="flex justify-center mb-6">
              <UserSearch className="h-16 w-16 text-gray-400" />
            </div>
            <p className="text-center text-gray-600 mb-6">
              {isLoadingPrompt ? (
                <span className="inline-block animate-pulse">Getting ready for your challenge...</span>
              ) : (
                gamePrompt
              )}
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

            {/* Replace the existing Start button with this centered, dark green version */}
            <div className="flex justify-center mt-6">
              <button
                onClick={onStartGame}
                disabled={gameLoading || poolCount === 0}
                className={`relative overflow-hidden rounded-xl bg-gradient-to-r from-green-800 via-green-700 to-green-800 px-8 py-3 font-bold text-white shadow-lg transition-all hover:scale-105 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-green-600 focus:ring-offset-2 ${
                  gameLoading ? 'opacity-70' : 'opacity-100'
                }`}
              >
                <div className="absolute inset-0 bg-white opacity-10 transition-opacity hover:opacity-20"></div>
                <div className="flex items-center justify-center gap-2">
                  {gameLoading ? (
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green-100">
                      <circle cx="11" cy="11" r="8"></circle>
                      <path d="m21 21-4.3-4.3"></path>
                    </svg>
                  )}
                  <span className="text-lg">{gameLoading ? 'Loading...' : 'Who are ya?!'}</span>
                </div>
              </button>
            </div>

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
            <div className="rounded-xl shadow-md transition-all hover:shadow-lg border bg-green-50/60 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Filter className="h-5 w-5 text-green-700" />
                  <h3 className="text-lg font-semibold text-green-900">Difficulty Filters</h3>
                </div>
                <button
                  className="text-gray-600 hover:text-gray-800"
                  onClick={() => setCollapsed(c => !c)}
                >
                  {collapsed ? (
                    <ChevronDown className="h-5 w-5" />
                  ) : (
                    <ChevronUp className="h-5 w-5" />
                  )}
                </button>
              </div>

              {!collapsed && !loadingFilters && (
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
                          onClick={clearLeagues}
                          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
                        >
                          <Trash2 className="h-3 w-3" />
                          Clear
                        </button>
                      </div>
                    </div>

                    <SelectedChips
                      title="Chosen leagues"
                      items={selectedLeagueIds}
                      onClear={clearLeagues}
                      getLabel={(id) => leagueIdToLabel[id] || `Unknown League (${id})`}
                      onRemoveItem={(id) => setSelectedLeagueIds(prev => prev.filter(x => x !== id))}
                      hoverClose
                    />

                    <div className="max-h-96 overflow-y-auto pr-2">
                      {Object.entries(groupedLeagues)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([country, leagues]) => (
                          <div key={country} className="mb-2">
                            <button
                              onClick={(e) => {
                                e.preventDefault(); // Prevent form submission
                                toggleCountry(country);
                              }}
                              type="button" // Explicitly mark as button
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
                                    onClick={(e) => e.stopPropagation()} // Prevent bubbling
                                  >
                                    <input
                                      type="checkbox"
                                      checked={selectedLeagueIds.includes(league.league_id)}
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
                            onClick={clearSeasons}
                            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
                          >
                            <Trash2 className="h-3 w-3" />
                            Clear
                          </button>
                        </div>
                      </div>

                      <SelectedChips
                        title="Chosen seasons"
                        items={selectedSeasons}
                        onClear={clearSeasons}
                      />

                      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mt-2">
                        {allSeasons.map((season) => (
                          <button
                            key={season}
                            onClick={() => {
                              setSelectedSeasons(prev =>
                                prev.includes(season) ? prev.filter(s => s !== season) : [...prev, season]
                              );
                            }}
                            className={classNames(
                              'px-2 py-1 text-sm rounded-md border',
                              selectedSeasons.includes(season)
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
                        value={minApps}
                        onChange={(e) => setMinApps(parseInt(e.target.value) || 0)}
                        min="0"
                        max="100"
                        className="w-full px-3 py-2 border rounded-md text-center"
                      />
                      <div className="text-xs text-gray-500 text-center mt-1">
                        Minimum appearances in a season
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
