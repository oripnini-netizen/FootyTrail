// elimination-create.js
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Switch,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  Image,
  SafeAreaView,
  Platform,
  StatusBar,
  Pressable,
  Keyboard,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { supabase } from "../lib/supabase";
import { getCounts } from "../lib/api";

// ------- utils -------
function compactMoney(n) {
  const num = Number(n || 0);
  if (num >= 1_000_000_000) return `${Math.round(num / 1_000_000_000)}B`;
  if (num >= 1_000_000) return `${Math.round(num / 1_000_000)}M`;
  if (num >= 1_000) return `${Math.round(num / 1_000)}K`;
  return `${num}`;
}

/**
 * EliminationCreateScreen
 * - Top bar sits under iPhone status bar (SafeAreaView + padding)
 * - "Apply My Default Filters" is a toggle (ON by default) placed under join deadline
 * - When ON → advanced filters hidden and defaults applied
 * - When OFF → show full advanced filters UI mirroring game.js (dropdowns, search, chips)
 * - Private invites (when Public = OFF): web-like autocomplete with result list + chips
 */
export default function EliminationCreateScreen() {
  const router = useRouter();
  const [userId, setUserId] = useState(null);
  const [myEmail, setMyEmail] = useState("");                 // ← NEW: keep creator email
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [fullName, setFullName] = useState("");

  // form fields
  const [name, setName] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [stake, setStake] = useState("0");
  const [minPlayers, setMinPlayers] = useState("2");
  const [roundLimitMin, setRoundLimitMin] = useState("5"); // minutes per round
  const [elimEvery, setElimEvery] = useState("1"); // rounds_to_elimination
  const [joinDeadlineMins, setJoinDeadlineMins] = useState("60"); // default: 60 minutes

  // Private invites (autocomplete + chips)
  const [searchEmail, setSearchEmail] = useState("");
  const [emailResults, setEmailResults] = useState([]); // [{id, email, full_name, profile_photo_url}]
  const [inviteIndex] = useState(-1);
  const [invites, setInvites] = useState([]); // chips: [{id?:string, email:string, full_name?:string}]
  const searchEmailRef = useRef(null);
  const inviteResultsRef = useRef(null);
  const emailDebounceRef = useRef(null);
  const [inviteError, setInviteError] = useState("");

  // Default filters toggle (ON by default)
  const [useDefaultFilters, setUseDefaultFilters] = useState(true);

  // Advanced filters data & state (mirrors game.js)
  const [allCompetitions, setAllCompetitions] = useState([]);
  const [allSeasons, setAllSeasons] = useState([]);

  const [selectedCompetitionIds, setSelectedCompetitionIds] = useState([]);
  const [selectedSeasons, setSelectedSeasons] = useState([]);
  const [minMarketValue, setMinMarketValue] = useState(0);
  const [minAppearances, setMinAppearances] = useState(0);

  // Defaults ref (so "use default filters" can apply DB defaults)
  const defaultRef = useRef({
    competitions: [],
    seasons: [],
    minMarketValue: 0,
    minAppearances: 0,
  });

  // Dropdowns & search
  const [compOpen, setCompOpen] = useState(false);
  const [compQuery, setCompQuery] = useState("");
  const [seasonsOpen, setSeasonsOpen] = useState(false);
  const [seasonQuery, setSeasonQuery] = useState("");

  // Submitting state
  const [submitting, setSubmitting] = useState(false);

  // Player pool counts (only when defaults are OFF)
  const [poolCount, setPoolCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [loadingCounts, setLoadingCounts] = useState(false);
  const [countsError, setCountsError] = useState("");

  // --- Load user + avatar and DB defaults, competitions & seasons (like game.js) ---
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.auth.getUser();
      if (!error) {
        const uid = data?.user?.id || null;
        setUserId(uid);
        setMyEmail((data?.user?.email || "").toLowerCase());  // ← NEW: store creator email
        if (uid) {
          const { data: userRow } = await supabase
            .from("users")
            .select(
              "full_name, profile_photo_url, default_competitions, default_seasons, default_min_market_value, default_min_appearances"
            )
            .eq("id", uid)
            .maybeSingle();

          setFullName(userRow?.full_name || "");
          setAvatarUrl(userRow?.profile_photo_url || null);

          // save DB defaults to ref & also initialize advanced values to those defaults
          const dbDefaults = {
            competitions: (userRow?.default_competitions || []).map(String),
            seasons: (userRow?.default_seasons || []).map(String),
            minMarketValue: Number(userRow?.default_min_market_value ?? 0),
            minAppearances: Number(userRow?.default_min_appearances ?? 0),
          };
          defaultRef.current = dbDefaults;

          // Prime advanced editors with defaults (so if user toggles OFF, it matches)
          setSelectedCompetitionIds(dbDefaults.competitions);
          setSelectedSeasons(dbDefaults.seasons);
          setMinMarketValue(dbDefaults.minMarketValue);
          setMinAppearances(dbDefaults.minAppearances);
        }
      }

      // competitions/seasons
      let payload = await fetchFromWebAPI();
      if (!payload) payload = await fetchFromSupabaseFallback();
      setAllCompetitions(payload?.flatCompetitions || []);
      setAllSeasons(
        Array.isArray(payload?.seasons)
          ? payload.seasons.map(String).sort((a, b) => Number(b) - Number(a))
          : []
      );
    })();
  }, []);

  // ---- Fetchers (copied pattern from game.js) ----
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
      const seas = await sRes.json(); // { seasons: [..] }

      const flat = [];
      Object.entries(comps.groupedByCountry || {}).forEach(([country, arr]) =>
        (arr || []).forEach((c) => flat.push({ ...c, country }))
      );

      return {
        flatCompetitions: flat,
        seasons: Array.isArray(seas.seasons) ? seas.seasons.map(String) : [],
      };
    } catch {
      return null;
    }
  }

  async function fetchFromSupabaseFallback() {
    const { data: comps } = await supabase
      .from("competitions")
      .select("country, competition_id, competition_name, flag_url, logo_url, total_value_eur")
      .order("country", { ascending: true });

    const { data: seasonsRows } = await supabase
      .from("v_competitions_with_seasons")
      .select("seasons");

    const set = new Set();
    (seasonsRows || []).forEach((r) => {
      const raw = r?.seasons;
      let arr = [];
      if (Array.isArray(raw)) arr = raw;
      else if (typeof raw === "string") {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) arr = parsed;
        } catch { }
      }
      arr.forEach((s) => set.add(String(s)));
    });

    const seasons = Array.from(set)
      .filter(Boolean)
      .sort((a, b) => Number(b) - Number(a));

    return {
      flatCompetitions: (comps || []).map((c) => ({ ...c })),
      seasons,
    };
  }

  // ---- Helpers ----
  const arraysEqualAsSets = (a, b) =>
    a.length === b.length && a.every((x) => b.includes(x));

  const filteredCompetitions = useMemo(() => {
    const q = (compQuery || "").trim().toLowerCase();
    if (!q) return allCompetitions;
    return allCompetitions.filter((c) => {
      const a = `${c?.competition_name || ""} ${c?.country || ""}`.toLowerCase();
      return a.includes(q);
    });
  }, [allCompetitions, compQuery]);

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

  // Seasons dropdown lists
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

  // Small UI atom (Chip)
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

  // Invite helpers
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

  const addInvite = (u) => {
    const email = (u?.email || "").trim().toLowerCase();
    if (!email) return;

    // ← NEW: prevent inviting yourself (by id or by email)
    if ((u?.id && u.id === userId) || (myEmail && email === myEmail)) {
      setInviteError("You can't invite yourself.");
      return;
    }

    setInvites((prev) => {
      if (prev.some((x) => x.email.toLowerCase() === email)) return prev;
      return [...prev, { id: u?.id, email, full_name: u?.full_name }];
    });
    setSearchEmail("");
    setEmailResults([]);
    setInviteError("");
    Keyboard.dismiss();
  };

  const addTypedEmailIfValid = () => {
    const e = (searchEmail || "").trim().toLowerCase();
    if (!e) return;
    if (!emailRegex.test(e)) {
      setInviteError("Please enter a valid email address.");
      return;
    }
    // ← NEW: block adding your own email manually
    if (myEmail && e === myEmail) {
      setInviteError("You can't invite yourself.");
      return;
    }
    addInvite({ email: e });
  };

  const removeInvite = (idOrEmail) => {
    setInvites((prev) =>
      prev.filter(
        (x) =>
          x.id !== idOrEmail &&
          x.email.toLowerCase() !== String(idOrEmail).toLowerCase()
      )
    );
  };

  // Debounced search for users by email/full_name
  useEffect(() => {
    if (!searchEmail) {
      setEmailResults([]);
      setInviteError("");
      return;
    }

    if (emailDebounceRef.current) clearTimeout(emailDebounceRef.current);
    emailDebounceRef.current = setTimeout(async () => {
      try {
        const q = searchEmail.trim();
        if (!q) {
          setEmailResults([]);
          return;
        }
        const { data, error } = await supabase
          .from("users")
          .select("id, email, full_name, profile_photo_url")
          .or(`email.ilike.%${q}%,full_name.ilike.%${q}%`)
          .limit(10);

        if (error) {
          setEmailResults([]);
          return;
        }

        // ← NEW: filter out the creator from search results, and already-added duplicates
        const filtered = (data || []).filter(
          (u) =>
            u?.email &&
            u.id !== userId &&
            u.email.toLowerCase() !== myEmail &&
            !invites.some((x) => x.email.toLowerCase() === u.email.toLowerCase())
        );
        setEmailResults(filtered);
      } catch {
        setEmailResults([]);
      }
    }, 220);

    return () => {
      if (emailDebounceRef.current) clearTimeout(emailDebounceRef.current);
    };
  }, [searchEmail, invites, userId, myEmail]);

  // --- Create handler: build filters based on toggle state ---
  const onCreate = async () => {
    if (!userId) {
      Alert.alert("Not signed in", "Please sign in first.");
      return;
    }
    if (!name.trim()) {
      Alert.alert("Name required", "Give your challenge a name.");
      return;
    }
    // --- Validate numeric inputs (show an error instead of silently clamping) ---
    const stake_points_raw = Number(stake);
    const min_participants_raw = Number(minPlayers);
    const round_minutes_raw = Number(roundLimitMin);
    const elim_every_raw = Number(elimEvery);
    const join_deadline_minutes_raw = Number(joinDeadlineMins);

    // Stake: >= 0 (integers are fine; we’ll floor to int)
    if (!Number.isFinite(stake_points_raw) || stake_points_raw < 0) {
      Alert.alert("Invalid stake", "Stake (points) must be 0 or more.");
      return;
    }
    const stake_points = Math.floor(stake_points_raw);

    // Min participants: >= 2
    if (!Number.isFinite(min_participants_raw) || Math.floor(min_participants_raw) < 2) {
      Alert.alert("Invalid minimum participants", "Minimum participants must be at least 2.");
      return;
    }
    const min_participants = Math.floor(min_participants_raw);

    // Round time: >= 1 minute
    if (!Number.isFinite(round_minutes_raw) || Math.floor(round_minutes_raw) < 1) {
      Alert.alert("Invalid round time", "Round time must be at least 1 minute.");
      return;
    }
    const round_time_limit_seconds = Math.floor(round_minutes_raw) * 60;

    // Eliminate every (rounds): 1–5
    if (
      !Number.isFinite(elim_every_raw) ||
      Math.floor(elim_every_raw) < 1 ||
      Math.floor(elim_every_raw) > 5
    ) {
      Alert.alert(
        "Invalid elimination cadence",
        "Eliminate every (rounds) must be between 1 and 5."
      );
      return;
    }
    const rounds_to_elimination = Math.floor(elim_every_raw);

    // Join deadline: >= 1 minute (no empty/default fallback; must be valid)
    if (
      !Number.isFinite(join_deadline_minutes_raw) ||
      Math.floor(join_deadline_minutes_raw) < 1
    ) {
      Alert.alert("Invalid join deadline", "Join deadline must be at least 1 minute.");
      return;
    }
    const p_join_window_minutes = Math.floor(join_deadline_minutes_raw);

    // Base filters
    const filters = {
      visibility: isPublic ? "public" : "private",
    };

    // Private invites → must pass UUIDs to RPC. Resolve any missing IDs by email.
    let invitedUserIds = [];
    if (!isPublic) {
      const withIds = invites.filter((x) => x.id);
      invitedUserIds = withIds.map((x) => x.id);

      const emailsNeedingLookup = invites
        .filter((x) => !x.id && x.email)
        .map((x) => x.email.toLowerCase());

      if (emailsNeedingLookup.length) {
        const { data: found } = await supabase
          .from("users")
          .select("id, email")
          .in("email", emailsNeedingLookup);

        (found || []).forEach((u) => invitedUserIds.push(u.id));
      }

      // ← NEW: ensure creator cannot slip in (by id), and require at least one other invitee
      invitedUserIds = invitedUserIds.filter((id) => id !== userId);

      if (invitedUserIds.length === 0) {
        setInviteError("Add at least one existing user (or set to Public).");
        return;
      }
    }

    // Apply defaults or advanced selections
    if (useDefaultFilters) {
      const d = defaultRef.current;
      if (d.competitions.length) filters.competitions = d.competitions;
      if (d.seasons.length) filters.seasons = d.seasons;
      if (Number(d.minAppearances) > 0)
        filters.minAppearances = Number(d.minAppearances);
      if (Number(d.minMarketValue) > 0)
        filters.minMarketValue = Number(d.minMarketValue);
    } else {
      if (selectedCompetitionIds.length)
        filters.competitions = selectedCompetitionIds.map(String);
      if (selectedSeasons.length)
        filters.seasons = selectedSeasons.map(String);
      if (Number(minAppearances) > 0)
        filters.minAppearances = Number(minAppearances);
      if (Number(minMarketValue) > 0)
        filters.minMarketValue = Number(minMarketValue);
    }

    setSubmitting(true);
    try {
      // ✅ Call SECURITY DEFINER RPC with EXACT param names:
      const { data, error } = await supabase.rpc(
        "create_elimination_tournament_with_stakes",
        {
          p_filters: filters,
          p_invited_user_ids: invitedUserIds.length ? invitedUserIds : null,
          p_name: name.trim(),
          p_round_time_limit_seconds: round_time_limit_seconds,
          p_rounds_to_elimination: rounds_to_elimination,
          p_stake_points: stake_points,
          p_join_window_minutes,
          p_min_participants: min_participants,
        }
      );

      if (error) throw error;

      Alert.alert(
        "Challenge created! 🪓",
        isPublic
          ? "Share it with friendsand start when you're ready!"
          : "Invites were sent. Waiting for them to join!"
      );
      router.back();
    } catch (e) {
      Alert.alert("Could not create", String(e?.message || e));
    } finally {
      setSubmitting(false);
    }
  };

  // Recompute Player Pool counts when advanced filters change (only when defaults are OFF)
  useEffect(() => {
    if (useDefaultFilters || !userId) return;

    let cancelled = false;
    (async () => {
      try {
        setLoadingCounts(true);
        setCountsError("");

        const payload = {
          competitions: selectedCompetitionIds,
          seasons: selectedSeasons,
          minMarketValue: Number(minMarketValue) || 0,
          minAppearances: Number(minAppearances) || 0,
          userId,
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
  }, [
    useDefaultFilters,
    userId,
    selectedCompetitionIds,
    selectedSeasons,
    minMarketValue,
    minAppearances,
  ]);


  return (
    <View style={{ flex: 1, backgroundColor: "#fff" }}>
      <SafeAreaView style={{ backgroundColor: "#ffffff" }}>
        <View
          style={[
            styles.topBar,
            {
              paddingTop:
                Platform.OS === "android" ? StatusBar.currentHeight || 0 : 0,
            },
          ]}
        >
          <Image
            source={require("../assets/images/footytrail_logo.png")}
            style={styles.headerLogo}
            resizeMode="contain"
          />
          <Text style={styles.topTitle}>Create Challenge</Text>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Text style={styles.avatarFallbackText}>
                {fullName ? fullName[0]?.toUpperCase() : "?"}
              </Text>
            </View>
          )}
        </View>
      </SafeAreaView>

      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        {/* Name */}
        <View style={styles.field}>
          <Text style={styles.label}>Name</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g., Friday Night KO"
            value={name}
            onChangeText={setName}
            returnKeyType="done"
          />
        </View>

        {/* Public / Private */}
        <View className="row" style={styles.row}>
          <Text style={styles.label}>Public</Text>
          <Switch value={isPublic} onValueChange={setIsPublic} />
        </View>

        {/* Invite emails (private only) */}
        {!isPublic && (
          <View style={styles.invitesCard}>
            <Text style={[styles.label, { marginBottom: 6 }]}>
              Invite users (by email)
            </Text>

            {/* Search input + Add button */}
            <View style={styles.inviteSearchRow}>
              <TextInput
                ref={searchEmailRef}
                style={[styles.input, { flex: 1 }]}
                value={searchEmail}
                onChangeText={(t) => {
                  setSearchEmail(t);
                  setInviteError("");
                }}
                placeholder="Type an email to search…"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                returnKeyType="search"
                onSubmitEditing={() => {
                  if (emailResults.length) addInvite(emailResults[0]);
                  else addTypedEmailIfValid();
                }}
              />
            </View>

            {!!inviteError && (
              <Text style={{ color: "#b91c1c", marginTop: 6 }}>{inviteError}</Text>
            )}

            {/* Results list */}
            {emailResults.length > 0 && (
              <View
                ref={inviteResultsRef}
                style={{ marginTop: 8, borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 10 }}
              >
                {emailResults.map((u) => (
                  <Pressable key={u.id} onPress={() => addInvite(u)} style={styles.resultRow}>
                    <Image
                      source={{ uri: u.profile_photo_url || "" }}
                      style={styles.resultAvatar}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: "700" }}>{u.full_name || u.email}</Text>
                      <Text style={{ color: "#6b7280" }}>{u.email}</Text>
                    </View>
                    <Ionicons name="add-circle-outline" size={22} color="#14532d" />
                  </Pressable>
                ))}
              </View>
            )}

            {/* Chips */}
            {invites.length > 0 && (
              <View style={[styles.subCard, { marginTop: 10 }]}>
                <Text style={[styles.label, { marginBottom: 6 }]}>Invited</Text>
                <View style={styles.rowWrap}>
                  {invites.map((u) => (
                    <Chip
                      key={u.id || u.email}
                      onPress={() => removeInvite(u.id || u.email)}
                      selected
                    >
                      {u.full_name ? `${u.full_name} (${u.email})` : u.email}
                    </Chip>
                  ))}
                </View>
              </View>
            )}
          </View>
        )}

        {/* Join deadline */}
        <View style={[styles.row, { marginTop: 8 }]}>
          <Text style={styles.label}>Join deadline (minutes)</Text>
          <TextInput
            style={styles.inputSmall}
            keyboardType="numeric"
            value={joinDeadlineMins}
            onChangeText={setJoinDeadlineMins}
          />
        </View>

        {/* Apply defaults toggle */}
        <View style={[styles.row, { marginTop: 8 }]}>
          <Text style={styles.label}>Apply my default filters</Text>
          <Switch value={useDefaultFilters} onValueChange={setUseDefaultFilters} />
        </View>

        {/* Advanced filters (shown only when defaults OFF) */}
        {!useDefaultFilters && (
          <View style={{ marginTop: 8 }}>
            {/* COMPETITIONS (card) */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Competitions</Text>

              <View style={styles.rowWrap}>
                <Chip onPress={selectTop10} selected={isTop10Selected}>
                  Top 10
                </Chip>
                <Chip onPress={clearComps} variant="outline" selected={isClearComps}>
                  Clear All
                </Chip>
              </View>

              <Pressable onPress={() => setCompOpen((v) => !v)} style={styles.selectHeader}>
                <Ionicons name="flag-outline" size={18} color="#0b3d24" />
                <Text style={styles.selectHeaderText}>
                  {selectedCompetitionIds.length ? `${selectedCompetitionIds.length} selected` : "Select competitions"}
                </Text>
                <Ionicons name={compOpen ? "chevron-up" : "chevron-down"} size={18} color="#111827" />
              </Pressable>

              {compOpen && (
                <View style={styles.dropdown}>
                  {/* search */}
                  <View style={styles.searchRow}>
                    <Ionicons name="search" size={16} color="#6b7280" style={{ marginRight: 6 }} />
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

            {/* SEASONS (card) */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Seasons</Text>

              <View style={styles.rowWrap}>
                <Chip
                  onPress={() => setSelectedSeasons(allSeasons.slice(0, 3))}
                  selected={isLast3Seasons}
                >
                  Last 3
                </Chip>
                <Chip
                  onPress={() => setSelectedSeasons(allSeasons.slice(0, 5))}
                  selected={isLast5Seasons}
                >
                  Last 5
                </Chip>
                <Chip
                  onPress={() => setSelectedSeasons([])}
                  variant="outline"
                  selected={isClearSeasons}
                >
                  Clear All
                </Chip>
              </View>

              <Pressable onPress={() => setSeasonsOpen((v) => !v)} style={styles.selectHeader}>
                <Ionicons name="calendar-outline" size={18} color="#0b3d24" />
                <Text style={styles.selectHeaderText}>
                  {selectedSeasons.length ? `${selectedSeasons.length} selected` : "Select seasons"}
                </Text>
                <Ionicons name={seasonsOpen ? "chevron-up" : "chevron-down"} size={18} color="#111827" />
              </Pressable>

              {seasonsOpen && (
                <View style={styles.dropdown}>
                  <View style={styles.searchRow}>
                    <Ionicons name="search" size={16} color="#6b7280" style={{ marginRight: 6 }} />
                    <TextInput
                      placeholder="Search season (e.g., 2021)"
                      value={seasonQuery}
                      onChangeText={setSeasonQuery}
                      style={styles.searchInput}
                      autoCorrect={false}
                      autoCapitalize="none"
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
                            <Text style={{ color: "#111827" }}>{s}</Text>
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

            {/* MARKET VALUE (card) */}
            <View style={styles.card}>
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

            {/* APPEARANCES (card) */}
            <View style={styles.card}>
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

            {/* PLAYER POOL (card) */}
            <View style={styles.poolCard}>
              <Text style={styles.poolLabel}>Player Pool:</Text>
              {loadingCounts ? (
                <ActivityIndicator size="small" />
              ) : (
                <Text style={styles.poolValue}>
                  {poolCount} / {totalCount}
                </Text>
              )}
            </View>
            {!!countsError && (
              <Text style={{ color: "#b91c1c", marginTop: -8, marginBottom: 8, fontSize: 12 }}>
                {countsError}
              </Text>
            )}
          </View>
        )}


        {/* Stake / Min participants / Round time / Elimination cadence */}
        <View style={[styles.subCard, { marginTop: 8 }]}>
          <Text style={styles.sectionTitle}>Match rules</Text>
          <View style={[styles.row, { justifyContent: "flex-start" }]}>
            <Text style={[styles.label, { width: 160 }]}>Stake (points)</Text>
            <TextInput
              style={styles.inputSmall}
              keyboardType="numeric"
              value={String(stake)}
              onChangeText={setStake}
            />
          </View>
          <View style={[styles.row, { justifyContent: "flex-start" }]}>
            <Text style={[styles.label, { width: 160 }]}>Min participants</Text>
            <TextInput
              style={styles.inputSmall}
              keyboardType="numeric"
              value={String(minPlayers)}
              onChangeText={setMinPlayers}
            />
          </View>
          <View style={[styles.row, { justifyContent: "flex-start" }]}>
            <Text style={[styles.label, { width: 160 }]}>Round time (minutes)</Text>
            <TextInput
              style={styles.inputSmall}
              keyboardType="numeric"
              value={String(roundLimitMin)}
              onChangeText={setRoundLimitMin}
            />
          </View>
          <View style={[styles.row, { justifyContent: "flex-start" }]}>
            <Text style={[styles.label, { width: 160 }]}>Eliminate every (rounds)</Text>
            <TextInput
              style={styles.inputSmall}
              keyboardType="numeric"
              value={String(elimEvery)}
              onChangeText={setElimEvery}
            />
          </View>
        </View>

        {/* Create + Cancel buttons */}
        <View style={styles.actionRow}>
          <TouchableOpacity
            onPress={onCreate}
            disabled={submitting}
            style={[styles.createBtn, submitting && { opacity: 0.7 }]}
          >
            <Text style={styles.createBtnText}>
              {submitting ? "Creating…" : "Create Challenge"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => router.push("/elimination")}
            style={styles.cancelBtn}
          >
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

/* ------------------------- Styles ------------------------- */
const styles = StyleSheet.create({
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingBottom: 8,
    backgroundColor: "#ffffff",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e7eb",
  },
  headerLogo: { width: 32, height: 32 },
  topTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 18,
    fontWeight: "800",
    color: "#0b3d24",
  },
  avatar: { width: 28, height: 28, borderRadius: 14 },
  avatarFallback: {
    backgroundColor: "#e5e7eb",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarFallbackText: { fontWeight: "700", color: "#111827" },

  container: { padding: 16, paddingBottom: 40 },
  field: { marginBottom: 12 },
  label: { fontSize: 14, fontWeight: "600", color: "#374151" },
  input: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 14,
    backgroundColor: "#fff",
  },
  inputSmall: {
    marginLeft: 8,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    width: 110,
    fontSize: 14,
    backgroundColor: "#fff",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  rowWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8,
  },

  // Advanced filters
  advancedBox: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    padding: 12,
    backgroundColor: "#ffffff",
  },
  subCard: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    padding: 10,
    backgroundColor: "#fff",
  },
  sectionTitle: { fontSize: 14, fontWeight: "700", color: "#111827", marginBottom: 6 },
  subTitle: { fontSize: 13, fontWeight: "700", color: "#1f2937", marginBottom: 6 },

  compRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    gap: 10,
  },
  flag: { width: 22, height: 16, borderRadius: 2, backgroundColor: "#eee" },
  logo: { width: 20, height: 20, borderRadius: 4, backgroundColor: "#eee" },
  compName: { fontWeight: "700", color: "#111827" },
  compSub: { color: "#6b7280" },

  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderRadius: 999,
  },

  invitesCard: { marginTop: 8, padding: 12, borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 12, backgroundColor: "#fff" },
  inviteSearchRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  resultRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#e5e7eb" },
  resultAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: "#e5e7eb" },

  actionRow: { flexDirection: "row", gap: 10, marginTop: 16 },
  createBtn: { flex: 1, backgroundColor: "#14532d", paddingVertical: 12, borderRadius: 10, alignItems: "center" },
  createBtnText: { color: "#fff", fontWeight: "800" },
  cancelBtn: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 10, backgroundColor: "#e5e7eb" },
  cancelBtnText: { color: "#111827", fontWeight: "700" },

  // --- parity with default-filters.js ---
  screen: { flex: 1, padding: 12, backgroundColor: "#f7faf7" },

  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e5e7eb",
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0b3d24",
    marginBottom: 8,
    fontFamily: "Tektur_700Bold",
  },

  selectHeader: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#fff",
  },
  selectHeaderText: {
    flex: 1,
    color: "#111827",
    fontWeight: "600",
    fontFamily: "Tektur_700Bold",
  },
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
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 8,
    backgroundColor: "#fafafa",
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: "#111827",
    paddingVertical: 4,
    fontFamily: "Tektur_400Regular",
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#f1f5f9",
    justifyContent: "space-between",
  },
  muted: { color: "#6b7280", marginTop: 8, fontFamily: "Tektur_400Regular" },

  poolCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#fef9c3",
    borderColor: "#fde68a",
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 12,
  },
  poolLabel: { fontSize: 14, color: "#92400e", fontWeight: "600", fontFamily: "Tektur_700Bold" },
  poolValue: { fontSize: 14, color: "#92400e", fontWeight: "800", fontFamily: "Tektur_700Bold" },

});
