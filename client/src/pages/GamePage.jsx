// src/pages/GamePage.jsx
// Switched to new data model: Competitions + Seasons + Min Market Value (€)

import React, { useEffect, useMemo, useState, useLayoutEffect, useRef } from 'react';
import {
  getCompetitions,
  getSeasons,
  getCounts,
  getRandomPlayer,
  getDailyChallenge,
  getLimits,
  API_BASE
} from '../api';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { saveGamePageCache, loadGamePageCache, clearGamePageCache } from '../state/gamePageCache.js';

import {
  UsersRound,
  Star,
  Trash2,
  Filter,
  ChevronDown,
  ChevronUp,
  Sparkles,
  UserSearch,
  Timer,
} from 'lucide-react';

function classNames(...s) {
  return s.filter(Boolean).join(' ');
}

function CountdownToTomorrow() {
  const [timeLeft, setTimeLeft] = useState(getTimeLeft());
  useEffect(() => {
    const id = setInterval(() => setTimeLeft(getTimeLeft()), 1000);
    return () => clearInterval(id);
  }, []);
  function getTimeLeft() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setHours(24, 0, 0, 0);
    const diff = Math.max(0, tomorrow - now);
    const hours = Math.floor(diff / 1000 / 60 / 60);
    const minutes = Math.floor((diff / 1000 / 60) % 60);
    const seconds = Math.floor((diff / 1000) % 60);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return <span>{timeLeft}</span>;
}

const fmt = (n) => new Intl.NumberFormat('en-US').format(n || 0);

