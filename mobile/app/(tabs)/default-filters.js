import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  TextInput,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  Alert,
  Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../../lib/supabase";
import { getCompetitions, getSeasons, getCounts } from "../../lib/api";

// ------- utils -------
function compactMoney(n) {
  const num = Number(n || 0);
  if (num >= 1_000_000_000) return `${Math.round(num / 1_000_000_000)}B`;
  if (num >= 1_000_000) return `${Math.round(num / 1_000_000)}M`;
  if (num >= 1_000) return `${Math.round(num / 1_000)}K`;
  return `${num}`;
}

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
      <Text style={{ color: selected ? "#fff" : "#111827", fontSize: 12, fontWeight: "600" }}>
        {children}
      </Text>
    </Pressable>
  );
}

function CompetitionRow({ comp, selected, onToggle }) {
  return (
    <Pressable onPress={() => onToggle(String(comp.competition_id))} style={styles.compRow}>
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

export default function DefaultFiltersScreen() {
  const [user, setUser] = useState(null);

  // Data
  const [allCompetitions, setAllCompetitions] = useState([]); // flat for search/sort
  const [groupedCompetitions, setGroupedCompetitions] = useState({});
  const [allSeasons, setAllSeasons] = useState([]);

  // Defaults
  const [defaultCompetitionIds, setDefaultCompetitionIds] = useState([]);
  const [defaultSeasons, setDefaultSeasons] = useState([]);
  const [defaultMinMarket, setDefaultMinMarket] = useState(0);
  const [defaultMinAppearances, setDefaultMinAppearances] = useState(0);

  // UI
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // pools counter
  const [poolCount, setPoolCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [loadingCounts, setLoadingCounts] = useState(false);
  const [countsError, setCountsError] = useState("");

  // Competitions dropdown
  const [compOpen, setCompOpen] = useState(false);
  const [compQuery, setCompQuery] = useState("");

  // Seasons dropdown (multi)
  const [seasonsOpen, setSeasonsOpen] = useState(false);
  const [seasonQuery, setSeasonQuery] = useState("");

  // ---------- API (web) then Supabase fallback ----------
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
        groupedByCountry: comps.groupedByCountry || {},
        flatCompetitions: flat,
        seasons: Array.isArray(seas.seasons) ? seas.seasons.map(String) : [],
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

    const grouped = {};
    (comps || []).forEach((c) => {
      (grouped[c.country] ||= []).push(c);
    });

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
        } catch {
          /* ignore */
        }
      }
      arr.forEach((s) => set.add(String(s)));
    });

    const seasons = Array.from(set)
      .filter(Boolean)
      .sort((a, b) => Number(b) - Number(a));

    return {
      groupedByCountry: grouped,
      flatCompetitions: (comps || []).map((c) => ({ ...c })),
      seasons,
    };
  }

  // ---------- load + counts ----------
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        if (!auth?.user) return;
        setUser(auth.user);

        const { data: row } = await supabase
          .from("users")
          .select(
            "default_competitions, default_seasons, default_min_market_value, default_min_appearances"
          )
          .eq("id", auth.user.id)
          .maybeSingle();

        setDefaultCompetitionIds((row?.default_competitions || []).map(String));
        setDefaultSeasons((row?.default_seasons || []).map(String));
        setDefaultMinMarket(row?.default_min_market_value ?? 0);
        setDefaultMinAppearances(row?.default_min_appearances ?? 0);

        let payload = await fetchFromWebAPI();
        if (!payload) payload = await fetchFromSupabaseFallback();

        if (!mounted) return;
        setGroupedCompetitions(payload.groupedByCountry || {});
        setAllCompetitions(payload.flatCompetitions || []);
        setAllSeasons(payload.seasons || []);
      } catch (e) {
        console.error(e);
        Alert.alert(
          "Unable to load filters",
          "Could not fetch competitions/seasons. Please check connectivity."
        );
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!user) return;
      try {
        setLoadingCounts(true);
        setCountsError("");
        const payload = {
          competitions: defaultCompetitionIds,
          seasons: defaultSeasons,
          minMarketValue: Number(defaultMinMarket) || 0,
          minAppearances: Number(defaultMinAppearances) || 0,
          userId: user.id,
        };
        console.log("[DefaultFilters] counts payload:", payload);
        const res = await getCounts(payload);
        if (!cancelled) {
          setPoolCount(res?.poolCount || 0);
          setTotalCount(res?.totalCount || 0);
          console.log("[DefaultFilters] counts result:", res);
        }
      } catch (e) {
        if (!cancelled) {
          setPoolCount(0);
          setTotalCount(0);
          setCountsError(String(e?.message || e));
          console.warn("[DefaultFilters] counts failed:", e);
        }
      } finally {
        if (!cancelled) setLoadingCounts(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [user, defaultCompetitionIds, defaultSeasons, defaultMinMarket, defaultMinAppearances]);

  const filteredCompetitions = useMemo(() => {
    const q = compQuery.trim().toLowerCase();
    if (!q) return allCompetitions;
    return allCompetitions.filter(
      (c) =>
        (c.competition_name || "").toLowerCase().includes(q) ||
        (c.country || "").toLowerCase().includes(q)
    );
  }, [compQuery, allCompetitions]);

  const toggleCompetition = (id) => {
    setDefaultCompetitionIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const top10Ids = useMemo(() => {
    const arr = [...allCompetitions];
    arr.sort((a, b) => Number(b.total_value_eur || 0) - Number(a.total_value_eur || 0));
    return arr.slice(0, 10).map((c) => String(c.competition_id));
  }, [allCompetitions]);

  const selectTop10 = () => setDefaultCompetitionIds(top10Ids);
  const selectAllComps = () => {
    const all = (allCompetitions || []).map((c) => String(c.competition_id));
    setDefaultCompetitionIds(all);
  };
  const clearComps = () => setDefaultCompetitionIds([]);

  const compsOrderedForDropdown = useMemo(() => {
    const ids = new Set(defaultCompetitionIds);
    const list = compQuery.trim() ? filteredCompetitions : allCompetitions;
    return [...list].sort((a, b) => {
      const sa = ids.has(String(a.competition_id)) ? 0 : 1;
      const sb = ids.has(String(b.competition_id)) ? 0 : 1;
      if (sa !== sb) return sa - sb;
      const ca = (a.country || "").localeCompare(b.country || "");
      if (ca !== 0) return ca;
      return (a.competition_name || "").localeCompare(b.competition_name || "");
    });
  }, [allCompetitions, filteredCompetitions, compQuery, defaultCompetitionIds]);

  const seasonsOrderedForDropdown = useMemo(() => {
    const sel = new Set(defaultSeasons);
    const base = seasonQuery
      ? allSeasons.filter((s) => s.toLowerCase().includes(seasonQuery.trim().toLowerCase()))
      : allSeasons;
    return [...base].sort((a, b) => {
      const sa = sel.has(a) ? 0 : 1;
      const sb = sel.has(b) ? 0 : 1;
      if (sa !== sb) return sa - sb;
      return Number(b) - Number(a);
    });
  }, [allSeasons, defaultSeasons, seasonQuery]);

  const toggleSeason = (season) => {
    setDefaultSeasons((prev) =>
      prev.includes(season) ? prev.filter((s) => s !== season) : [...prev, season]
    );
  };

  const handleSave = async () => {
    if (!user) return;
    try {
      setSaving(true);
      const { error } = await supabase
        .from("users")
        .update({
          default_competitions: defaultCompetitionIds,
          default_seasons: defaultSeasons,
          default_min_market_value: Number(defaultMinMarket) || 0,
          default_min_appearances: Number(defaultMinAppearances) || 0,
        })
        .eq("id", user.id);
      if (error) throw error;
      Alert.alert("Saved", "Default filters updated.");
    } catch (e) {
      Alert.alert("Error", e?.message || "Could not save filters.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.screen}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: 32 }}>
      {/* COMPETITIONS */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Competitions</Text>

        <View style={styles.rowWrap}>
          <Chip onPress={selectTop10}>Top 10</Chip>
          <Chip onPress={selectAllComps}>Select All</Chip>
          <Chip onPress={clearComps} variant="outline">
            Clear All
          </Chip>
        </View>

        <Pressable onPress={() => setCompOpen((v) => !v)} style={styles.selectHeader}>
          <Ionicons name="flag-outline" size={18} color="#0b3d24" />
          <Text style={styles.selectHeaderText}>
            {defaultCompetitionIds.length ? `${defaultCompetitionIds.length} selected` : "Select competitions"}
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
                  const selected = defaultCompetitionIds.includes(id);
                  return (
                    <CompetitionRow
                      key={id}
                      comp={c}
                      selected={selected}
                      onToggle={toggleCompetition}
                    />
                  );
                })}
                {compsOrderedForDropdown.length === 0 && <Text style={styles.muted}>No matches.</Text>}
              </ScrollView>
            </View>
          </View>
        )}
      </View>

      {/* SEASONS (multi-select) */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Seasons</Text>

        <View style={styles.rowWrap}>
          <Chip onPress={() => setDefaultSeasons(allSeasons.slice(0, 3))}>Last 3</Chip>
          <Chip onPress={() => setDefaultSeasons(allSeasons.slice(0, 5))}>Last 5</Chip>
          <Chip onPress={() => setDefaultSeasons(allSeasons)}>Select All</Chip>
          <Chip onPress={() => setDefaultSeasons([])} variant="outline">
            Clear
          </Chip>
        </View>

        <Pressable onPress={() => setSeasonsOpen((v) => !v)} style={styles.selectHeader}>
          <Ionicons name="calendar-outline" size={18} color="#0b3d24" />
          <Text style={styles.selectHeaderText}>
            {defaultSeasons.length ? `${defaultSeasons.length} selected` : "Select seasons"}
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
                  const selected = defaultSeasons.includes(s);
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

      {/* MARKET VALUE */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Minimum Market Value (€)</Text>
        <TextInput
          keyboardType="number-pad"
          value={String(defaultMinMarket ?? 0)}
          onChangeText={(t) => setDefaultMinMarket(parseInt(t || "0", 10) || 0)}
          style={styles.input}
        />
        <View style={styles.rowWrap}>
          {[0, 100_000, 500_000, 1_000_000, 5_000_000, 10_000_000, 25_000_000, 50_000_000].map(
            (v) => (
              <Chip
                key={v}
                selected={Number(defaultMinMarket) === v}
                onPress={() => setDefaultMinMarket(v)}
              >
                {v === 0 ? "Clear" : compactMoney(v)}
              </Chip>
            )
          )}
        </View>
      </View>

      {/* APPEARANCES */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Minimum Appearances</Text>
        <TextInput
          keyboardType="number-pad"
          value={String(defaultMinAppearances ?? 0)}
          onChangeText={(t) => setDefaultMinAppearances(parseInt(t || "0", 10) || 0)}
          style={styles.input}
        />
        <View style={styles.rowWrap}>
          {[0, 5, 10, 15, 20, 25, 30].map((v) => (
            <Chip
              key={v}
              selected={Number(defaultMinAppearances) === v}
              onPress={() => setDefaultMinAppearances(v)}
            >
              {v}
            </Chip>
          ))}
        </View>
      </View>

      {/* Player pool (moved here, just above Save) */}
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

      <Pressable
        onPress={handleSave}
        disabled={saving}
        style={[styles.saveBtn, { opacity: saving ? 0.7 : 1 }]}
      >
        <Text style={styles.saveText}>{saving ? "Saving..." : "Save Filters"}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 12, backgroundColor: "#f7faf7" },

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
  poolLabel: { fontSize: 14, color: "#92400e", fontWeight: "600" },
  poolValue: { fontSize: 14, color: "#92400e", fontWeight: "800" },

  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e5e7eb",
  },
  cardTitle: { fontSize: 16, fontWeight: "700", color: "#0b3d24", marginBottom: 8 },
  rowWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  muted: { color: "#6b7280", marginTop: 8 },

  input: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: "#111827",
    marginBottom: 8,
  },

  chip: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
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
  selectHeaderText: { flex: 1, color: "#111827", fontWeight: "600" },

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
  searchInput: { flex: 1, fontSize: 14, color: "#111827", paddingVertical: 4 },

  compRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#f1f5f9",
  },
  flag: { width: 18, height: 12, borderRadius: 2, backgroundColor: "#eee" },
  logo: { width: 18, height: 18, borderRadius: 3, backgroundColor: "#eee" },
  compName: { fontWeight: "700", color: "#0b3d24" },
  compSub: { fontSize: 12, color: "#6b7280" },

  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#f1f5f9",
    justifyContent: "space-between",
  },

  // dark green like app theme
  saveBtn: {
    backgroundColor: "#14532d",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  saveText: { color: "#fff", fontWeight: "800" },
});
