import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Modal,
  Pressable,
  Image,
  ScrollView,
  Switch,
} from "react-native";
import { supabase } from "../../lib/supabase";

// ---- Tabs & metric options (match web semantics) ----
const TABS = ["Today", "Week", "Month", "All Time"];
const METRIC_TOTAL = "Total Points";
const METRIC_PPG = "Points/Game";

// Helpers
const periodStartFromTab = (now, tab) => {
  if (tab === "Today") return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (tab === "Week") { const d = new Date(now); d.setDate(now.getDate() - 7); return d; }
  if (tab === "Month") { const d = new Date(now); d.setMonth(now.getMonth() - 1); return d; }
  return null; // All Time
};
const isToday = (isoOrDate) => {
  const d = new Date(isoOrDate);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() &&
         d.getMonth() === now.getMonth() &&
         d.getDate() === now.getDate();
};
const formatTime = (seconds) => {
  const s = Number(seconds) || 0;
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};
const rankDisplay = (index) => {
  if (index === 0) return "🥇";
  if (index === 1) return "🥈";
  if (index === 2) return "🥉";
  return String(index + 1);
};

export default function LeaderboardScreen() {
  // Filters
  const [tab, setTab] = useState("Today");
  const [metric, setMetric] = useState(METRIC_TOTAL); // controlled by "Per Game" switch

  // Loading
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Data
  const [dailyChampions, setDailyChampions] = useState([]);
  const [rows, setRows] = useState([]);

  // User modal
  const [openUser, setOpenUser] = useState(null);
  const [userLoading, setUserLoading] = useState(false);
  const [userStats, setUserStats] = useState({
    totalPoints: 0,
    games: 0,
    avgTime: 0,
    successRate: 0,
  });
  const [userGames, setUserGames] = useState([]);

  // -------- Lightweight cache to speed up tab/metric switching --------
  // Key: `${tab}|${metric}`
  const cacheRef = useRef(new Map());

  // ------- Data loader (same logic as web page) -------
  const load = async (opts = { useCache: true, backgroundRefresh: true }) => {
    const cacheKey = `${tab}|${metric}`;

    // Fast path: use cache immediately if available
    if (opts.useCache && cacheRef.current.has(cacheKey)) {
      const cached = cacheRef.current.get(cacheKey);
      setDailyChampions(cached.dailyChampions || []);
      setRows(cached.rows || []);
      setLoading(false);

      // Do a silent refresh in background to keep things fresh
      if (!opts.backgroundRefresh) return;
    } else {
      setLoading(true);
    }

    try {
      // Daily Champions (today’s daily winners)
      const todayStartIso = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();

      const dailyPromise = supabase
        .from("games_records")
        .select("id, user_id, points_earned, player_name, created_at, won")
        .eq("is_daily_challenge", true)
        .gte("created_at", todayStartIso)
        .eq("won", true)
        .order("points_earned", { ascending: false })
        .limit(10);

      // Main leaderboard
      const now = new Date();
      const start = periodStartFromTab(now, tab);
      const startIso = start ? start.toISOString() : null;

      // Base (non-elimination) games
      let grQuery = supabase
        .from("games_records")
        .select("user_id, points_earned, time_taken_seconds, won, created_at")
        .or("is_elimination_game.is.null,is_elimination_game.eq.false");
      if (startIso) grQuery = grQuery.gte("created_at", startIso);

      // Transactions
      let txQuery = supabase.from("point_transactions").select("user_id, amount, created_at");
      if (startIso) txQuery = txQuery.gte("created_at", startIso);

      // Fetch in parallel
      const [{ data: daily, error: dailyErr }, { data: gamesRows, error: gamesErr }, { data: txRows, error: txErr }] =
        await Promise.all([dailyPromise, grQuery, txQuery]);

      if (dailyErr) throw dailyErr;
      if (gamesErr) throw gamesErr;
      if (txErr) throw txErr;

      // Wire daily champions with users table
      let champions = [];
      if (daily?.length) {
        const ids = Array.from(new Set(daily.map((d) => d.user_id)));
        let users = [];
        if (ids.length) {
          const { data: usersData, error: usersErr } = await supabase
            .from("users")
            .select("id, full_name, profile_photo_url, created_at")
            .in("id", ids);
          if (usersErr) throw usersErr;
          users = usersData || [];
        }
        const map = new Map(users.map((u) => [u.id, u]));
        champions = daily.map((d) => ({ ...d, user: map.get(d.user_id) || { full_name: "Unknown Player" } }));
      }

      // Aggregate base (non-elimination) stats by user
      const baseByUser = new Map();
      for (const g of gamesRows || []) {
        const uid = g.user_id;
        let acc = baseByUser.get(uid);
        if (!acc) {
          acc = { gamesCount: 0, basePoints: 0, totalTime: 0, wins: 0 };
          baseByUser.set(uid, acc);
        }
        acc.gamesCount += 1;
        acc.basePoints += g.points_earned || 0;
        acc.totalTime += g.time_taken_seconds || 0;
        if (g.won) acc.wins += 1;
      }

      // Aggregate transactions by user
      const txByUser = new Map();
      for (const t of txRows || []) {
        const uid = t.user_id;
        const amt = Number(t.amount || 0);
        txByUser.set(uid, (txByUser.get(uid) || 0) + amt);
      }

      // Union of user IDs
      const involvedIds = Array.from(new Set([...baseByUser.keys(), ...txByUser.keys()]));
      let users = [];
      if (involvedIds.length) {
        const { data: usersData2, error: usersErr2 } = await supabase
          .from("users")
          .select("id, full_name, profile_photo_url, created_at")
          .in("id", involvedIds);
        if (usersErr2) throw usersErr2;
        users = usersData2 || [];
      }
      const userMap = new Map(users.map((u) => [u.id, u]));

      // Build rows (hide users with 0 games in timeframe)
      const built = [];
      for (const uid of involvedIds) {
        const u = userMap.get(uid);
        const base = baseByUser.get(uid) || { gamesCount: 0, basePoints: 0, totalTime: 0, wins: 0 };
        if (base.gamesCount === 0) continue;

        const txSum = txByUser.get(uid) || 0;
        const totalPoints = base.basePoints + txSum;

        built.push({
          userId: uid,
          name: u?.full_name || "Unknown Player",
          profilePhoto: u?.profile_photo_url || "",
          memberSince: u?.created_at ? new Date(u.created_at).toLocaleDateString() : "—",
          points: totalPoints,
          gamesCount: base.gamesCount,
          avgTime: base.gamesCount ? Math.round(base.totalTime / base.gamesCount) : 0,
          successRate: base.gamesCount ? Math.round((base.wins / base.gamesCount) * 100) : 0,
          avgPoints: base.gamesCount ? Math.round(totalPoints / base.gamesCount) : totalPoints,
        });
      }

      built.sort((a, b) =>
        metric === METRIC_TOTAL ? b.points - a.points : b.avgPoints - a.avgPoints
      );

      // Update UI
      setDailyChampions(champions);
      setRows(built);

      // Save to cache
      cacheRef.current.set(cacheKey, { dailyChampions: champions, rows: built });
    } catch (e) {
      console.error("Error loading leaderboard:", e);
      if (!cacheRef.current.has(`${tab}|${metric}`)) {
        setDailyChampions([]);
        setRows([]);
      }
    } finally {
      setLoading(false);
    }
  };

  // Initial & on-filter changes
  useEffect(() => {
    load({ useCache: true, backgroundRefresh: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, metric]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load({ useCache: false, backgroundRefresh: false });
    setRefreshing(false);
  };

  // Open user modal (recent games + lifetime stats)
  const openUserModal = async (player) => {
    setOpenUser(player);
    setUserLoading(true);
    setUserStats({ totalPoints: 0, games: 0, avgTime: 0, successRate: 0 });
    setUserGames([]);
    try {
      const { data: games, error: gamesErr } = await supabase
        .from("games_records")
        .select(
          "id, player_name, won, points_earned, time_taken_seconds, guesses_attempted, hints_used, created_at, is_daily_challenge, is_elimination_game"
        )
        .eq("user_id", player.userId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (gamesErr) throw gamesErr;
      setUserGames(games || []);

      const { data: allGames, error: allErr } = await supabase
        .from("games_records")
        .select("won, points_earned, time_taken_seconds")
        .eq("user_id", player.userId)
        .or("is_elimination_game.is.null,is_elimination_game.eq.false");
      if (allErr) throw allErr;

      const total = allGames?.length || 0;
      const basePts = (allGames || []).reduce((s, g) => s + (g.points_earned || 0), 0);
      const wins = (allGames || []).filter((g) => g.won).length;
      const time = (allGames || []).reduce((s, g) => s + (g.time_taken_seconds || 0), 0);

      const { data: txs, error: txErr } = await supabase
        .from("point_transactions")
        .select("amount")
        .eq("user_id", player.userId);
      if (txErr) throw txErr;
      const txPts = (txs || []).reduce((s, t) => s + Number(t.amount || 0), 0);

      setUserStats({
        totalPoints: basePts + txPts,
        games: total,
        avgTime: total ? Math.round(time / total) : 0,
        successRate: total ? Math.round((wins / total) * 100) : 0,
      });
    } catch (e) {
      console.error("Failed loading user modal data:", e);
    } finally {
      setUserLoading(false);
    }
  };

  // ----- RENDER -----
  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {/* Daily Champions */}
      <View style={styles.dailyCard}>
        <Text style={styles.dailyHeader}>☆ Today's Daily Challenge Champions</Text>
        {dailyChampions.length === 0 ? (
          <View style={styles.dailyEmpty}>
            <Text style={styles.dailyEmptyStar}>⭐</Text>
            <Text style={styles.dailyEmptyTitle}>No champions yet today!</Text>
            <Text style={styles.dailyEmptySub}>Be the first to conquer today's daily challenge.</Text>
          </View>
        ) : (
          <FlatList
            contentContainerStyle={{ padding: 12 }}
            data={dailyChampions}
            keyExtractor={(it) => String(it.id)}
            renderItem={({ item, index }) => {
              const user = item.user || {};
              return (
                <View style={styles.dailyItem}>
                  <View style={styles.dailyRankBubble}>
                    <Text style={styles.dailyRankText}>{index + 1}</Text>
                  </View>
                  {user.profile_photo_url ? (
                    <Image source={{ uri: user.profile_photo_url }} style={styles.avatarSm} />
                  ) : (
                    <View style={styles.avatarSmFallback}>
                      <Text style={styles.avatarSmFallbackText}>
                        {(user.full_name || "?").slice(0, 1)}
                      </Text>
                    </View>
                  )}
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Pressable
                      onPress={() =>
                        openUserModal({
                          userId: item.user_id,
                          name: user.full_name || "Unknown Player",
                          profilePhoto: user.profile_photo_url || "",
                          memberSince: user.created_at
                            ? new Date(user.created_at).toLocaleDateString()
                            : "—",
                        })
                      }
                    >
                      <Text style={styles.dailyName} numberOfLines={1} ellipsizeMode="tail">
                        {user.full_name || "Unknown Player"}
                      </Text>
                    </Pressable>
                    <Text style={styles.dailyPoints}>{item.points_earned} points</Text>
                  </View>
                </View>
              );
            }}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          />
        )}
      </View>

      {/* Tabs row — centered and wrapped */}
      <View style={styles.filtersRow}>
        {TABS.map((t) => (
          <Pressable
            key={t}
            onPress={() => setTab(t)}
            style={[styles.tabPill, tab === t ? styles.tabPillActive : styles.tabPillInactive]}
          >
            <Text style={tab === t ? styles.tabTextActive : styles.tabTextInactive}>{t}</Text>
          </Pressable>
        ))}
      </View>

      {/* Metric switch (Per Game) */}
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>Per Game</Text>
        <Switch
          value={metric === METRIC_PPG}
          onValueChange={(on) => setMetric(on ? METRIC_PPG : METRIC_TOTAL)}
        />
      </View>

      {/* Leaderboard list */}
      <Text style={styles.sectionTitle}>Overall Rankings</Text>
      <FlatList
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 40 }}
        data={rows}
        keyExtractor={(item) => item.userId}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        renderItem={({ item, index }) => (
          <Pressable onPress={() => openUserModal(item)} style={styles.cardRow}>
            {/* Left: rank (medals) + avatar */}
            <View style={styles.leftCol}>
              <Text style={styles.rankText}>{rankDisplay(index)}</Text>
              {item.profilePhoto ? (
                <Image source={{ uri: item.profilePhoto }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarFallback}>
                  <Text style={styles.avatarFallbackText}>
                    {(item.name || "?").slice(0, 1)}
                  </Text>
                </View>
              )}
            </View>

            {/* Middle: name + joined */}
            <View style={styles.midCol}>
              <Text style={styles.playerName} numberOfLines={1} ellipsizeMode="tail">
                {item.name}
              </Text>
              <Text style={styles.memberSince} numberOfLines={1} ellipsizeMode="tail">
                Joined {item.memberSince}
              </Text>
            </View>

            {/* Right: points + compact stats */}
            <View style={styles.rightCol}>
              <Text style={styles.pointsValue}>
                {metric === METRIC_TOTAL
                  ? Number(item.points || 0).toLocaleString()
                  : item.avgPoints}
              </Text>
              <Text style={styles.pointsLabel}>
                {metric === METRIC_TOTAL ? "points" : "pts/game"}
              </Text>
              <Text style={styles.compactStats}>
                {item.gamesCount} • {formatTime(item.avgTime)} • {item.successRate}%
              </Text>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <Text style={{ color: "#6b7280" }}>
              No leaderboard data for the selected period.
            </Text>
          </View>
        }
      />

      {/* User Modal */}
      <Modal visible={!!openUser} transparent animationType="fade" onRequestClose={() => setOpenUser(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                {openUser?.profilePhoto ? (
                  <Image source={{ uri: openUser.profilePhoto }} style={styles.avatar} />
                ) : (
                  <View style={styles.avatarFallback}>
                    <Text style={styles.avatarFallbackText}>
                      {(openUser?.name || "?").slice(0, 1)}
                    </Text>
                  </View>
                )}
                <View style={{ marginLeft: 10 }}>
                  <Text style={styles.modalName} numberOfLines={1}>
                    {openUser?.name}
                  </Text>
                  <Text style={styles.modalSince}>
                    Joined {openUser?.memberSince || "—"}
                  </Text>
                </View>
              </View>
              <Pressable onPress={() => setOpenUser(null)} style={styles.closeBtn}>
                <Text style={{ fontWeight: "700" }}>✕</Text>
              </Pressable>
            </View>

            {/* Stats */}
            <View style={styles.statsGrid}>
              <View style={styles.statBox}>
                <Text style={styles.statSmallLabel}>Total Points</Text>
                <Text style={styles.statBigValue}>
                  {userStats.totalPoints?.toLocaleString?.() || 0}
                </Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statSmallLabel}>Games</Text>
                <Text style={styles.statBigValue}>{userStats.games || 0}</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statSmallLabel}>Avg Time</Text>
                <Text style={styles.statBigValue}>{userStats.avgTime || 0}s</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statSmallLabel}>Success</Text>
                <Text style={styles.statBigValue}>{userStats.successRate || 0}%</Text>
              </View>
            </View>

            {/* Recent 20 */}
            <View style={{ maxHeight: 340, paddingHorizontal: 12, paddingBottom: 12 }}>
              {userLoading ? (
                <View style={{ height: 120, alignItems: "center", justifyContent: "center" }}>
                  <ActivityIndicator />
                </View>
              ) : userGames.length === 0 ? (
                <View style={styles.emptyBox}>
                  <Text style={{ color: "#6b7280" }}>No recent games.</Text>
                </View>
              ) : (
                <ScrollView>
                  {userGames.map((g) => {
                    const maskedName =
                      g.is_daily_challenge && isToday(g.created_at)
                        ? "Daily Challenge Player"
                        : g.player_name || "Unknown Player";
                    const titleStyle = [
                      styles.gameTitle,
                      g.is_daily_challenge
                        ? { color: "#a16207", fontWeight: "700" }
                        : g.is_elimination_game
                        ? { color: "#7c3aed", fontWeight: "700" }
                        : null,
                    ];
                    return (
                      <View key={g.id} style={styles.gameRow}>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={titleStyle} numberOfLines={1} ellipsizeMode="tail">
                            {maskedName}
                          </Text>
                          <Text style={styles.gameSub}>
                            {new Date(g.created_at).toLocaleString()}
                          </Text>
                        </View>
                        <View style={{ alignItems: "flex-end" }}>
                          <Text
                            style={[
                              styles.gamePoints,
                              { color: g.won ? "#16a34a" : "#dc2626" },
                            ]}
                          >
                            {g.won ? `+${g.points_earned}` : "0"} pts
                          </Text>
                          <Text style={styles.gameSub}>
                            {g.guesses_attempted} {g.guesses_attempted === 1 ? "guess" : "guesses"}
                            {g.is_daily_challenge ? " • Daily" : ""}
                            {g.is_elimination_game ? " • Elimination" : ""}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </ScrollView>
              )}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ---- Styles ----
const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },

  // Daily champions
  dailyCard: {
    margin: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#fde68a",
    backgroundColor: "#fffbeb",
  },
  dailyHeader: {
    borderBottomWidth: 1,
    borderBottomColor: "#fef3c7",
    textAlign: "center",
    paddingVertical: 10,
    fontWeight: "700",
    color: "#92400e",
  },
  dailyEmpty: { paddingVertical: 18, alignItems: "center", justifyContent: "center" },
  dailyEmptyStar: { fontSize: 28, marginBottom: 4 },
  dailyEmptyTitle: { fontSize: 16, fontWeight: "600" },
  dailyEmptySub: { color: "#6b7280", marginTop: 2 },
  dailyItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderColor: "#fde68a",
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
  },
  dailyRankBubble: {
    height: 32,
    width: 32,
    borderRadius: 16,
    backgroundColor: "#fef3c7",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  dailyRankText: { fontWeight: "700", color: "#92400e" },
  dailyName: { fontWeight: "600" },
  dailyPoints: { color: "#a16207", marginTop: 2, fontSize: 12 },
  avatarSm: { height: 28, width: 28, borderRadius: 14, backgroundColor: "#f0fdf4", marginRight: 8 },
  avatarSmFallback: {
    height: 28,
    width: 28,
    borderRadius: 14,
    backgroundColor: "#dcfce7",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  avatarSmFallbackText: { color: "#065f46", fontWeight: "700" },

  // Tabs row — centered pills
  filtersRow: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    alignItems: "center",
    justifyContent: "center", // center the 4 pills
    width: "100%",
  },
  tabPill: {
    paddingVertical: 6, // as requested
    paddingHorizontal: 12,
    borderRadius: 20,
  },
  tabPillActive: { backgroundColor: "#064e3b" },
  tabPillInactive: { backgroundColor: "#e5e7eb" },
  tabTextActive: { color: "white", fontWeight: "600" },
  tabTextInactive: { color: "#374151", fontWeight: "500" },

  // Metric switch row
  switchRow: {
    marginHorizontal: 12,
    marginTop: 2,
    marginBottom: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: "#d1d5db",
    backgroundColor: "#fff",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  switchLabel: { fontWeight: "700", color: "#374151" },

  // Section title
  sectionTitle: {
    marginTop: 4,
    marginHorizontal: 12,
    marginBottom: 6,
    color: "#065f46",
    fontWeight: "700",
    fontSize: 16,
  },

  // Leaderboard rows
  cardRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "white",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  leftCol: { width: 80, flexDirection: "row", alignItems: "center", gap: 8 },
  rankText: { fontWeight: "700", color: "#6b7280", width: 28, textAlign: "center" },
  avatar: { height: 36, width: 36, borderRadius: 18, backgroundColor: "#f0fdf4" },
  avatarFallback: {
    height: 36,
    width: 36,
    borderRadius: 18,
    backgroundColor: "#dcfce7",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarFallbackText: { color: "#065f46", fontWeight: "700" },

  midCol: { flex: 1, minWidth: 0, paddingRight: 8 },
  playerName: { fontWeight: "600", color: "#111827" },
  memberSince: { color: "#6b7280", fontSize: 12, marginTop: 1 },

  rightCol: { width: 120, alignItems: "flex-end" },
  pointsValue: { color: "#16a34a", fontWeight: "700" },
  pointsLabel: { color: "#6b7280", fontSize: 12, marginTop: 1 },
  compactStats: { color: "#6b7280", fontSize: 12, marginTop: 4 },

  // Empty
  emptyBox: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    backgroundColor: "white",
    padding: 16,
    marginHorizontal: 12,
    marginVertical: 10,
    alignItems: "center",
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  modalCard: {
    width: "100%",
    maxWidth: 640,
    borderRadius: 14,
    backgroundColor: "white",
    overflow: "hidden",
  },
  modalHeader: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  modalName: { fontWeight: "700" },
  modalSince: { color: "#6b7280", fontSize: 12 },
  closeBtn: { padding: 6, borderRadius: 16 },

  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 12,
    paddingTop: 12,
    gap: 8,
  },
  statBox: {
    width: "48%",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    padding: 12,
    alignItems: "center",
    marginBottom: 8,
  },
  statSmallLabel: { color: "#6b7280", fontSize: 12 },
  statBigValue: { fontWeight: "700", color: "#065f46", marginTop: 2 },

  gameRow: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  gameTitle: { fontWeight: "600" },
  gameSub: { color: "#6b7280", fontSize: 12, marginTop: 2, textAlign: "right" },
  gamePoints: { fontWeight: "700", textAlign: "right" },
});
