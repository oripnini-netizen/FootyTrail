// src/pages/GamePage.jsx
// Data model: Competitions + Seasons + Min Market Value (€)
// Includes:
// - State caching (no reload on tab return)
// - Distinct "Difficulty Filters" with 3 collapsibles (competitions, seasons, min MV)
// - Pool counts refresh on change (no full page reload)
// - Min MV quick presets (clear, 100K, 500K, 1M, 5M, 10M, 25M, 50M)
// - Daily Challenge: LLM prompt + fetch today's player and navigate with correct shape
// - "Who are ya?!" button moved to the top of the main card with UserSearch icon

import React, { useEffect, useMemo, useState, useLayoutEffect, useRef } from 'react';
import {
  getCompetitions,
  getSeasons,
  getCounts,
  getRandomPlayer,
  getDailyChallenge,
  getLimits,
  getGamePrompt,
  API_BASE
} from '../api';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { saveGamePageCache, loadGamePageCache, clearGamePageCache } from '../state/gamePageCache.js';

import {
  Users,
  Star,
  Trash2,
  Filter,
  ChevronDown,
  ChevronUp,
  Sparkles,
  UserSearch,
  Timer,
  CheckSquare,
  CalendarClock
} from 'lucide-react';

function classNames(...s) {
  return s.filter(Boolean).join(' ');
}

const fmt = (n) => new Intl.NumberFormat('en-US').format(n || 0);
const fmtCurrency = (n) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(n || 0));

