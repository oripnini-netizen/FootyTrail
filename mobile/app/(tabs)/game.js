// mobile/app/(tabs)/game.js
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  ScrollView,
  Alert,
  StyleSheet,
  TextInput,
  Image,
  DeviceEventEmitter,
  RefreshControl,
  AppState,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { supabase } from "../../lib/supabase";
import {
  getCompetitions,   // (left intact, not used now for dropdowns)
  getSeasons,        // (left intact, not used now for dropdowns)
  getCounts,
  getRandomPlayer,
  getDailyChallenge,
  getLimits,
  API_BASE,
  utcNow,            // <-- NEW: import UTC helper
} from "../../lib/api";

// ✨ NEW: detect when this screen regains focus (so we refresh limits/daily)
import { useIsFocused } from "@react-navigation/native";
import AsyncStorage from "@react-native-async-storage/async-storage";

// >>> NEW (fonts): load Google Font "Tektur"
import {
  useFonts,
  Tektur_400Regular,
  Tektur_700Bold,
} from "@expo-google-fonts/tektur";

/* ---------------- helpers ---------------- */

const fmt = (n) => new Intl.NumberFormat("en-US").format(Number(n || 0));

function compactMoney(n) {
  const num = Number(n || 0);
  if (num >= 1_000_000_000) return `${Math.round(num / 1_000_000_000)}B`;
  if (num >= 1_000_000) return `${Math.round(num / 1_000_000)}M`;
  if (num >= 1_000) return `${Math.round(num / 1_000)}K`;
  return `${num}`;
}

function msUntilNextUtcMidnight() {
  const now = utcNow(); // <-- use UTC helper
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  );
  return next.getTime() - now.getTime();
}
function useCountdownToTomorrow() {
  const [timeLeft, setTimeLeft] = useState(format(msUntilNextUtcMidnight()));
  useEffect(() => {
    const id = setInterval(
      () => setTimeLeft(format(msUntilNextUtcMidnight())),
      1000
    );
    return () => clearInterval(id);
  }, []);
  function format(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const h = String(Math.floor(totalSec / 3600)).padStart(2, "0");
    const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
    const s = String(totalSec % 60).padStart(2, "0");
    return `${h}:${m}:${s}`;
  }
  return timeLeft;
}

