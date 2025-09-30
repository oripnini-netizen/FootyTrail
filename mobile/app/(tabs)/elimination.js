// mobile/app/elimination.js
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Pressable,
  TouchableOpacity,
  StyleSheet,
  Image,
  Animated,
  Easing,
  Dimensions,
  Alert,
} from "react-native";
import { supabase } from "../../lib/supabase";
import { useRouter } from "expo-router";
import { useFocusEffect } from "expo-router";
import { useCallback as useCB } from "react";
import * as Notifications from "expo-notifications";
import ReverseTimerBar from "../../components/ReverseTimerBar";
import { useAudioPlayer } from "expo-audio";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFonts, Tektur_400Regular, Tektur_700Bold, Tektur_800ExtraBold } from "@expo-google-fonts/tektur";

/* ------------------------------- Small utils ------------------------------ */
function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${ss}s`;
  return `${ss}s`;
}
function fmtDateTime(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return "—";
  }
}
function useCountdown(endIso) {
  const [left, setLeft] = useState(() => compute(endIso));
  useEffect(() => {
    setLeft(compute(endIso));
    if (!endIso) return;
    const id = setInterval(() => setLeft(compute(endIso)), 1000);
    return () => clearInterval(id);
  }, [endIso]);
  return left;
  function compute(end) {
    if (!end) return "—";
    const ms = Math.max(0, new Date(end).getTime() - Date.now());
    return fmtDuration(ms);
  }
}

function StatCard({ label, value, valueStyle }) {
  return (
    <View style={{ flex: 1, alignItems: "center", marginHorizontal: 4, padding: 8, borderWidth: 1, borderColor: "#ddd", borderRadius: 8, backgroundColor: "#fff" }}>
      <Text style={{ fontSize: 12, color: "#666", fontFamily: "Tektur_400Regular" }}>{label}</Text>
      <Text style={[{ fontSize: 18, fontWeight: "bold", fontFamily: "Tektur_700Bold" }, valueStyle ? { color: valueStyle.replace("text-", "").replace("-700", "") } : {}]}>{value}</Text>
    </View>
  );
}

// deterministic pseudo-random (so avatars don't jump every render)
function seededRand(seed) {
  let x = seed | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return ((x >>> 0) % 100000) / 100000;
}
function strHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* -------------------- One-time “finished” alert persistence ------------------- */
const finishAlertKey = (tournamentId, userId) =>
  `ft:finishAlert:${String(tournamentId)}:${String(userId)}`;

async function hasSeenFinishAlert(tournamentId, userId) {
  try {
    const v = await AsyncStorage.getItem(finishAlertKey(tournamentId, userId));
    return v === "1";
  } catch {
    return false;
  }
}
async function markSeenFinishAlert(tournamentId, userId) {
  try {
    await AsyncStorage.setItem(finishAlertKey(tournamentId, userId), "1");
  } catch { }
}

/* ---------------------- Per-card realtime (minimal & fast) ---------------------- */
/**
 * Subscribes to realtime changes for a single tournament card.
 * Debounced refetch on:
 *   - elimination_participants (join/accept/decline/state)
 *   - elimination_rounds       (status/closed_at/ends_at updates)
 *   - elimination_round_entries (started/game_record_id/points)
 *   - elimination_tournaments   (status/name/filters/etc.)
 */
function useRealtimeTournament({ tournamentId, roundIds, onChange, enabled = true }) {
  const debouncedRefetchTimer = useRef(null);

  const refetchSoon = useCallback(() => {
    if (debouncedRefetchTimer.current) clearTimeout(debouncedRefetchTimer.current);
    debouncedRefetchTimer.current = setTimeout(() => {
      onChange && onChange();
    }, 250);
  }, [onChange]);

  const roundIdSet = useMemo(() => new Set((roundIds || []).filter(Boolean)), [roundIds]);

  useEffect(() => {
    if (!enabled || !tournamentId) return;

    const channel = supabase.channel(`rt:tournament:${tournamentId}`);

    // Participants in this tournament
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "elimination_participants", filter: `tournament_id=eq.${tournamentId}` },
      refetchSoon
    );

    // Rounds of this tournament
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "elimination_rounds", filter: `tournament_id=eq.${tournamentId}` },
      refetchSoon
    );

    // Entries (filter in handler by round_id)
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "elimination_round_entries" },
      (payload) => {
        const rid = payload?.new?.round_id ?? payload?.old?.round_id ?? null;
        if (!rid || (roundIdSet.size && !roundIdSet.has(rid))) return;
        refetchSoon();
      }
    );

    // Tournament row itself
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "elimination_tournaments", filter: `id=eq.${tournamentId}` },
      refetchSoon
    );

    channel.subscribe();

    return () => {
      if (debouncedRefetchTimer.current) {
        clearTimeout(debouncedRefetchTimer.current);
        debouncedRefetchTimer.current = null;
      }
      try {
        channel.unsubscribe();
      } catch {
        supabase.removeChannel(channel);
      }
    };

  }, [tournamentId, roundIdSet, refetchSoon]);
}

/* ----------------------------- Alignment constants ----------------------------- */
/** Ensures titles/subtitles and the bottom info row align across all slides */
const TITLE_BLOCK_MIN_H = 40;
const BOTTOM_BLOCK_MIN_H = 40;

/* ------------------------ User KPI stats (mobile) ------------------------ */
// Re-render only when userId OR refreshKey changes (not on expand/collapse noise)
const UserElimStatsKPI = React.memo(
  function UserElimStatsKPI({ userId, refreshKey }) {
    const [stats, setStats] = useState({
      created: 0,
      participated: 0,
      wins: 0,
      roundsSurvived: 0,
      pointsNet: 0,
    });

    useEffect(() => {
      let cancelled = false;
      (async () => {
        try {
          const [p1, p2, p3, p4] = await Promise.all([
            supabase
              .from("elimination_participants")
              .select("tournament_id", { count: "exact", head: true })
              .eq("user_id", userId)
              .eq("invite_status", "accepted"),
            supabase
              .from("elimination_tournaments")
              .select("id", { count: "exact", head: true })
              .eq("winner_user_id", userId),
            supabase
              .from("elimination_tournaments")
              .select("id", { count: "exact", head: true })
              .eq("owner_id", userId),
            supabase
              .from("elimination_round_entries")
              .select("round_id", { count: "exact", head: true })
              .eq("user_id", userId),
          ]);

          // Net points from point_transactions
          let net = 0;
          try {
            const { data: tx } = await supabase
              .from("point_transactions")
              .select("amount")
              .eq("user_id", userId)
              .limit(10000);
            if (Array.isArray(tx)) {
              net = tx.reduce((acc, r) => acc + (Number(r?.amount) || 0), 0);
            }
          } catch { }

          if (!cancelled) {
            setStats({
              created: p3?.count || 0,
              participated: p1?.count || 0,
              wins: p2?.count || 0,
              roundsSurvived: p4?.count || 0,
              pointsNet: net,
            });
          }
        } catch { }
      })();
      return () => { cancelled = true; };
    }, [userId, refreshKey]);

    const netPositive = stats.pointsNet > 0;
    const netNegative = stats.pointsNet < 0;

    return (
      <View style={{ alignItems: "center", marginBottom: 8 }}>
        {/* Row 1: Created, Played, Won */}
        <View style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
          <StatCardKPI label="Created" value={String(stats.created)} />
          <StatCardKPI label="Played" value={String(stats.participated)} />
          <StatCardKPI label="Won" value={String(stats.wins)} />
        </View>

        {/* Row 2: Survived, Points */}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <StatCardKPI label="Survived" value={String(stats.roundsSurvived)} />
          <StatCardKPI
            label="Points"
            value={(netPositive ? "+" : "") + String(stats.pointsNet)}
            valueStyle={{
              color: netPositive
                ? "#047857"
                : netNegative
                  ? "#b91c1c"
                  : "#111827",
            }}
          />
        </View>
      </View>
    );
  }
  , (prev, next) => (
    prev.userId === next.userId &&
    prev.refreshKey === next.refreshKey
  )
);

function StatCardKPI({ label, value, valueStyle }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: "white",
        borderColor: "#E5E7EB",
        borderWidth: 1,
        borderRadius: 10,
        paddingVertical: 8,
        paddingHorizontal: 6,
        alignItems: "center",
      }}
    >
      <Text style={{ fontSize: 11, color: "#6B7280", fontFamily: "Tektur_400Regular" }}>{label}</Text>
      <Text style={[{ fontSize: 18, fontWeight: "700", color: "#111827", fontFamily: "Tektur_700Bold" }, valueStyle]}>{value}</Text>
    </View>
  );
}


/* ---------------------------------- Page ---------------------------------- */
export default function EliminationScreen() {
  const router = useRouter();
  const [userId, setUserId] = useState(null);

  const [upcoming, setUpcoming] = useState([]); // lobby
  const [live, setLive] = useState([]);
  const [finished, setFinished] = useState([]);

  // Loading + error per section
  const [loading, setLoading] = useState({ upcoming: true, live: true, finished: true });
  const [error, setError] = useState({ upcoming: "", live: "", finished: "" });

  // Pull-to-refresh
  const [refreshing, setRefreshing] = useState(false);

  // For child cards to force reloads
  const [refreshToken, setRefreshToken] = useState(0);
  const [hardRefreshToken, setHardRefreshToken] = useState(0);

  // Per-tournament realtime ticks (so we can nudge only the changed card)
  const [rtTicksByTournament, setRtTicksByTournament] = useState({});
  const bumpRtTick = useCallback((tid) => {
    if (!tid) return;
    setRtTicksByTournament((prev) => ({ ...prev, [tid]: (prev[tid] || 0) + 1 }));
  }, []);

  const [liveAutoTick, setLiveAutoTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setLiveAutoTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const [showAllFinished, setShowAllFinished] = useState(false);

  // Expanded card: always expand the top card after each lists reload
  const [expandedIds, setExpandedIds] = useState(new Set());

  // Fade-in animation for the list container
  const fadeAnim = useRef(new Animated.Value(0)).current; // 0 → 1
  const slideAnim = useRef(new Animated.Value(8)).current; // 8px down → 0

  // --- Get current user id once ---
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await supabase.auth.getUser();
      if (!alive) return;
      if (error) {
        setUserId(null);
        return;
      }
      setUserId(data?.user?.id || null);
    })();
    return () => { alive = false; };
  }, []);

  // --- Loader: fetch three lists
  const reloadLists = useCallback(async () => {
    if (!userId) {
      setUpcoming([]); setLive([]); setFinished([]);
      setLoading({ upcoming: false, live: false, finished: false });
      setError({ upcoming: "", live: "", finished: "" });
      return;
    }
    try {
      // --- 1) LOBBY: all, except those I explicitly declined ---
      const { data: lobbyAll, error: lobbyErr } = await supabase
        .from("elimination_tournaments")
        .select("*")
        .eq("status", "lobby")
        .order("created_at", { ascending: false });

      if (lobbyErr) throw lobbyErr;

      const lobbyIds = (lobbyAll || []).map((t) => t.id);
      let declinedSet = new Set();

      if (lobbyIds.length > 0) {
        const { data: myDeclines, error: declinesErr } = await supabase
          .from("elimination_participants")
          .select("tournament_id")
          .eq("user_id", userId)
          .eq("invite_status", "declined")
          .in("tournament_id", lobbyIds);

        if (declinesErr) throw declinesErr;
        declinedSet = new Set((myDeclines || []).map((r) => r.tournament_id));
      }

      const lobbyFiltered = (lobbyAll || []).filter((t) => !declinedSet.has(t.id));

      // --- 2) Get my ACCEPTED tournament IDs once (for live & finished) ---
      const { data: myAccepted, error: accErr } = await supabase
        .from("elimination_participants")
        .select("tournament_id")
        .eq("user_id", userId)
        .eq("invite_status", "accepted");

      if (accErr) throw accErr;

      const acceptedIds = Array.from(new Set((myAccepted || []).map((r) => r.tournament_id)));

      // --- 3) LIVE: only tournaments I accepted ---
      let liveData = [];
      if (acceptedIds.length > 0) {
        const { data, error } = await supabase
          .from("elimination_tournaments")
          .select("*")
          .eq("status", "live")
          .in("id", acceptedIds)
          .order("updated_at", { ascending: false });
        if (error) throw error;
        liveData = data || [];
      }

      // --- 4) FINISHED: only tournaments I accepted ---
      let finishedData = [];
      if (acceptedIds.length > 0) {
        const { data, error } = await supabase
          .from("elimination_tournaments")
          .select("*")
          .eq("status", "finished")
          .in("id", acceptedIds)
          .order("finished_at", { ascending: false });
        if (error) throw error;
        finishedData = data || [];
      }

      // --- 5) Commit to state ---
      setUpcoming(lobbyFiltered);
      setLive(liveData);
      setFinished(finishedData);
      setRefreshToken((t) => t + 1);  // let light reloads trigger dependents like the KPI/animations
    } catch (e) {
      console.warn("reloadLists failed:", e);
    }
  }, [supabase, userId]);

  // initial + on user change
  useEffect(() => { reloadLists(); }, [reloadLists]);

  // Also reload every time the Elimination tab/screen regains focus
  useFocusEffect(
    useCallback(() => {
      reloadLists();  // refetch lobby/live/finished and re-expand top card
      return () => { };
    }, [reloadLists])
  );

  // --- Refresh when the user taps a push notification about an elimination challenge
  useEffect(() => {
    // Decide whether the tapped notification is about an elimination challenge
    const isEliminationNotification = (data) => {
      const k = data?.kind;
      return (
        k === "round_started" ||
        k === "tournament_new_accept" ||
        k === "private_elim_invited"
      );
    };

    const handleTap = (response) => {
      const data = response?.notification?.request?.content?.data ?? {};
      if (isEliminationNotification(data)) {
        // User is on the Elimination screen already; just refresh the lists
        reloadLists?.();
      }
    };

    // 1) Handle taps while app is foreground/background
    const sub = Notifications.addNotificationResponseReceivedListener(handleTap);

    // 2) Handle the case where the app was launched/opened from a tap
    (async () => {
      try {
        const last = await Notifications.getLastNotificationResponseAsync();
        if (last) handleTap(last);
      } catch { }
    })();

    return () => {
      sub?.remove?.();
    };
  }, [reloadLists]);

  // Scroll-to-refresh
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    // Bump hard refresh first (cards will decide whether to react)
    setHardRefreshToken((t) => t + 1);
    reloadLists()
      .finally(() => setRefreshing(false));
  }, [reloadLists]);

  // simple “any” flags / lists
  const anyError = error.upcoming || error.live || error.finished;
  // Only live + upcoming + the *last* finished
  const lastFinished = finished && finished.length ? finished[0] : null;
  const combinedList = [
    ...(live || []),
    ...(upcoming || []),
    ...(lastFinished ? [lastFinished] : []),
  ];

  // How many finished are *not* shown yet (for the button label)
  const remainingFinishedCount = Math.max(0, (finished?.length || 0) - (lastFinished ? 1 : 0));

  // Fade in on mount / reloads
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 60, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  }, [refreshToken]);

  // Always expand the first visible card (live/upcoming + last finished) after each reload
  useEffect(() => {
    // combinedList is defined above; it reflects the currently displayed order
    const first = combinedList.length ? combinedList[0].id : null;
    setExpandedIds(first ? new Set([first]) : new Set());
    // Runs after each reloadLists() completion and realtime-triggered hard refresh
  }, [refreshToken, hardRefreshToken, combinedList.length]);

  // Realtime: keep tournaments → reload lists, everything else → tick only the affected card.
  useEffect(() => {
    const ch = supabase
      .channel("elim-mobile-realtime")

      // Any change to tournaments should re-query the three lists
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "elimination_tournaments" },
        () => reloadLists()
      )

      // Rounds → bump that tournament's card only
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "elimination_rounds" },
        (payload) => {
          const tid = payload?.new?.tournament_id ?? payload?.old?.tournament_id ?? null;
          if (tid) bumpRtTick(tid);
        }
      )

      // Participants → bump that tournament's card only
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "elimination_participants" },
        (payload) => {
          const tid = payload?.new?.tournament_id ?? payload?.old?.tournament_id ?? null;
          if (tid) bumpRtTick(tid);
        }
      )

      // Entries → find the tournament via the round_id and bump only that card
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "elimination_round_entries" },
        async (payload) => {
          const rid = payload?.new?.round_id ?? payload?.old?.round_id ?? null;
          if (!rid) return;
          // Lightweight lookup of the tournament for this round
          const { data } = await supabase
            .from("elimination_rounds")
            .select("tournament_id")
            .eq("id", rid)
            .single();
          const tid = data?.tournament_id ?? null;
          if (tid) bumpRtTick(tid);
        }
      )

      // point_transactions: noisy → IGNORE at page level. Cards recompute when opened.

      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [reloadLists, bumpRtTick]);

  let [fontsLoaded] = useFonts({ Tektur_400Regular, Tektur_700Bold, Tektur_800ExtraBold });
  if (!fontsLoaded) return null;

  return (
    <View style={{ flex: 1, backgroundColor: "#F0FDF4", justifyContent: "center" }}>
      <Animated.ScrollView
        contentContainerStyle={{ padding: 12, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        // Fade + slight up-slide to avoid any flash on mount/reloads
        style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}
      >
        {/* Top CTA */}
        <View style={{ marginBottom: 12, justifyContent: "center" }}>
          <TouchableOpacity
            style={[styles.primaryBtn, { alignSelf: "center", paddingHorizontal: 14 }]}
            onPress={() => router.push("/elimination-create")}
          >
            <Text style={[styles.primaryBtnText, { fontFamily: "Tektur_700Bold" }]}>+ Create New Challenge</Text>
          </TouchableOpacity>
        </View>

        {userId && <UserElimStatsKPI userId={userId} refreshKey={`${refreshToken}:${hardRefreshToken}`} />}

        {anyError ? (
          <ErrorBox message={anyError} />
        ) : combinedList.length === 0 ? (
          <EmptyText text="" />
        ) : (
          <View style={{ gap: 12 }}>
            {/* live + upcoming + the last finished */}
            {combinedList.map((t, idx) => (
              <TournamentCardMobileBR
                key={t.id}
                tournament={t}
                userId={userId}
                refreshToken={refreshToken}
                hardRefreshToken={
                  (t.status === "live" || t.status === "lobby")
                    ? (hardRefreshToken + liveAutoTick)  // refresh every 30s + realtime
                    : 0                                  // finished: no auto refresh
                }
                perCardTick={rtTicksByTournament[t.id] || 0}
                onChanged={reloadLists}
                isExpanded={expandedIds.has(t.id)}
                onToggle={() => {
                  setExpandedIds((prev) => {
                    const n = new Set(prev);
                    if (n.has(t.id)) n.delete(t.id); else n.add(t.id);
                    return n;
                  });
                }}
              />
            ))}

            {/* Toggle goes RIGHT AFTER the always-shown last finished */}
            {remainingFinishedCount > 0 && (
              <View style={{ alignItems: "center", marginTop: 4 }}>
                <TouchableOpacity
                  onPress={() => setShowAllFinished((v) => !v)}
                  activeOpacity={0.85}
                  style={[styles.secondaryBtn, { paddingHorizontal: 16, paddingVertical: 10 }]}
                >
                  <Text style={[styles.secondaryBtnText, { fontFamily: "Tektur_700Bold" }]}>
                    {showAllFinished
                      ? "Hide previous finished challenges"
                      : `Show previous finished challenges (${remainingFinishedCount})`}
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* The rest of the finished go AFTER the button (collapsed by default) */}
            {showAllFinished &&
              (finished?.slice(1) || []).map((t) => (
                <TournamentCardMobileBR
                  key={t.id}
                  tournament={t}
                  userId={userId}
                  refreshToken={refreshToken}
                  hardRefreshToken={
                    (t.status === "live" || t.status === "lobby")
                      ? (hardRefreshToken + liveAutoTick)  // refresh every 30s + realtime
                      : 0                                  // finished: no auto refresh
                  }
                  perCardTick={rtTicksByTournament[t.id] || 0}
                  onChanged={reloadLists}
                  isExpanded={expandedIds.has(t.id)}  // collapsed unless user opens
                  onToggle={() => {
                    setExpandedIds((prev) => {
                      const n = new Set(prev);
                      if (n.has(t.id)) n.delete(t.id); else n.add(t.id);
                      return n;
                    });
                  }}
                />
              ))}
          </View>



        )}
      </Animated.ScrollView>
    </View>
  );

  /* ------------------- Small inner components for this screen ------------------- */
  function EmptyText({ text }) {
    return (
      <View style={{ paddingVertical: 40, alignItems: "center" }}>
        <Text style={{ color: "#6B7280", fontFamily: "Tektur_400Regular" }}>{text}</Text>
      </View>
    );
  }
  function ErrorBox({ message }) {
    return (
      <View style={styles.errorBox}>
        <Text style={[styles.errorTitle, { fontFamily: "Tektur_700Bold" }]}>Couldn’t load</Text>
        <Text style={[styles.errorText, { fontFamily: "Tektur_400Regular" }]}>{String(message)}</Text>
      </View>
    );
  }
  function Skeleton() {
    return (
      <View style={{ gap: 12 }}>
        {[0, 1].map((i) => (
          <View key={i} style={styles.skeleton} />
        ))}
      </View>
    );
  }
}


/* --------------- Battle-Royale styled tournament card (RN) --------------- */
function TournamentCardMobileBR({
  tournament,
  userId,
  refreshToken,
  hardRefreshToken,
  onChanged,
  isExpanded,
  onToggle,
  onFirstDataLoaded,
  perCardTick = 0,
}) {
  const router = useRouter();
  const isUpcoming = tournament.status === "lobby";
  const isLive = tournament.status === "live";
  const isFinished = tournament.status === "finished";
  const isOwner = tournament.owner_id === userId; // hide join for creator
  const timeLimitMin = Math.round((tournament.round_time_limit_seconds || 0) / 60);
  const roundsToElim = Math.max(1, Number(tournament.rounds_to_elimination || 1));

  const [loading, setLoading] = useState(true);
  const [participants, setParticipants] = useState([]);
  const [rounds, setRounds] = useState([]);
  const [entriesByRound, setEntriesByRound] = useState({});
  const [usersById, setUsersById] = useState({});
  const [playersById, setPlayersById] = useState({});
  const [youEliminatedRound, setYouEliminatedRound] = useState(null);
  const [busy, setBusy] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);

  // --- Join pre-check state (derived from today's earned points) ---
  const [canAffordStakeToday, setCanAffordStakeToday] = useState(true);
  const [precheckMsg, setPrecheckMsg] = useState("");

  // Decline the invite (only if I'm truly still invited and lobby is open)
  async function handleDecline() {
    if (busy) return;
    if (!isLobbyOpen) {
      console.warn("Decline blocked: lobby is not in 'lobby' status.");
      return;
    }
    if (!isInvitedOnly) {
      console.warn("Decline blocked: you have already accepted (no pending invite).");
      return;
    }

    setBusy("decline");
    try {
      const { error } = await supabase.rpc("decline_tournament_invite", {
        p_tournament_id: tournament.id,
      });
      if (error) {
        console.warn("decline_tournament_invite failed:", error.message);
      }
    } finally {
      setBusy("");
      onChanged && onChanged();
    }
  }


  // --- UTC day range helper (today 00:00 → tomorrow 00:00 in UTC) ---
  function getTodayUtcRange() {
    const now = new Date();
    const utcY = now.getUTCFullYear();
    const utcM = now.getUTCMonth();
    const utcD = now.getUTCDate();
    const start = new Date(Date.UTC(utcY, utcM, utcD, 0, 0, 0));
    const end = new Date(Date.UTC(utcY, utcM, utcD + 1, 0, 0, 0));
    return { start: start.toISOString(), end: end.toISOString() };
  }



  // NEW: local tick to trigger a refetch when realtime events land for this card
  const [rtTick, setRtTick] = useState(0);

  // pulsing aura
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1200, easing: Easing.out(Easing.quad), useNativeDriver: false }),
        Animated.timing(pulse, { toValue: 0, duration: 1200, easing: Easing.in(Easing.quad), useNativeDriver: false }),
      ])
    ).start();
  }, [pulse]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [{ data: partRows }, { data: roundRows }] = await Promise.all([
          supabase
            .from("elimination_participants")
            .select("user_id, state, invite_status, eliminated_at_round")
            .eq("tournament_id", tournament.id),

          supabase
            .from("elimination_rounds")
            .select("id, round_number, started_at, ends_at, closed_at, player_id, is_elimination, users_participated")
            .eq("tournament_id", tournament.id)
            .order("round_number", { ascending: true }),
        ]);

        const participantIds = (partRows || []).map((r) => r.user_id);


        // entries per round — BULK query in one go (removes N+1 round-trips)
        const roundIds = (roundRows || []).map((r) => r.id);
        let entriesMap = {};
        let entryUserIds = new Set();

        if (roundIds.length) {
          const { data: entAll } = await supabase
            .from("elimination_round_entries")
            .select("round_id, user_id, points_earned, started, game_record_id")
            .in("round_id", roundIds);

          const arrAll = Array.isArray(entAll) ? entAll : [];
          for (const e of arrAll) {
            if (!entriesMap[e.round_id]) entriesMap[e.round_id] = [];
            entriesMap[e.round_id].push(e);
            entryUserIds.add(e.user_id);
          }
        } else {
          entriesMap = {};
        }


        // round player info — include nationality & position so LiveGame hints work
        const roundPlayerIds = Array.from(
          new Set((roundRows || []).map((r) => r.player_id).filter(Boolean))
        );
        let playersMap = {};
        if (roundPlayerIds.length) {
          const { data: pisRows } = await supabase
            .from("players_in_seasons")
            .select("player_id, player_name, player_photo, player_nationality, player_position")
            .in("player_id", roundPlayerIds);
          const best = {};
          (pisRows || []).forEach((row) => {
            if (!best[row.player_id] || (!best[row.player_id].player_photo && row.player_photo)) {
              best[row.player_id] = row;
            }
          });
          playersMap = Object.fromEntries(
            Object.values(best).map((p) => [
              p.player_id,
              {
                id: p.player_id,
                name: p.player_name || "Player",
                photo: p.player_photo || null,
                nationality: p.player_nationality || "",
                position: p.player_position || "",
              },
            ])
          );
        }

        // fetch users (include owner so he is always countable)
        const allIds = Array.from(new Set([...participantIds, ...entryUserIds, tournament.owner_id].filter(Boolean)));
        let usersRows = [];
        if (allIds.length) {
          const { data: uRows } = await supabase
            .from("users")
            .select("id, full_name, email, profile_photo_url")
            .in("id", allIds);
          usersRows = uRows || [];
        }
        const usersByIdNext = Object.fromEntries(usersRows.map((u) => [u.id, u]));

        // build participants with meta (use union of IDs, no manual owner fallback)
        const unionIds = Array.from(new Set([...participantIds, ...allIds]));
        const withMeta = unionIds.map((uid) => {
          const u = usersByIdNext[uid] || { id: uid };
          const p = (partRows || []).find((x) => x.user_id === uid);
          return {
            ...u,
            state: p?.state || null,
            invite_status: p?.invite_status || "accepted",
            eliminated_at_round: p?.eliminated_at_round ?? null,
          };
        });

        if (!cancelled) {
          setParticipants(withMeta);
          setRounds(Array.isArray(roundRows) ? roundRows : []);
          setEntriesByRound(entriesMap);
          setUsersById(usersByIdNext);
          setPlayersById(playersMap);

          const me = withMeta.find((u) => u.id === userId);
          setYouEliminatedRound(me?.eliminated_at_round ?? null);

          // --- Pre-check: only when lobby, not owner, not already joined, and stake > 0
          const stakePts = Number(tournament.stake_points || 0);
          const youAccepted = (partRows || []).some(
            (p) => p.user_id === userId && (p.invite_status || "").toLowerCase() === "accepted"
          );
          const canRunPrecheck = isUpcoming && !isOwner && !youAccepted && stakePts > 0;

          if (!canRunPrecheck) {
            setCanAffordStakeToday(true);
            setPrecheckMsg("");
          } else {
            (async () => {
              try {
                setPrecheckMsg("");
                const { start, end } = getTodayUtcRange();

                // 1) Sum regular-games points today
                let sumGames = 0;
                {
                  const { data: grRows } = await supabase
                    .from("games_records")
                    .select("points_earned")
                    .eq("user_id", userId)
                    .eq("is_elimination_game", false)
                    .gte("created_at", start)
                    .lt("created_at", end);
                  if (Array.isArray(grRows)) {
                    for (const r of grRows) sumGames += Number(r.points_earned) || 0;
                  }
                }

                // 2) Sum point_transactions today
                let sumTx = 0;
                {
                  const { data: txRows } = await supabase
                    .from("point_transactions")
                    .select("amount")
                    .eq("user_id", userId)
                    .gte("created_at", start)
                    .lt("created_at", end);
                  if (Array.isArray(txRows)) {
                    for (const r of txRows) sumTx += Number(r.amount) || 0;
                  }
                }

                const availableToday = (sumGames || 0) + (sumTx || 0);
                const ok = availableToday >= stakePts;

                setCanAffordStakeToday(ok);
                if (!ok) {
                  setPrecheckMsg(`Stake is ${stakePts} pts. Your available today is ${availableToday} pts.`);
                }
              } catch (e) {
                console.warn("join precheck failed:", e?.message);
                setCanAffordStakeToday(true);
              }
            })();
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tournament.id, refreshToken, hardRefreshToken, userId, rtTick, perCardTick]); // ← include rtTick so realtime nudges refetch


  // NEW: Let the parent know this card finished its FIRST internal fetch
  const hasSignaledReadyRef = useRef(false);
  useEffect(() => {
    if (!loading && !hasSignaledReadyRef.current) {
      hasSignaledReadyRef.current = true;
      onFirstDataLoaded && onFirstDataLoaded(tournament.id);
    }
  }, [loading, onFirstDataLoaded, tournament.id]);


  // Hook up realtime for ONLY this tournament card
  useRealtimeTournament({
    tournamentId: tournament.id,
    roundIds: rounds.map((r) => r.id),
    onChange: () => setRtTick((t) => t + 1),
    enabled: !!isExpanded, // realtime channel only when open
  });

  const acceptedParticipants = useMemo(
    () => participants.filter((p) => (p.invite_status || "").toLowerCase() === "accepted"),
    [participants]
  );
  const pendingParticipants = useMemo(
    () =>
      participants.filter(
        (p) =>
          p.invite_status &&
          (p.invite_status.toLowerCase() === "invited" ||
            p.invite_status.toLowerCase() === "pending")
      ),
    [participants]
  );

  const acceptedCount = acceptedParticipants.length;

  const pot = useMemo(
    () => Number(tournament.stake_points || 0) * Number(acceptedCount || 0),
    [tournament.stake_points, acceptedCount]
  );
  const joinCountdown = useCountdown(isUpcoming ? tournament.join_deadline : null);
  const userHasJoined = useMemo(() => {
    const me = acceptedParticipants.find((p) => p.id === userId);
    return !!me;
  }, [acceptedParticipants, userId]);

  // FIXED: call the RPC exactly like the web (no extra args) and avoid RLS-violating upserts
  async function handleJoin() {
    if (!isUpcoming || isOwner || userHasJoined || busy) return;
    setBusy("join");
    try {
      const { error } = await supabase.rpc("accept_tournament_invite", {
        p_tournament_id: tournament.id,
      });
      if (error) {
        console.warn("accept_tournament_invite failed:", error.message);
      }
    } finally {
      setBusy("");
      onChanged && onChanged();
    }
  }

  // NEW: creator can start once min participants reached
  async function handleStart() {
    if (!isUpcoming || !isOwner || busy) return;
    setBusy("start");
    try {
      const { error } = await supabase.rpc("start_elimination_tournament", {
        p_tournament_id: tournament.id,
        p_force_start: true,
      });
      if (error) {
        console.warn("start_elimination_tournament failed:", error.message);
      }
    } finally {
      setBusy("");
      onChanged && onChanged();
    }
  }

  const roundsAsc = useMemo(() => [...rounds].sort((a, b) => (a.round_number || 0) - (b.round_number || 0)), [rounds]);
  const roundsDesc = useMemo(() => [...roundsAsc].reverse(), [roundsAsc]);

  const winnerUserId = tournament.winner_user_id || null;
  const youWon = !!winnerUserId && winnerUserId === userId;
  const winner = usersById[winnerUserId] || { id: winnerUserId };

  const totalPointsByUserAll = useMemo(() => {
    const m = new Map();
    for (const rId in entriesByRound) {
      for (const e of (entriesByRound[rId] || [])) {
        m.set(e.user_id, (m.get(e.user_id) || 0) + (Number(e.points_earned) || 0));
      }
    }
    return m;
  }, [entriesByRound]);

  const filterChips = useMemo(() => {
    const f = tournament?.filters || {};
    const chips = [];
    if (Array.isArray(f.competitions) && f.competitions.length) {
      chips.push(...f.competitions.map((c) => ({ label: "League", value: String(c) })));
    }
    if (Array.isArray(f.seasons) && f.seasons.length) {
      chips.push(...f.seasons.map((s) => ({ label: "Season", value: String(s) })));
    }
    if (Number.isFinite(Number(f.minMarketValue)) && Number(f.minMarketValue) > 0) {
      chips.push({ label: "Min MV", value: String(f.minMarketValue) });
    }
    if (Number.isFinite(Number(f.minAppearances)) && Number(f.minAppearances) > 0) {
      chips.push({ label: "Min Apps", value: String(f.minAppearances) });
    }
    return chips;
  }, [tournament?.filters]);

  // Header color by status
  const headerStyle =
    isLive ? styles.headerLive : isUpcoming ? styles.headerUpcoming : styles.headerFinished;

  const canStart = isOwner && isUpcoming && acceptedCount >= Number(tournament.min_participants || 0);

  // Treat lobby as open purely by status
  const isLobbyOpen = String(tournament.status || "").toLowerCase() === "lobby";

  // Am I still invited (not yet accepted)?
  const isInvitedOnly = participants.some(
    (p) => p.id === userId && String(p.invite_status || "").toLowerCase() !== "accepted"
  );

  return (
    <View style={styles.card}>
      {/* ----- Header (color-coded & clickable to collapse/expand) ----- */}
      <TouchableOpacity
        style={[styles.cardHeader, headerStyle]}
        activeOpacity={0.85}
        onPress={onToggle}
      >
        {/* Row 1: Name */}
        <Text
          style={[
            styles.cardTitle,
            { textAlign: "center", width: "100%", marginBottom: 6, fontFamily: "Tektur_800ExtraBold" },
          ]}
        >
          {tournament.name || "Untitled"}
        </Text>

        {/* Row 2: Centered meta line */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            width: "100%",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <Text style={[styles.smallMuted, { fontFamily: "Tektur_400Regular" }]}>
            Participants: <Text style={[styles.bold, { fontFamily: "Tektur_700Bold" }]}>{acceptedCount}</Text>
          </Text>

          <Text style={[styles.smallMuted, { fontFamily: "Tektur_400Regular" }]}>•</Text>

          <Text style={[styles.smallMuted, { fontFamily: "Tektur_400Regular" }]}>
            <Text style={[styles.bold, { fontFamily: "Tektur_700Bold" }]}>{fmtDateTime(tournament.created_at)}</Text>
          </Text>
        </View>

        {/* Row 3: Left (status + participants) | Right (actions + chevron) */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
          }}
        >
          {/* Left side */}
          <View
            style={
              isUpcoming
                ? styles.upcomingChip
                : isLive
                  ? styles.liveChip
                  : styles.finishedChip
            }
          >
            <Text
              style={[
                isUpcoming
                  ? styles.upcomingChipText
                  : isLive
                    ? styles.liveChipText
                    : styles.finishedChipText,
                { fontFamily: isUpcoming ? "Tektur_700Bold" : "Tektur_400Regular" }
              ]}
            >
              {isUpcoming ? "Upcoming" : isLive ? "Live" : "Finished"}
            </Text>
          </View>

          {/* Right side */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            {isUpcoming ? (
              isOwner ? (
                canStart ? (
                  <View style={[styles.joinedChip]}>
                    <Text style={[styles.joinedChipText, { fontFamily: "Tektur_700Bold" }]}>Ready to start challenge</Text>
                  </View>
                ) : (
                  <View style={styles.joinedChip}>
                    <Text style={[styles.joinedChipText, { fontFamily: "Tektur_400Regular" }]}>Waiting for min participants</Text>
                  </View>
                )
              ) : (
                <View style={userHasJoined ? styles.joinedChip : styles.chip}>
                  <Text
                    style={[userHasJoined ? styles.joinedChipText : styles.chipValue, { fontFamily: userHasJoined ? "Tektur_700Bold" : "Tektur_400Regular" }]}
                  >
                    {userHasJoined ? "Joined" : "Open to Join"}
                  </Text>
                </View>
              )
            ) : isFinished ? (
              <View style={youWon ? styles.winnerChip : styles.elimChip}>
                <Text style={[youWon ? styles.winnerChipText : styles.elimChipText, { fontFamily: youWon ? "Tektur_700Bold" : "Tektur_400Regular" }]}>
                  {`Won by ${winner.full_name}`}
                </Text>
              </View>
            ) : <View style={styles.liveChip}>
              <Text style={[styles.liveChipText, { fontFamily: "Tektur_400Regular" }]}>Round {rounds.length} in progress</Text>
            </View>}
          </View>
        </View>
      </TouchableOpacity>

      {/* ----- Collapsible body ----- */}
      {isExpanded && (
        <>
          {/* ----- Summary row ----- */}
          <View style={[styles.row, { justifyContent: "stretched", alignItems: "center", gap: 12, marginTop: 8, minHeight: BOTTOM_BLOCK_MIN_H }]}>
            <InfoChip label="Stake 💸" value={`${Number(tournament.stake_points || 0)} pts`} />
            <InfoChip label="Pot 💰" value={`${Number(tournament.stake_points || 0) * Number(acceptedCount || 0)} pts`} />
            <InfoChip label="Time ⏱️" value={`${timeLimitMin} min`} />
            <InfoChip label="🪓 every" value={`${roundsToElim} rounds`} />

            {isUpcoming ? <InfoChip label="🕰️ Closes in" value={joinCountdown} tone="danger" /> : null}

            <TouchableOpacity onPress={() => setFiltersOpen((v) => !v)}>
              <View style={[styles.chip, { alignSelf: "flex-start", alignItems: "stretch", paddingHorizontal: 8, paddingVertical: 8, borderRadius: 16 }]}>
                <Text style={[styles.chipValue, { fontFamily: "Tektur_700Bold" }]}>{filtersOpen ? "Hide" : "Show"} Filters</Text>
              </View>
            </TouchableOpacity>
          </View>

          {/* ----- Collapsible Filters row (default collapsed) ----- */}
          {filterChips.length > 0 && (
            <View style={styles.row}>
              {filtersOpen && (
                <View style={styles.filtersBox}>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    {filterChips.map((c, idx) => (
                      <View key={idx} style={styles.chip}>
                        <Text style={[styles.chipLabel, { fontFamily: "Tektur_700Bold" }]}>{c.label}:</Text>
                        <Text style={[styles.chipValue, { fontFamily: "Tektur_700Bold" }]}> {c.value}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </View>
          )}

          {/* ----- Lobby Arena (status = lobby) ----- */}
          {isUpcoming && (
            <LobbyArena
              tournament={tournament}
              acceptedParticipants={acceptedParticipants}
              pendingParticipants={pendingParticipants}
              usersById={usersById}
            />
          )}

          {/* ----- SWIPEABLE ARENA (live/finished) ----- */}
          {(isLive || isFinished) && (
            <SwipeableArena
              tournament={tournament}
              userId={userId}
              roundsAsc={roundsAsc}
              roundsDesc={roundsDesc}
              participants={participants}
              entriesByRound={entriesByRound}
              usersById={usersById}
              playersById={playersById}
              totalPointsByUserAll={totalPointsByUserAll}
              pulse={pulse}
              onForceRefresh={onChanged}
              onPlay={() => {
                const latest = roundsDesc[0];
                if (latest) {
                  const player = playersById[latest.player_id] || {};
                  // Pass individual player fields + elimination as JSON, as expected by live-game.js
                  router.push({
                    pathname: "/live-game",
                    params: {
                      id: String(player.id ?? ""),
                      name: player.name ?? "",
                      nationality: player.nationality ?? "",
                      position: player.position ?? "",
                      photo: player.photo ?? "",
                      isDaily: "0",
                      filters: JSON.stringify(tournament?.filters || {}),
                      elimination: JSON.stringify({
                        tournamentId: tournament.id,
                        roundId: latest.id,
                        endsAt: latest.ends_at,                           // ISO from DB
                        timeLimitSeconds: tournament.round_time_limit_seconds || 120
                      }),
                    },
                  });
                }
              }}
            />
          )}

          {/* Inline actions that make sense only when body is open */}
          {isUpcoming && (
            <>
              <View style={{ marginTop: 8, flexDirection: "row", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                {isOwner ? (
                  canStart ? (
                    <TouchableOpacity
                      style={[styles.primaryBtn, busy && { opacity: 0.6 }]}
                      disabled={busy === "start"}
                      onPress={handleStart}
                    >
                      <Text style={[styles.primaryBtnText, { fontFamily: "Tektur_700Bold" }]}>Start Challenge</Text>
                    </TouchableOpacity>
                  ) : null
                ) : userHasJoined ? null : (
                  <>
                    {/* Join (your existing disable logic for stake can stay as-is if you added it) */}
                    <TouchableOpacity
                      style={[styles.primaryBtn, busy && { opacity: 0.6 }]}
                      disabled={busy === "join"}
                      onPress={handleJoin}
                    >
                      <Text style={[styles.primaryBtnText, { fontFamily: "Tektur_700Bold" }]}>Join Challenge</Text>
                    </TouchableOpacity>

                    {/* Decline appears ONLY if you're still invited AND lobby is open */}
                    {isInvitedOnly && isLobbyOpen && (
                      <TouchableOpacity
                        style={[styles.secondaryBtn, busy && { opacity: 0.6 }]}
                        disabled={busy === "decline"}
                        onPress={handleDecline}
                      >
                        <Text style={[styles.secondaryBtnText, { fontFamily: "Tektur_700Bold" }]}>Decline</Text>
                      </TouchableOpacity>
                    )}
                  </>
                )}
              </View>

              {/* If invited but lobby not in 'lobby' status, show why Decline isn't available */}
              {isInvitedOnly && !isLobbyOpen && (
                <Text style={{ textAlign: "center", marginTop: 6, fontSize: 12, color: "#ef4444", fontFamily: "Tektur_400Regular" }}>
                  Invites can only be declined while the challenge is in lobby.
                </Text>
              )}
            </>
          )}

          {loading && (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator />
            </View>
          )}
        </>
      )}
    </View>
  );
}

/* -------------------- Lobby arena (status = lobby) -------------------- */
function LobbyArena({ tournament, acceptedParticipants, pendingParticipants, usersById, heightOverride }) {
  const screenW = Dimensions.get("window").width;
  const whistle = useAudioPlayer(require("../../assets/sounds/final_whistle.wav"));
  const containerW = screenW - 24 - 24;
  const pitchW = containerW - 4;
  const totalAvatars = (acceptedParticipants?.length || 0) + (pendingParticipants?.length || 0);
  const naturalPitchH = 220 + Math.min(160, totalAvatars * 8);
  const pitchH = heightOverride ?? naturalPitchH;

  // layout params
  const arenaPadding = 18;
  const avatarSize = 36;
  const radius = avatarSize / 2;
  const minGap = 8;
  const minDist = avatarSize + minGap;

  const minX = arenaPadding + radius;
  const maxX = pitchW - arenaPadding - radius;
  const minY = arenaPadding + radius;
  const maxY = pitchH - arenaPadding - radius;

  // merge two lists (we'll style by status)
  const accepted = (acceptedParticipants || []).map((p) => ({
    ...(usersById[p.id] || p || { id: p.id }),
    _status: "accepted",
  }));
  const pending = (pendingParticipants || []).map((p) => ({
    ...(usersById[p.id] || p || { id: p.id }),
    _status: "pending",
  }));
  const avatars = [...accepted, ...pending];

  // non-overlapping stable positions
  const placeNonOverlapping = () => {
    const placed = [];
    avatars.forEach((u) => {
      const baseSeed = strHash(String(tournament.id) + ":lobby:" + String(u.id));
      let attempt = 0;
      let placedPos = null;
      while (attempt < 200 && !placedPos) {
        const sx = seededRand(baseSeed + 97 * (attempt + 1));
        const sy = seededRand(baseSeed + 131 * (attempt + 1));
        const cx = minX + sx * (maxX - minX);
        const cy = minY + sy * (maxY - minY);
        let ok = true;
        for (const p of placed) {
          const dx = p.cx - cx;
          const dy = p.cy - cy;
          if (dx * dx + dy * dy < minDist * minDist) {
            ok = false;
            break;
          }
        }
        if (ok) placedPos = { id: u.id, cx, cy };
        attempt++;
      }
      if (!placedPos) {
        const sx = seededRand(baseSeed + 7777);
        const sy = seededRand(baseSeed + 8888);
        const cx = minX + sx * (maxX - minX);
        const cy = minY + sy * (maxY - minY);
        placedPos = { id: u.id, cx, cy };
      }
      placed.push(placedPos);
    });
    return placed.map(({ id, cx, cy }) => ({
      id,
      x: cx - radius,
      y: cy - radius,
    }));
  };
  const avatarPositions = placeNonOverlapping();

  // pop-in animation per avatar (nice join effect)
  const scaleMapRef = useRef({});
  avatars.forEach((u) => {
    if (!scaleMapRef.current[u.id]) {
      scaleMapRef.current[u.id] = new Animated.Value(0);
      Animated.spring(scaleMapRef.current[u.id], {
        toValue: 1,
        friction: 5,
        tension: 120,
        useNativeDriver: true,
      }).start();
    }
  });

  // NEW: Title + subtitle with fixed min-height for alignment
  const ownerUser = usersById[tournament.owner_id] || {};
  const ownerLabel = ownerUser.full_name || null;

  return (
    <View style={{ marginTop: 0 }}>
      <View style={{ alignItems: "center", marginBottom: 6, minHeight: TITLE_BLOCK_MIN_H, justifyContent: "center" }}>
        <Text style={{ fontWeight: "800", color: "#002d68ff", marginBottom: 6, fontFamily: "Tektur_800ExtraBold" }}>Lobby</Text>
        {ownerLabel && (
          <View style={styles.creatorChip}>
            <Text style={[styles.creatorChipText, { fontFamily: "Tektur_400Regular" }]}>
              Challenge Creator: {ownerLabel}
            </Text>
          </View>
        )}
      </View>
      <View style={[styles.arenaContainer, { paddingVertical: 6 }]}>
        <View style={[styles.pitch, { height: pitchH, borderRadius: 20, width: pitchW }]}>
          {/* pitch lines */}
          <View style={styles.pitchBorderOuter} />
          <View style={styles.pitchBorderInner} />
          <View style={styles.pitchHalfLine} />
          <View style={styles.pitchCenterCircle} />

          {/* avatars */}
          {avatars.map((u) => {
            const pos = avatarPositions.find((p) => p.id === u.id) || { x: 20, y: 20 };
            const scale = scaleMapRef.current[u.id] || new Animated.Value(1);
            const isPending = u._status !== "accepted";
            return (
              <Animated.View
                key={u.id}
                style={[
                  styles.avatarAbsWrap,
                  {
                    left: pos.x,
                    top: pos.y,
                    width: 36,
                    height: 36,
                    transform: [{ scale }],
                    borderColor: isPending ? "#64748b" : "#0077ffff", // gray for invited, blue for joined
                    opacity: isPending ? 0.7 : 1,
                    overflow: "hidden",
                  },
                ]}
              >
                {u.profile_photo_url ? (
                  <Image source={{ uri: u.profile_photo_url }} style={styles.avatarInnerMask} />
                ) : (
                  <View style={[styles.userAvatarArena, { backgroundColor: "#17202a" }]} />
                )}
              </Animated.View>
            );
          })}
        </View>
      </View>

      {/* tiny legend with fixed min-height for alignment */}
      <View
        style={{
          flexDirection: "row",
          gap: 14,
          justifyContent: "center",
          marginTop: 2,
          minHeight: BOTTOM_BLOCK_MIN_H,
          alignItems: "center",
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <View style={{ width: 10, height: 10, borderRadius: 10, backgroundColor: "#0077ffff" }} />
          <Text style={{ color: "#94a3b8", fontSize: 12, fontFamily: "Tektur_400Regular" }}>Joined</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <View style={{ width: 10, height: 10, borderRadius: 10, backgroundColor: "#64748b" }} />
          <Text style={{ color: "#94a3b8", fontSize: 12, fontFamily: "Tektur_400Regular" }}>Invited</Text>
        </View>
      </View>
    </View>
  );
}

/* ----------------------------- Pagination dots ----------------------------- */
function PaginationDots({ total, index }) {
  if (!Number.isFinite(total) || total <= 1) return null;
  return (
    <View style={styles.dotsRow}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={[styles.dot, i === index && styles.dotActive]}
        />
      ))}
    </View>
  );
}

/* ------------------------- Swipeable rounds + arena ------------------------ */
function SwipeableArena({
  tournament,
  userId,
  roundsAsc,
  roundsDesc,
  participants,
  entriesByRound,
  usersById,
  playersById,
  totalPointsByUserAll,
  pulse,
  onPlay,
  onForceRefresh,
}) {
  const screenW = Dimensions.get("window").width;

  const winnerUserId = tournament?.winner_user_id || null;

  // 🔔 Show final result alert ONCE per user per tournament
  const alertShownRef = React.useRef(false);
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (
        tournament.status === "finished" &&
        winnerUserId &&
        userId &&
        !alertShownRef.current
      ) {
        const already = await hasSeenFinishAlert(tournament.id, userId);
        if (cancelled || already) return;

        // Build message
        const winner = usersById[winnerUserId] || {};
        const winnerName = winner.full_name || winner.email || "Winner";
        const challengeName = tournament.name || "Challenge";
        const stake = Number(tournament.stake_points || 0);
        const acceptedCount = participants.filter(
          (p) => (p.invite_status || "").toLowerCase() === "accepted"
        ).length;
        const pot = stake * acceptedCount;

        let message = "";
        if (userId === winnerUserId) {
          message = `Congratulations ${winnerName}! You conquered "${challengeName}" and managed to survive until the end. Bragging rights are yours! 🌟`;
          if (stake > 0) message += ` 💰 You take a pot of ${pot} points. 💰`;
        } else {
          message = `Shamefully defeated in "${challengeName}" 😔 Bow before ${winnerName}. Train harder and return stronger.`;
          if (stake > 0) message += ` 💸 You lost ${stake} points. 💸`;
        }

        // Mark as seen immediately (prevents re-entrancy if user navigates fast)
        alertShownRef.current = true;
        await markSeenFinishAlert(tournament.id, userId);

        // Play final whistle exactly when the win/lose alert shows
        try {
          whistle.seekTo(0);
          whistle.play();
        } catch { }

        // Show the required “OK”-only alert
        const title = userId === winnerUserId ? "🏆 Victory!" : "💀 Defeat";
        Alert.alert(title, message, [{ text: "OK" }]);
      }
    })();

    return () => { cancelled = true; };
  }, [tournament.status, winnerUserId, userId, participants, usersById, tournament.id, tournament.stake_points]);

  const acceptedCount = participants.filter(
    (p) => (p.invite_status || "").toLowerCase() === "accepted"
  ).length;
  const pot = Number(tournament?.stake_points || 0) * Number(acceptedCount || 0);
  const stake = Number(tournament?.stake_points || 0);

  const containerW = screenW - 24 - 24; // prevent right-edge cut
  const [page, setPage] = useState(0);

  // --- unified height across slides (ROUNDS)
  const maxStartedCount = useMemo(() => {
    let max = 0;
    for (const r of roundsDesc) {
      const ids = Array.isArray(r.users_participated) ? r.users_participated : [];
      if (ids.length > max) max = ids.length;
    }
    return max;
  }, [roundsDesc]);
  const baseH = 220;
  const unifiedPitchH_Rounds = baseH + Math.min(160, maxStartedCount * 8);

  // --- compute accepted/pending (for lobby slide when live/finished)
  const acceptedParticipants = useMemo(
    () => participants.filter((p) => (p.invite_status || "").toLowerCase() === "accepted"),
    [participants]
  );
  const pendingParticipants = useMemo(
    () =>
      participants.filter(
        (p) =>
          p.invite_status &&
          (p.invite_status.toLowerCase() === "invited" ||
            p.invite_status.toLowerCase() === "pending")
      ),
    [participants]
  );

  // --- LOBBY pitch height (usually highest), then take MAX with rounds
  const totalLobbyAvatars = acceptedParticipants.length + pendingParticipants.length;
  const lobbyPitchH = baseH + Math.min(160, totalLobbyAvatars * 8);
  const unifiedPitchHAll = Math.max(unifiedPitchH_Rounds, lobbyPitchH);

  // slides: winner first (if finished), then newest → older rounds, then keep lobby slide
  const slides = useMemo(() => {
    const arr = roundsDesc.map((r) => ({ type: "round", round: r }));
    if (tournament.status === "finished" && winnerUserId) {
      arr.unshift({ type: "winner" });
    }
    // keep lobby as part of swipe when not in lobby status
    arr.push({ type: "lobby" });
    return arr;
  }, [roundsDesc, tournament.status, winnerUserId]);

  // Ensure RoundSlide can compute cumulative points accurately
  RoundSlide.__entriesByRound__ = entriesByRound;

  return (
    <View style={{ marginTop: 6 }}>
      {/* ---- Pagination dots OUTSIDE the slide card ---- */}
      <View style={{ width: containerW, alignSelf: "center", marginBottom: 6 }}>
        <PaginationDots total={slides.length} index={page} />
      </View>

      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        snapToInterval={containerW}
        decelerationRate="fast"
        contentContainerStyle={{ paddingVertical: 4 }}
        scrollEventThrottle={16}
        onScroll={({ nativeEvent }) => {
          const i = Math.round((nativeEvent.contentOffset?.x || 0) / containerW);
          if (i !== page) setPage(i);
        }}
      >
        {slides.map((slide) => {
          const containerStyle = { width: containerW };

          if (slide.type === "winner") {
            const winner = usersById[winnerUserId] || { id: winnerUserId };
            const name = winner?.full_name || winner?.email || "Winner";
            return (
              <View key={`winner-${tournament.id}`} style={containerStyle}>

                <View style={{ alignItems: "center", marginBottom: 6, minHeight: TITLE_BLOCK_MIN_H, justifyContent: "center" }}>
                  <Text style={{ fontWeight: "800", color: "#a89500ff", marginBottom: 6, fontFamily: "Tektur_800ExtraBold" }}>Challenge Winner</Text>
                  <View style={styles.winnerChip}>
                    <Text style={[styles.winnerChipText, { fontFamily: "Tektur_400Regular" }]}>{winner?.full_name}</Text>
                  </View>
                </View>
                <WinnerPitch pulse={pulse} winner={winner} pitchW={containerW - 4} pitchH={unifiedPitchHAll} />
                <View style={{ marginTop: 8, alignItems: "center", minHeight: BOTTOM_BLOCK_MIN_H, justifyContent: "center" }}>
                  <Text
                    style={{
                      color: "#a89500ff",
                      textAlign: "center",
                      fontWeight: "700",
                      lineHeight: 20,
                      fontFamily: "Tektur_400Regular",
                    }}
                  >
                    {stake > 0 ? `${name} takes the crown!` : `${name} takes the crown!`}
                  </Text>
                </View>
              </View>
            );
          }

          if (slide.type === "lobby") {
            return (
              <View key={`lobby-${tournament.id}`} style={containerStyle}>
                <LobbyArena
                  tournament={tournament}
                  acceptedParticipants={acceptedParticipants}
                  pendingParticipants={pendingParticipants}
                  usersById={usersById}
                  heightOverride={unifiedPitchHAll}
                />
              </View>
            );
          }

          // ---- Round slide (refactored into its own component to safely use hooks like useCountdown)
          const r = slide.round;
          return (
            <View key={r.id} style={[containerStyle, { position: "relative" }]}>
              <RoundSlide
                containerStyle={{}} // RoundSlide already wraps with its own containerStyle prop
                tournament={tournament}
                userId={userId}
                round={r}
                roundsAsc={roundsAsc}
                participants={participants}
                entries={entriesByRound[r.id] || []}
                usersById={usersById}
                playersById={playersById}
                pulse={pulse}
                containerW={containerW}
                unifiedPitchHAll={unifiedPitchHAll}
                onPlay={onPlay}
                onForceRefresh={onForceRefresh}
              />
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

/* ---------------- Round slide (separate so we can use hooks safely) ---------------- */
function RoundSlide({
  containerStyle,
  tournament,
  userId,
  round,
  roundsAsc,
  participants,
  entries,
  usersById,
  playersById,
  pulse,
  containerW,
  unifiedPitchHAll,
  onPlay,
  onForceRefresh,
}) {
  const r = round;
  const isLiveTournament = tournament?.status === "live";

  // participants for this round from users_participated (fallback to entries if null)
  const roundUserIds = Array.isArray(r.users_participated) && r.users_participated.length
    ? r.users_participated
    : Array.from(
      new Set(
        entries
          .filter((e) => e.started === true || e.points_earned !== null)
          .map((e) => e.user_id)
      )
    );
  const participantsThisRoundCount = roundUserIds.length;

  const eliminatedByRound = new Set(
    participants
      .filter(
        (p) =>
          Number.isFinite(p.eliminated_at_round) &&
          p.eliminated_at_round <= r.round_number
      )
      .map((p) => p.id)
  );

  const roundPts = new Map(entries.map((e) => [e.user_id, Number(e.points_earned) || 0]));
  const playedThisRound = new Set(entries.filter((e) => !!e.game_record_id).map((e) => e.user_id));
  const youPlayed = userId ? playedThisRound.has(userId) : false;

  // ⬇️ Add this inside RoundSlide (near the other consts), so we can use it below
  const youEliminatedRound = React.useMemo(() => {
    const me = participants.find((p) => p.id === userId);
    const val = me?.eliminated_at_round;
    return Number.isFinite(val) ? val : null;
  }, [participants, userId]);

  // Build block-aware cumulative points that reset on the FIRST round AFTER an elimination round.
  // We sum from (last elimination round strictly BEFORE this round) + 1  → current round (inclusive).
  const eb = RoundSlide.__entriesByRound__;
  const cum = new Map();

  if (eb && Array.isArray(roundsAsc)) {
    const idxCur = roundsAsc.findIndex((rr) => rr.id === r.id);

    // Find the nearest elimination round strictly BEFORE the current round.
    // If found at index i, start summing at i+1. If none found, start at 0.
    let startIdx = 0;
    for (let i = idxCur - 1; i >= 0; i--) {
      const rr = roundsAsc[i];
      if (rr?.is_elimination) {
        startIdx = i + 1; // reset happens on the first round AFTER an elimination round
        break;
      }
    }

    // Sum from startIdx → idxCur (inclusive)
    for (let i = startIdx; i <= idxCur; i++) {
      const rr = roundsAsc[i];
      const arr = eb[rr.id] || [];
      for (const e of arr) {
        cum.set(e.user_id, (cum.get(e.user_id) || 0) + (Number(e.points_earned) || 0));
      }
    }
  }

  const cumPoints = cum;

  const [tableOpen, setTableOpen] = useState(false);

  const tableRows = useMemo(() => {
    // Build rows from users who participated in this round (roundUserIds)
    const rows = roundUserIds.map((uid) => {
      const u = usersById[uid] || { id: uid, full_name: "User" };
      const name = u.full_name || u.email || "User";
      const acc = Number(cumPoints.get(uid) || 0);
      const rnd = Number(roundPts.get(uid) || 0);
      const played = playedThisRound.has(uid);
      return { id: uid, name, acc, rnd, played };
    });

    // Sort by accumulated points (descending)
    rows.sort((a, b) => b.acc - a.acc || b.rnd - a.rnd || a.name.localeCompare(b.name));
    return rows;
  }, [roundUserIds, usersById, cumPoints, roundPts, playedThisRound]);

  const activeUserIds = roundUserIds.filter((uid) => !eliminatedByRound.has(uid));

  let minCum = Infinity;
  for (const uid of activeUserIds) {
    const v = cumPoints.get(uid) || 0;
    if (v < minCum) minCum = v;
  }
  const lowestCumUsers = new Set(
    activeUserIds.filter((uid) => (cumPoints.get(uid) || 0) === minCum)
  );

  const avatars = roundUserIds.map((uid) => {
    return usersById[uid] || { id: uid, profile_photo_url: "", email: "User" };
  });

  // --- Use the SAME layout + seed as Lobby so positions persist across rounds
  const arenaPadding = 18;
  const avatarSize = 36; // match Lobby
  const radius = avatarSize / 2;
  const pitchW = containerW - 4;
  const pitchH = unifiedPitchHAll;
  const minGap = 8; // match Lobby
  const minDist = avatarSize + minGap;

  const minX = arenaPadding + radius;
  const maxX = pitchW - arenaPadding - radius;
  const minY = arenaPadding + radius;
  const maxY = pitchH - arenaPadding - radius;

  const placeNonOverlapping = () => {
    const placed = [];
    avatars.forEach((u) => {
      // SAME seed as Lobby: tournament.id + ":lobby:" + user id
      const baseSeed = strHash(String(tournament.id) + ":lobby:" + String(u.id));
      let attempt = 0;
      let placedPos = null;
      while (attempt < 200 && !placedPos) {
        const sx = seededRand(baseSeed + 97 * (attempt + 1));
        const sy = seededRand(baseSeed + 131 * (attempt + 1));
        const cx = minX + sx * (maxX - minX);
        const cy = minY + sy * (maxY - minY);
        let ok = true;
        for (const p of placed) {
          const dx = p.cx - cx;
          const dy = p.cy - cy;
          if (dx * dx + dy * dy < minDist * minDist) { ok = false; break; }
        }
        if (ok) placedPos = { id: u.id, cx, cy };
        attempt++;
      }
      if (!placedPos) {
        const sx = seededRand(baseSeed + 7777);
        const sy = seededRand(baseSeed + 8888);
        const cx = minX + sx * (maxX - minX);
        const cy = minY + sy * (maxY - minY);
        placedPos = { id: u.id, cx, cy };
      }
      placed.push(placedPos);
    });
    return placed.map(({ id, cx, cy }) => ({ id, x: cx - radius, y: cy - radius }));
  };

  const avatarPositions = placeNonOverlapping();

  // --- NEW: Countdown for live rounds subtitle
  const liveCountdown = useCountdown(!r.closed_at ? r.ends_at : null);
  const countdownEnded = !r.closed_at && !!r.ends_at && liveCountdown === "—";

  const [showEndedBanner, setShowEndedBanner] = useState(false);

  // When countdown hits zero (returns "—") and round isn't closed yet,
  // show "Round Ended" and force a refresh so the next round appears.
  const endedRef = useRef(false);

  // Consider the round "ended" if (a) DB marked it closed, (b) everyone who should play has played, or (c) timer hit zero.
  const allPlayed =
    Array.isArray(roundUserIds) &&
    roundUserIds.length > 0 &&
    roundUserIds.every((uid) => playedThisRound.has(uid));

  const roundEndedNow = !!r.closed_at || allPlayed || countdownEnded;
  const isLatestRound = roundsAsc[roundsAsc.length - 1]?.id === r.id;

  // Fire once when a round ends (any reason): show overlay and refresh
  useEffect(() => {
    if (isLiveTournament && isLatestRound && roundEndedNow && !endedRef.current) {
      endedRef.current = true;

      // Overlay for ~2.5s
      setShowEndedBanner(true);
      const hideT = setTimeout(() => setShowEndedBanner(false), 2500);

      // Let parent refresh so the next round appears
      onForceRefresh && onForceRefresh();

      return () => clearTimeout(hideT);
    }
  }, [roundEndedNow, onForceRefresh, isLiveTournament]);

  return (
    <View style={containerStyle}>
      {/* Above the arena: round & survivors left (fixed min-height) */}
      <View style={{ alignItems: "center", marginBottom: 6, minHeight: TITLE_BLOCK_MIN_H, justifyContent: "center" }}>
        <Text
          style={{
            fontWeight: "800",
            color: r.is_elimination ? "#8d0000ff" : "#000000ff", // 🔴 red if elimination
            marginBottom: 6,
            fontFamily: "Tektur_800ExtraBold",
          }}
        >
          Round {r.round_number} {r.is_elimination ? "🪓" : ""}
        </Text>

        <ReverseTimerBar
          endAt={r.ends_at}
          totalSeconds={tournament.round_time_limit_seconds}
          forceEnded={roundEndedNow}           // <= NEW: makes the bar show "Round Ended" immediately
        />

      </View>

      {/* Centered modal-style alert like your screenshot */}
      {showEndedBanner && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(0,0,0,0.30)", // dim backdrop
            zIndex: 50,
          }}
        >
          <View
            style={{
              width: 280,
              borderRadius: 16,
              backgroundColor: "#ffffff",
              paddingVertical: 18,
              paddingHorizontal: 18,
              alignItems: "center",
              // soft shadow
              shadowColor: "#000",
              shadowOpacity: 0.18,
              shadowRadius: 18,
              elevation: 8,
            }}
          >
            <Text style={{ fontSize: 34, marginBottom: 6, fontFamily: "Tektur_400Regular" }}>⏳</Text>
            <Text
              style={{
                fontSize: 18,
                fontWeight: "800",
                color: "#111827",
                marginBottom: 4,
                fontFamily: "Tektur_800ExtraBold",
              }}
            >
              Round Ended!
            </Text>
            <Text style={{ fontSize: 14, color: "#6B7280", textAlign: "center", fontFamily: "Tektur_400Regular" }}>
              Get back to the arena!
            </Text>
          </View>
        </View>
      )}

      {/* Single arena with avatars */}
      <ArenaPitch
        heightOverride={pitchH}
        pulse={pulse}
        pitchId={r.id}
        pitchW={pitchW}
        pitchH={pitchH}
        avatars={avatars}
        avatarPositions={avatarPositions}
        roundPts={roundPts}
        cumPointsAtRound={cumPoints}
        lowestCumUsers={lowestCumUsers}
        playedThisRound={playedThisRound}
        isElimination={r.is_elimination}
      />

      {/* Legend below arena */}
      <View
        style={{
          flexDirection: "row",
          gap: 14,
          justifyContent: "center",
          marginTop: 6,
          minHeight: 28,
          alignItems: "center",
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <View style={{ width: 10, height: 10, borderRadius: 10, backgroundColor: "#10b981" }} />
          <Text style={{ color: "#94a3b8", fontSize: 12, fontFamily: "Tektur_400Regular" }}>Safe</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <View style={{ width: 10, height: 10, borderRadius: 10, backgroundColor: "#ef4444" }} />
          <Text style={{ color: "#94a3b8", fontSize: 12, fontFamily: "Tektur_400Regular" }}>In danger</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Text style={{ fontSize: 14, fontFamily: "Tektur_400Regular" }}>🔆</Text>
          <Text style={{ color: "#94a3b8", fontSize: 12, fontFamily: "Tektur_400Regular" }}>Played</Text>
        </View>
      </View>


      {/* Under arena: finished => player info or live => Play (fixed min-height) */}
      <View style={{ marginTop: 8, alignItems: "center", minHeight: BOTTOM_BLOCK_MIN_H, justifyContent: "center" }}>
        {!r.closed_at ? (
          youPlayed ? (
            <Text style={{ color: "#000000ff", fontSize: 12, fontFamily: "Tektur_400Regular" }}>Was this enough to keep you from being chopped?</Text>
          ) : youEliminatedRound && youEliminatedRound <= r.round_number ? (
            <View style={styles.elimChip}>
              <Text style={[styles.elimChipText, { fontFamily: "Tektur_400Regular" }]}>Eliminated on Round {youEliminatedRound}</Text>
            </View>
          ) : (
            <TouchableOpacity onPress={onPlay} style={[styles.primaryBtn, { alignSelf: "center" }]}>
              <Text style={[styles.primaryBtnText, { fontFamily: "Tektur_400Regular" }]}>Play to Survive</Text>
            </TouchableOpacity>
          )
        ) : (

          (() => {
            const p = playersById[r.player_id];
            return (
              <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
                {p?.photo ? (
                  <Image
                    source={{ uri: p.photo }}
                    style={{ width: 44, height: 44, borderRadius: 8, backgroundColor: "#17202a" }}
                  />
                ) : (
                  <View
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 8,
                      backgroundColor: "#17202a",
                    }}
                  />
                )}
                <View>
                  <Text style={{ color: "#4e4e4eff", fontWeight: "800", fontSize: 14, fontFamily: "Tektur_400Regular" }}>
                    {p?.name || "Round Player"}
                  </Text>
                  {(p?.nationality || p?.position) && (
                    <Text style={{ color: "#6b7280", fontSize: 12, fontFamily: "Tektur_400Regular" }}>
                      {[p?.nationality, p?.position].filter(Boolean).join(" • ")}
                    </Text>
                  )}
                </View>
              </View>

            );
          })()
        )}
      </View>
      {/* --- Collapsible per-round standings table --- */}
      <View style={{ marginTop: 10 }}>
        <TouchableOpacity
          onPress={() => setTableOpen((v) => !v)}
          activeOpacity={0.85}
          style={{
            alignSelf: "center",
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: "#334155",
            backgroundColor: "#0a0f0b",
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "800", fontFamily: "Tektur_400Regular" }}>
            {tableOpen ? "Hide" : "Show"} Round Standings
          </Text>
        </TouchableOpacity>

        {tableOpen && (
          <View style={styles.tableWrap}>
            {/* header */}
            <View style={[styles.tableRow, styles.tableHeader]}>
              <Text style={[styles.tableCellName, { fontWeight: "800", fontFamily: "Tektur_400Regular" }]}>Name</Text>
              <Text style={[styles.tableCellSmall, { fontWeight: "800", fontFamily: "Tektur_400Regular" }]}>Accum.</Text>
              <Text style={[styles.tableCellSmall, { fontWeight: "800", fontFamily: "Tektur_400Regular" }]}>Curr.</Text>
              <Text style={[styles.tableCellSmall, { fontWeight: "800", fontFamily: "Tektur_400Regular" }]}>Played</Text>
            </View>

            {/* rows */}
            {tableRows.map((row) => (
              <View key={row.id} style={styles.tableRow}>
                <Text numberOfLines={1} style={[styles.tableCellName, { fontFamily: "Tektur_400Regular" }]}>
                  {row.name}
                </Text>
                <Text style={[styles.tableCellSmall, { fontFamily: "Tektur_400Regular" }]}>{row.acc}</Text>
                <Text style={[styles.tableCellSmall, { fontFamily: "Tektur_400Regular" }]}>{row.rnd}</Text>
                <View style={[styles.tableCellSmall, { alignItems: "flex-end" }]}>
                  {row.played ? (
                    <View style={styles.playedPill}>
                      <Text style={{ color: "#0b0b0b", fontWeight: "800", fontSize: 10, fontFamily: "Tektur_400Regular" }}>✔️</Text>
                    </View>
                  ) : (
                    <Text style={{ color: "#94a3b8", fontSize: 12, fontFamily: "Tektur_400Regular" }}>⭕</Text>
                  )}
                </View>
              </View>
            ))}
          </View>
        )}
      </View>

    </View>
  );
}

/* Attach entriesByRound so RoundSlide can compute cumulative points across rounds */
RoundSlide.__entriesByRound__ = {};

/* ---------------- Winner “pitch” slide (centered avatar + crown above) --------------- */
function WinnerPitch({ pulse, winner, pitchW, pitchH }) {
  return (
    <View style={[styles.arenaContainer, { paddingVertical: 6 }]}>
      <Animated.View
        style={[
          styles.pitch,
          { height: pitchH, borderRadius: 20, position: "relative", width: pitchW },
          {
            shadowOpacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.08, 0.25] }),
            shadowRadius: pulse.interpolate({ inputRange: [0, 1], outputRange: [4, 10] }),
          },
        ]}
      >
        {/* Football pitch lines */}
        <View style={styles.pitchBorderOuter} />
        <View style={styles.pitchBorderInner} />
        <View style={styles.pitchHalfLine} />
        <View style={styles.pitchCenterCircle} />

        {/* Crown ABOVE the avatar (not on it) */}
        <Text
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            marginLeft: -14,
            marginTop: -72,
            fontSize: 28,
            fontFamily: "Tektur_400Regular",
          }}
        >
          👑
        </Text>

        {/* Centered winner avatar */}
        <View
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            marginLeft: -36,
            marginTop: -36,
            width: 72,
            height: 72,
            borderRadius: 999,
            overflow: "hidden",
            borderWidth: 3,
            borderColor: "#f59e0b",
            backgroundColor: "#1f2937",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {winner?.profile_photo_url ? (
            <Image
              source={{ uri: winner.profile_photo_url }}
              style={{ width: "100%", height: "100%" }}
            />
          ) : (
            <View
              style={{ width: "100%", height: "100%", backgroundColor: "#17202a" }}
            />
          )}
        </View>
      </Animated.View>
    </View>
  );
}

/* ---------------------------- Arena visualization ---------------------------- */
function ArenaPitch({
  heightOverride,
  pulse,
  pitchId,
  pitchW,
  pitchH,
  avatars,
  avatarPositions,
  roundPts,
  cumPointsAtRound,
  lowestCumUsers,
  playedThisRound,
  isElimination
}) {
  const [tooltip, setTooltip] = useState(null); // { id, x, y }
  const [tooltipSize, setTooltipSize] = useState({ w: 0, h: 0 });

  const clamp = (val, min, max) => Math.max(min, Math.min(max, val));

  const handleAvatarPress = (u, pos) => {
    if (tooltip && tooltip.id === u.id) {
      setTooltip(null);
    } else {
      const desiredLeft = pos.x + 24;
      const desiredTop = Math.max(6, pos.y - 6);
      setTooltip({
        id: u.id,
        x: desiredLeft,
        y: desiredTop,
      });
    }
  };

  const tooltipStyle = (() => {
    if (!tooltip) return null;
    const margin = 6;
    const w = tooltipSize.w || 180;
    const h = tooltipSize.h || 80;
    const left = clamp(tooltip.x, margin, (pitchW || 280) - w - margin);
    const top = clamp(tooltip.y, margin, (pitchH || (heightOverride || 240)) - h - margin);
    return { left, top };
  })();

  return (
    <Animated.View style={[styles.arenaContainer, heightOverride ? { paddingVertical: 6 } : null,
    {
      shadowOpacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.08, 0.85] }),
      shadowRadius: pulse.interpolate({ inputRange: [0, 1], outputRange: [5, 15] }),
      shadowColor: isElimination ? "#ef4444" : "#a5f8ddff", // 🔴 red pulse if elimination
      borderColor: isElimination ? "rgba(239,68,68,0.25)" : "rgba(16,185,129,0.25)",
    },
    ]}>
      <Animated.View
        style={[
          styles.pitch,
          heightOverride ? { height: heightOverride, borderRadius: 20, width: pitchW } : { width: pitchW },
          {
            shadowOpacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.08, 0.85] }),
            shadowRadius: pulse.interpolate({ inputRange: [0, 1], outputRange: [5, 15] }),
            shadowColor: isElimination ? "#ef4444" : "#10b981", // 🔴 red pulse if elimination
            borderColor: isElimination ? "rgba(239,68,68,0.25)" : "rgba(16,185,129,0.25)",
          },
        ]}
      >
        {/* Football pitch lines */}
        <View style={styles.pitchBorderOuter} />
        <View style={styles.pitchBorderInner} />
        <View style={styles.pitchHalfLine} />
        <View style={styles.pitchCenterCircle} />

        {/* Avatars */}
        {avatars.map((u) => {
          const pos = avatarPositions.find((p) => p.id === u.id) || { x: 20, y: 20 };
          const isLowest = lowestCumUsers.has(u.id);
          const played = playedThisRound.has(u.id);
          const baseColor = isLowest ? "#ef4444" : "#10b981"; // red (to be eliminated) / green (safe)

          return (
            <TouchableOpacity
              key={u.id}
              onPress={() => handleAvatarPress(u, pos)}
              activeOpacity={0.85}
              style={[
                styles.avatarAbsWrap,
                {
                  left: pos.x,
                  top: pos.y,
                  borderColor: baseColor,
                  borderWidth: 2,
                },
              ]}
            >
              {/* ⭐ Star behind the avatar (can extend outside the circle) */}
              {played && (
                <View pointerEvents="none" style={styles.playedStar}>
                  <Text style={[styles.playedStarGlyph, { fontFamily: "Tektur_400Regular" }]}>🔆</Text>
                </View>
              )}

              {/* Inner circular mask for the image */}
              <View style={styles.avatarInnerMask}>
                {u.profile_photo_url ? (
                  <Image source={{ uri: u.profile_photo_url }} style={[styles.userAvatarArena, { zIndex: 1 }]} />
                ) : (
                  <View style={[styles.userAvatarArena, { backgroundColor: "#17202a", zIndex: 1 }]} />
                )}
              </View>
            </TouchableOpacity>
          );
        })}


        {/* Clicking anywhere outside the tooltip closes it */}
        {tooltip && (
          <Pressable
            style={[StyleSheet.absoluteFill, { zIndex: 5 }]}
            onPress={() => setTooltip(null)}
          />
        )}

        {/* Tooltip */}
        {tooltip && (() => {
          const u = avatars.find((x) => x.id === tooltip.id);
          if (!u) return null;
          const fullName = u.full_name || u.email || "User";
          const acc = cumPointsAtRound.get(u.id) || 0;
          const rp = Number.isFinite(roundPts.get(u.id)) ? roundPts.get(u.id) : 0;
          return (
            <View
              onLayout={(e) => {
                const { width, height } = e.nativeEvent.layout;
                if (width && height) setTooltipSize({ w: width, h: height });
              }}
              onStartShouldSetResponder={() => true}
              style={[
                styles.tooltipCard,
                { zIndex: 10 },
                tooltipStyle || { left: tooltip.x, top: tooltip.y },
              ]}
            >
              <Text style={[styles.tooltipTitle, { fontFamily: "Tektur_400Regular" }]}>{fullName}</Text>
              <Text style={[styles.tooltipRow, { fontFamily: "Tektur_400Regular" }]}>
                Accummulated: <Text style={[styles.tooltipStrong, { fontFamily: "Tektur_400Regular" }]}>{acc}</Text> pts
              </Text>
              <Text style={[styles.tooltipRow, { fontFamily: "Tektur_400Regular" }]}>
                Curr. round: <Text style={[styles.tooltipStrong, { fontFamily: "Tektur_400Regular" }]}>{rp}</Text> pts
              </Text>
            </View>
          );
        })()}
      </Animated.View>
    </Animated.View>
  );
}

/* --------------------------------- Styles -------------------------------- */
const styles = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },

  cardHeader: {
    flexDirection: "column",
    alignItems: "center",
    gap: 12,
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
    borderWidth: 1,
  },
  headerLive: {
    backgroundColor: "#fff",
    borderColor: "#e5e7eb",
  },
  headerUpcoming: {
    backgroundColor: "#fff",
    borderColor: "#e5e7eb",
  },
  headerFinished: {
    backgroundColor: "#fff",
    borderColor: "#e5e7eb",
  },

  cardTitle: { fontSize: 16, fontWeight: "800", color: "#000000ff" },
  cardSub: { fontSize: 12, color: "#166534" },

  chevron: {
    fontSize: 18,
    color: "#e2e8f0",
    marginLeft: 6,
  },

  arenaContainer: { paddingVertical: 6, paddingHorizontal: 2 },

  pitch: {
    height: 240,
    borderRadius: 20,
    position: "relative",
    backgroundColor: "#166534",
    borderWidth: 2,
    borderColor: "rgba(16,185,129,0.25)",
    shadowColor: "#10b981",
    overflow: "hidden",
  },

  // Faded pitch lines
  pitchBorderOuter: {
    position: "absolute",
    top: 8,
    bottom: 8,
    left: 8,
    right: 8,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: "rgba(16,185,129,0.18)",
  },
  pitchBorderInner: {
    position: "absolute",
    top: 20,
    bottom: 20,
    left: 20,
    right: 20,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "rgba(16,185,129,0.12)",
  },
  pitchHalfLine: {
    position: "absolute",
    left: "50%",
    top: 8,
    bottom: 8,
    width: 1,
    marginLeft: -0.5,
    backgroundColor: "rgba(16,185,129,0.15)",
  },
  pitchCenterCircle: {
    position: "absolute",
    width: 84,
    height: 84,
    borderRadius: 84 / 2,
    left: "50%",
    top: "50%",
    marginLeft: -42,
    marginTop: -42,
    borderWidth: 2,
    borderColor: "rgba(16,185,129,0.15)",
  },

  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginVertical: 8 },
  chip: {
    borderWidth: 1,
    borderColor: "#4e4e4eff",
    backgroundColor: "#ddddddff",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  chipLabel: { fontSize: 10, color: "#4e4e4eff" },
  chipValue: { fontSize: 12, fontWeight: "800", color: "#0a0f0b" },

  filtersBox: {
    borderWidth: 1,
    borderColor: "#4e4e4eff",
    backgroundColor: "#ddddddff",
    borderRadius: 10,
    padding: 8,
    marginTop: 6,
  },
  filtersTitle: { fontWeight: "800", color: "#e2e8f0" },

  primaryBtn: {
    backgroundColor: "#166534",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  primaryBtnText: { color: "#ffffffff", fontWeight: "800" },

  secondaryBtn: {
    backgroundColor: "#e5e7eb",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  secondaryBtnText: { color: "#111827", fontWeight: "800" },

  dotsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginBottom: 4,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#d1d5db", // gray-300
    opacity: 0.9,
  },
  dotActive: {
    backgroundColor: "#6b7280", // gray-500
  },

  joinedChip: {
    backgroundColor: "#064e3b",
    borderWidth: 1,
    borderColor: "#10b981",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  joinedChipText: { color: "#ecfeff", fontWeight: "800", fontSize: 12 },

  finishedChip: {
    backgroundColor: "#000000ff",
    borderWidth: 1,
    borderColor: "#10b981",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  finishedChipText: { color: "#10b981", fontWeight: "800", fontSize: 12 },

  upcomingChip: {
    backgroundColor: "#2f00ffff",
    borderWidth: 1,
    borderColor: "#ffffffff",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  upcomingChipText: { color: "#ffffffff", fontWeight: "800", fontSize: 12 },

  liveChip: {
    backgroundColor: "#0d8527ff",
    borderWidth: 1,
    borderColor: "#ffffffff",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  liveChipText: { color: "#ffffffff", fontWeight: "800", fontSize: 12 },

  elimChip: {
    backgroundColor: "#3f1a1a",
    borderWidth: 1,
    borderColor: "#fecaca",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  elimChipText: { color: "#fecaca", fontWeight: "800", fontSize: 12 },

  countdownChip: {
    backgroundColor: "#612727ff",
    borderWidth: 1,
    borderColor: "#fff",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  countdownChipText: { color: "#fff", fontWeight: "800", fontSize: 12 },

  winnerChip: {
    backgroundColor: "#a89500ff",
    borderWidth: 1,
    borderColor: "#fef08a",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  winnerChipText: { color: "#fef08a", fontWeight: "800", fontSize: 12 },

  creatorChip: {
    backgroundColor: "#0099ffff",
    borderWidth: 1,
    borderColor: "#000d2eff",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  creatorChipText: { color: "#000d2eff", fontWeight: "800", fontSize: 12 },

  smallMuted: { fontSize: 12, color: "#4e4e4eff" },
  bold: { fontWeight: "800" },

  errorBox: {
    borderWidth: 1,
    borderColor: "#fecaca",
    backgroundColor: "#3f1a1a",
    padding: 10,
    borderRadius: 10,
  },
  errorTitle: { fontWeight: "800", color: "#fecaca", marginBottom: 4 },
  errorText: { color: "#fecaca" },

  skeleton: {
    height: 110,
    borderRadius: 14,
    backgroundColor: "#0a0f0b",
    borderWidth: 1,
    borderColor: "#1f2937",
  },

  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(5,10,8,0.35)",
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 14,
  },

  bootOverlay: {
    position: "absolute",
    top: 0, right: 0, bottom: 0, left: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F0FDF4",
    zIndex: 999,
  },

  // Avatars (absolute jittered)
  avatarAbsWrap: {
    position: "absolute",
    width: 36,
    height: 36,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: "#334155",
    overflow: "visible",
    backgroundColor: "#1f2937",
  },
  userAvatarArena: { width: "100%", height: "100%" },

  // NEW: inner circular mask so only the image is clipped, not the star
  avatarInnerMask: {
    position: "relative",
    width: "100%",
    height: "100%",
    borderRadius: 999,
    overflow: "hidden",
    zIndex: 1,
  },

  playedStar: {
    position: "absolute",
    left: -10,
    top: -10,
    right: -10,
    bottom: -10,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 0, // behind the avatar image
  },
  playedStarGlyph: {
    // The star itself; big enough so points peek outside the 36x36 avatar
    fontSize: 40,
    lineHeight: 46,
    color: "#facc15",
    opacity: 0.85,
    textShadowColor: "rgba(0,0,0,0.35)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
    transform: [{ rotate: "0deg" }], // a tiny tilt for flair
  },

  tableWrap: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    backgroundColor: "#fff",
    borderRadius: 10,
    overflow: "hidden",
  },

  tableHeader: {
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },

  tableRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },

  tableCellName: {
    flex: 1,
    color: "#000000ff",
    fontSize: 12,
    marginRight: 8,
  },

  tableCellSmall: {
    width: 64,
    color: "#4e4e4eff",
    fontSize: 12,
    textAlign: "right",
  },

  playedPill: {
    backgroundColor: "#facc15",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#d4af0a",
  },

  // Tooltip next to avatar
  tooltipCard: {
    position: "absolute",
    minWidth: 160,
    maxWidth: 220,
    backgroundColor: "rgba(5,12,9,0.96)",
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.35)",
  },
  tooltipTitle: { color: "#e2e8f0", fontWeight: "800", marginBottom: 2 },
  tooltipRow: { color: "#94a3b8", fontSize: 12, marginTop: 2 },
  tooltipStrong: { color: "#e2e8f0", fontWeight: "800" },

});


/* ---------------------------- helpers components --------------------------- */
function InfoChip({ label, value, tone }) {
  const border =
    tone === "danger" ? { borderColor: "#7f1d1d", backgroundColor: "#3f1a1a" } : undefined;
  const valueColor = tone === "danger" ? { color: "#fecaca" } : undefined;
  return (
    <View style={[styles.chip, border]}>
      <Text style={[styles.chipLabel, valueColor, { fontFamily: "Tektur_400Regular" }]}>{label}</Text>
      <Text style={[styles.chipValue, valueColor, { fontFamily: "Tektur_700Bold" }]}> {value}</Text>
    </View>
  );
}