// --- UTC+2 countdown helper ---
const TZ_PLUS2_MS = 2 * 60 * 60 * 1000;
function CountdownToTomorrow() {
  const [timeLeft, setTimeLeft] = useState(getTimeLeft());
  useEffect(() => {
    const id = setInterval(() => setTimeLeft(getTimeLeft()), 1000);
    return () => clearInterval(id);
  }, []);
  function getTimeLeft() {
    const now = new Date();
    const plus2Now = new Date(now.getTime() + TZ_PLUS2_MS);
    const nextMidPlus2 = new Date(plus2Now);
    nextMidPlus2.setUTCHours(24, 0, 0, 0);
    const diff = Math.max(0, nextMidPlus2.getTime() - plus2Now.getTime());
    const hours = Math.floor(diff / 1000 / 60 / 60);
    const minutes = Math.floor((diff / 1000 / 60) % 60);
    const seconds = Math.floor((diff / 1000) % 60);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return <span>{timeLeft}</span>;
}

export default function GamePage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // Page readiness (initial boot only)
  const [pageReady, setPageReady] = useState(false);

  // UI/filters state
  const [loadingFilters, setLoadingFilters] = useState(true);
  const [filtersCollapsed, setFiltersCollapsed] = useState(true);
  const [compCollapsed, setCompCollapsed] = useState(false);
  const [seasonsCollapsed, setSeasonsCollapsed] = useState(false);
  const [mvCollapsed, setMvCollapsed] = useState(false);

  const [groupedCompetitions, setGroupedCompetitions] = useState({});
  const [allSeasons, setAllSeasons] = useState([]);

  const [selectedCompetitionIds, setSelectedCompetitionIds] = useState([]);
  const [selectedSeasons, setSelectedSeasons] = useState([]);
  const [minMarketValue, setMinMarketValue] = useState(0);

  const [expandedCountries, setExpandedCountries] = useState({});
  const [loadingCounts, setLoadingCounts] = useState(false);

  // Prompts
  const [gamePrompt, setGamePrompt] = useState(
    "Get ready to outsmart your rivals and predict the game—let’s kick off a new round now!"
  );
  const [isLoadingPrompt, setIsLoadingPrompt] = useState(true);

  const [dailyPrompt, setDailyPrompt] = useState(
    "Today's Daily Challenge is live! Guess a star from the elite leagues and grab 10,000 points and an extra game."
  );
  const [isLoadingDailyPrompt, setIsLoadingDailyPrompt] = useState(true);

  const [limits, setLimits] = useState({
    gamesToday: 0,
    dailyPlayed: false,
    dailyWin: false,
    pointsToday: 0,
    pointsTotal: 0,
    dailyPlayerName: null,
    dailyPlayerPhoto: null
  });

  // Daily record (name/photo if already played)
  const [daily, setDaily] = useState(null);

  // Counts
  const [poolCount, setPoolCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const potentialPoints = useMemo(() => poolCount * 5, [poolCount]);

  // Start button states
  const [gameLoading, setGameLoading] = useState(false);
  const [dailyLoading, setDailyLoading] = useState(false);

  // Cache management (to keep state when switching tabs)
  const hasRestoredRef = useRef(false);
  const restoredFromCacheRef = useRef(false);

  const gatherStateForCache = () => ({
    scrollY: window.scrollY,
    selectedCompetitionIds,
    selectedSeasons,
    minMarketValue,
    filtersCollapsed,
    compCollapsed,
    seasonsCollapsed,
    mvCollapsed,
    expandedCountries,
    poolCount,
    totalCount,
    gamePrompt
  });

  useLayoutEffect(() => {
    if (hasRestoredRef.current) return;
    const cached = loadGamePageCache();
    if (cached) {
      try {
        if (Array.isArray(cached.selectedCompetitionIds)) setSelectedCompetitionIds(cached.selectedCompetitionIds);
        if (Array.isArray(cached.selectedSeasons)) setSelectedSeasons(cached.selectedSeasons);
        if (Number.isFinite(cached.minMarketValue)) setMinMarketValue(cached.minMarketValue);
        if (typeof cached.filtersCollapsed === 'boolean') setFiltersCollapsed(cached.filtersCollapsed);
        if (typeof cached.compCollapsed === 'boolean') setCompCollapsed(cached.compCollapsed);
        if (typeof cached.seasonsCollapsed === 'boolean') setSeasonsCollapsed(cached.seasonsCollapsed);
        if (typeof cached.mvCollapsed === 'boolean') setMvCollapsed(cached.mvCollapsed);
        if (cached.expandedCountries && typeof cached.expandedCountries === 'object') {
          setExpandedCountries(cached.expandedCountries);
        }
        if (Number.isFinite(cached.poolCount)) setPoolCount(cached.poolCount);
        if (Number.isFinite(cached.totalCount)) setTotalCount(cached.totalCount);
        if (typeof cached.gamePrompt === 'string') setGamePrompt(cached.gamePrompt);

        setPageReady(true);
        setLoadingFilters(false);
        setIsLoadingPrompt(false);

        requestAnimationFrame(() => window.scrollTo(0, cached.scrollY || 0));
        setTimeout(() => window.scrollTo(0, cached.scrollY || 0), 0);

        restoredFromCacheRef.current = true;
      } catch {
        clearGamePageCache();
      }
    }
    hasRestoredRef.current = true;
  }, []);

  useEffect(() => () => saveGamePageCache(gatherStateForCache()), [
    selectedCompetitionIds, selectedSeasons, minMarketValue,
    filtersCollapsed, compCollapsed, seasonsCollapsed, mvCollapsed,
    expandedCountries, gamePrompt, poolCount, totalCount
  ]);

  useEffect(() => {
    const handleHide = () => saveGamePageCache(gatherStateForCache());
    document.addEventListener('visibilitychange', handleHide, { passive: true });
    window.addEventListener('pagehide', handleHide, { passive: true });
    return () => {
      document.removeEventListener('visibilitychange', handleHide);
      window.removeEventListener('pagehide', handleHide);
    };
  }, [selectedCompetitionIds, selectedSeasons, minMarketValue, filtersCollapsed, compCollapsed, seasonsCollapsed, mvCollapsed, expandedCountries, gamePrompt, poolCount, totalCount]);

  // Apply user defaults if not restored from cache
  useEffect(() => {
    if (!restoredFromCacheRef.current && user) {
      const defaultsComp = (user.default_competitions || user.default_leagues || []).map(String);
      const defaultsSeasons = user.default_seasons || [];
      const defaultsMinMV = user.default_min_market_value ?? 0;

      setSelectedCompetitionIds(defaultsComp);
      setSelectedSeasons(defaultsSeasons);
      setMinMarketValue(defaultsMinMV);
    }
  }, [user]);

  // Init: competitions, seasons, limits, daily
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoadingFilters(true);
        setPageReady(false);

        // Competitions
        const compsRes = await getCompetitions();
        if (!cancelled) {
          const grouped = compsRes.groupedByCountry || {};
          setGroupedCompetitions(grouped);
          const initialCollapse = {};
          Object.keys(grouped).forEach((c) => (initialCollapse[c] = false));
          setExpandedCountries((prev) => Object.keys(prev).length ? prev : initialCollapse);
        }

        // Seasons — normalize payload into array of strings (desc)
        const seasonsRes = await getSeasons();
        if (!cancelled) {
          const seasons = normalizeSeasons(seasonsRes);
          setAllSeasons(seasons);
        }

        // Limits/daily
        if (user?.id) {
          try {
            const lim = await getLimits(user.id);
            if (!cancelled) {
              setLimits(lim || { gamesToday: 0, dailyPlayed: false, dailyWin: false, pointsToday: 0, pointsTotal: 0 });
            }
          } catch {
            if (!cancelled) setLimits({ gamesToday: 0, dailyPlayed: false, dailyWin: false, pointsToday: 0, pointsTotal: 0 });
          }
        } else {
          if (!cancelled) setLimits({ gamesToday: 0, dailyPlayed: false, dailyWin: false, pointsToday: 0, pointsTotal: 0 });
        }

        const d = await getDailyChallenge().catch(() => null);
        if (!cancelled) setDaily(d || null);
      } finally {
        if (!cancelled) {
          setLoadingFilters(false);
          setPageReady(true);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [user?.id]);

  // Regular prompt
  useEffect(() => {
    if (restoredFromCacheRef.current) {
      setIsLoadingPrompt(false);
      return;
    }
    (async () => {
      try {
        setIsLoadingPrompt(true);
        const response = await fetch(`${API_BASE}/ai/generate-game-prompt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        if (!response.ok) throw new Error(`Failed to fetch game prompt: ${response.status}`);
        const data = await response.json();
        if (data.prompt) setGamePrompt(data.prompt);
      } catch {
        /* ignore */
      } finally {
        setIsLoadingPrompt(false);
      }
    })();
  }, []);

  // Daily prompt (only matters if not yet played)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setIsLoadingDailyPrompt(true);
        const res = await fetch(`${API_BASE}/ai/generate-daily-prompt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        if (!res.ok) throw new Error('daily prompt fetch failed');
        const data = await res.json();
        if (!cancelled && data?.prompt) setDailyPrompt(data.prompt);
      } catch {
        // keep fallback
      } finally {
        if (!cancelled) setIsLoadingDailyPrompt(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Counts refresh on filter changes (no full page reload)
  useEffect(() => {
    let cancelled = false;
    if (loadingFilters) return;

    (async () => {
      try {
        setLoadingCounts(true);

        const payload = {
          competitions: selectedCompetitionIds,
          seasons: selectedSeasons,
          minMarketValue: Number(minMarketValue) || 0,
          userId: user?.id
        };

        const countsResult = await getCounts(payload);
        const { poolCount: filteredCount, totalCount: dbTotal } = countsResult || {};

        if (!cancelled) {
          setPoolCount(filteredCount || 0);
          setTotalCount(dbTotal || 0);
        }
      } catch {
        if (!cancelled) {
          setPoolCount(0);
          setTotalCount(0);
        }
      } finally {
        if (!cancelled) setLoadingCounts(false);
      }
    })();

    return () => { cancelled = true; };
  }, [selectedCompetitionIds, selectedSeasons, minMarketValue, user?.id, loadingFilters]);

  // Label map for chips
  const compIdToLabel = useMemo(() => {
    const map = {};
    Object.entries(groupedCompetitions || {}).forEach(([country, comps]) => {
      (comps || []).forEach((c) => {
        map[String(c.competition_id)] = `${country} - ${c.competition_name}`;
      });
    });
    return map;
  }, [groupedCompetitions]);

  // Flatten competitions + top 10
  const flatCompetitions = useMemo(() => {
    const out = [];
    Object.values(groupedCompetitions).forEach(arr => (arr || []).forEach(c => out.push(c)));
    return out;
  }, [groupedCompetitions]);

  const top10CompetitionIds = useMemo(() => {
    const arr = [...flatCompetitions];
    arr.sort((a, b) => (Number(b.total_value_eur || 0) - Number(a.total_value_eur || 0)));
    return arr.slice(0, 10).map(c => String(c.competition_id));
  }, [flatCompetitions]);

  // Helpers
  const toggleCompetition = (id) => {
    const sid = String(id);
    setSelectedCompetitionIds((prev) =>
      prev.includes(sid) ? prev.filter((x) => x !== sid) : [...prev, sid]
    );
  };
  const clearCompetitions = () => setSelectedCompetitionIds([]);
  const selectAllCompetitions = () =>
    setSelectedCompetitionIds(flatCompetitions.map(c => String(c.competition_id)));
  const selectTop10Competitions = () => setSelectedCompetitionIds(top10CompetitionIds);

  const clearSeasons = () => setSelectedSeasons([]);
  const selectAllSeasons = () => setSelectedSeasons(allSeasons);
  const handleLast5Seasons = () => setSelectedSeasons(allSeasons.slice(0, 5));

  const toggleCountry = (country) => setExpandedCountries(prev => ({ ...prev, [country]: !prev[country] }));

  // Regular game start
  const onStartGame = async () => {
    try {
      setGameLoading(true);
      const currentFilters = {
        competitions: selectedCompetitionIds,
        seasons: selectedSeasons,
        minMarketValue: Number(minMarketValue) || 0,
        userId: user?.id
      };
      const randomPlayer = await getRandomPlayer(currentFilters, user?.id);
      if (!randomPlayer) {
        alert('No players found with current filters. Try adjusting your selection.');
        return;
      }
      const pp = poolCount * 5;
      navigate('/live', {
        state: {
          ...randomPlayer,
          isDaily: false,
          filters: { ...currentFilters, potentialPoints: pp },
          potentialPoints: pp
        },
        replace: true
      });
    } catch {
      alert('Failed to start game. Please try again.');
    } finally {
      setGameLoading(false);
    }
  };

  // DAILY GAME START — FIXED MAPPING
  const onStartDaily = async () => {
    try {
      setDailyLoading(true);

      const dailyChallenge = await getDailyChallenge();
      if (!dailyChallenge || !dailyChallenge.player_id) {
        alert("No daily challenge available for today.");
        setDailyLoading(false);
        return;
      }

      const res = await fetch(`${API_BASE}/player/${dailyChallenge.player_id}`);
      if (!res.ok) throw new Error('Failed to fetch player data');
      const playerData = await res.json();

      const mappedPlayerData = {
        id:          playerData.id          ?? playerData.player_id,
        name:        playerData.name        ?? playerData.player_name,
        age:         playerData.age         ?? playerData.player_age,
        nationality: playerData.nationality ?? playerData.player_nationality,
        position:    playerData.position    ?? playerData.player_position,
        photo:       playerData.photo       ?? playerData.player_photo,
      };

      if (!mappedPlayerData.id || !mappedPlayerData.name) {
        throw new Error('Daily player payload incomplete');
      }

      const pp = 10000; // fixed potential points for daily
      navigate('/live', {
        state: {
          ...mappedPlayerData,
          isDaily: true,
          filters: { potentialPoints: pp },
          potentialPoints: pp,
        },
        replace: true,
      });
    } catch (e) {
      console.error('Failed to start daily', e);
      alert('Failed to start daily challenge. Please try again.');
    } finally {
      setDailyLoading(false);
    }
  };

  const maxGames = limits?.dailyWin ? 11 : 10;
  const pointsToday = limits?.pointsToday ?? 0;
  const pointsTotal = limits?.pointsTotal ?? 0;
  const isAdmin = (user?.role === 'admin');
  const reachedLimit = !isAdmin && (Number(limits?.gamesToday || 0) >= maxGames);

  const LoadingSpinner = () => (
    <div className="min-h-screen flex flex-col items-center justify-center">
      <div className="mb-4">
        <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-green-700"></div>
      </div>
      <p className="text-green-700 text-lg font-medium">Loading FootyTrail...</p>
      <p className="text-gray-500 mt-2">Calculating player pool and preparing your challenge</p>
    </div>
  );

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-green-50 to-transparent">
      <div className="fixed inset-0 -z-10 bg-gradient-to-b from-green-50 to-transparent" />

      {!pageReady ? (
        <LoadingSpinner />
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
          className="max-w-3xl mx-auto px-4 py-8 space-y-6"
        >
          {/* Daily Challenge */}
          <div className="bg-white rounded-xl shadow-md transition-all hover:shadow-lg p-6 text-center">
            <div className="flex justify-center mb-4">
              <Star className="h-8 w-8 text-yellow-400" />
            </div>
            <h2 className="text-xl font-semibold mb-2">Daily Challenge</h2>
            <p className="text-gray-600 mb-4">
              {!limits.dailyPlayed
                ? (isLoadingDailyPrompt ? 'Loading…' : dailyPrompt)
                : "Next challenge in "}
              {limits.dailyPlayed && <CountdownToTomorrow />}
            </p>
            {daily && (
              <>
                <button
                  className={`inline-flex items-center gap-2 px-6 py-2 rounded-xl font-bold shadow transition-all ${
                    (limits.dailyPlayed || dailyLoading)
                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      : 'bg-gradient-to-r from-yellow-500 to-yellow-700 text-white hover:scale-105'
                  }`}
                  onClick={onStartDaily}
                  disabled={limits.dailyPlayed || dailyLoading}
                >
                  <Sparkles className="h-5 w-5" />
                  {limits.dailyPlayed ? "Already Played" : (dailyLoading ? "Loading…" : "Play Daily Challenge")}
                </button>
                {daily && limits.dailyPlayed && (
                  <div className="mt-4 text-sm text-gray-700">
                    {limits.dailyWin
                      ? <>You <span className="font-bold text-green-600">won</span> today's challenge!<br /></>
                      : <>You <span className="font-bold text-red-600">lost</span> today's challenge.<br /></>}
                    The player was <span className="font-bold">{limits.dailyPlayerName || daily.player_name}</span>.
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

          {/* Progress Stats */}
          <div className="bg-white rounded-xl shadow-md transition-all hover:shadow-lg p-6 grid grid-cols-3 gap-4">
            <div className="text-center">
              <div className="text-xl font-bold">
                {`${limits.gamesToday || 0}/${maxGames}`}
              </div>
              <div className="text-sm text-gray-600">Daily Progress</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-bold text-green-600">{pointsToday}</div>
              <div className="text-sm text-gray-600">Daily Points</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-bold text-blue-600">{pointsTotal}</div>
              <div className="text-sm text-gray-600">Total Points</div>
            </div>
          </div>

          {/* Main card or lockout */}
          {!reachedLimit ? (
            <div className="bg-white rounded-xl shadow-md transition-all hover:shadow-lg p-6">
              {/* Moved Play button to the top (replacing the old big icon) */}
              <div className="flex justify-center mb-4">
                <button
                  onClick={onStartGame}
                  disabled={gameLoading || poolCount === 0}
                  className={classNames(
                    'relative overflow-hidden rounded-xl bg-gradient-to-r from-green-800 via-green-700 to-green-800 px-8 py-3 font-bold text-white shadow-lg transition-all hover:scale-105 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-green-600 focus:ring-offset-2',
                    (gameLoading || poolCount === 0) && 'opacity-70 cursor-not-allowed'
                  )}
                >
                  <div className="absolute inset-0 bg-white opacity-10 transition-opacity hover:opacity-20"></div>
                  <div className="flex items-center justify-center gap-2">
                    {gameLoading ? (
                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                    ) : (
                      <UserSearch className="h-5 w-5 text-green-100" />
                    )}
                    <span className="text-lg">{gameLoading ? 'Loading...' : 'Who are ya?!'}</span>
                  </div>
                </button>
              </div>

              {/* Prompt */}
              <p className="text-center text-gray-600 mb-6">
                {isLoadingPrompt ? (
                  <span className="inline-block animate-pulse">Getting ready for your challenge...</span>
                ) : (
                  gamePrompt
                )}
              </p>

              {/* Player Pool */}
              <div className="bg-yellow-50 rounded-lg p-4 mb-2">
                <div className="flex justify-between items-center">
                  <div>
                    <div className="text-lg font-semibold text-yellow-800">
                      {loadingCounts ? '—' : fmt(potentialPoints)}
                    </div>
                    <div className="text-sm text-yellow-600">Potential Points</div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-semibold text-yellow-800">
                      {loadingCounts ? '—' : fmt(poolCount)} / {loadingCounts ? '—' : fmt(totalCount)}
                    </div>
                    <div className="text-sm text-yellow-600">Player Pool</div>
                  </div>
                </div>
              </div>

              {/* Selected Filters (chips) */}
              <div className="mb-4 mt-4">
                <div className="text-sm text-gray-600 mb-2">Competitions</div>
                <SelectedChips
                  items={selectedCompetitionIds}
                  onClear={() => setSelectedCompetitionIds([])}
                  getLabel={(id) => compIdToLabel[id] || `Unknown Competition (${id})`}
                  onRemoveItem={(id) => setSelectedCompetitionIds(prev => prev.filter(x => x !== id))}
                  hoverClose
                />

                <div className="text-sm text-gray-600 mt-3 mb-2">Seasons</div>
                <SelectedChips
                  items={selectedSeasons}
                  onClear={() => setSelectedSeasons([])}
                  onRemoveItem={(season) => setSelectedSeasons(prev => prev.filter(x => x !== season))}
                  hoverClose
                />

                {Number(minMarketValue) > 0 && (
                  <>
                    <div className="text-sm text-gray-600 mt-3 mb-2">Minimum Market Value (€)</div>
                    <SelectedChips
                      items={[minMarketValue]}
                      onClear={() => setMinMarketValue(0)}
                      getLabel={(v) => `Min MV: ${fmtCurrency(v)}`}
                      onRemoveItem={() => setMinMarketValue(0)}
                      hoverClose
                    />
                  </>
                )}
              </div>

              {/* Filters Panel (3 collapsibles) */}
              <div className="rounded-xl shadow-md transition-all hover:shadow-lg border bg-green-50/60 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Filter className="h-5 w-5 text-green-700" />
                    <h3 className="text-lg font-semibold text-green-900">Difficulty Filters</h3>
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
                        <>
                          <button
                            type="button"
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); selectTop10Competitions(); }}
                            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
                          >
                            <Star className="h-3 w-3" /> Top 10
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); selectAllCompetitions(); }}
                            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
                          >
                            <CheckSquare className="h-3 w-3" /> Select All
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); clearCompetitions(); }}
                            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
                          >
                            <Trash2 className="h-3 w-3" />
                            Clear All
                          </button>
                        </>
                      }
                    >
                      <SelectedChips
                        title="Chosen competitions"
                        items={selectedCompetitionIds}
                        onClear={clearCompetitions}
                        getLabel={(id) => compIdToLabel[id] || `Unknown Competition (${id})`}
                        onRemoveItem={(id) => setSelectedCompetitionIds(prev => prev.filter(x => x !== id))}
                        hoverClose
                      />
                      <div className="max-h-96 overflow-y-auto pr-2">
                        {Object.entries(groupedCompetitions)
                          .sort(([a], [b]) => a.localeCompare(b))
                          .map(([country, comps]) => (
                            <div key={country} className="mb-2">
                              <button
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleCountry(country); }}
                                type="button"
                                className="w-full flex items-center justify-between p-2 hover:bg-green-50 rounded"
                              >
                                <div className="flex items-center gap-2">
                                  {comps?.[0]?.flag_url && (
                                    <img
                                      src={comps[0].flag_url}
                                      alt={country}
                                      className="w-6 h-4 object-cover rounded"
                                    />
                                  )}
                                  <span>{country}</span>
                                  <span className="text-xs text-gray-500">({comps.length})</span>
                                </div>
                                {expandedCountries[country] ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                              </button>

                              {expandedCountries[country] && (
                                <div className="ml-8 space-y-2 mt-2">
                                  {comps.map((c) => {
                                    const cid = String(c.competition_id);
                                    const checked = selectedCompetitionIds.includes(cid);
                                    return (
                                      <label
                                        key={cid}
                                        className="flex items-center gap-2 cursor-pointer"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <input type="checkbox" checked={checked} onChange={() => toggleCompetition(cid)} className="rounded" />
                                        {c.logo_url && (
                                          <img src={c.logo_url} alt={c.competition_name} className="w-5 h-5 object-contain" />
                                        )}
                                        <span className="text-sm">{c.competition_name}</span>
                                        {c.tier && <span className="ml-2 text=[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700">Tier {c.tier}</span>}
                                      </label>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          ))}
                      </div>
                    </Section>

                    {/* Seasons */}
                    <Section
                      title="Seasons"
                      icon={<Users className="h-4 w-4 text-green-700" />}
                      collapsed={seasonsCollapsed}
                      onToggle={() => setSeasonsCollapsed(v => !v)}
                      actions={
                        <>
                          <button
                            type="button"
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleLast5Seasons(); }}
                            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
                          >
                            <CalendarClock className="h-3 w-3" /> Last 5
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); selectAllSeasons(); }}
                            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
                          >
                            <CheckSquare className="h-3 w-3" /> Select All
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); clearSeasons(); }}
                            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
                          >
                            <Trash2 className="h-3 w-3" />
                            Clear All
                          </button>
                        </>
                      }
                    >
                      <SelectedChips title="Chosen seasons" items={selectedSeasons} onClear={clearSeasons} />
                      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mt-2">
                        {allSeasons.map((season) => (
                          <button
                            key={season}
                            type="button"
                            onClick={() =>
                              setSelectedSeasons(prev => prev.includes(season) ? prev.filter(s => s !== season) : [...prev, season])
                            }
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
                    </Section>

                    {/* Minimum Market Value */}
                    <Section
                      title="Minimum Market Value (€)"
                      icon={<Users className="h-4 w-4 text-green-700" />}
                      collapsed={mvCollapsed}
                      onToggle={() => setMvCollapsed(v => !v)}
                    >
                      <div className="flex flex-col gap-3">
                        <div className="flex items-center gap-3">
                          <input
                            type="number"
                            value={minMarketValue}
                            onChange={(e) => setMinMarketValue(parseInt(e.target.value) || 0)}
                            min="0"
                            step="100000"
                            className="w-40 border rounded-md px-2 py-1"
                          />
                          <div className="text-sm text-gray-600">{fmtCurrency(minMarketValue)}</div>
                        </div>
                        {/* Quick presets */}
                        <div className="flex flex-wrap gap-2">
                          <PresetButton title="Clear" onClick={() => setMinMarketValue(0)} active={minMarketValue === 0}>
                            <Trash2 size={14} /> Clear
                          </PresetButton>
                          <PresetButton onClick={() => setMinMarketValue(100000)} active={minMarketValue === 100000}>
                            <Star size={14} /> 100K €
                          </PresetButton>
                          <PresetButton onClick={() => setMinMarketValue(500000)} active={minMarketValue === 500000}>
                            <Star size={14} /> 500K €
                          </PresetButton>
                          <PresetButton onClick={() => setMinMarketValue(1000000)} active={minMarketValue === 1000000}>
                            <Star size={14} /> 1M €
                          </PresetButton>
                          <PresetButton onClick={() => setMinMarketValue(5000000)} active={minMarketValue === 5000000}>
                            <Star size={14} /> 5M €
                          </PresetButton>
                          <PresetButton onClick={() => setMinMarketValue(10000000)} active={minMarketValue === 10000000}>
                            <Star size={14} /> 10M €
                          </PresetButton>
                          <PresetButton onClick={() => setMinMarketValue(25000000)} active={minMarketValue === 25000000}>
                            <Star size={14} /> 25M €
                          </PresetButton>
                          <PresetButton onClick={() => setMinMarketValue(50000000)} active={minMarketValue === 50000000}>
                            <Star size={14} /> 50M €
                          </PresetButton>
                        </div>
                      </div>
                    </Section>
                  </div>
                )}
              </div>
            </div>
          ) : (
            // Lockout view
            <div className="bg-white rounded-xl shadow-md transition-all hover:shadow-lg p-8 text-center">
              <div className="flex justify-center mb-4">
                <Timer className="h-14 w-14 text-green-600" />
              </div>
              <h3 className="text-2xl font-semibold mb-2 text-gray-900">You're done for today!</h3>
              <p className="text-gray-600">
                You’ve finished your {maxGames} games for today. Come back when the new day starts.
              </p>
              <div className="mt-6">
                <div className="text-sm text-gray-500 mb-1">Time until reset</div>
                <div className="text-4xl font-extrabold text-green-700 tracking-widest">
                  <CountdownToTomorrow />
                </div>
              </div>
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}

// ---------- helpers ----------

function normalizeSeasons(payload) {
  let raw = [];
  if (Array.isArray(payload)) {
    raw = payload;
  } else if (payload && Array.isArray(payload.seasons)) {
    raw = payload.seasons;
  } else if (payload && Array.isArray(payload.data)) {
    raw = payload.data;
  } else if (payload && typeof payload === 'object') {
    const collected = [];
    Object.values(payload).forEach((v) => {
      if (Array.isArray(v)) collected.push(...v);
      else if (typeof v === 'string' || typeof v === 'number') collected.push(v);
    });
    raw = collected.length ? collected : [];
  }

  const uniq = Array.from(new Set(raw.map(String)));
  uniq.sort((a, b) => String(b).localeCompare(String(a)));
  return uniq;
}

function Section({ title, icon, collapsed, onToggle, actions, children }) {
  return (
    <div className="rounded-lg border bg-white/60">
      {/* Header row */}
      <div className="flex items-center justify-between px-3 py-2">
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex items-center gap-2"
        >
          {icon}
          <span className="font-medium text-green-900">{title}</span>
          {collapsed ? <ChevronDown className="h-4 w-4 ml-1" /> : <ChevronUp className="h-4 w-4 ml-1" />}
        </button>
        {/* Desktop actions (inline, right side) */}
        <div className="hidden sm:flex items-center gap-2 flex-wrap">{actions}</div>
      </div>

      {/* Mobile actions (second row under title) */}
      {actions && (
        <div className="sm:hidden px-3 pb-2">
          <div className="flex flex-wrap gap-2">
            {actions}
          </div>
        </div>
      )}

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

function SelectedChips({ title, items, onClear, getLabel, onRemoveItem, hoverClose = false }) {
  if (!items?.length) return null;
  return (
    <div className="mb-2">
      {title && <div className="text-xs text-gray-600 mb-1">{title}</div>}
      <div className="flex flex-wrap gap-2">
        {items.map((t, index) => {
          const label = getLabel ? getLabel(t) : String(t);
          return (
            <span
              key={`${String(t)}-${index}`}
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
        <button type="button" onClick={onClear} className="text-xs text-gray-600 underline hover:text-gray-800">
          Clear
        </button>
      </div>
    </div>
  );
}
