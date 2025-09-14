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
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { supabase } from "../lib/supabase";

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
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [fullName, setFullName] = useState("");

  // form fields
  const [name, setName] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [stake, setStake] = useState("0");
  const [minPlayers, setMinPlayers] = useState("2");
  const [roundLimitMin, setRoundLimitMin] = useState("10"); // minutes per round
  const [elimEvery, setElimEvery] = useState("1"); // rounds_to_elimination
  const [joinDeadlineMins, setJoinDeadlineMins] = useState("60"); // default: 60 minutes

  // === NEW: Private invites state (autocomplete + chips) ===
  const [searchEmail, setSearchEmail] = useState("");
  const [emailResults, setEmailResults] = useState([]); // [{id, email, full_name, profile_photo_url}]
  const [inviteIndex] = useState(-1); // kept for parity, but mobile uses taps instead of arrows
  const [invites, setInvites] = useState([]); // chips: [{id?:string, email:string, full_name?:string}]
  const searchEmailRef = useRef(null);
  const inviteResultsRef = useRef(null);
  const emailDebounceRef = useRef(null);
  const [inviteError, setInviteError] = useState("");

  // === NEW: Default filters toggle (ON by default) ===
  const [useDefaultFilters, setUseDefaultFilters] = useState(true);

  // === Advanced filters data & state (mirrors game.js) ===
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

  // --- Load user + avatar and DB defaults, competitions & seasons (like game.js) ---
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.auth.getUser();
      if (!error) {
        const uid = data?.user?.id || null;
        setUserId(uid);
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

      // competitions/seasons (same approach as game.js)
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
        } catch {}
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

  // ---- Helpers copied from game.js behavior ----
  function fmtNum(n) {
    return new Intl.NumberFormat("en-US").format(Number(n || 0));
  }
  function compactMoney(n) {
    const num = Number(n || 0);
    if (num >= 1_000_000_000) return `${Math.round(num / 1_000_000_000)}B`;
    if (num >= 1_000_000) return `${Math.round(num / 1_000_000)}M`;
    if (num >= 1_000) return `${Math.round(num / 1_000)}K`;
    return `${num}`;
  }
  const arraysEqualAsSets = (a, b) =>
    a.length === b.length && a.every((x) => b.includes(x));

  // Competition dropdown lists
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

  // === NEW: Invite helpers ===
  const emailRegex =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

  const addInvite = (u) => {
    const email = (u?.email || "").trim().toLowerCase();
    if (!email) return;
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
    const e = (searchEmail || "").trim();
    if (!e) return;
    if (!emailRegex.test(e)) {
      setInviteError("Please enter a valid email address.");
      return;
    }
    addInvite({ email: e });
  };

  const removeInvite = (idOrEmail) => {
    setInvites((prev) =>
      prev.filter(
        (x) =>
          x.id !== idOrEmail && x.email.toLowerCase() !== String(idOrEmail).toLowerCase()
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

        const filtered = (data || []).filter(
          (u) => u?.email && !invites.some((x) => x.email.toLowerCase() === u.email.toLowerCase())
        );
        setEmailResults(filtered);
      } catch {
        setEmailResults([]);
      }
    }, 220);

    return () => {
      if (emailDebounceRef.current) clearTimeout(emailDebounceRef.current);
    };
  }, [searchEmail, invites]);

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
    const stake_points = Math.max(0, Number(stake) || 0);
    const min_participants = Math.max(2, Number(minPlayers) || 2);
    const round_time_limit_seconds = Math.max(
      60,
      (Number(roundLimitMin) || 10) * 60
    );
    const rounds_to_elimination = Math.max(
      1,
      Math.min(5, Number(elimEvery) || 1)
    );

    // Base filters
    const filters = {
      visibility: isPublic ? "public" : "private",
    };

    // Private invites
    if (!isPublic) {
      const emails = invites.map((x) => (x.email || "").trim()).filter(Boolean);
      if (emails.length === 0) {
        setInviteError("Add at least one email, or set the challenge to Public.");
        return;
      }
      filters.invited_emails = emails;
    }

    // Apply defaults or advanced selections
    if (useDefaultFilters) {
      const d = defaultRef.current;
      if (d.competitions.length) filters.competitions = d.competitions;
      if (d.seasons.length) filters.seasons = d.seasons;
      if (Number(d.minAppearances) > 0) filters.minAppearances = Number(d.minAppearances);
      if (Number(d.minMarketValue) > 0) filters.minMarketValue = Number(d.minMarketValue);
    } else {
      if (selectedCompetitionIds.length) filters.competitions = selectedCompetitionIds.map(String);
      if (selectedSeasons.length) filters.seasons = selectedSeasons.map(String);
      if (Number(minAppearances) > 0) filters.minAppearances = Number(minAppearances);
      if (Number(minMarketValue) > 0) filters.minMarketValue = Number(minMarketValue);
    }

    // Join deadline (minutes from now; default 60)
    let join_deadline = null;
    try {
      const minsRaw = joinDeadlineMins?.trim();
      const mins = minsRaw === "" ? 60 : Math.max(0, Number(minsRaw) || 60);
      if (mins > 0) {
        join_deadline = new Date(Date.now() + mins * 60000).toISOString();
      }
    } catch {
      // ignore
    }

    setSubmitting(true);
    try {
      const { data, error } = await supabase
        .from("elimination_tournaments")
        .insert([
          {
            name: name.trim(),
            status: "lobby",
            owner_id: userId,
            stake_points,
            min_participants,
            round_time_limit_seconds,
            rounds_to_elimination,
            join_deadline,
            filters,
          },
        ])
        .select("id")
        .maybeSingle();

      if (error) throw error;

      Alert.alert(
        "Challenge created",
        isPublic
          ? "Share it and start when you're ready!"
          : "Invites recorded. Share and start when you're ready!"
      );
      router.back();
    } catch (e) {
      Alert.alert("Could not create", String(e?.message || e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#fff" }}>
      <SafeAreaView style={{ backgroundColor: "#ffffff" }}>
        <View
          style={[
            styles.topBar,
            { paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight || 0) : 0 },
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

      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
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
        <View style={styles.row}>
          <Text style={styles.label}>Public</Text>
          <Switch value={isPublic} onValueChange={setIsPublic} />
        </View>

        {/* === NEW: Invite emails (private only) with autocomplete + chips === */}
        {!isPublic && (
          <View style={styles.invitesCard}>
            <Text style={[styles.label, { marginBottom: 6 }]}>Invite users (by email)</Text>

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
                  // If we have search results, add the first; otherwise try typed email
                  if (emailResults.length > 0) {
                    addInvite(emailResults[0]);
                  } else {
                    addTypedEmailIfValid();
                  }
                }}
              />
              <TouchableOpacity style={styles.addBtn} onPress={addTypedEmailIfValid}>
                <Text style={styles.addBtnText}>Add</Text>
              </TouchableOpacity>
            </View>

            {/* Results list (tap to add) */}
            {emailResults.length > 0 && (
              <View ref={inviteResultsRef} style={styles.resultsList}>
                {emailResults.map((u) => (
                  <TouchableOpacity
                    key={u.id}
                    onPress={() => addInvite(u)}
                    style={styles.resultRow}
                    activeOpacity={0.7}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
                      {u.profile_photo_url ? (
                        <Image source={{ uri: u.profile_photo_url }} style={styles.resultAvatar} />
                      ) : (
                        <View style={[styles.resultAvatar, { backgroundColor: "#e5e7eb" }]} />
                      )}
                      <View style={{ marginLeft: 8, flex: 1 }}>
                        <Text style={styles.resultName} numberOfLines={1}>
                          {u.full_name ? `${u.full_name}` : u.email}
                        </Text>
                        {u.full_name ? (
                          <Text style={styles.resultEmail} numberOfLines={1}>
                            {u.email}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                    <Text style={styles.resultAdd}>Add</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Chips */}
            {invites.length > 0 && (
              <View style={{ marginTop: 10 }}>
                <Text style={styles.invitedLabel}>Invited</Text>
                <View style={styles.chipsWrap}>
                  {invites.map((u) => (
                    <View key={u.id || u.email} style={styles.inviteChip}>
                      <Text style={styles.inviteChipText}>
                        {u.full_name || u.email}
                      </Text>
                      <TouchableOpacity
                        onPress={() => removeInvite(u.id || u.email)}
                        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                      >
                        <Text style={styles.inviteChipX}>×</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {!!inviteError && <Text style={styles.errorText}>{inviteError}</Text>}
          </View>
        )}

        {/* Stake, min participants, round time, elimination every */}
        <View style={styles.row}>
          <Text style={styles.label}>Stake (points)</Text>
          <TextInput
            style={styles.inputSmall}
            keyboardType="numeric"
            value={stake}
            onChangeText={setStake}
          />
        </View>

        <View style={styles.row}>
          <Text style={styles.label}>Min participants</Text>
          <TextInput
            style={styles.inputSmall}
            keyboardType="numeric"
            value={minPlayers}
            onChangeText={setMinPlayers}
          />
        </View>

        <View style={styles.row}>
          <Text style={styles.label}>Round time (minutes)</Text>
          <TextInput
            style={styles.inputSmall}
            keyboardType="numeric"
            value={roundLimitMin}
            onChangeText={setRoundLimitMin}
          />
        </View>

        <View style={styles.row}>
          <Text style={styles.label}>Elimination every (rounds)</Text>
          <TextInput
            style={styles.inputSmall}
            keyboardType="numeric"
            value={elimEvery}
            onChangeText={setElimEvery}
          />
        </View>

        {/* Join deadline */}
        <View style={styles.row}>
          <Text style={styles.label}>Join deadline (minutes)</Text>
          <TextInput
            style={styles.inputSmall}
            keyboardType="numeric"
            value={joinDeadlineMins}
            onChangeText={setJoinDeadlineMins}
          />
        </View>

        {/* === "Apply My Default Filters" toggle OUTSIDE the advanced box === */}
        <View style={[styles.row, { marginTop: 6 }]}>
          <Text style={styles.label}>Apply My Default Filters</Text>
          <Switch
            value={useDefaultFilters}
            onValueChange={setUseDefaultFilters}
          />
        </View>

        {/* === Advanced Filters (visible only if toggle OFF) === */}
        {!useDefaultFilters && (
          <View style={styles.advancedBox}>
            <Text style={[styles.label, { marginBottom: 8 }]}>Advanced Filters</Text>

            {/* COMPETITIONS */}
            <View style={styles.subCard}>
              <Text style={styles.sectionTitle}>Competitions</Text>

              <View style={styles.rowWrap}>
                <Chip onPress={selectTop10} selected={isTop10Selected}>
                  Top 10
                </Chip>
                <Chip onPress={selectAllComps} selected={isAllCompsSelected}>
                  Select All
                </Chip>
                <Chip onPress={clearComps} variant="outline" selected={isClearComps}>
                  Clear All
                </Chip>
              </View>

              <Pressable onPress={() => setCompOpen((v) => !v)} style={styles.selectHeader}>
                <Ionicons name="flag-outline" size={18} color="#0b3d24" />
                <Text style={styles.selectHeaderText}>
                  {selectedCompetitionIds.length
                    ? `${selectedCompetitionIds.length} selected`
                    : "Choose competitions"}
                </Text>
                <Ionicons
                  name={compOpen ? "chevron-up" : "chevron-down"}
                  size={18}
                  color="#0b3d24"
                />
              </Pressable>

              {compOpen && (
                <>
                  <TextInput
                    style={styles.searchInput}
                    placeholder="Search competitions…"
                    value={compQuery}
                    onChangeText={setCompQuery}
                  />

                  <View style={styles.listBox}>
                    {compsOrderedForDropdown.map((c) => {
                      const isSel = selectedCompetitionIds.includes(
                        String(c.competition_id)
                      );
                      return (
                        <CompetitionRow
                          key={c.competition_id}
                          comp={c}
                          selected={isSel}
                          onToggle={toggleCompetition}
                        />
                      );
                    })}
                  </View>
                </>
              )}
            </View>

            {/* SEASONS */}
            <View style={styles.subCard}>
              <Text style={styles.sectionTitle}>Seasons</Text>

              <View style={styles.rowWrap}>
                <Chip onPress={selectLast3} selected={isLast3Seasons}>
                  Last 3
                </Chip>
                <Chip onPress={selectLast5} selected={isLast5Seasons}>
                  Last 5
                </Chip>
                <Chip onPress={selectAllSeasons} selected={isAllSeasons}>
                  Select All
                </Chip>
                <Chip onPress={clearSeasons} variant="outline" selected={isClearSeasons}>
                  Clear All
                </Chip>
              </View>

              <Pressable onPress={() => setSeasonsOpen((v) => !v)} style={styles.selectHeader}>
                <Ionicons name="calendar-outline" size={18} color="#0b3d24" />
                <Text style={styles.selectHeaderText}>
                  {selectedSeasons.length
                    ? `${selectedSeasons.length} selected`
                    : "Choose seasons"}
                </Text>
                <Ionicons
                  name={seasonsOpen ? "chevron-up" : "chevron-down"}
                  size={18}
                  color="#0b3d24"
                />
              </Pressable>

              {seasonsOpen && (
                <>
                  <TextInput
                    style={styles.searchInput}
                    placeholder="Filter seasons…"
                    value={seasonQuery}
                    onChangeText={setSeasonQuery}
                  />

                  <View style={styles.listBox}>
                    {seasonsOrderedForDropdown.map((s) => {
                      const isSel = selectedSeasons.includes(s);
                      return (
                        <Pressable
                          key={s}
                          onPress={() => toggleSeason(s)}
                          style={styles.compRow}
                        >
                          <View style={{ flex: 1 }}>
                            <Text style={styles.compName}>{s}</Text>
                          </View>
                          <Ionicons
                            name={isSel ? "checkbox" : "square-outline"}
                            size={20}
                            color={isSel ? "#14532d" : "#9ca3af"}
                          />
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              )}
            </View>

            {/* MINIMUMS */}
            <View style={styles.subCard}>
              <Text style={styles.sectionTitle}>Minimums</Text>
              <View style={styles.row}>
                <Text style={styles.label}>Min value (€)</Text>
                <TextInput
                  style={styles.inputSmall}
                  keyboardType="numeric"
                  value={String(minMarketValue ?? 0)}
                  onChangeText={(t) => setMinMarketValue(Number(t) || 0)}
                />
              </View>
              <View style={styles.row}>
                <Text style={styles.label}>Min appearances</Text>
                <TextInput
                  style={styles.inputSmall}
                  keyboardType="numeric"
                  value={String(minAppearances ?? 0)}
                  onChangeText={(t) => setMinAppearances(Number(t) || 0)}
                />
              </View>
            </View>
          </View>
        )}

        {/* Create button */}
        <TouchableOpacity
          onPress={onCreate}
          disabled={submitting}
          style={[styles.createBtn, submitting && { opacity: 0.7 }]}
        >
          <Text style={styles.createBtnText}>{submitting ? "Creating…" : "Create Challenge"}</Text>
        </TouchableOpacity>
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
  sectionTitle: { fontSize: 14, fontWeight: "700", color: "#0b3d24" },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  selectHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 10,
    marginTop: 10,
    backgroundColor: "#f8fafc",
  },
  selectHeaderText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    color: "#0b3d24",
  },
  searchInput: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    backgroundColor: "#fff",
  },
  listBox: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "#fff",
  },
  compRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#f1f5f9",
  },
  flag: { width: 18, height: 12, borderRadius: 2, marginRight: 4 },
  logo: { width: 22, height: 22, borderRadius: 4, marginRight: 4 },
  compName: { fontSize: 14, fontWeight: "600", color: "#111827" },
  compSub: { fontSize: 12, color: "#6b7280" },

  // Create button
  createBtn: {
    marginTop: 10,
    backgroundColor: "#14532d",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  createBtnText: { color: "#fff", fontWeight: "700" },

  // Invites block
  invitesCard: {
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    padding: 12,
    backgroundColor: "#ffffff",
  },
  inviteSearchRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  addBtn: {
    backgroundColor: "#14532d",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
  },
  addBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  resultsList: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    maxHeight: 240,
    overflow: "hidden",
    backgroundColor: "#fff",
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#f1f5f9",
  },
  resultAvatar: { width: 28, height: 28, borderRadius: 14 },
  resultName: { fontSize: 14, fontWeight: "600", color: "#111827" },
  resultEmail: { fontSize: 12, color: "#6b7280" },
  resultAdd: { fontSize: 12, color: "#374151" },

  invitedLabel: { fontSize: 12, color: "#6b7280", marginBottom: 4 },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  inviteChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#f3f4f6",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  inviteChipText: { fontSize: 12, fontWeight: "600", color: "#111827" },
  inviteChipX: { fontSize: 14, color: "#6b7280" },

  errorText: { marginTop: 8, fontSize: 12, color: "#dc2626" },
});