export default function GamePage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // Page readiness
  const [pageReady, setPageReady] = useState(false);

  // Data + UI state
  const [daily, setDaily] = useState(null);
  const [loadingFilters, setLoadingFilters] = useState(true);
  const [collapsed, setCollapsed] = useState(true);
  const [groupedCompetitions, setGroupedCompetitions] = useState({});
  const [allSeasons, setAllSeasons] = useState([]);
  const [selectedCompetitionIds, setSelectedCompetitionIds] = useState([]);
  const [selectedSeasons, setSelectedSeasons] = useState([]);
  const [minMarketValue, setMinMarketValue] = useState(0);
  const [loadingCounts, setLoadingCounts] = useState(false);
  const [expandedCountries, setExpandedCountries] = useState({});

  // Game prompt
  const [gamePrompt, setGamePrompt] = useState(
    "Get ready to outsmart your rivals and predict the game—let’s kick off a new round now!"
  );
  const [isLoadingPrompt, setIsLoadingPrompt] = useState(true);

  // Limits
  const [limits, setLimits] = useState({ gamesToday: 0, dailyPlayed: false, dailyWin: false, pointsToday: 0, pointsTotal: 0 });
  const [dailyLoading, setDailyLoading] = useState(false);

  // Counts
  const [poolCount, setPoolCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const potentialPoints = useMemo(() => poolCount * 5, [poolCount]);

  // Start button state
  const [gameLoading, setGameLoading] = useState(false);

  // --------- Cache management ---------
  const hasRestoredRef = useRef(false);
  const restoredFromCacheRef = useRef(false);

  const initialFiltersRef = useRef(null);
  const filtersDirtyRef = useRef(false);

  const gatherStateForCache = () => ({
    scrollY: window.scrollY,
    selectedCompetitionIds,
    selectedSeasons,
    minMarketValue,
    collapsed,
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
        if (typeof cached.collapsed === 'boolean') setCollapsed(cached.collapsed);
        if (cached.expandedCountries && typeof cached.expandedCountries === 'object') {
          setExpandedCountries(cached.expandedCountries);
        }
        if (Number.isFinite(cached.poolCount)) setPoolCount(cached.poolCount);
        if (Number.isFinite(cached.totalCount)) setTotalCount(cached.totalCount);
        if (typeof cached.gamePrompt === 'string') setGamePrompt(cached.gamePrompt);

        initialFiltersRef.current = {
          competitions: (cached.selectedCompetitionIds || []).slice(),
          seasons: (cached.selectedSeasons || []).slice(),
          minMarketValue: cached.minMarketValue ?? 0
        };

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
    selectedCompetitionIds, selectedSeasons, minMarketValue, collapsed, expandedCountries, gamePrompt, poolCount, totalCount
  ]);
  useEffect(() => {
    const handleHide = () => saveGamePageCache(gatherStateForCache());
    document.addEventListener('visibilitychange', handleHide, { passive: true });
    window.addEventListener('pagehide', handleHide, { passive: true });
    return () => {
      document.removeEventListener('visibilitychange', handleHide);
      window.removeEventListener('pagehide', handleHide);
    };
  }, [selectedCompetitionIds, selectedSeasons, minMarketValue, collapsed, expandedCountries, gamePrompt, poolCount, totalCount]);

  // Apply user defaults only if NOT restored (support future fields, fallback to legacy ones)
  useEffect(() => {
    if (!restoredFromCacheRef.current && user) {
      const defaultsComp = (user.default_competitions || user.default_leagues || []).map(String);
      const defaultsSeasons = user.default_seasons || [];
      const defaultsMinMV = user.default_min_market_value ?? user.default_min_appearances ?? 0;

      setSelectedCompetitionIds(defaultsComp);
      setSelectedSeasons(defaultsSeasons);
      setMinMarketValue(defaultsMinMV);

      initialFiltersRef.current = {
        competitions: defaultsComp.slice(),
        seasons: defaultsSeasons.slice(),
        minMarketValue: defaultsMinMV
      };
    }
  }, [user]);

  // Detect when filters change vs initial
  useEffect(() => {
    const init = initialFiltersRef.current;
    if (!init) {
      initialFiltersRef.current = { competitions: selectedCompetitionIds, seasons: selectedSeasons, minMarketValue };
      return;
    }
    const eqArray = (a, b) => {
      if (!Array.isArray(a) || !Array.isArray(b)) return false;
      const aa = [...a].map(String).sort();
      const bb = [...b].map(String).sort();
      if (aa.length !== bb.length) return false;
      for (let i = 0; i < aa.length; i++) if (aa[i] !== bb[i]) return false;
      return true;
    };
    const changed =
      !eqArray(init.competitions, selectedCompetitionIds) ||
      !eqArray(init.seasons, selectedSeasons) ||
      init.minMarketValue !== minMarketValue;
    if (changed) filtersDirtyRef.current = true;
  }, [selectedCompetitionIds, selectedSeasons, minMarketValue]);

  // Start daily
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
        id: playerData.player_id,
        name: playerData.player_name,
        age: playerData.player_age,
        nationality: playerData.player_nationality,
        position: playerData.player_position,
        photo: playerData.player_photo,
      };
      navigate('/live', {
        state: {
          ...mappedPlayerData,
          isDaily: true,
          filters: { potentialPoints: 10000 },
          potentialPoints: 10000,
        },
        replace: true,
      });
    } catch {
      alert('Failed to start daily challenge. Please try again.');
    } finally {
      setDailyLoading(false);
    }
  };

  // Load competitions/seasons/limits/daily
  useEffect(() => {
    let cancelled = false;
    const background = restoredFromCacheRef.current;

    (async () => {
      try {
        if (!background) {
          setLoadingFilters(true);
          setPageReady(false);
        }

        const compsRes = await getCompetitions();
        if (!cancelled) {
          setGroupedCompetitions(compsRes.groupedByCountry || {});
          const initialCollapse = {};
          Object.keys(compsRes.groupedByCountry || {}).forEach((c) => {
            initialCollapse[c] = false;
          });
          setExpandedCountries((prev) => Object.keys(prev).length ? prev : initialCollapse);
        }

        const seasonsRes = await getSeasons();
        if (!cancelled) setAllSeasons(seasonsRes.seasons || []);

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
        if (!cancelled && !background) {
          setLoadingFilters(false);
          setPageReady(true);
        }
        if (background) {
          setLoadingFilters(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [user?.id]);

  // Game prompt (skip if restored)
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

  // Recalculate counts
  useEffect(() => {
    let cancelled = false;

    const shouldSkip =
      restoredFromCacheRef.current && !filtersDirtyRef.current;

    if (shouldSkip || loadingFilters) return;

    (async () => {
      try {
        setLoadingCounts(true);
        if (!restoredFromCacheRef.current) setPageReady(false);

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
          setPageReady(true);
        }
      } catch {
        if (!cancelled) {
          setPoolCount(0);
          setTotalCount(0);
          setPageReady(true);
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

  // Helpers
  const toggleCompetition = (id) => {
    const sid = String(id);
    setSelectedCompetitionIds((prev) =>
      prev.includes(sid) ? prev.filter((x) => x !== sid) : [...prev, sid]
    );
  };
  const clearCompetitions = () => setSelectedCompetitionIds([]);
  const clearSeasons = () => setSelectedSeasons([]);
  const handleLast5Seasons = () => setSelectedSeasons(allSeasons.slice(0, 5));
  const toggleCountry = (country) => setExpandedCountries(prev => ({ ...prev, [country]: !prev[country] }));

  // Start regular game
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

          {/* Game Setup OR Lockout */}
          {!reachedLimit ? (
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

              {/* Player Pool */}
              <div className="bg-yellow-50 rounded-lg p-4 mb-6">
                <div className="flex justify-between items-center">
                  <div>
                    <div className="text-lg font-semibold text-yellow-800">{fmt(potentialPoints)}</div>
                    <div className="text-sm text-yellow-600">Potential Points</div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-semibold text-yellow-800">
                      {fmt(poolCount)} / {fmt(totalCount)}
                    </div>
                    <div className="text-sm text-yellow-600">Player Pool</div>
                  </div>
                </div>
              </div>

              {/* Play */}
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

              {/* Selected Filters */}
              <div className="mb-4">
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
                      getLabel={(v) => `Min MV: €${fmt(v)}`}
                      onRemoveItem={() => setMinMarketValue(0)}
                      hoverClose
                    />
                  </>
                )}
              </div>

              {/* Filters Panel */}
              <div className="rounded-xl shadow-md transition-all hover:shadow-lg border bg-green-50/60 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Filter className="h-5 w-5 text-green-700" />
                    <h3 className="text-lg font-semibold text-green-900">Difficulty Filters</h3>
                  </div>
                  <button className="text-gray-600 hover:text-gray-800" onClick={() => setCollapsed(c => !c)}>
                    {collapsed ? <ChevronDown className="h-5 w-5" /> : <ChevronUp className="h-5 w-5" />}
                  </button>
                </div>

                {!collapsed && !loadingFilters && (
                  <div className="mt-4 space-y-6">
                    {/* Competitions */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Star className="h-4 w-4 text-green-700" />
                          <span className="font-medium text-green-900">Competitions Filter</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={clearCompetitions}
                            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
                          >
                            <Trash2 className="h-3 w-3" />
                            Clear
                          </button>
                        </div>
                      </div>

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
                                onClick={(e) => { e.preventDefault(); toggleCountry(country); }}
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
                                      <label key={cid} className="flex items-center gap-2 cursor-pointer" onClick={(e) => e.stopPropagation()}>
                                        <input type="checkbox" checked={checked} onChange={() => toggleCompetition(cid)} className="rounded" />
                                        {c.logo_url && (
                                          <img src={c.logo_url} alt={c.competition_name} className="w-5 h-5 object-contain" />
                                        )}
                                        <span className="text-sm">{c.competition_name}</span>
                                        {c.tier && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700">Tier {c.tier}</span>}
                                      </label>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          ))}
                      </div>
                    </div>

                    {/* Seasons + Min Market Value */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
                      <div className="md:col-span-2">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <UsersRound className="h-4 w-4 text-green-700" />
                            <span className="font-medium text-green-900">Season Filter</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button onClick={handleLast5Seasons} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50">
                              Last 5
                            </button>
                            <button onClick={clearSeasons} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50">
                              <Trash2 className="h-3 w-3" />
                              Clear
                            </button>
                          </div>
                        </div>

                        <SelectedChips title="Chosen seasons" items={selectedSeasons} onClear={clearSeasons} />

                        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mt-2">
                          {allSeasons.map((season) => (
                            <button
                              key={season}
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
                      </div>

                      {/* Minimum Market Value (€) */}
                      <div className="flex flex-col items-center">
                        <div className="flex items-center gap-2 mb-2">
                          <UsersRound className="h-4 w-4 text-green-700" />
                          <span className="font-medium text-green-900">Minimum Market Value (€)</span>
                        </div>
                        <input
                          type="number"
                          value={minMarketValue}
                          onChange={(e) => setMinMarketValue(parseInt(e.target.value) || 0)}
                          min="0"
                          step="100000"
                          className="w-full px-3 py-2 border rounded-md text-center"
                        />
                        <div className="text-xs text-gray-500 text-center mt-1">Players whose max value ≥ this number</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            // ======= LOCKOUT VIEW (limit reached) =======
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

// Small chip helper
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
        <button onClick={onClear} className="text-xs text-gray-600 underline hover:text-gray-800">
          Clear
        </button>
      </div>
    </div>
  );
}