// ---- UTC day key helpers (to force-refresh after 00:00 UTC) ----
const UTC_DAY_KEY = "ft:lastUtcDaySeen";
function getUtcDayKey(d = utcNow()) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`; // e.g., 2025-09-28 (UTC)
}

// Run a callback exactly at the next UTC midnight while app is in foreground
function scheduleRefreshAtUtcMidnight(cb) {
  const ms = msUntilNextUtcMidnight();
  const id = setTimeout(cb, Math.max(0, ms) + 50); // tiny buffer
  return () => clearTimeout(id);
}

/* ---------------- UI atoms ---------------- */

function Chip({ children, onPress, selected = false, variant = "solid", style }) {
  const solid = variant === "solid";
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        selected
          ? { backgroundColor: "#14532d", borderColor: "#14532d" }
          : solid
            ? { backgroundColor: "#fff", borderColor: "#d1d5db" }
            : { backgroundColor: "transparent", borderColor: "#d1d5db" },
        style,
      ]}
    >
      <Text
        style={{
          color: selected ? "#fff" : "#111827",
          fontSize: 12,
          fontWeight: "600",
          fontFamily: "Tektur_700Bold", // font only
        }}
      >
        {children}
      </Text>
    </Pressable>
  );
}

function CompetitionRow({ comp, selected, onToggle }) {
  return (
    <Pressable
      onPress={() => onToggle(String(comp.competition_id))}
      style={styles.compRow}
    >
      {comp.flag_url ? (
        <Image source={{ uri: comp.flag_url }} style={styles.flag} />
      ) : (
        <View style={[styles.flag, { backgroundColor: "#e5e7eb" }]} />
      )}
      {comp.logo_url ? (
        <Image source={{ uri: comp.logo_url }} style={styles.logo} />
      ) : (
        <View style={[styles.logo, { backgroundColor: "#eef2f7" }]} />
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.compName} numberOfLines={1}>
          {comp.competition_name}
        </Text>
        <Text style={styles.compSub} numberOfLines={1}>
          {comp.country}
        </Text>
      </View>
      <Ionicons
        name={selected ? "checkbox" : "square-outline"}
        size={20}
        color={selected ? "#14532d" : "#9ca3af"}
      />
    </Pressable>
  );
}

/* ===========================================================
 *  Mobile Game Screen — Daily enabled; defaults applied only once
 * =========================================================== */
export default function GameScreen() {
  const router = useRouter();
  const countdown = useCountdownToTomorrow();
  const isFocused = useIsFocused();

  // >>> ADDED: ref + listener to handle FT_SCROLL_TO_TOP_GAME
  const scrollRef = useRef(null);

  // Build a map of UTC-day => rows for that day (non-elimination only)
  function dayKeyUTC(ts) {
    const d = new Date(ts);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }

  async function fetchRecentNonElimRows(userId, daysBack = 60) {
    const now = utcNow();
    const startUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysBack));
    const { data, error } = await supabase
      .from("games_records")
      .select("created_at, is_daily_challenge, won, is_elimination_game")
      .eq("user_id", userId)
      .eq("is_elimination_game", false)
      .gte("created_at", startUtc.toISOString())
      .order("created_at", { ascending: false });
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }

  function computeDailyStreak(dayMap) {
    // helper: did the user play the daily on a given UTC day?
    const hasDaily = (key) => {
      const rows = dayMap.get(key) || [];
      return rows.some((r) => r.is_daily_challenge === true);
    };

    let cursor = utcNow();
    // if today doesn't qualify, start counting from yesterday
    if (!hasDaily(getUtcDayKey(cursor))) {
      cursor = new Date(
        Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate() - 1)
      );
    }

    let streak = 0;
    while (true) {
      const key = getUtcDayKey(cursor);
      if (!hasDaily(key)) break;
      streak += 1;
      cursor = new Date(
        Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate() - 1)
      );
    }
    return streak;
  }

  function computeRegularStreak(dayMap) {
    // helper: did the user complete ALL regular games on a given UTC day?
    // (10 if daily not won that day, 11 if daily was won)
    const completedRegulars = (key) => {
      const rows = dayMap.get(key) || [];
      const dailyWon = rows.some((r) => r.is_daily_challenge === true && r.won === true);
      const required = dailyWon ? 11 : 10;
      const regularCount = rows.filter((r) => r.is_daily_challenge !== true).length;
      return regularCount >= required;
    };

    let cursor = utcNow();
    // if today doesn't qualify, start counting from yesterday
    if (!completedRegulars(getUtcDayKey(cursor))) {
      cursor = new Date(
        Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate() - 1)
      );
    }

    let streak = 0;
    while (true) {
      const key = getUtcDayKey(cursor);
      if (!completedRegulars(key)) break;
      streak += 1;
      cursor = new Date(
        Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate() - 1)
      );
    }
    return streak;
  }

  async function refreshStreaks(userId) {
    const rows = await fetchRecentNonElimRows(userId);
    const map = new Map();
    rows.forEach(r => {
      const key = dayKeyUTC(r.created_at);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    });
    setDailyStreak(computeDailyStreak(map));
    setRegularStreak(computeRegularStreak(map));
  }


  useEffect(() => {
    const sub = DeviceEventEmitter.addListener("FT_SCROLL_TO_TOP_GAME", () => {
      // scroll the top-level ScrollView to the top
      scrollRef.current?.scrollTo?.({ y: 0, animated: true });
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener("FT_FORCE_RELOAD_DEFAULT_FILTERS", async () => {
      try {
        if (!user?.id) return;

        const { data: profile, error } = await supabase
          .from("users")
          .select(
            "default_competitions, default_seasons, default_min_market_value, default_min_appearances"
          )
          .eq("id", user.id)
          .single();
        if (error) throw error;

        const dbDefaults = {
          competitions: (profile?.default_competitions || []).map(String),
          seasons: (profile?.default_seasons || []).map(String),
          minMarketValue: Number(profile?.default_min_market_value ?? 0),
          minAppearances: Number(profile?.default_min_appearances ?? 0),
        };

        // update our "source of truth" + visible filters
        defaultRef.current = dbDefaults;
        setSelectedCompetitionIds(dbDefaults.competitions);
        setSelectedSeasons(dbDefaults.seasons);
        setMinMarketValue(dbDefaults.minMarketValue);
        setMinAppearances(dbDefaults.minAppearances);
      } catch (e) {
        console.warn("[game] Failed to reload defaults", e);
      }
    });
    return () => sub.remove();
  }, [user?.id]);


  // >>> NEW (fonts) <<<
  const [fontsLoaded] = useFonts({
    Tektur_400Regular,
    Tektur_700Bold,
  });

  const [user, setUser] = useState(null);
  const [bootLoading, setBootLoading] = useState(true);

  // Limits + Daily state
  const [limits, setLimits] = useState({
    gamesToday: 0,
    pointsToday: 0,
    pointsTotal: 0,
    dailyPlayed: false,
    dailyWin: false,
    dailyPlayerName: null,
    dailyPlayerPhoto: null,
  });
  const [daily, setDaily] = useState(null);
  const [dailyLoading, setDailyLoading] = useState(false);
  // Streaks
  const [dailyStreak, setDailyStreak] = useState(0);     // # of consecutive UTC days with a daily played
  const [regularStreak, setRegularStreak] = useState(0); // # of consecutive UTC days with all regular games completed


  // Data for filters
  const [allCompetitions, setAllCompetitions] = useState([]);
  const [allSeasons, setAllSeasons] = useState([]);

  // Selections (initialized from user defaults ONCE)
  const [selectedCompetitionIds, setSelectedCompetitionIds] = useState([]);
  const [selectedSeasons, setSelectedSeasons] = useState([]);
  const [minMarketValue, setMinMarketValue] = useState(0);
  const [minAppearances, setMinAppearances] = useState(0);

  // Keep a snapshot of DB defaults for "Apply Default Filters" + equality checks
  const defaultRef = useRef({
    competitions: [],
    seasons: [],
    minMarketValue: 0,
    minAppearances: 0,
  });
  const appliedDefaultsOnceRef = useRef(false);

  // Player pool
  const [poolCount, setPoolCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [loadingCounts, setLoadingCounts] = useState(false);
  const [countsError, setCountsError] = useState("");

  // Dropdowns
  const [compOpen, setCompOpen] = useState(false);
  const [compQuery, setCompQuery] = useState("");
  const [seasonsOpen, setSeasonsOpen] = useState(false);
  const [seasonQuery, setSeasonQuery] = useState("");

  // Filters wrapper (collapsed by default)
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Buttons
  const [gameLoading, setGameLoading] = useState(false);

  // Pull-to-refresh
  const [refreshing, setRefreshing] = useState(false); // <-- ADDED

  /* --------- SAME loading method as default-filters.js --------- */
  async function fetchFromWebAPI() {
    const base = process.env.EXPO_PUBLIC_API_BASE;
    if (!base) return null;
    try {
      const [cRes, sRes] = await Promise.all([
        fetch(`${base}/competitions`, { headers: { Accept: "application/json" } }),
        fetch(`${base}/seasons`, { headers: { Accept: "application/json" } }),
      ]);
      if (!cRes.ok || !sRes.ok) return null;

      const comps = await cRes.json(); // { groupedByCountry: { country: [..] } }
      const seas = await sRes.json();  // { seasons: [..] }

      const flat = [];
      Object.entries(comps.groupedByCountry || {}).forEach(([country, arr]) =>
        (arr || []).forEach((c) => flat.push({ ...c, country }))
      );

      return {
        flatCompetitions: flat,
        seasons: Array.isArray(seas.seasons)
          ? seas.seasons
            .map(String)
            .filter((s) => s && s.toLowerCase() !== "null" && s.toLowerCase() !== "undefined")
          : [],
      };
    } catch {
      return null;
    }
  }

  async function fetchFromSupabaseFallback() {
    const { data: comps, error: compErr } = await supabase
      .from("competitions")
      .select("country, competition_id, competition_name, flag_url, logo_url, total_value_eur")
      .order("country", { ascending: true });
    if (compErr) throw compErr;

    const { data: seasonsRows, error: seasonsErr } = await supabase
      .from("v_competitions_with_seasons")
      .select("seasons");
    if (seasonsErr) throw seasonsErr;

    const set = new Set();
    (seasonsRows || []).forEach((r) => {
      const raw = r?.seasons;
      let arr = [];
      if (Array.isArray(raw)) {
        arr = raw;
      } else if (typeof raw === "string") {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) arr = parsed;
        } catch { /* ignore */ }
      }
      arr.forEach((s) => {
        const v = String(s ?? "").trim();
        if (v && v.toLowerCase() !== "null" && v.toLowerCase() !== "undefined") {
          set.add(v);
        }
      });
    });

    const seasons = Array.from(set)
      .filter(Boolean)
      .sort((a, b) => Number(b) - Number(a));

    return {
      flatCompetitions: (comps || []).map((c) => ({ ...c })),
      seasons,
    };
  }
  /* ------------------------------------------------------------- */

  /* -------- Boot: session, profile defaults, competitions, seasons, limits, daily -------- */
  useEffect(() => {
    let mounted = true;
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user) {
        useRouter().replace("/login");
        return;
      }
      if (!mounted) return;
      setUser(session.user);

      const { data: profile } = await supabase
        .from("users")
        .select(
          "has_completed_onboarding, default_competitions, default_seasons, default_min_market_value, default_min_appearances"
        )
        .eq("id", session.user.id)
        .single();

      if (profile && profile.has_completed_onboarding === false) {
        useRouter().replace("/tutorial");
        return;
      }

      // Store DB defaults in a ref (single source of truth)
      const dbDefaults = {
        competitions: (profile?.default_competitions || []).map(String),
        seasons: (profile?.default_seasons || []).map(String),
        minMarketValue: Number(profile?.default_min_market_value ?? 0),
        minAppearances: Number(profile?.default_min_appearances ?? 0),
      };
      defaultRef.current = dbDefaults;

      // Apply defaults to CURRENT filter state ONCE (user can change afterwards)
      if (!appliedDefaultsOnceRef.current) {
        setSelectedCompetitionIds(dbDefaults.competitions);
        setSelectedSeasons(dbDefaults.seasons);
        setMinMarketValue(dbDefaults.minMarketValue);
        setMinAppearances(dbDefaults.minAppearances);
        appliedDefaultsOnceRef.current = true;
      }

      try {
        // *** competitions/seasons loading identical to default-filters.js ***
        let payload = await fetchFromWebAPI();
        if (!payload) payload = await fetchFromSupabaseFallback();

        setAllCompetitions(payload?.flatCompetitions || []);
        setAllSeasons(payload?.seasons || []);

        // Limits + Daily
        const lim = await getLimits(session.user.id).catch(() => null);
        if (lim) setLimits((l) => ({ ...l, ...lim }));

        const d = await getDailyChallenge().catch(() => null);
        setDaily(d || null);
        if (session?.user?.id) {
          try { await refreshStreaks(session.user.id); } catch { }
        }

      } finally {
        if (mounted) setBootLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // ✨ NEW: Refresh limits + daily whenever this screen regains focus (e.g., after finishing the daily)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isFocused || !user?.id) return;
      try {
        const lim = await getLimits(user.id).catch(() => null);
        if (!cancelled && lim) setLimits((l) => ({ ...l, ...lim }));
        const d = await getDailyChallenge().catch(() => null);
        if (!cancelled) setDaily(d || null);
        try { await refreshStreaks(user.id); } catch { }
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, [isFocused, user?.id]);

  /* -------- Counts refresh on filter change -------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user) return;
      try {
        setLoadingCounts(true);
        setCountsError("");
        const payload = {
          competitions: selectedCompetitionIds,
          seasons: selectedSeasons,
          minMarketValue: Number(minMarketValue) || 0,
          minAppearances: Number(minAppearances) || 0,
          userId: user.id,
        };
        const res = await getCounts(payload);
        if (!cancelled) {
          setPoolCount(res?.poolCount || 0);
          setTotalCount(res?.totalCount || 0);
        }
      } catch (e) {
        if (!cancelled) {
          setPoolCount(0);
          setTotalCount(0);
          setCountsError(String(e?.message || e));
        }
      } finally {
        if (!cancelled) setLoadingCounts(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, selectedCompetitionIds, selectedSeasons, minMarketValue, minAppearances]);

  /* -------- Filter helpers -------- */

  const filteredCompetitions = useMemo(() => {
    const q = (compQuery || "").trim().toLowerCase();
    if (!q) return allCompetitions;
    return allCompetitions.filter((c) => {
      const a = `${c?.competition_name || ""} ${c?.country || ""}`.toLowerCase();
      return a.includes(q);
    });
  }, [allCompetitions, compQuery]);

  // Order: selected first, then by country+name
  const compsOrderedForDropdown = useMemo(() => {
    const sel = new Set(selectedCompetitionIds);
    return [...filteredCompetitions].sort((a, b) => {
      const aid = String(a.competition_id);
      const bid = String(b.competition_id);
      const sa = sel.has(aid) ? 0 : 1;
      const sb = sel.has(bid) ? 0 : 1;
      if (sa !== sb) return sa - sb;
      const an = `${a.country} ${a.competition_name}`.toLowerCase();
      const bn = `${b.country} ${b.competition_name}`.toLowerCase();
      return an.localeCompare(bn);
    });
  }, [filteredCompetitions, selectedCompetitionIds]);

  const top10Ids = useMemo(() => {
    // heuristic: first 10 by total_value_eur desc if available, else first 10
    const sorted = [...allCompetitions].sort(
      (a, b) => Number(b.total_value_eur || 0) - Number(a.total_value_eur || 0)
    );
    return sorted.slice(0, 10).map((c) => String(c.competition_id));
  }, [allCompetitions]);

  const toggleCompetition = (id) => {
    setSelectedCompetitionIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };
  const clearComps = () => setSelectedCompetitionIds([]);
  const selectAllComps = () =>
    setSelectedCompetitionIds(allCompetitions.map((c) => String(c.competition_id)));
  const selectTop10 = () => setSelectedCompetitionIds(top10Ids);

  // Seasons
  const filteredSeasons = useMemo(() => {
    const q = (seasonQuery || "").trim();
    if (!q) return allSeasons;
    return allSeasons.filter((s) => s.includes(q));
  }, [allSeasons, seasonQuery]);

  const seasonsOrderedForDropdown = useMemo(() => {
    const sel = new Set(selectedSeasons);
    return [...filteredSeasons].sort((a, b) => {
      const sa = sel.has(a) ? 0 : 1;
      const sb = sel.has(b) ? 0 : 1;
      if (sa !== sb) return sa - sb;
      return Number(b) - Number(a);
    });
  }, [filteredSeasons, selectedSeasons]);

  const toggleSeason = (season) => {
    setSelectedSeasons((prev) =>
      prev.includes(season) ? prev.filter((s) => s !== season) : [...prev, season]
    );
  };
  const selectAllSeasons = () => setSelectedSeasons(allSeasons);
  const clearSeasons = () => setSelectedSeasons([]);
  const selectLast3 = () => setSelectedSeasons(allSeasons.slice(0, 3));
  const selectLast5 = () => setSelectedSeasons(allSeasons.slice(0, 5));

  // Active pill states
  const arraysEqualAsSets = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

  const isTop10Selected =
    selectedCompetitionIds.length > 0 &&
    top10Ids.length > 0 &&
    arraysEqualAsSets(selectedCompetitionIds, top10Ids);

  const isAllCompsSelected =
    allCompetitions.length > 0 &&
    selectedCompetitionIds.length === allCompetitions.length;

  const isClearComps = selectedCompetitionIds.length === 0;

  const isLast3Seasons =
    allSeasons.length >= 3 &&
    selectedSeasons.length === 3 &&
    arraysEqualAsSets(selectedSeasons, allSeasons.slice(0, 3));

  const isLast5Seasons =
    allSeasons.length >= 5 &&
    selectedSeasons.length === 5 &&
    arraysEqualAsSets(selectedSeasons, allSeasons.slice(0, 5));

  const isAllSeasons =
    allSeasons.length > 0 && selectedSeasons.length === allSeasons.length;

  const isClearSeasons = selectedSeasons.length === 0;

  /* -------- Defaults chips -------- */

  const atDBDefaults =
    arraysEqualAsSets(selectedCompetitionIds, defaultRef.current.competitions) &&
    arraysEqualAsSets(selectedSeasons, defaultRef.current.seasons) &&
    Number(minMarketValue) === Number(defaultRef.current.minMarketValue) &&
    Number(minAppearances) === Number(defaultRef.current.minAppearances);

  const applyDefaultFilters = () => {
    const d = defaultRef.current;
    setSelectedCompetitionIds(d.competitions);
    setSelectedSeasons(d.seasons);
    setMinMarketValue(d.minMarketValue);
    setMinAppearances(d.minAppearances);
  };

  /* -------- Start game actions -------- */

  const startRegular = async () => {
    try {
      setGameLoading(true);

      // 1) Build the exact same filters the server uses for the pool
      const roundFilters = {
        competitions: selectedCompetitionIds.map(String),
        seasons: selectedSeasons.map(String),
        minMarketValue: Number(minMarketValue) || 0,
        minAppearances: Number(minAppearances) || 0,
        userId: user?.id,
      };

      // 2) Get a player using those filters (this returns a complete player)
      const player = await getRandomPlayer(roundFilters, user?.id);
      if (!player) {
        Alert.alert("No players found", "Try adjusting your filters.");
        return;
      }

      // 3) Potential points from the current pool size
      const potentialPoints = Math.max(0, Number(poolCount) * 5);

      // 4) Navigate with a full payload: full player + real filters
      router.push({
        pathname: "/live-game",
        params: {
          payload: JSON.stringify({
            ...player,
            isDaily: false,
            potentialPoints,
            filters: {
              competitions: roundFilters.competitions,
              seasons: roundFilters.seasons,
              minMarketValue: roundFilters.minMarketValue,
              minAppearances: roundFilters.minAppearances,
            },
          }),
        },
      });
    } catch (e) {
      Alert.alert("Failed to start game", String(e?.message || e));
    } finally {
      setGameLoading(false);
    }
  };

  const startDaily = async () => {
    try {
      setDailyLoading(true);

      const d = daily || (await getDailyChallenge());
      if (!d?.player_id && !d?.id) {
        Alert.alert("No daily challenge available");
        return;
      }
      const playerId = String(d.player_id ?? d.id);

      // 1) Fetch the full player record by id so the payload is complete
      //    (same source live-game uses for transfers/facts)
      const res = await fetch(`${API_BASE}/player/${encodeURIComponent(playerId)}`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error("Failed to load daily player");
      const full = await res.json();

      // 2) Build the player object from canonical fields
      const player = {
        id: playerId,
        name: full.name ?? full.player_name ?? d.player_name ?? d.name,
        age: full.age ?? full.player_age ?? null,
        nationality: full.nationality ?? full.player_nationality ?? null,
        position: full.position ?? full.player_position ?? null,
        photo: full.photo || full.player_photo || full.player_photo_url || null,
        funFact: full.funFact ?? null,
      };

      // 3) Daily has fixed potential; no pool filters (and Postgame won’t show “Play Again” for daily)
      router.push({
        pathname: "/live-game",
        params: {
          payload: JSON.stringify({
            ...player,
            isDaily: true,
            potentialPoints: 10000,
            filters: {}, // keep structure consistent, not used for Daily
          }),
        },
      });
    } catch (e) {
      Alert.alert("Failed to start daily", String(e?.message || e));
    } finally {
      setDailyLoading(false);
    }
  };

  /* ---------- NON-elimination daily metrics (as on web) ---------- */
  const [nonElimTodayCount, setNonElimTodayCount] = useState(null);
  const [nonElimTodayPoints, setNonElimTodayPoints] = useState(null);
  const [nonElimTotalPoints, setNonElimTotalPoints] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!user?.id) {
          if (!cancelled) {
            setNonElimTodayCount(null);
            setNonElimTodayPoints(null);
            setNonElimTotalPoints(null);
          }
          return;
        }
        // UTC boundaries for "today"
        const now = utcNow(); // <-- use UTC helper
        const startUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        const endUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));

        // Today (non-elimination)
        const { data: todayRows, error: e1 } = await supabase
          .from("games_records")
          .select("points_earned, created_at, is_daily_challenge")
          .eq("user_id", user.id)
          .eq("is_elimination_game", false)
          .gte("created_at", startUtc.toISOString())
          .lt("created_at", endUtc.toISOString());
        if (e1) throw e1;

        const todayCount = (todayRows || []).filter((r) => r?.is_daily_challenge !== true).length;
        const todayPoints = (todayRows || []).reduce((sum, r) => sum + Number(r?.points_earned || 0), 0);

        // Total (non-elimination)
        const { data: totalRows, error: e2 } = await supabase
          .from("games_records")
          .select("points_earned")
          .eq("user_id", user.id)
          .eq("is_elimination_game", false);
        if (e2) throw e2;

        const totalPoints = (totalRows || []).reduce((sum, r) => sum + Number(r?.points_earned || 0), 0);

        if (!cancelled) {
          setNonElimTodayCount(todayCount);
          setNonElimTodayPoints(todayPoints);
          setNonElimTotalPoints(totalPoints);
        }
      } catch {
        // fall back to server-provided limits
        if (!cancelled) {
          setNonElimTodayCount(null);
          setNonElimTodayPoints(null);
          setNonElimTotalPoints(null);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, limits?.gamesToday, limits?.pointsToday, limits?.pointsTotal]); // recompute after playing etc.

  const maxGames = limits?.dailyWin ? 11 : 10;

  // Effective values (prefer non-elimination query results; otherwise limits)
  const gamesTodayEffective = (nonElimTodayCount != null)
    ? nonElimTodayCount
    : Number(limits?.gamesToday || 0);

  const pointsTodayEffective = (nonElimTodayPoints != null)
    ? nonElimTodayPoints
    : (limits?.pointsToday ?? 0);

  const pointsTotalEffective = (nonElimTotalPoints != null)
    ? nonElimTotalPoints
    : (limits?.pointsTotal ?? 0);

  // >>> NEW (lockout): reached daily limit?
  const reachedLimit = gamesTodayEffective >= maxGames;

  // === ADDED: pull-to-refresh handler ===
  const handleRefresh = async () => {
    if (!user?.id) return;
    setRefreshing(true);
    try {
      // 1) refresh limits & daily
      const [lim, d] = await Promise.all([
        getLimits(user.id).catch(() => null),
        getDailyChallenge().catch(() => null),
      ]);
      if (lim) setLimits((l) => ({ ...l, ...lim }));
      setDaily(d || null);

      // 2) refresh the user's DEFAULT FILTERS from DB and apply
      const { data: profile, error } = await supabase
        .from("users")
        .select(
          "default_competitions, default_seasons, default_min_market_value, default_min_appearances"
        )
        .eq("id", user.id)
        .single();
      if (error) throw error;

      const dbDefaults = {
        competitions: (profile?.default_competitions || []).map(String),
        seasons: (profile?.default_seasons || []).map(String),
        minMarketValue: Number(profile?.default_min_market_value ?? 0),
        minAppearances: Number(profile?.default_min_appearances ?? 0),
      };
      defaultRef.current = dbDefaults;
      setSelectedCompetitionIds(dbDefaults.competitions);
      setSelectedSeasons(dbDefaults.seasons);
      setMinMarketValue(dbDefaults.minMarketValue);
      setMinAppearances(dbDefaults.minAppearances);

      // 3) refresh counts for the (now updated) filters
      setCountsError("");
      setLoadingCounts(true);
      const payload = {
        competitions: dbDefaults.competitions,
        seasons: dbDefaults.seasons,
        minMarketValue: Number(dbDefaults.minMarketValue) || 0,
        minAppearances: Number(dbDefaults.minAppearances) || 0, // <-- fixed spelling
        userId: user.id,
      };
      const res = await getCounts(payload).catch((e) => {
        setCountsError(String(e?.message || e));
        return null;
      });
      if (res) {
        setPoolCount(res?.poolCount || 0);
        setTotalCount(res?.totalCount || 0);
      }
      if (user?.id) { try { await refreshStreaks(user.id); } catch { } }
    } finally {
      setLoadingCounts(false);
      setRefreshing(false);
    }
  };

  // Store today's UTC day key on initial boot
  useEffect(() => {
    (async () => {
      try {
        const todayKey = getUtcDayKey();
        await AsyncStorage.setItem(UTC_DAY_KEY, todayKey);
      } catch { }
    })();
  }, []);

  // On focus: if UTC day changed while app was away, force-refresh
  useEffect(() => {
    if (!isFocused) return;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(UTC_DAY_KEY);
        const nowKey = getUtcDayKey();
        if (stored !== nowKey) {
          await handleRefresh();              // pulls fresh limits/daily + defaults + counts
          await AsyncStorage.setItem(UTC_DAY_KEY, nowKey);
        }
      } catch { }
    })();
  }, [isFocused]);

  // While this screen is mounted/active, refresh exactly at UTC midnight
  useEffect(() => {
    // Only schedule while app is active; if it goes background, we'll rely on the focus effect above.
    let clearTimer = scheduleRefreshAtUtcMidnight(async () => {
      try {
        await handleRefresh();
        await AsyncStorage.setItem(UTC_DAY_KEY, getUtcDayKey());
      } catch { }
      // Re-schedule the next midnight tick (tomorrow)
      clearTimer = scheduleRefreshAtUtcMidnight(async () => {
        try {
          await handleRefresh();
          await AsyncStorage.setItem(UTC_DAY_KEY, getUtcDayKey());
        } catch { }
      });
    });

    // If app goes background/active, we can choose to re-schedule,
    // but the focus effect already covers the reopen case.
    const sub = AppState.addEventListener("change", (state) => {
      // no-op: we rely on focus hook when coming back
    });

    return () => {
      clearTimer?.();
      sub.remove?.();
    };
  }, []);

  /* ---------------- UI ---------------- */
  if (bootLoading || !fontsLoaded) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8, fontFamily: "Tektur_400Regular" }}>Loading…</Text>
      </View>
    );
  }

  return (
    <ScrollView
      ref={scrollRef} // <-- ADDED
      style={{ backgroundColor: "#F0FDF4" }}
      contentContainerStyle={styles.container}
      refreshControl={          /* <-- ADDED: pull-to-refresh */
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
      }
    >
      {/* Daily Challenge */}
      <View style={styles.card}>
        <View style={[styles.cardTitle, { textAlign: "center" }]}>
          <Text style={[styles.cardTitle, { textAlign: "center", marginLeft: 6 }]}>🌟Daily Challenge🌟</Text>
        </View>

        <Text style={[styles.cardText, { textAlign: "center" }]}>
          {!limits.dailyPlayed
            ? "Today's Daily Challenge is live! Guess a star and grab 10,000 points and an extra game."
            : <>Next challenge in <Text style={styles.countdown}>{countdown}</Text></>}
        </Text>
        <Pressable
          onPress={startDaily}
          disabled={limits.dailyPlayed || dailyLoading}
          style={[
            styles.button,
            styles.dailyBtn,
            (limits.dailyPlayed || dailyLoading) && styles.buttonDisabled,
            { marginTop: 10 },
          ]}
        >
          <Text style={styles.buttonText}>
            {limits.dailyPlayed ? "Daily Challenge Played" : dailyLoading ? "Loading…" : "Try the Daily Challenge"}
          </Text>
        </Pressable>

        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: 8, gap: 8 }}>
          <Ionicons name="flame" size={20} color="#f97316" />
          <Text style={[styles.cardText, { marginRight: 6 }]}>Daily Challenge Streak: {dailyStreak}</Text>
        </View>
        {daily && limits.dailyPlayed && (
          <View style={{ alignItems: "center", marginTop: 10 }}>
            {limits.dailyPlayerPhoto ? (
              <View style={{ alignItems: "center", marginBottom: 8 }}>
                <Image
                  source={{ uri: limits.dailyPlayerPhoto }}
                  style={{ width: 80, height: 80, borderRadius: 40 }}
                />
              </View>
            ) : null}
            <Text style={styles.cardText}>
              {limits.dailyWin ? (
                <>
                  You <Text style={{ fontWeight: "700", color: "#16a34a", fontFamily: "Tektur_700Bold" }}>won</Text> today's challenge!
                </>
              ) : (
                <>
                  You <Text style={{ fontWeight: "700", color: "#dc2626", fontFamily: "Tektur_700Bold" }}>lost</Text> today's challenge.
                </>
              )}
            </Text>
            <Text style={[styles.cardText, { marginTop: 4 }]}>
              The player was{" "}
              <Text style={{ fontWeight: "700", fontFamily: "Tektur_700Bold" }}>
                {limits.dailyPlayerName || daily.player_name}
              </Text>
              .
            </Text>
          </View>
        )}
      </View>

      {/* Progress Stats */}
      <View style={[styles.card, { paddingVertical: 16 }]}>
        <View style={styles.statsRow}>
          <View style={styles.statCell}>
            <Text style={styles.statValue}>{`${gamesTodayEffective || 0}/${maxGames}`}</Text>
            <Text style={styles.statLabel}>Daily Progress</Text>
          </View>
          <View style={styles.statCell}>
            <Text style={[styles.statValue, { color: "#16a34a" }]}>{fmt(pointsTodayEffective || 0)}</Text>
            <Text style={styles.statLabel}>Daily Points</Text>
          </View>
          <View style={styles.statCell}>
            <Text style={[styles.statValue, { color: "#2563eb" }]}>{fmt(pointsTotalEffective || 0)}</Text>
            <Text style={styles.statLabel}>Total Points</Text>
          </View>
        </View>
      </View>

      {/* Start Button + Player Pool */}
      <View style={styles.card}>
        {!reachedLimit ? (
          <>
            <Text style={[styles.cardText, { textAlign: "center", marginTop: 8 }]}>
              Ready for a fresh challenge?
            </Text>
            <Pressable
              onPress={startRegular}
              disabled={gameLoading || poolCount === 0}
              style={[
                styles.button,
                styles.playBtn,
                (gameLoading || poolCount === 0) && styles.buttonDisabled,
              ]}
            >
              {gameLoading ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <ActivityIndicator color="#fff" />
                  <Text style={styles.buttonText}>Generating Random Player…</Text>
                </View>
              ) : (
                <Text style={styles.buttonText}>Play a Daily Game</Text>
              )}
            </Pressable>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: 8, gap: 8 }}>
              <Ionicons name="flame" size={20} color="#f97316" />
              <Text style={[styles.cardText, { textAlign: "center" }]}>Daily Progress Streak: {regularStreak}</Text>
            </View>
            {/* Potential points + Player Pool */}
            <View
              style={[
                styles.poolCard,
                { marginTop: 12, marginBottom: 12, backgroundColor: "#fff7ed", borderColor: "#fed7aa" },
              ]}
            >
              <View>
                <Text style={[styles.poolBig, { color: "#9a3412" }]}>
                  {loadingCounts ? "—" : fmt(poolCount * 5)}
                </Text>
                <Text style={[styles.poolLabel, { color: "#b45309" }]}>Potential Points</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                {loadingCounts ? (
                  <ActivityIndicator size="small" />
                ) : (
                  <Text style={[styles.poolBig, { color: "#9a3412" }]}>
                    {fmt(poolCount)} / {fmt(totalCount)}
                  </Text>
                )}
                <Text style={[styles.poolLabel, { color: "#b45309" }]}>Player Pool</Text>
              </View>
            </View>

            {!!countsError && (
              <Text style={{ color: "#b91c1c", marginTop: 8, fontSize: 12, fontFamily: "Tektur_400Regular" }}>
                {countsError}
              </Text>
            )}
          </>
        ) : (
          // >>> NEW: lockout view (no regular game allowed after daily limit)
          <View style={{ alignItems: "center", paddingVertical: 8 }}>
            <Text style={[styles.cardTitle, { textAlign: "center", marginBottom: 4 }]}>
              You're done for today!
            </Text>
            <Text style={[styles.cardText, { textAlign: "center" }]}>
              You’ve finished your {maxGames} games for today. Come back when the new day starts.
            </Text>
            <View style={{ marginTop: 10, alignItems: "center" }}>
              <Text style={[styles.countdown, { fontSize: 24, letterSpacing: 2 }]}>
                {countdown}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: 8, gap: 8 }}>
                <Ionicons name="flame" size={20} color="#f97316" />
                <Text style={[styles.cardText, { textAlign: "center" }]}>Daily Progress Streak: {regularStreak}</Text>
              </View>
            </View>
          </View>
        )}

        {/* ====== Collapsible Filters Wrapper ====== */}
        <View style={styles.card}>
          <Pressable
            onPress={() => setFiltersOpen((v) => !v)}
            style={styles.filtersHeader}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Ionicons name="filter" size={18} color="#0b3d24" />
              <Text style={styles.filtersTitle}>Adjust Difficulty Filters</Text>
            </View>
            <Ionicons
              name={filtersOpen ? "chevron-up" : "chevron-down"}
              size={18}
              color={"#111827"}
            />
          </Pressable>

          {filtersOpen && (
            <View style={{ marginTop: 10 }}>
              {/* ---- Defaults pill row ---- */}
              <View style={[styles.subCard, { paddingVertical: 12 }]}>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  <Chip
                    onPress={applyDefaultFilters}
                    selected={atDBDefaults}
                    style={atDBDefaults ? null : { backgroundColor: "#fff" }}
                  >
                    Apply Default Filters
                  </Chip>
                </View>
              </View>

              {/* COMPETITIONS */}
              <View style={[styles.subCard]}>
                <Text style={styles.cardTitle}>Competitions</Text>

                <View style={styles.rowWrap}>
                  <Chip onPress={selectTop10} selected={isTop10Selected}>
                    Top 10
                  </Chip>
                  <Chip onPress={clearComps} variant="outline" selected={isClearComps}>
                    Clear All
                  </Chip>
                </View>

                <Pressable
                  onPress={() => setCompOpen((v) => !v)}
                  style={styles.selectHeader}
                >
                  <Ionicons name="flag-outline" size={18} color="#0b3d24" />
                  <Text style={styles.selectHeaderText}>
                    {selectedCompetitionIds.length
                      ? `${selectedCompetitionIds.length} selected`
                      : "Select competitions"}
                  </Text>
                  <Ionicons
                    name={compOpen ? "chevron-up" : "chevron-down"}
                    size={18}
                    color={"#111827"}
                  />
                </Pressable>

                {compOpen && (
                  <View style={styles.dropdown}>
                    {/* search */}
                    <View style={styles.searchRow}>
                      <Ionicons
                        name="search"
                        size={16}
                        color="#6b7280"
                        style={{ marginRight: 6 }}
                      />
                      <TextInput
                        placeholder="Search by competition or country"
                        value={compQuery}
                        onChangeText={setCompQuery}
                        style={styles.searchInput}
                        autoCorrect={false}
                        autoCapitalize="none"
                      />
                      {compQuery.length > 0 && (
                        <Pressable onPress={() => setCompQuery("")}>
                          <Ionicons name="close-circle" size={18} color="#9ca3af" />
                        </Pressable>
                      )}
                    </View>

                    <View style={{ maxHeight: 360 }}>
                      <ScrollView>
                        {compsOrderedForDropdown.map((c) => {
                          const id = String(c.competition_id);
                          const selected = selectedCompetitionIds.includes(id);
                          return (
                            <CompetitionRow
                              key={id}
                              comp={c}
                              selected={selected}
                              onToggle={toggleCompetition}
                            />
                          );
                        })}
                        {compsOrderedForDropdown.length === 0 && (
                          <Text style={styles.muted}>No matches.</Text>
                        )}
                      </ScrollView>
                    </View>
                  </View>
                )}
              </View>

              {/* SEASONS (multi-select) */}
              <View style={styles.subCard}>
                <Text style={styles.cardTitle}>Seasons</Text>

                <View style={styles.rowWrap}>
                  <Chip onPress={selectLast3} selected={isLast3Seasons}>
                    Last 3
                  </Chip>
                  <Chip onPress={selectLast5} selected={isLast5Seasons}>
                    Last 5
                  </Chip>
                  <Chip onPress={clearSeasons} variant="outline" selected={isClearSeasons}>
                    Clear All
                  </Chip>
                </View>

                <Pressable
                  onPress={() => setSeasonsOpen((v) => !v)}
                  style={styles.selectHeader}
                >
                  <Ionicons name="calendar-outline" size={18} color="#0b3d24" />
                  <Text style={styles.selectHeaderText}>
                    {selectedSeasons.length
                      ? `${selectedSeasons.length} selected`
                      : "Select seasons"}
                  </Text>
                  <Ionicons
                    name={seasonsOpen ? "chevron-up" : "chevron-down"}
                    size={18}
                    color={"#111827"}
                  />
                </Pressable>

                {seasonsOpen && (
                  <View style={styles.dropdown}>
                    <View style={styles.searchRow}>
                      <Ionicons
                        name="search"
                        size={16}
                        color="#6b7280"
                        style={{ marginRight: 6 }}
                      />
                      <TextInput
                        placeholder="Search season (e.g. 2024)"
                        value={seasonQuery}
                        onChangeText={setSeasonQuery}
                        style={styles.searchInput}
                        autoCorrect={false}
                        autoCapitalize="none"
                        keyboardType="numeric"
                      />
                      {seasonQuery.length > 0 && (
                        <Pressable onPress={() => setSeasonQuery("")}>
                          <Ionicons name="close-circle" size={18} color="#9ca3af" />
                        </Pressable>
                      )}
                    </View>

                    <View style={{ maxHeight: 280 }}>
                      <ScrollView>
                        {seasonsOrderedForDropdown.map((s) => {
                          const selected = selectedSeasons.includes(s);
                          return (
                            <Pressable
                              key={s}
                              style={styles.optionRow}
                              onPress={() => toggleSeason(s)}
                            >
                              <Text style={{ color: "#111827", fontFamily: "Tektur_400Regular" }}>{s}</Text>
                              <Ionicons
                                name={selected ? "checkbox" : "square-outline"}
                                size={18}
                                color={selected ? "#14532d" : "#9ca3af"}
                              />
                            </Pressable>
                          );
                        })}
                        {seasonsOrderedForDropdown.length === 0 && (
                          <Text style={styles.muted}>No seasons.</Text>
                        )}
                      </ScrollView>
                    </View>
                  </View>
                )}
              </View>

              {/* MARKET VALUE */}
              <View style={styles.subCard}>
                <Text style={styles.cardTitle}>Minimum Market Value (€)</Text>
                <TextInput
                  keyboardType="number-pad"
                  value={String(minMarketValue ?? 0)}
                  onChangeText={(t) => setMinMarketValue(parseInt(t || "0", 10) || 0)}
                  style={styles.input}
                />
                <View style={styles.rowWrap}>
                  {[0, 100_000, 500_000, 1_000_000, 5_000_000, 10_000_000, 25_000_000, 50_000_000].map(
                    (v) => (
                      <Chip
                        key={v}
                        selected={Number(minMarketValue) === v}
                        onPress={() => setMinMarketValue(v)}
                      >
                        {compactMoney(v)}
                      </Chip>
                    )
                  )}
                </View>
              </View>

              {/* APPEARANCES */}
              <View style={styles.subCard}>
                <Text style={styles.cardTitle}>Minimum Appearances</Text>
                <TextInput
                  keyboardType="number-pad"
                  value={String(minAppearances ?? 0)}
                  onChangeText={(t) => setMinAppearances(parseInt(t || "0", 10) || 0)}
                  style={styles.input}
                />
                <View style={styles.rowWrap}>
                  {[0, 5, 10, 15, 20, 25, 30, 50, 100, 150, 200].map((v) => (
                    <Chip
                      key={v}
                      selected={Number(minAppearances) === v}
                      onPress={() => setMinAppearances(v)}
                    >
                      {v}
                    </Chip>
                  ))}
                </View>
              </View>
            </View>
          )}
        </View>
      </View>
      {/* Spacer */}
      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

/* ---------------- helpers (normalize / flatten) ---------------- */

function groupByCountryFromFlat(flat = []) {
  const grouped = {};
  (flat || []).forEach((c) => {
    const country = c?.country || "Other";
    (grouped[country] ||= []).push(c);
  });
  return grouped;
}
function flattenCompetitions(groupedByCountry = {}) {
  const out = [];
  Object.entries(groupedByCountry || {}).forEach(([country, arr]) => {
    (arr || []).forEach((c) => out.push({ ...c, country }));
  });
  return out;
}
function normalizeSeasons(sRes) {
  if (Array.isArray(sRes)) return sRes.map(String).sort((a, b) => Number(b) - Number(a));
  if (Array.isArray(sRes?.seasons)) return sRes.seasons.map(String).sort((a, b) => Number(b) - Number(a));
  return [];
}

/* ---------------- styles ---------------- */

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  container: {
    padding: 12,
    paddingBottom: 48,
    gap: 12,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 12,
    marginBottom: 4,
  },
  subCard: {
    backgroundColor: "#ffffff",
    borderRadius: 10,
    padding: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e5e7eb",
    marginBottom: 4,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0b3d24",
    marginBottom: 4,
    fontFamily: "Tektur_700Bold", // font only
  },
  cardText: {
    fontSize: 14,
    color: "#4b5563",
    fontFamily: "Tektur_400Regular", // font only
  },
  countdown: {
    fontWeight: "800",
    color: "#166534",
    fontFamily: "Tektur_700Bold", // font only
  },
  button: {
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
  },
  playBtn: {
    backgroundColor: "#166534",
  },
  dailyBtn: {
    backgroundColor: "#f59e0b",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 16,
    fontFamily: "Tektur_700Bold", // font only
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  statCell: {
    flex: 1,
    alignItems: "center",
  },
  statValue: {
    fontSize: 18,
    fontWeight: "800",
    color: "#111827",
    fontFamily: "Tektur_700Bold", // font only
  },
  statLabel: {
    fontSize: 12,
    color: "#6b7280",
    marginTop: 2,
    fontFamily: "Tektur_400Regular", // font only
  },

  rowWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#d1d5db",
    backgroundColor: "#fff",
  },
  selectHeader: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: "#fff",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  selectHeaderText: { flex: 1, color: "#0b3d24", fontWeight: "600", fontFamily: "Tektur_700Bold" },
  dropdown: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    backgroundColor: "#fff",
    padding: 8,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    borderColor: "#e5e7eb",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginBottom: 8,
    backgroundColor: "#fff",
  },
  searchInput: {
    flex: 1,
    height: 28,
    paddingVertical: 0,
    color: "#111827",
    fontFamily: "Tektur_400Regular", // font only
  },
  optionRow: {
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e7eb",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  muted: {
    color: "#6b7280",
    fontSize: 12,
    textAlign: "center",
    paddingVertical: 8,
    fontFamily: "Tektur_400Regular", // font only
  },

  compRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#eef2f7",
  },
  flag: { width: 24, height: 16, borderRadius: 3, overflow: "hidden" },
  logo: { width: 20, height: 20, borderRadius: 4, overflow: "hidden" },
  compName: { fontSize: 13, color: "#111827", fontWeight: "600", fontFamily: "Tektur_700Bold" },
  compSub: { fontSize: 11, color: "#6b7280", fontFamily: "Tektur_400Regular" },

  poolCard: {
    backgroundColor: "#fef3c7",
    borderColor: "#fde68a",
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  poolBig: { fontSize: 18, fontWeight: "700", fontFamily: "Tektur_700Bold" },
  poolLabel: { fontSize: 12, fontWeight: "600", fontFamily: "Tektur_700Bold" },

  input: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    backgroundColor: "#fff",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
    color: "#111827",
    fontFamily: "Tektur_400Regular", // font only
  },

  filtersHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  filtersTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0b3d24",
    fontFamily: "Tektur_700Bold", // font only
  },
});
