// mobile/app/leagues.js
import React, { useCallback, useEffect, useMemo, useState, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Image,
  ActivityIndicator,
  Alert,
  ScrollView,
  RefreshControl,
  Modal,
  Pressable,
  Dimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
} from "react-native";
import { supabase } from "../../lib/supabase";
import DateTimePicker from "@react-native-community/datetimepicker";
import { KeyboardAwareScrollView } from "react-native-keyboard-aware-scroll-view";
import { useFonts, Tektur_400Regular, Tektur_700Bold } from "@expo-google-fonts/tektur";

/* =========================
   Shared time/date helpers
   ======================= */
function toUtcMidnight(dateLike) {
  const d =
    typeof dateLike === "string"
      ? new Date(`${dateLike}T00:00:00.000Z`)
      : new Date(dateLike);
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  );
}
function todayUtcMidnight() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
function dayRangeUtc(dateStr) {
  const start = toUtcMidnight(dateStr);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}
const fmtShort = (d) =>
  new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" });

// Convert "YYYY-MM-DD" to a *local* Date (no time)
function ymdToLocalDate(ymd) {
  const [y, m, d] = (ymd || "").split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
// Tomorrow in UTC, returned as "YYYY-MM-DD"
function tomorrowUtcYMD() {
  const t = todayUtcMidnight();
  const plus1 = new Date(t.getTime() + 24 * 60 * 60 * 1000);
  return plus1.toISOString().slice(0, 10);
}
/* =========================
   Names & standings helpers
   ======================= */
const displayName = (p) =>
  p.is_bot ? p.display_name : p.user?.full_name || "Unknown";
const byDateAsc = (a, b) => new Date(a.match_date) - new Date(b.match_date);
const keyDP = (m, p) => `${m.league_id}|${m.match_date}|${p.id}`;

function computeStandings(participants, matches, dayPointsMap) {
  const stats = new Map();
  const ensure = (pid, name, isBot) => {
    if (!stats.has(pid))
      stats.set(pid, {
        pid,
        name,
        isBot,
        P: 0,
        W: 0,
        D: 0,
        L: 0,
        PTS: 0,
        PF: 0,
        PA: 0,
      });
    return stats.get(pid);
  };

  const today0 = todayUtcMidnight();

  matches
    .filter((m) => new Date(m.match_date) <= today0) // include today (live)
    .forEach((m) => {
      const home = participants.find((p) => p.id === m.home_participant_id);
      const away = participants.find((p) => p.id === m.away_participant_id);
      if (!home || !away) return;

      const homePts = dayPointsMap.get(keyDP(m, home)) ?? 0;
      const awayPts = dayPointsMap.get(keyDP(m, away)) ?? 0;

      const A = ensure(home.id, displayName(home), home.is_bot);
      const B = ensure(away.id, displayName(away), away.is_bot);

      A.P += 1;
      B.P += 1;

      // points for/against (for GD)
      A.PF += homePts;
      A.PA += awayPts;
      B.PF += awayPts;
      B.PA += homePts;

      if (homePts > awayPts) {
        A.W += 1;
        A.PTS += 3;
        B.L += 1;
      } else if (homePts < awayPts) {
        B.W += 1;
        B.PTS += 3;
        A.L += 1;
      } else {
        A.D += 1;
        B.D += 1;
        A.PTS += 1;
        B.PTS += 1;
      }
    });

  // ensure everyone shows in table
  participants.forEach((p) => ensure(p.id, displayName(p), p.is_bot));

  const list = Array.from(stats.values()).map((s) => ({
    ...s,
    GD: (s.PF || 0) - (s.PA || 0),
  }));
  return list.sort(
    (a, b) => b.PTS - a.PTS || b.GD - a.GD || b.W - a.W || a.name.localeCompare(b.name)
  );
}

/* =========================
   Double round-robin pairing
   ======================= */
function generateDoubleRoundRobin(participantIds) {
  const n = participantIds.length;
  if (n < 2) return [];
  const arr = [...participantIds];
  if (n % 2 !== 0) arr.push(null);
  const m = arr.length;
  const rounds = [];
  for (let r = 0; r < m - 1; r++) {
    const pairs = [];
    for (let i = 0; i < m / 2; i++) {
      const a = arr[i];
      const b = arr[m - 1 - i];
      if (a != null && b != null) {
        pairs.push(r % 2 === 0 ? { home: a, away: b } : { home: b, away: a });
      }
    }
    rounds.push({ match_day: r + 1, pairs });
    const fixed = arr[0];
    const rest = arr.slice(1);
    rest.unshift(rest.pop());
    arr.splice(0, arr.length, fixed, ...rest);
  }
  const secondLeg = rounds.map((r, idx) => ({
    match_day: rounds.length + idx + 1,
    pairs: r.pairs.map((p) => ({ home: p.away, away: p.home })),
  }));
  return [...rounds, ...secondLeg];
}

/* =========================
   Fun bot names (like web)
   ======================= */
const BOT_PREFIX = [
  "Robo",
  "Auto",
  "Mecha",
  "Cyber",
  "Quantum",
  "Galacto",
  "Vector",
  "Atlas",
  "Proto",
  "Machine",
];
const BOT_SUFFIX = [
  "United",
  "FC",
  "Athletic",
  "Calcio",
  "City",
  "Town",
  "Dynamos",
  "Wanderers",
  "Botos",
  "Botlandia",
  "Robotics",
];
const randomBotName = () =>
  `${BOT_PREFIX[Math.floor(Math.random() * BOT_PREFIX.length)]} ${BOT_SUFFIX[Math.floor(Math.random() * BOT_SUFFIX.length)]
  }`;

/* =========================
   Tiny UI atoms
   ======================= */
function Section({ title, right, children, style }) {
  return (
    <View
      style={[
        {
          borderWidth: 1,
          borderColor: "#e5e7eb",
          borderRadius: 12,
          backgroundColor: "#fff",
          padding: 12,
          marginBottom: 12,
        },
        style,
      ]}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <Text style={{ fontSize: 16, fontWeight: "700", fontFamily: "Tektur_700Bold" }}>{title}</Text>
        {right}
      </View>
      {children}
    </View>
  );
}

function StatusPill({ status }) {
  const base = {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    fontSize: 12,
    fontWeight: "700",
    fontFamily: "Tektur_700Bold",
  };
  if (status === "Live")
    return (
      <Text style={[base, { backgroundColor: "#fee2e2", color: "#b91c1c" }]}>
        Live
      </Text>
    );
  if (status === "Scheduled")
    return (
      <Text style={[base, { backgroundColor: "#fef3c7", color: "#92400e" }]}>
        Scheduled
      </Text>
    );
  return (
    <Text style={[base, { backgroundColor: "#e5e7eb", color: "#374151" }]}>
      Ended
    </Text>
  );
}

/* =========================================================
   Avatar — initials fallback so they aren’t all the same
   ======================================================= */
function Avatar({ participant, size = 28, onPress }) {
  const { is_bot, user } = participant || {};
  const uri = user?.profile_photo_url;

  const initialsUrl = `https://api.dicebear.com/7.x/initials/png?seed=${encodeURIComponent(
    user?.full_name || user?.email || "User"
  )}&radius=50&backgroundType=gradientLinear`;

  const content = is_bot ? (
    <View
      style={{
        height: size,
        width: size,
        borderRadius: size / 2,
        borderWidth: 1,
        borderColor: "#e5e7eb",
        backgroundColor: "#f3f4f6",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ fontFamily: "Tektur_400Regular", fontSize: Math.max(10, size * 0.32), color: "#111827" }}>
        BOT
      </Text>
    </View>
  ) : (
    <Image
      source={{
        uri: uri || initialsUrl,
      }}
      style={{
        height: size,
        width: size,
        borderRadius: size / 2,
        borderWidth: 1,
        borderColor: "#e5e7eb",
        backgroundColor: "#f3f4f6",
      }}
    />
  );

  if (!onPress || is_bot) return content;
  return (
    <Pressable onPress={onPress} hitSlop={8}>
      {content}
    </Pressable>
  );
}

/* =========================================================
   User Recent Games Modal — match Leaderboard modal behavior
   ======================================================= */
function UserRecentGamesModal({ visible, onClose, userRow }) {
  const screen = Dimensions.get("window");
  const cardMaxWidth = Math.min(screen.width - 32, 420);
  const cardMaxHeight = Math.min(screen.height - 80, 640);

  // Resolve basic user props
  const userId =
    userRow?.user?.id ||
    userRow?.user_id ||
    userRow?.id ||
    userRow?.userId ||
    null;
  const display =
    userRow?.user?.full_name ||
    userRow?.name ||
    userRow?.user?.email ||
    userRow?.display_name ||
    "User";
  const avatarUrl =
    userRow?.profilePhoto ||
    userRow?.user?.profile_photo_url ||
    `https://api.dicebear.com/7.x/initials/png?seed=${encodeURIComponent(
      display
    )}&radius=50&backgroundType=gradientLinear`;

  // Local helpers (clone behavior from leaderboard)
  const isTodayUtc = (isoOrDate) => {
    try {
      const d = new Date(isoOrDate);
      const now = new Date();
      return (
        d.getUTCFullYear() === now.getUTCFullYear() &&
        d.getUTCMonth() === now.getUTCMonth() &&
        d.getUTCDate() === now.getUTCDate()
      );
    } catch {
      return false;
    }
  };
  const formatUtcDateTime = (iso) => {
    try {
      const d = new Date(iso);
      if (isNaN(d)) return "—";
      const yyyy = d.getUTCFullYear();
      const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(d.getUTCDate()).padStart(2, "0");
      const hh = String(d.getUTCHours()).padStart(2, "0");
      const min = String(d.getUTCMinutes()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd} ${hh}:${min} UTC`;
    } catch {
      return "—";
    }
  };

  // Data state
  const [loading, setLoading] = useState(true);
  const [games, setGames] = useState([]);
  const [statsLoading, setStatsLoading] = useState(true);
  const [userStats, setUserStats] = useState({
    totalPoints: 0,
    games: 0,
    avgTime: 0,
    successRate: 0,
  });

  // Load recent games (like leaderboard)
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!visible || !userId) return;
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from("games_records")
          .select(
            "id, player_name, won, points_earned, time_taken_seconds, guesses_attempted, hints_used, created_at, is_daily_challenge, is_elimination_game"
          )
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(20);
        if (error) throw error;
        if (alive) setGames(Array.isArray(data) ? data : []);
      } catch {
        if (alive) setGames([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [visible, userId]);

  // Load lifetime stats (mirror leaderboard’s aggregation)
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!visible || !userId) return;
      setStatsLoading(true);
      try {
        // Base (non-elimination) games only
        const { data: allGames, error: allErr } = await supabase
          .from("games_records")
          .select("won, points_earned, time_taken_seconds")
          .eq("user_id", userId)
          .or("is_elimination_game.is.null,is_elimination_game.eq.false");
        if (allErr) throw allErr;

        const total = allGames?.length || 0;
        const basePts = (allGames || []).reduce(
          (s, g) => s + (g.points_earned || 0),
          0
        );
        const wins = (allGames || []).filter((g) => g.won).length;
        const time = (allGames || []).reduce(
          (s, g) => s + (g.time_taken_seconds || 0),
          0
        );

        const { data: txs, error: txErr } = await supabase
          .from("point_transactions")
          .select("amount")
          .eq("user_id", userId);
        if (txErr) throw txErr;
        const txPts = (txs || []).reduce(
          (s, t) => s + Number(t.amount || 0),
          0
        );

        if (alive) {
          setUserStats({
            totalPoints: basePts + txPts,
            games: total,
            avgTime: total ? Math.round(time / total) : 0,
            successRate: total ? Math.round((wins / total) * 100) : 0,
          });
        }
      } catch (e) {
        if (alive) {
          setUserStats({
            totalPoints: 0,
            games: 0,
            avgTime: 0,
            successRate: 0,
          });
        }
      } finally {
        if (alive) setStatsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [visible, userId]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.45)",
          padding: 20,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <View
          style={{
            backgroundColor: "#fff",
            borderRadius: 12,
            overflow: "hidden",
            width: cardMaxWidth,
            maxHeight: cardMaxHeight,
          }}
        >
          {/* Header */}
          <View
            style={{
              padding: 14,
              borderBottomWidth: 1,
              borderBottomColor: "#e5e7eb",
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Image
                source={{ uri: avatarUrl }}
                style={{
                  height: 36,
                  width: 36,
                  borderRadius: 18,
                  borderWidth: 1,
                  borderColor: "#e5e7eb",
                }}
              />
              <Text style={{ fontWeight: "800", fontSize: 16, fontFamily: "Tektur_700Bold" }}>{display}</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <Text style={{ fontWeight: "800", fontSize: 18, fontFamily: "Tektur_700Bold" }}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Stats grid (like leaderboard) */}
          <View
            style={{
              paddingHorizontal: 12,
              paddingTop: 10,
              paddingBottom: 6,
              flexDirection: "row",
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            {[
              { label: "Total Points", value: userStats.totalPoints?.toLocaleString?.() || 0 },
              { label: "Games", value: userStats.games || 0 },
              { label: "Avg Time", value: `${userStats.avgTime || 0}s` },
              { label: "Success", value: `${userStats.successRate || 0}%` },
            ].map((s) => (
              <View
                key={s.label}
                style={{
                  flexBasis: "48%",
                  borderWidth: 1,
                  borderColor: "#e5e7eb",
                  borderRadius: 10,
                  paddingVertical: 8,
                  paddingHorizontal: 10,
                }}
              >
                <Text style={{ fontFamily: "Tektur_400Regular", fontSize: 12, color: "#6b7280", textAlign: "center" }}>{s.label}</Text>
                <Text style={{ fontSize: 18, fontWeight: "800", color: "#065f46", textAlign: "center", fontFamily: "Tektur_700Bold" }}>{s.value}</Text>
              </View>
            ))}
          </View>

          {/* Recent games list */}
          <ScrollView style={{ paddingHorizontal: 12, paddingBottom: 12 }}>
            {loading ? (
              <View style={{ paddingVertical: 20, alignItems: "center" }}>
                <ActivityIndicator />
              </View>
            ) : games.length === 0 ? (
              <Text style={{ fontFamily: "Tektur_400Regular", color: "#6b7280" }}>No games yet.</Text>
            ) : (
              games.map((g) => {
                const maskedName =
                  g.is_daily_challenge && isTodayUtc(g.created_at)
                    ? "Daily Challenge Player"
                    : g.player_name || "Unknown Player";

                const titleStyle = [
                  { fontWeight: "700", fontFamily: "Tektur_700Bold" },
                  g.is_daily_challenge
                    ? { color: "#a16207" } // gold
                    : g.is_elimination_game
                      ? { color: "#7c3aed" } // purple
                      : null,
                ];

                return (
                  <View
                    key={g.id}
                    style={{
                      borderWidth: 1,
                      borderColor: "#e5e7eb",
                      borderRadius: 10,
                      padding: 10,
                      marginBottom: 10,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <View style={{ flex: 1, minWidth: 0, paddingRight: 10 }}>
                      <Text style={titleStyle} numberOfLines={1} ellipsizeMode="tail">
                        {maskedName}
                      </Text>
                      <Text style={{ fontFamily: "Tektur_400Regular", color: "#6b7280", fontSize: 12 }}>
                        {formatUtcDateTime(g.created_at)}
                      </Text>
                    </View>

                    <View style={{ alignItems: "flex-end" }}>
                      <Text
                        style={{
                          fontFamily: "Tektur_700Bold",
                          fontWeight: "900",
                          color: g.won ? "#16a34a" : "#dc2626",
                        }}
                      >
                        {g.won ? `+${g.points_earned}` : "0"} pts
                      </Text>
                      <Text style={{ fontFamily: "Tektur_400Regular", color: "#6b7280", fontSize: 12 }}>
                        {g.guesses_attempted} {g.guesses_attempted === 1 ? "guess" : "guesses"}
                        {g.is_daily_challenge ? " • Daily" : ""}
                        {g.is_elimination_game ? (
                          <>
                            {" "}
                            • <Text style={{ fontFamily: "Tektur_400Regular", color: "#7c3aed" }}>Elimination</Text>
                          </>
                        ) : (
                          ""
                        )}
                      </Text>
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/* =========================
   Create League MODAL (replaces inline panel)
   ======================= */
function CreateLeagueModal({
  visible,
  onClose,
  canCreateDeps,
  ui,
  setters,
  search,
  actions,
}) {
  const screen = Dimensions.get("window");
  const cardMaxWidth = Math.min(screen.width - 32, 520);
  const cardMaxHeight = Math.min(screen.height - 80, 680);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.45)",
          padding: 20,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={Platform.OS === "ios" ? 16 : 0}
          style={{ width: cardMaxWidth, maxHeight: cardMaxHeight }}
        >
          <View
            style={{
              backgroundColor: "#fff",
              borderRadius: 12,
              overflow: "hidden",
              width: "100%",
              maxHeight: "100%",
            }}
          >
            {/* Header with close */}
            <View
              style={{
                padding: 14,
                borderBottomWidth: 1,
                borderBottomColor: "#e5e7eb",
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <Text style={{ fontWeight: "800", fontFamily: "Tektur_700Bold", fontSize: 16 }}>Create a League</Text>
              <TouchableOpacity onPress={onClose} hitSlop={12}>
                <Text style={{ fontWeight: "800", fontFamily: "Tektur_700Bold", fontSize: 18 }}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Body (scrollable) */}
            <KeyboardAwareScrollView
              style={{ paddingHorizontal: 12, paddingVertical: 0 }}
              contentContainerStyle={{ paddingBottom: 4 }}
              keyboardShouldPersistTaps="handled"
              enableOnAndroid
              showsVerticalScrollIndicator={true}
            >
              <CreateLeaguePanel
                canCreateDeps={canCreateDeps}
                ui={ui}
                setters={setters}
                search={search}
                actions={actions}
              />
            </KeyboardAwareScrollView>
          </View>
        </KeyboardAvoidingView>

      </View>
    </Modal>
  );
}

/* =========================
   MAIN SCREEN
   ======================= */
export default function LeaguesScreen() {
  const [fontsLoaded] = useFonts({
    Tektur_400Regular,
    Tektur_700Bold,
  });

  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);

  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load(false);      // reuse your existing loader
    } finally {
      setRefreshing(false);
    }
  }, [load]);
  // Create league UI
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [startDate, setStartDate] = useState(() => {
    const t = todayUtcMidnight();
    const plus1 = new Date(t.getTime() + 24 * 60 * 60 * 1000);
    return plus1.toISOString().slice(0, 10);
  });

  // invites
  const [searchEmail, setSearchEmail] = useState("");
  const [emailResults, setEmailResults] = useState([]);
  const [invites, setInvites] = useState([]); // {id,email,full_name}

  // Data buckets (like web)
  const [leagues, setLeagues] = useState([]); // [{ league, creatorUser, participants, matches }]
  const [tab, setTab] = useState("Active"); // Active | Scheduled | Ended

  // Collapsible cards state (default: Active + Scheduled + newest Ended open)
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [didInitExpanded, setDidInitExpanded] = useState(false);

  // live refresh for standings coloring
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 20000);
    return () => clearInterval(id);
  }, []);

  // Load me
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.auth.getUser();
      if (!error) setMe(data?.user || null);
    })();
  }, []);

  // Load leagues where I participate (mirror web page shape)
  const load = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLeagues([]);
        return;
      }

      const { data: myParts, error: e1 } = await supabase
        .from("league_participants")
        .select("league_id")
        .eq("user_id", user.id);
      if (e1) throw e1;

      const leagueIds = [...new Set((myParts || []).map((p) => p.league_id))];
      if (!leagueIds.length) {
        setLeagues([]);
        return;
      }

      const { data: leaguesData, error: e2 } = await supabase
        .from("leagues")
        .select("*")
        .in("id", leagueIds);
      if (e2) throw e2;

      const { data: parts, error: e3 } = await supabase
        .from("league_participants")
        .select("id, league_id, user_id, is_bot, display_name")
        .in("league_id", leagueIds);
      if (e3) throw e3;

      // fetch all relevant users (participants + creators)
      let userIds = parts?.filter((p) => p.user_id).map((p) => p.user_id) || [];
      const creatorIds = leaguesData.map((l) => l.creator_id).filter(Boolean);
      userIds = [...new Set([...userIds, ...creatorIds])];

      const userMap = new Map();
      if (userIds.length) {
        const { data: usersRows } = await supabase
          .from("users")
          .select("id, full_name, profile_photo_url, email, created_at")
          .in("id", userIds);
        (usersRows || []).forEach((u) => userMap.set(u.id, u));
      }

      const participantsHydrated =
        parts?.map((p) => ({ ...p, user: p.user_id ? userMap.get(p.user_id) : null })) || [];

      const { data: matches, error: e4 } = await supabase
        .from("league_matches")
        .select("*")
        .in("league_id", leagueIds);
      if (e4) throw e4;

      const grouped = leagueIds.map((id) => ({
        league: leaguesData.find((l) => l.id === id),
        creatorUser: userMap.get(leaguesData.find((l) => l.id === id)?.creator_id),
        participants: participantsHydrated.filter((p) => p.league_id === id),
        matches: (matches || []).filter((m) => m.league_id === id).sort(byDateAsc),
      }));

      setLeagues(grouped);
    } catch (err) {
      console.error("Leagues load error:", err);
      setLeagues([]);
      Alert.alert("Error", "Could not load leagues.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Email search (exclude me)
  useEffect(() => {
    let active = true;
    const t = setTimeout(async () => {
      const q = (searchEmail || "").trim();
      if (!q || q.length < 2) {
        if (active) setEmailResults([]);
        return;
      }
      const { data } = await supabase
        .from("users")
        .select("id, email, full_name")
        .ilike("email", `%${q}%`)
        .limit(10);
      const filtered = (data || []).filter((u) => u.id !== me?.id);
      if (active) setEmailResults(filtered);
    }, 250);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [searchEmail, me?.id]);

  // Tab buckets (UTC like web)
  const classified = useMemo(() => {
    const out = { Scheduled: [], Active: [], Ended: [] };
    const today0 = todayUtcMidnight();

    for (const L of leagues) {
      const start = toUtcMidnight(L.league.start_date);
      const last = L.matches.length
        ? toUtcMidnight(L.matches[L.matches.length - 1].match_date)
        : start;
      const key = start > today0 ? "Scheduled" : last < today0 ? "Ended" : "Active";
      out[key].push(L);
    }
    return out;
  }, [leagues]);

  // counts for main tabs
  const tabCounts = {
    Active: classified.Active.length,
    Scheduled: classified.Scheduled.length,
    Ended: classified.Ended.length,
  };

  // Initialize expanded defaults once
  useEffect(() => {
    if (didInitExpanded || !leagues.length) return;
    const defaults = new Set();
    classified.Active.forEach((L) => defaults.add(L.league.id));
    classified.Scheduled.forEach((L) => defaults.add(L.league.id));
    const newestEnded = classified.Ended.sort(
      (a, b) =>
        new Date(b.league?.created_at || b.league?.start_date || 0) -
        new Date(a.league?.created_at || a.league?.start_date || 0)
    )[0]?.league?.id;
    if (newestEnded) defaults.add(newestEnded);
    setExpandedIds(defaults);
    setDidInitExpanded(true);
  }, [didInitExpanded, leagues.length, classified]);

  const toggleCard = useCallback((id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Live day totals map (exclude elimination games from league totals)
  const [dayPoints, setDayPoints] = useState(new Map());
  useEffect(() => {
    let cancelled = false;
    async function compute() {
      const map = new Map();
      for (const L of leagues) {
        const { league, participants, matches } = L;
        const dates = [...new Set(matches.map((m) => m.match_date))];
        for (const d of dates) {
          const { start, end } = dayRangeUtc(d);
          const humans = participants.filter((p) => !p.is_bot);
          const humanIds = humans.map((h) => h.user_id).filter(Boolean);

          let byUser = new Map();
          if (humanIds.length) {
            const { data: records } = await supabase
              .from("games_records")
              .select("user_id, points_earned")
              .in("user_id", humanIds)
              .gte("created_at", start)
              .lt("created_at", end)
              .eq("is_elimination_game", false);
            byUser = new Map();
            (records || []).forEach((r) => {
              byUser.set(
                r.user_id,
                (byUser.get(r.user_id) || 0) + (r.points_earned || 0)
              );
            });
          }

          const sumHumans = humans.reduce(
            (s, h) => s + (byUser.get(h.user_id) || 0),
            0
          );
          const avgHuman = humans.length ? Math.round(sumHumans / humans.length) : 0;

          participants.forEach((p) => {
            const total = p.is_bot ? avgHuman : byUser.get(p.user_id) || 0;
            map.set(keyDP({ league_id: league.id, match_date: d }, p), total);
          });
        }
      }
      if (!cancelled) setDayPoints(map);
    }
    if (leagues.length) compute();
    return () => {
      cancelled = true;
    };
  }, [leagues, tick]);

  // Current list by tab, newest first
  const currentListUnsorted =
    tab === "Active"
      ? classified.Active
      : tab === "Scheduled"
        ? classified.Scheduled
        : classified.Ended;

  const currentList = useMemo(() => {
    const arr = [...currentListUnsorted];
    arr.sort(
      (a, b) =>
        new Date(b.league?.created_at || b.league?.start_date || 0) -
        new Date(a.league?.created_at || a.league?.start_date || 0)
    );
    return arr;
  }, [currentListUnsorted]);

  // User recent-games modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalUserRow, setModalUserRow] = useState(null);
  const openUserModal = useCallback((participantRow) => {
    if (!participantRow?.is_bot) {
      setModalUserRow(participantRow);
      setModalOpen(true);
    }
  }, []);
  const closeUserModal = useCallback(() => {
    setModalOpen(false);
    setModalUserRow(null);
  }, []);

  // build tabs with counts in the label
  const MAIN_TABS = [
    { key: "Active", label: `Active (${tabCounts.Active})` },
    { key: "Scheduled", label: `Scheduled (${tabCounts.Scheduled})` },
    { key: "Ended", label: `Ended (${tabCounts.Ended})` },
  ];

  return (
    !fontsLoaded ? (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#F0FDF4" }}>
        <ActivityIndicator size="large" color="#065f46" />
      </View>
    ) : (

      <View style={{ flex: 1, backgroundColor: "#F0FDF4" }}>
        {/* Header row: tabs with counts */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            paddingTop: 12,
          }}
        >
          {MAIN_TABS.map((t) => (
            <Pressable
              key={t.key}
              onPress={() => setTab(t.key)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 999,
                backgroundColor: tab === t.key ? "#065f46" : "#ffffff",
                borderWidth: tab === t.key ? 0 : 1,
                borderColor: "#e5e7eb",
              }}
            >
              <Text
                style={{
                  color: tab === t.key ? "#ffffff" : "#374151",
                  fontWeight: "700",
                  fontFamily: "Tektur_700Bold",
                }}
              >
                {t.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Centered "+ Create New League" button */}
        <View style={{ alignItems: "center", marginTop: 10, marginBottom: 6 }}>
          <TouchableOpacity
            onPress={() => setCreateOpen(true)}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 10,
              borderRadius: 10,
              backgroundColor: "#065f46",
            }}
            activeOpacity={0.85}
          >
            <Text style={{ color: "white", fontFamily: "Tektur_700Bold", fontWeight: "800" }}>
              + Create New League
            </Text>
          </TouchableOpacity>
        </View>

        {/* MAIN LIST */}
        <ScrollView
          contentContainerStyle={{ padding: 12, paddingBottom: 28 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#065f46"         // spinner color iOS
              colors={["#065f46"]}        // spinner color Android
            />
          }
        >
          {loading ? (
            <View style={{ paddingTop: 48, alignItems: "center" }}>
              <ActivityIndicator size="large" color="#065f46" />
            </View>
          ) : currentList.length === 0 ? (
            <View style={{ marginTop: 32, alignItems: "center" }}>
              <View
                style={{
                  height: 64,
                  width: 64,
                  borderRadius: 32,
                  backgroundColor: "#dcfce7",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ fontFamily: "Tektur_400Regular", fontSize: 20 }}>📅</Text>
              </View>
              <Text
                style={{
                  marginTop: 10,
                  fontSize: 16,
                  fontWeight: "700",
                  color: "#065f46",
                  fontFamily: "Tektur_700Bold",
                }}
              >
                No leagues found
              </Text>
              <Text style={{ fontFamily: "Tektur_400Regular", color: "#6b7280" }}>
                Create your first league or wait to be invited!
              </Text>
            </View>
          ) : (
            <View style={{ gap: 12 }}>
              {currentList.map((L) => (
                <LeagueCard
                  key={L.league.id}
                  L={L}
                  dayPoints={dayPoints}
                  expanded={expandedIds.has(L.league.id)}
                  onToggle={() => toggleCard(L.league.id)}
                  onAvatarPress={openUserModal}
                />
              ))}
            </View>
          )}
        </ScrollView>

        {/* Create League MODAL */}
        <CreateLeagueModal
          visible={createOpen}
          onClose={() => setCreateOpen(false)}
          canCreateDeps={{ me, name, desc, startDate, invites }}
          ui={{ creating }}
          setters={{
            setCreating,
            setCreateOpen,
            setName,
            setDesc,
            setStartDate,
            setInvites,
            setSearchEmail,
            setEmailResults,
          }}
          search={{ searchEmail, emailResults }}
          actions={{ load }}
        />

        {/* User modal (fixed-size card) */}
        <UserRecentGamesModal
          visible={modalOpen}
          onClose={closeUserModal}
          userRow={modalUserRow}
        />
      </View>
    )
  );
}

/* =========================
   Create League Panel (inner content; used inside modal)
   ======================= */
function CreateLeaguePanel({ canCreateDeps, ui, setters, search, actions }) {
  const { me, name, desc, startDate, invites } = canCreateDeps;
  const { creating } = ui;
  const {
    setCreating,
    setCreateOpen,
    setName,
    setDesc,
    setStartDate,
    setInvites,
    setSearchEmail,
    setEmailResults,
  } = setters;
  const { searchEmail, emailResults } = search;
  const { load } = actions;
  const [showDatePicker, setShowDatePicker] = useState(false);

  const addInvite = (u) => {
    if (!u || u.id === me?.id) return;
    if (invites.find((x) => x.id === u.id)) return;
    setInvites((prev) => [...prev, u]);
    setSearchEmail("");
    setEmailResults([]);
  };
  const removeInvite = (id) =>
    setInvites((prev) => prev.filter((x) => x.id !== id));

  const totalChosen = 1 + invites.length;
  const totalIfOdd = totalChosen % 2 === 1 ? totalChosen + 1 : totalChosen;
  const withinLimits = totalIfOdd >= 2 && totalIfOdd <= 20;
  const hasOtherUser = invites.length >= 1; // creator must invite at least one real user
  const canCreate = name.trim() && startDate && withinLimits && hasOtherUser;


  const onCreateLeague = useCallback(async () => {
    if (!me?.id || !canCreate) return;

    try {
      setCreating(true);

      let people = [
        {
          id: me.id,
          email: me.email,
          full_name:
            me.user_metadata?.full_name || me.full_name || "You",
        },
        ...invites,
      ];
      if (people.length % 2 === 1) {
        people.push({
          id: null,
          email: null,
          full_name: randomBotName(),
          is_bot: true,
        });
      }

      // 1) Create league
      const { data: leagueRow, error: e1 } = await supabase
        .from("leagues")
        .insert([
          {
            name: name.trim(),
            description: desc || null,
            creator_id: me.id,
            start_date: startDate,
          },
        ])
        .select()
        .single();
      if (e1) throw e1;

      // 2) Insert participants
      const partsPayload = people.map((p) => ({
        league_id: leagueRow.id,
        user_id: p.is_bot ? null : p.id,
        is_bot: !!p.is_bot,
        display_name: p.is_bot ? p.full_name : null,
      }));
      const { data: parts, error: e2 } = await supabase
        .from("league_participants")
        .insert(partsPayload)
        .select();
      if (e2) throw e2;

      // 3) Fixtures: double round-robin
      const partIds = parts.map((p) => p.id);
      const rounds = generateDoubleRoundRobin(partIds);
      const start = toUtcMidnight(startDate);
      const matchesPayload = [];
      rounds.forEach((round, idx) => {
        const date = new Date(start.getTime() + idx * 24 * 60 * 60 * 1000);
        round.pairs.forEach((pair) => {
          matchesPayload.push({
            league_id: leagueRow.id,
            match_day: round.match_day,
            match_date: date.toISOString().slice(0, 10),
            home_participant_id: pair.home,
            away_participant_id: pair.away,
          });
        });
      });
      const { error: e3 } = await supabase
        .from("league_matches")
        .insert(matchesPayload);
      if (e3) throw e3;

      // 4) Clear & close form, reload page data
      setName("");
      setDesc("");
      setInvites([]);
      setStartDate(() => {
        const t = todayUtcMidnight();
        const plus1 = new Date(t.getTime() + 24 * 60 * 60 * 1000);
        return plus1.toISOString().slice(0, 10);
      });
      setCreateOpen(false);

      await load();
    } catch (err) {
      console.error("Create league failed:", err);
      Alert.alert("Error", "Could not create league.");
    } finally {
      setCreating(false);
    }
  }, [
    me?.id,
    name,
    desc,
    startDate,
    invites,
    canCreate,
    setCreating,
    setName,
    setDesc,
    setInvites,
    setStartDate,
    setCreateOpen,
    load,
  ]);

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: "#e5e7eb",
        borderRadius: 12,
        backgroundColor: "#fff",
        padding: 12,
        marginBottom: 12,
      }}
    >
      {/* Name */}
      <View style={{ marginBottom: 8 }}>
        <Text style={{ fontFamily: "Tektur_400Regular", fontWeight: "600", marginBottom: 4 }}>League Name</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="e.g., Weekend Legends"
          maxLength={40}
          returnKeyType="done"
          blurOnSubmit
          onSubmitEditing={() => Keyboard.dismiss()}
          style={{
            borderWidth: 1,
            borderColor: "#e5e7eb",
            borderRadius: 8,
            paddingHorizontal: 10,
            paddingVertical: 8,
          }}
        />
        <Text style={{ fontFamily: "Tektur_400Regular", color: "#6b7280", fontSize: 12, marginTop: 4 }}>
          Max 40 characters.
        </Text>


      </View>

      {/* Description */}
      <View style={{ marginBottom: 8 }}>
        <Text style={{ fontFamily: "Tektur_400Regular", fontWeight: "600", marginBottom: 4 }}>
          Description (optional)
        </Text>
        <TextInput
          value={desc}
          onChangeText={setDesc}
          placeholder="Short description"
          maxLength={140}
          returnKeyType="done"
          blurOnSubmit
          onSubmitEditing={() => Keyboard.dismiss()}
          style={{
            borderWidth: 1,
            borderColor: "#e5e7eb",
            borderRadius: 8,
            paddingHorizontal: 10,
            paddingVertical: 8,
          }}
        />
        <Text style={{ fontFamily: "Tektur_400Regular", color: "#6b7280", fontSize: 12, marginTop: 4 }}>
          Max 140 characters.
        </Text>


      </View>

      {/* Start date */}
      <View style={{ marginBottom: 8 }}>
        <Text style={{ fontFamily: "Tektur_400Regular", fontWeight: "600", marginBottom: 4 }}>Start Date</Text>

        {/* Button-looking field that opens the native date picker */}
        <Pressable
          onPress={() => setShowDatePicker(true)}
          style={{
            borderWidth: 1,
            borderColor: "#e5e7eb",
            borderRadius: 8,
            paddingHorizontal: 10,
            paddingVertical: 12,
            backgroundColor: "#fff",
          }}
        >
          <Text style={{ fontWeight: "700", fontFamily: "Tektur_700Bold" }}>{startDate}</Text>
          <Text style={{ fontFamily: "Tektur_400Regular", color: "#6b7280", fontSize: 12 }}>Tap to choose a date</Text>
        </Pressable>

        {showDatePicker ? (
          <View
            // iOS inline calendar needs space inside modal/scroll
            style={{
              alignSelf: "stretch",
              marginTop: 8,
              height: Platform.OS === "ios" ? 340 : undefined
            }}
          >
            <DateTimePicker
              value={ymdToLocalDate(startDate)}                 // LOCAL date in
              mode="date"
              display={Platform.OS === "ios" ? "inline" : "default"}
              onChange={(evt, picked) => {
                if (!picked) return; // canceled
                // close immediately after choosing a date
                setShowDatePicker(false);

                // Normalize picked LOCAL date to UTC Y-M-D
                const y = picked.getFullYear();
                const m = picked.getMonth();
                const d = picked.getDate();
                const chosenUtc = new Date(Date.UTC(y, m, d));

                // clamp to tomorrow (UTC)
                const minUtc = toUtcMidnight(tomorrowUtcYMD());
                const finalUtc = chosenUtc < minUtc ? minUtc : chosenUtc;

                setStartDate(finalUtc.toISOString().slice(0, 10));
              }}

              minimumDate={ymdToLocalDate(tomorrowUtcYMD())}    // show min in LOCAL
              style={{ flex: 1 }}                                // let it fill the 340
            />
          </View>
        ) : null}

        <Text style={{ fontFamily: "Tektur_400Regular", color: "#6b7280", fontSize: 12, marginTop: 4 }}>
          Leagues can only start from tomorrow (UTC) onwards.
        </Text>
      </View>


      {/* Invite by email */}
      <View style={{ marginBottom: 8 }}>
        <Text style={{ fontFamily: "Tektur_400Regular", fontWeight: "600", marginBottom: 4 }}>
          Invite Players (search email)
        </Text>
        <TextInput
          value={searchEmail}
          onChangeText={setSearchEmail}
          placeholder="Type at least 2 characters"
          autoCapitalize="none"
          returnKeyType="done"
          blurOnSubmit
          onSubmitEditing={() => Keyboard.dismiss()}
          style={{
            borderWidth: 1,
            borderColor: "#e5e7eb",
            borderRadius: 8,
            paddingHorizontal: 10,
            paddingVertical: 8,
          }}
        />

        {!!emailResults.length && (
          <View
            style={{
              marginTop: 6,
              borderWidth: 1,
              borderColor: "#e5e7eb",
              borderRadius: 8,
              overflow: "hidden",
            }}
          >
            {emailResults.map((u) => (
              <Pressable
                key={u.id}
                onPress={() => addInvite(u)}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                  backgroundColor: "white",
                }}
              >
                <Text>{u.full_name || u.email}</Text>
              </Pressable>
            ))}
          </View>
        )}
        {!!invites.length && (
          <View
            style={{
              marginTop: 8,
              flexDirection: "row",
              flexWrap: "wrap",
              gap: 6,
            }}
          >
            {invites.map((u) => (
              <View
                key={u.id}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderWidth: 1,
                  borderColor: "#e5e7eb",
                  borderRadius: 999,
                  backgroundColor: "#f9fafb",
                }}
              >
                <Text>{u.full_name || u.email}</Text>
                <Pressable onPress={() => removeInvite(u.id)}>
                  <Text style={{ fontFamily: "Tektur_700Bold", fontWeight: "900" }}>×</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}
        {/* Participants count (includes creator) */}
        <View style={{ marginTop: 8 }}>
          <Text style={{ fontFamily: "Tektur_400Regular", fontSize: 12, color: "#374151" }}>
            Total participants (including you): {1 + invites.length}
            {((1 + invites.length) % 2 === 1) ? " — odd number: a bot will be added automatically." : ""}
          </Text>
        </View>


      </View>

      {/* Create */}
      <View
        style={{
          flexDirection: "row",
          justifyContent: "flex-end",
          alignItems: "center",
          gap: 10,
        }}
      >
        <Pressable
          onPress={onCreateLeague}
          disabled={!canCreate || creating}
          style={{
            opacity: !canCreate || creating ? 0.6 : 1,
            backgroundColor: "#065f46",
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderRadius: 10,
          }}
        >
          <Text style={{ color: "white", fontWeight: "800", fontFamily: "Tektur_700Bold" }}>
            {creating ? "Creating..." : "Create League"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/* =========================
   League Card
   ======================= */
function LeagueCard({ L, dayPoints, expanded, onToggle, onAvatarPress }) {
  const { league, participants, matches } = L;

  const participantsById = useMemo(() => {
    const map = new Map();
    participants.forEach((p) => map.set(p.id, p));
    return map;
  }, [participants]);

  const nextInfo = useMemo(() => {
    const today0 = todayUtcMidnight();
    const future = matches.filter((m) => toUtcMidnight(m.match_date) > today0);
    if (!future.length) return null;
    const m = future[0];
    return {
      match_day: m.match_day,
      match_date: m.match_date,
      home: participantsById.get(m.home_participant_id),
      away: participantsById.get(m.away_participant_id),
    };
  }, [matches, participantsById]);

  const standings = useMemo(
    () => computeStandings(participants, matches, dayPoints),
    [participants, matches, dayPoints]
  );

  const status =
    toUtcMidnight(league.start_date) > todayUtcMidnight()
      ? "Scheduled"
      : matches[matches.length - 1] &&
        toUtcMidnight(matches[matches.length - 1].match_date) <
        todayUtcMidnight()
        ? "Ended"
        : "Live";

  function scoreColor(isHome, H, A) {
    if (H === A) return "#6b7280"; // draw gray
    const win = isHome ? H > A : A > H;
    return win ? "#047857" : "#b91c1c"; // green for higher, red for lower
  }

  // --- Swipe tabs (Table | Fixtures) ---
  const [subTab, setSubTab] = useState(0); // 0=Table, 1=Fixtures
  const scroller = useRef(null);
  // Measure page heights so the card matches the active tab's content height
  const [tableH, setTableH] = useState(0);
  const [fixturesH, setFixturesH] = useState(0);
  const [cardWidth, setCardWidth] = useState(0);
  const screenPad = 24; // page width ~= screen - page padding
  const pageWidth =
    cardWidth > 0 ? cardWidth : Dimensions.get("window").width - screenPad;

  const onScroll = (e) => {
    const x = e.nativeEvent.contentOffset.x;
    const idx = Math.round(x / pageWidth);
    if (idx !== subTab) setSubTab(idx);
  };

  // Group matches by match day
  const matchesByDay = useMemo(() => {
    const map = new Map();
    for (const m of matches) {
      if (!map.has(m.match_day)) map.set(m.match_day, []);
      map.get(m.match_day).push(m);
    }
    // keep deterministic order by match_day
    return Array.from(map.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([md, arr]) => ({
        match_day: md,
        date: arr[0]?.match_date,
        items: arr,
      }));
  }, [matches]);

  // ===== Auto-fit column widths for POS, P, GD, PTS =====
  const [colW, setColW] = useState({ pos: 0, p: 0, gd: 0, pts: 0 });
  const updateCol = (key, w) =>
    setColW((prev) => (w > (prev[key] || 0) ? { ...prev, [key]: w } : prev));
  const padW = 20; // padding added around measured text
  // Replaced avatar-only column with a fixed player column for avatar+name
  const PLAYER_COL_W = 100;

  // row height sync between frozen (POS+PLAYER) and scrollable pane
  const [rowHeights, setRowHeights] = useState({});
  const setRowH = useCallback((pid, h) => {
    setRowHeights((prev) => (prev[pid] === h ? prev : { ...prev, [pid]: h }));
  }, []);

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: "#e5e7eb",
        borderRadius: 14,
        backgroundColor: "#fff",
        overflow: "hidden",
      }}
      onLayout={(e) => setCardWidth(e.nativeEvent.layout.width)}
    >
      {/* header band */}
      <TouchableOpacity
        onPress={onToggle}
        activeOpacity={0.8}
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 12,
          paddingVertical: 10,
          backgroundColor: "#fff",
          borderBottomWidth: 1,
          borderBottomColor: "#e5e7eb",
        }}
      >
        <View style={{ flex: 1, paddingRight: 8, gap: 2 }}>
          <Text
            style={{ fontFamily: "Tektur_700Bold", fontSize: 16, color: "#065f46" }}
          >
            {league.name}
          </Text>
          {!!league.description && (
            <Text style={{ fontFamily: "Tektur_400Regular", color: "#065f46", opacity: 0.8 }} >
              {league.description}
            </Text>
          )}
          <Text style={{ fontFamily: "Tektur_400Regular", color: "#065f46", opacity: 0.8, fontSize: 12 }}>
            Starts {league.start_date} • {participants.length} participants
          </Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <StatusPill status={status} />
          {(() => {
            const today0 = todayUtcMidnight();
            const future = matches.filter((m) => toUtcMidnight(m.match_date) > today0);
            const nextInfo =
              future.length > 0
                ? {
                  match_day: future[0].match_day,
                  match_date: future[0].match_date,
                  home: participantsById.get(future[0].home_participant_id),
                  away: participantsById.get(future[0].away_participant_id),
                }
                : null;
            return nextInfo ? (
              <View style={{ marginTop: 6, alignItems: "flex-end", gap: 6 }}>
                <Text style={{ fontFamily: "Tektur_400Regular", color: "#065f46", fontSize: 12 }}>
                  Next: Day {nextInfo.match_day} • {fmtShort(nextInfo.match_date)}
                </Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Avatar
                    participant={nextInfo.home}
                    size={20}
                    onPress={() => onAvatarPress(nextInfo.home)}
                  />
                  <Text style={{ fontFamily: "Tektur_400Regular", color: "#065f46", opacity: 0.65, fontSize: 12 }}>
                    vs
                  </Text>
                  <Avatar
                    participant={nextInfo.away}
                    size={20}
                    onPress={() => onAvatarPress(nextInfo.away)}
                  />
                </View>
              </View>
            ) : null;
          })()}

        </View>
      </TouchableOpacity>

      {!expanded ? null : (
        <>
          {/* Subtabs header */}
          <View style={{ paddingHorizontal: 12, paddingTop: 10 }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <View style={{ flexDirection: "row", gap: 20 }}>
                {["Table", "Fixtures & Results"].map((label, idx) => (
                  <Pressable
                    key={label}
                    onPress={() => {
                      setSubTab(idx);
                      scroller.current?.scrollTo({ x: idx * pageWidth, animated: true });
                    }}
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      borderRadius: 999,
                      backgroundColor: subTab === idx ? "#065f46" : "#f3f4f6",
                    }}
                  >
                    <Text
                      style={{
                        color: subTab === idx ? "#fff" : "#111827",
                        fontWeight: "700",
                        fontFamily: "Tektur_700Bold",
                        fontSize: 12,
                      }}
                    >
                      {label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text style={{ fontFamily: "Tektur_400Regular", color: "#6b7280", fontSize: 12 }}>↔</Text>
            </View>
          </View>

          {/* TAB BODY — render only the active tab so the card height matches its content */}
          {subTab === 0 ? (
            /* ---------- TABLE ---------- */
            <View style={{ marginTop: 8, paddingHorizontal: 12, paddingBottom: 12 }}>
              <View
                style={{
                  borderWidth: 1,
                  borderColor: "#e5e7eb",
                  borderRadius: 10,
                  overflow: "hidden",
                }}
              >
                {/* Two-pane layout: LEFT = frozen POS + Player, RIGHT = horizontal scrollable stats */}
                <View style={{ flexDirection: "row", width: "100%" }}>
                  {/* LEFT (frozen) — POS + Player */}
                  <View style={{ flexDirection: "row", backgroundColor: "#fff" }}>
                    {/* POS (frozen) */}
                    <View
                      style={{
                        width: 56,
                        borderRightWidth: 1,
                        borderRightColor: "#e5e7eb",
                      }}
                    >
                      {/* POS header */}
                      <View
                        style={{
                          backgroundColor: "#f9fafb",
                          paddingVertical: 6,
                          paddingHorizontal: 6,
                          borderBottomWidth: 1,
                          borderBottomColor: "#e5e7eb",
                          alignItems: "center",
                        }}
                      >
                        <Text style={{ fontWeight: "700", color: "#6b7280", fontFamily: "Tektur_700Bold" }}>POS</Text>
                      </View>

                      {/* POS rows */}
                      {standings.map((s, i) => (
                        <View
                          key={`pos-${s.pid}`}
                          style={{
                            height: rowHeights[s.pid] ?? undefined,
                            paddingHorizontal: 6,
                            borderTopWidth: 1,
                            borderTopColor: "#f3f4f6",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Text style={{ fontFamily: "Tektur_400Regular", fontVariant: ["tabular-nums"] }}>{i + 1}</Text>
                        </View>
                      ))}
                    </View>

                    {/* Player (frozen) */}
                    <View
                      style={{
                        minWidth: 140,
                        flexShrink: 1,
                        borderRightWidth: 1,
                        borderRightColor: "#e5e7eb",
                      }}
                    >
                      {/* Player header */}
                      <View
                        style={{
                          backgroundColor: "#f9fafb",
                          paddingVertical: 6,
                          paddingHorizontal: 8,
                          borderBottomWidth: 1,
                          borderBottomColor: "#e5e7eb",
                        }}
                      >
                        <Text style={{ fontWeight: "700", color: "#6b7280", fontFamily: "Tektur_700Bold" }}>PLAYER</Text>
                      </View>

                      {/* Player rows (avatar + FULL name, no ellipsis) */}
                      {standings.map((s) => {
                        const rowP = participantsById.get(s.pid);
                        return (
                          <View
                            key={`player-${s.pid}`}
                            onLayout={(e) => setRowH(s.pid, e.nativeEvent.layout.height)}
                            style={{
                              paddingVertical: 8,
                              paddingHorizontal: 8,
                              borderTopWidth: 1,
                              borderTopColor: "#f3f4f6",
                            }}
                          >
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                              <Avatar participant={rowP} size={26} onPress={() => onAvatarPress(rowP)} />
                              <Text style={{ fontFamily: "Tektur_400Regular", flexShrink: 1, flexGrow: 1, flexWrap: "wrap" }}>
                                {rowP?.user?.full_name || rowP?.display_name || "—"}
                              </Text>
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  </View>

                  {/* RIGHT (scrollable) — P, PTS, GD (PTS right after P) */}
                  <ScrollView
                    horizontal
                    bounces
                    showsHorizontalScrollIndicator
                    contentContainerStyle={{ backgroundColor: "#fff" }}
                  >
                    <View>
                      {/* header row */}
                      <View
                        style={{
                          flexDirection: "row",
                          backgroundColor: "#f9fafb",
                          paddingVertical: 6,
                          alignItems: "center",
                          borderBottomWidth: 1,
                          borderBottomColor: "#e5e7eb",
                        }}
                      >
                        {/* P */}
                        <View
                          style={{
                            width: Math.max(colW.p + padW, 56),
                            alignItems: "center",
                            paddingHorizontal: 6,
                          }}
                        >
                          <Text
                            onLayout={(e) => updateCol("p", e.nativeEvent.layout.width)}
                            style={{ fontWeight: "700", color: "#6b7280", fontFamily: "Tektur_700Bold" }}
                          >
                            P
                          </Text>
                        </View>

                        {/* PTS — RIGHT AFTER P */}
                        <View
                          style={{
                            width: Math.max(colW.pts + padW, 64),
                            alignItems: "center",
                            paddingHorizontal: 8,
                          }}
                        >
                          <Text
                            onLayout={(e) => updateCol("pts", e.nativeEvent.layout.width)}
                            style={{ fontWeight: "700", color: "#6b7280", fontFamily: "Tektur_700Bold" }}
                          >
                            PTS
                          </Text>
                        </View>

                        {/* GD */}
                        <View
                          style={{
                            width: Math.max(colW.gd + padW, 70),
                            alignItems: "center",
                            paddingHorizontal: 6,
                          }}
                        >
                          <Text
                            onLayout={(e) => updateCol("gd", e.nativeEvent.layout.width)}
                            style={{ fontWeight: "700", color: "#6b7280", fontFamily: "Tektur_700Bold" }}
                          >
                            GD
                          </Text>
                        </View>
                      </View>

                      {/* data rows */}
                      {standings.map((s) => (
                        <View
                          key={`scroll-${s.pid}`}
                          style={{
                            flexDirection: "row",
                            height: rowHeights[s.pid] ?? undefined,
                            borderTopWidth: 1,
                            borderTopColor: "#f3f4f6",
                            alignItems: "center",
                          }}
                        >
                          {/* P */}
                          <View
                            style={{
                              width: Math.max(colW.p + padW, 56),
                              alignItems: "center",
                              paddingHorizontal: 6,
                            }}
                          >
                            <Text
                              onLayout={(e) => updateCol("p", e.nativeEvent.layout.width)}
                              style={{ fontFamily: "Tektur_400Regular", fontVariant: ["tabular-nums"] }}
                            >
                              {s.P}
                            </Text>
                          </View>

                          {/* PTS */}
                          <View
                            style={{
                              width: Math.max(colW.pts + padW, 64),
                              alignItems: "center",
                              paddingHorizontal: 8,
                            }}
                          >
                            <Text
                              onLayout={(e) => updateCol("pts", e.nativeEvent.layout.width)}
                              style={{ fontWeight: "800", fontVariant: ["tabular-nums"], fontFamily: "Tektur_700Bold" }}
                            >
                              {s.PTS}
                            </Text>
                          </View>

                          {/* GD */}
                          <View
                            style={{
                              width: Math.max(colW.gd + padW, 70),
                              alignItems: "center",
                              paddingHorizontal: 6,
                            }}
                          >
                            <Text
                              onLayout={(e) => updateCol("gd", e.nativeEvent.layout.width)}
                              style={{ fontFamily: "Tektur_400Regular", fontVariant: ["tabular-nums"] }}
                            >
                              {s.GD.toLocaleString()}
                            </Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  </ScrollView>
                </View>
              </View>
            </View>
          ) : (
            /* ---------- FIXTURES & RESULTS ---------- */
            <View style={{ marginTop: 8, paddingHorizontal: 12, paddingBottom: 12 }}>
              {matchesByDay.map((group) => (
                <View
                  key={`md-${group.match_day}`}
                  style={{
                    borderWidth: 1,
                    borderColor: "#e5e7eb",
                    borderRadius: 10,
                    overflow: "hidden",
                    marginBottom: 10,
                  }}
                >
                  <View
                    style={{
                      backgroundColor: "#f9fafb",
                      paddingHorizontal: 10,
                      paddingVertical: 8,
                      borderBottomWidth: 1,
                      borderBottomColor: "#e5e7eb",
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <Text style={{ fontWeight: "800", fontFamily: "Tektur_700Bold" }}>Match Day {group.match_day}</Text>
                    <Text style={{ fontFamily: "Tektur_400Regular", color: "#6b7280", fontSize: 12 }}>
                      {fmtShort(group.date)}
                    </Text>
                  </View>

                  {group.items.map((m, idx) => (
                    <ResultRow
                      key={`${m.id || `${group.match_day}-${idx}`}`}
                      match={m}
                      participantsById={participantsById}
                      dayPoints={dayPoints}
                      onAvatarPress={onAvatarPress}
                      scoreColor={scoreColor}
                    />
                  ))}
                </View>
              ))}
            </View>
          )}


        </>
      )}
    </View>
  );
}

/* =========================
   Result row (collapsible with players breakdown)
   ======================= */
function ResultRow({
  match,
  participantsById,
  dayPoints,
  onAvatarPress,
  scoreColor,
}) {
  const [open, setOpen] = useState(false);
  const home =
    participantsById[match.home_participant_id] ||
    participantsById.get(match.home_participant_id);
  const away =
    participantsById[match.away_participant_id] ||
    participantsById.get(match.away_participant_id);

  const d = toUtcMidnight(match.match_date);
  const isFuture = d > todayUtcMidnight();
  const H = dayPoints.get(keyDP(match, home)) ?? 0;
  const A = dayPoints.get(keyDP(match, away)) ?? 0;

  return (
    <View style={{ borderTopWidth: 1, borderTopColor: "#f3f4f6" }}>
      {/* Row: avatars + centered score (tap to expand) */}
      <Pressable
        onPress={() => !isFuture && setOpen((o) => !o)}
        disabled={isFuture}
        style={{
          paddingHorizontal: 10,
          paddingVertical: 10,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          opacity: isFuture ? 0.7 : 1,
        }}
      >
        {/* left: avatars vs */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
          <Avatar participant={home} size={24} onPress={() => onAvatarPress(home)} />
          <Text style={{ fontFamily: "Tektur_400Regular", color: "#9ca3af" }}>vs</Text>
          <Avatar participant={away} size={24} onPress={() => onAvatarPress(away)} />
        </View>

        {/* right: score + subline */}
        {/* right: score (without day/date subline) */}
        <View style={{ minWidth: 110, alignItems: "flex-end" }}>
          {isFuture ? (
            <Text style={{ color: "#6b7280", fontFamily: "Tektur_400Regular", fontWeight: "600" }}>Scheduled</Text>
          ) : (
            <Text style={{ fontFamily: "Tektur_700Bold", fontWeight: "900" }}>
              <Text style={{ fontFamily: "Tektur_400Regular", color: scoreColor(true, H, A) }}>{H}</Text>
              <Text style={{ fontFamily: "Tektur_400Regular", color: "#9ca3af" }}> — </Text>
              <Text style={{ fontFamily: "Tektur_400Regular", color: scoreColor(false, H, A) }}>{A}</Text>
            </Text>
          )}
        </View>

      </Pressable>

      {/* Collapsible breakdown (players & earned points per side) */}
      {open && !isFuture && (
        <View style={{ paddingHorizontal: 10, paddingBottom: 10, gap: 8 }}>
          {!home.is_bot && (
            <PlayersBreakdownRN
              label={(home.user?.full_name || home.display_name || "Home").trim()}
              participant={home}
              date={match.match_date}
            />
          )}
          {!away.is_bot && (
            <PlayersBreakdownRN
              label={(away.user?.full_name || away.display_name || "Away").trim()}
              participant={away}
              date={match.match_date}
            />
          )}
        </View>
      )}
    </View>
  );
}

/* =========================
   Players breakdown (RN version of web’s PlayersBreakdown)
   ======================= */
function PlayersBreakdownRN({ label, participant, date }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const { start, end } = dayRangeUtc(date);
        const { data } = await supabase
          .from("games_records")
          .select("player_name, points_earned")
          .eq("user_id", participant.user_id)
          .gte("created_at", start)
          .lt("created_at", end)
          .or("is_elimination_game.is.null,is_elimination_game.eq.false") // exclude elimination
          .order("points_earned", { ascending: false })
          .limit(11);
        if (!cancelled) setRows(data || []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (!participant.is_bot) load();
    return () => {
      cancelled = true;
    };
  }, [participant.id, participant.is_bot, participant.user_id, date]);

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: "#e5e7eb",
        borderRadius: 10,
        backgroundColor: "#f9fafb",
        overflow: "hidden",
      }}
    >
      <View
        style={{
          paddingHorizontal: 10,
          paddingVertical: 8,
          backgroundColor: "#fff",
          borderBottomWidth: 1,
          borderBottomColor: "#e5e7eb",
        }}
      >
        <Text style={{ fontFamily: "Tektur_700Bold" }}>{label}</Text>
      </View>
      <View style={{ paddingHorizontal: 10, paddingVertical: 8 }}>
        {loading ? (
          <Text style={{ fontFamily: "Tektur_400Regular", color: "#6b7280" }}>Loading…</Text>
        ) : rows.length === 0 ? (
          <Text style={{ fontFamily: "Tektur_400Regular", color: "#6b7280" }}>No players recorded for this day.</Text>
        ) : (
          rows.map((r, idx) => (
            <View
              key={`${r.player_name || idx}-${idx}`}
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingVertical: 4,
              }}
            >
              <Text numberOfLines={1} style={{ fontFamily: "Tektur_400Regular", flex: 1, paddingRight: 10 }}>
                {r.player_name || "—"}
              </Text>
              <Text style={{ fontWeight: "800", fontFamily: "Tektur_700Bold" }}>
                {(r.points_earned ?? 0).toLocaleString()} pts
              </Text>
            </View>
          ))
        )}
      </View>
    </View>
  );
}
