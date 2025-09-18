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
} from "react-native";
import { supabase } from "../../lib/supabase";
import { useRouter } from "expo-router";

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

/* ---------------------- Per-card realtime (minimal & fast) ---------------------- */
/**
 * Subscribes to realtime changes for a single tournament card.
 * Debounced refetch on:
 *   - elimination_participants (join/accept/decline/state)
 *   - elimination_rounds       (status/closed_at/ends_at updates)
 *   - elimination_round_entries (started/game_record_id/points)
 *   - elimination_tournaments   (status/name/filters/etc.)
 */
function useRealtimeTournament({ tournamentId, roundIds, onChange }) {
  const debouncedRefetchTimer = useRef(null);

  const refetchSoon = useCallback(() => {
    if (debouncedRefetchTimer.current) clearTimeout(debouncedRefetchTimer.current);
    debouncedRefetchTimer.current = setTimeout(() => {
      onChange && onChange();
    }, 250);
  }, [onChange]);

  const roundIdSet = useMemo(() => new Set((roundIds || []).filter(Boolean)), [roundIds]);

  useEffect(() => {
    if (!tournamentId) return;

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
      supabase.removeChannel(channel);
    };
  }, [tournamentId, roundIdSet, refetchSoon]);
}

/* ----------------------------- Alignment constants ----------------------------- */
/** Ensures titles/subtitles and the bottom info row align across all slides */
const TITLE_BLOCK_MIN_H = 40;
const BOTTOM_BLOCK_MIN_H = 40;

/* ---------------------------------- Page ---------------------------------- */
export default function EliminationScreen() {
  const router = useRouter();
  const [userId, setUserId] = useState(null);

  const [upcoming, setUpcoming] = useState([]); // lobby
  const [live, setLive] = useState([]);
  const [finished, setFinished] = useState([]);

  const [loading, setLoading] = useState({ upcoming: true, live: true, finished: true });
  const [error, setError] = useState({ upcoming: "", live: "", finished: "" });
  const [refreshing, setRefreshing] = useState(false);

  const [refreshToken, setRefreshToken] = useState(0);
  const [hardRefreshToken, setHardRefreshToken] = useState(0);
  const autoStartTriedRef = useRef(new Set());

  // NEW: track which cards are expanded
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const didInitExpandedRef = useRef(false);

  // get user id
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await supabase.auth.getUser();
      if (!alive) return;
      setUserId(error ? null : data?.user?.id ?? null);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const reloadLists = useCallback(async () => {
    if (!userId) {
      setUpcoming([]);
      setLive([]);
      setFinished([]);
      setLoading({ upcoming: false, live: false, finished: false });
      setError({ upcoming: "", live: "", finished: "" });
      return;
    }

    // ----------------------------- Upcoming -----------------------------
    setLoading((s) => ({ ...s, upcoming: true }));
    setError((e) => ({ ...e, upcoming: "" }));
    try {
      const { data, error: err } = await supabase
        .from("elimination_tournaments")
        .select(
          "id, name, status, created_at, round_time_limit_seconds, filters, winner_user_id, rounds_to_elimination, stake_points, min_participants, join_deadline, owner_id"
        )
        .eq("status", "lobby")
        .order("created_at", { ascending: false });
      if (err) throw err;

      const all = Array.isArray(data) ? data : [];
      const pub = all.filter((t) => ((t?.filters || {}).visibility || "private") === "public");
      const priv = all.filter((t) => ((t?.filters || {}).visibility || "private") !== "public");

      let canSeePriv = [];
      if (priv.length) {
        const ids = priv.map((t) => t.id);
        const { data: mine } = await supabase
          .from("elimination_participants")
          .select("tournament_id, invite_status")
          .eq("user_id", userId)
          .in("tournament_id", ids);
        const allowedIds = new Set((mine || []).map((r) => r.tournament_id));
        canSeePriv = priv.filter((t) => t.owner_id === userId || allowedIds.has(t.id));
      }
      const list = [...pub, ...canSeePriv].sort(
        (a, b) => new Date(b.created_at) - new Date(a.created_at)
      );
      setUpcoming(list);

      // auto-start
      const due = list.filter((t) => {
        const dl = t?.join_deadline ? new Date(t.join_deadline) : null;
        const isDue = !!dl && dl <= new Date();
        const notTried = !autoStartTriedRef.current.has(t.id);
        return isDue && notTried;
      });
      if (due.length) {
        due.forEach((t) => autoStartTriedRef.current.add(t.id));
        await Promise.allSettled(
          due.map((t) => supabase.rpc("start_elimination_tournament", { p_tournament_id: t.id }))
        );
      }
    } catch (e) {
      setError((s) => ({ ...s, upcoming: e?.message || "Failed to load." }));
      setUpcoming([]);
    } finally {
      setLoading((s) => ({ ...s, upcoming: false }));
    }

    // --------------------------------- Live ---------------------------------
    setLoading((s) => ({ ...s, live: true }));
    setError((e) => ({ ...e, live: "" }));
    try {
      const { data, error: err } = await supabase
        .from("elimination_tournaments")
        .select(
          "id, name, status, created_at, round_time_limit_seconds, filters, winner_user_id, rounds_to_elimination, stake_points, min_participants, join_deadline, owner_id"
        )
        .eq("status", "live")
        .order("created_at", { ascending: false });
      if (err) throw err;

      const all = Array.isArray(data) ? data : [];
      const ids = all.map((t) => t.id);
      const { data: myRows } = await supabase
        .from("elimination_participants")
        .select("tournament_id, invite_status")
        .eq("user_id", userId)
        .in("tournament_id", ids);
      const accepted = new Set(
        (myRows || [])
          .filter((r) => (r.invite_status || "").toLowerCase() === "accepted")
          .map((r) => r.tournament_id)
      );
      setLive(all.filter((t) => accepted.has(t.id)));
    } catch (e) {
      setError((s) => ({ ...s, live: e?.message || "Failed to load." }));
      setLive([]);
    } finally {
      setLoading((s) => ({ ...s, live: false }));
    }

    // ------------------------------- Finished -------------------------------
    setLoading((s) => ({ ...s, finished: true }));
    setError((e) => ({ ...e, finished: "" }));
    try {
      const { data, error: err } = await supabase
        .from("elimination_tournaments")
        .select(
          "id, name, status, created_at, round_time_limit_seconds, filters, winner_user_id, rounds_to_elimination, stake_points, min_participants, join_deadline, owner_id"
        )
        .eq("status", "finished")
        .order("created_at", { ascending: false });
      if (err) throw err;
      setFinished(Array.isArray(data) ? data : []);
    } catch (e) {
      setError((s) => ({ ...s, finished: e?.message || "Failed to load." }));
      setFinished([]);
    } finally {
      setLoading((s) => ({ ...s, finished: false }));
      setRefreshToken((t) => t + 1);
    }
  }, [userId]);

  // initial + on user change
  useEffect(() => {
    if (!userId) return;
    reloadLists();
  }, [userId, reloadLists]);

  // ------------------------- Realtime (no polling) -------------------------
  useEffect(() => {
    const ch = supabase
      .channel("elim-mobile-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "elimination_tournaments" }, () =>
        reloadLists()
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "elimination_rounds" }, () => {
        setHardRefreshToken((t) => t + 1);
        reloadLists();
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "elimination_round_entries" },
        () => reloadLists()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "elimination_participants" },
        () => {
          setHardRefreshToken((t) => t + 1);
          reloadLists();
        }
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "point_transactions" }, () =>
        reloadLists()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [reloadLists]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await reloadLists();
    } finally {
      setRefreshing(false);
    }
  }, [reloadLists]);

  // ---------- Unified list (color-coded headers instead of separate sections)
  const combinedList = useMemo(() => {
    // keep order: Live → Upcoming → Finished
    return [...live, ...upcoming, ...finished];
  }, [live, upcoming, finished]);

  const isAnyLoading = loading.live || loading.upcoming || loading.finished;
  const anyError = error.live || error.upcoming || error.finished;

  // Initialize default expanded states ONCE:
  // - expand ALL live & upcoming
  // - expand ONLY the newest finished (index 0 in finished, since sorted desc by created_at)
  useEffect(() => {
    if (didInitExpandedRef.current) return;
    if (isAnyLoading) return;
    const liveIds = live.map((t) => t.id);
    const upcomingIds = upcoming.map((t) => t.id);
    const newestFinishedId = finished[0]?.id;
    const defaults = new Set([...liveIds, ...upcomingIds]);
    if (newestFinishedId) defaults.add(newestFinishedId);
    setExpandedIds(defaults);
    didInitExpandedRef.current = true;
  }, [isAnyLoading, live, upcoming, finished]);

  const toggleCard = useCallback((id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    // page bg (not pure black)
    <View style={{ flex: 1, backgroundColor: "#F0FDF4", justifyContent: "center"}}>
      <ScrollView
        contentContainerStyle={{ padding: 12, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* --------- Top CTA: Create Challenge --------- */}
        <View style={{ marginBottom: 12, justifyContent: "center"}}>
          <TouchableOpacity
            style={[styles.primaryBtn, { alignSelf: "center", paddingHorizontal: 14 }]}
            onPress={() => useRouter().push("/elimination-create")}
          >
            <Text style={styles.primaryBtnText}>+ Create New Challenge</Text>
          </TouchableOpacity>
        </View>

        {isAnyLoading ? (
          <Skeleton />
        ) : anyError ? (
          <ErrorBox message={anyError} />
        ) : combinedList.length === 0 ? (
          <EmptyText text="No challenges yet." />
        ) : (
          <View style={{ gap: 12 }}>
            {combinedList.map((t) => (
              <TournamentCardMobileBR
                key={t.id}
                tournament={t}
                userId={userId}
                refreshToken={refreshToken}
                hardRefreshToken={hardRefreshToken}
                onChanged={reloadLists}
                isExpanded={expandedIds.has(t.id)}
                onToggle={() => toggleCard(t.id)}
              />
            ))}
          </View>
        )}

        <View style={{ height: 24 }} />
      </ScrollView>
    </View>
  );
}

/* --------------------------- Small UI atoms --------------------------- */
function EmptyText({ text }) {
  return <Text style={{ color: "#94a3b8" }}>{text}</Text>;
}
function ErrorBox({ message }) {
  return (
    <View style={styles.errorBox}>
      <Text style={styles.errorTitle}>Couldn’t load</Text>
      <Text style={styles.errorText}>{String(message)}</Text>
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

/* --------------- Battle-Royale styled tournament card (RN) --------------- */
function TournamentCardMobileBR({
  tournament,
  userId,
  refreshToken,
  hardRefreshToken,
  onChanged,
  isExpanded,          // NEW
  onToggle,            // NEW
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
        const { data: partRows } = await supabase
          .from("elimination_participants")
          .select("user_id, state, invite_status")
          .eq("tournament_id", tournament.id);

        const participantIds = (partRows || []).map((r) => r.user_id);

        const { data: roundRows } = await supabase
          .from("elimination_rounds")
          .select("id, round_number, started_at, ends_at, closed_at, player_id, is_elimination, users_participated")
          .eq("tournament_id", tournament.id)
          .order("round_number", { ascending: true });

        // entries per round
        const entriesMap = {};
        let entryUserIds = new Set();
        for (const r of roundRows || []) {
          const { data: ent } = await supabase
            .from("elimination_round_entries")
            .select("user_id, points_earned, started, game_record_id")
            .eq("round_id", r.id);
          const arr = Array.isArray(ent) ? ent : [];
          entriesMap[r.id] = arr;
          arr.forEach((e) => entryUserIds.add(e.user_id));
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
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tournament.id, refreshToken, hardRefreshToken, userId, rtTick]); // ← include rtTick so realtime nudges refetch

  // Hook up realtime for ONLY this tournament card
  useRealtimeTournament({
    tournamentId: tournament.id,
    roundIds: rounds.map((r) => r.id),
    onChange: () => setRtTick((t) => t + 1),
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

  return (
    <View style={styles.card}>
      {/* ----- Header (color-coded & clickable to collapse/expand) ----- */}
      <TouchableOpacity
        style={[styles.cardHeader, headerStyle]}
        activeOpacity={0.85}
        onPress={onToggle}
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{tournament.name || "Untitled"}</Text>
          <Text style={styles.cardSub}>
            {isUpcoming ? "Upcoming" : isLive ? "Live" : "Finished"}
          </Text>
        </View>

        {/* Right side header actions (shown even when collapsed for quick context) */}
        {isUpcoming ? (
          <View style={{ alignItems: "flex-end", gap: 6 }}>
            <Text style={styles.smallMuted}>
              Participants: <Text style={styles.bold}>{acceptedCount}</Text>
            </Text>
            {isOwner ? (
              canStart ? (
                <View style={styles.joinedChip}>
                  <Text style={styles.joinedChipText}>Ready</Text>
                </View>
              ) : (
                <View style={styles.joinedChip}>
                  <Text style={styles.joinedChipText}>Creator</Text>
                </View>
              )
            ) : (
              <View style={userHasJoined ? styles.joinedChip : styles.chip}>
                <Text style={userHasJoined ? styles.joinedChipText : styles.chipValue}>
                  {userHasJoined ? "Joined" : "Join"}
                </Text>
              </View>
            )}
          </View>
        ) : isFinished ? (
          <View style={{ alignItems: "flex-end", gap: 6 }}>
            <Text style={styles.smallMuted}>
              Participants: <Text style={styles.bold}>{acceptedCount}</Text>
            </Text>
          </View>
        ) : null}

        {/* Chevron */}
        <Text style={styles.chevron}>{isExpanded ? "▾" : "▸"}</Text>
      </TouchableOpacity>

      {/* ----- Collapsible body ----- */}
      {isExpanded && (
        <>
          {/* ----- Summary row ----- */}
          <View style={[styles.row, {justifyContent: "center"}]}>
            <InfoChip label="Stake 💸" value={`${Number(tournament.stake_points || 0)} pts`} />
            <InfoChip label="Pot 💰" value={`${Number(tournament.stake_points || 0) * Number(acceptedCount || 0)} pts`} />
            <InfoChip label="⏱️" value={`${timeLimitMin} min`} />
            <InfoChip label="🪓 every" value={`${roundsToElim} rounds`} />

            {isUpcoming ? <InfoChip label="🕰️ Join ends in" value={joinCountdown} tone="danger" /> : null}

            <TouchableOpacity onPress={() => setFiltersOpen((v) => !v)}>
              <View style={{alignItems: "left", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 16, backgroundColor: "#00000040"}}>
              <Text style={[styles.smallMuted, {  fontWeight: "700", color: "#ffffffff" }]}>{filtersOpen ? "Hide" : "Show"} Filters</Text>
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
                        <Text style={styles.chipLabel}>{c.label}:</Text>
                        <Text style={styles.chipValue}> {c.value}</Text>
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
                      }),
                    },
                  });
                }
              }}
            />
          )}

          {/* Inline actions that make sense only when body is open */}
          {isUpcoming && (
            <View style={{ marginTop: 8, flexDirection: "row", gap: 8, justifyContent: "center"}}>
              {isOwner ? (
                canStart ? (
                  <TouchableOpacity
                    style={[styles.primaryBtn, busy && { opacity: 0.6 }]}
                    disabled={busy === "start"}
                    onPress={handleStart}
                  >
                    <Text style={styles.primaryBtnText}>Start Challenge</Text>
                  </TouchableOpacity>
                ) : null
              ) : userHasJoined ? null : (
                <TouchableOpacity
                  style={[styles.primaryBtn, busy && { opacity: 0.6 }]}
                  disabled={busy === "join"}
                  onPress={handleJoin}
                >
                  <Text style={styles.primaryBtnText}>Join Challenge</Text>
                </TouchableOpacity>
              )}
            </View>
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
  const ownerLabel = ownerUser.full_name || ownerUser.email || String(tournament.owner_id || "");

  return (
    <View style={{ marginTop: 0 }}>
      <View style={{ alignItems: "center", marginBottom: 6, minHeight: TITLE_BLOCK_MIN_H, justifyContent: "center" }}>
        <Text style={{ fontWeight: "800", color: "#e2e8f0" , marginBottom: 6}}>Lobby</Text>
        <View style={styles.creatorChip}>
          <Text style={styles.creatorChipText}>Challenge Creator: {ownerLabel}</Text>
        </View>
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
                    borderColor: isPending ? "#64748b" : "#10b981", // gray for invited, green for joined
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
          <View style={{ width: 10, height: 10, borderRadius: 10, backgroundColor: "#10b981" }} />
          <Text style={{ color: "#94a3b8", fontSize: 12 }}>Joined</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <View style={{ width: 10, height: 10, borderRadius: 10, backgroundColor: "#64748b" }} />
          <Text style={{ color: "#94a3b8", fontSize: 12 }}>Invited</Text>
        </View>
      </View>
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
}) {
  const screenW = Dimensions.get("window").width;

  const winnerUserId = tournament?.winner_user_id || null;
  const acceptedCount = participants.filter(
    (p) => (p.invite_status || "").toLowerCase() === "accepted"
  ).length;
  const pot = Number(tournament?.stake_points || 0) * Number(acceptedCount || 0);
  const stake = Number(tournament?.stake_points || 0);

  const containerW = screenW - 24 - 24; // prevent right-edge cut

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
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        snapToInterval={containerW}
        decelerationRate="fast"
        contentContainerStyle={{ paddingVertical: 4 }}
      >
        {slides.map((slide) => {
          const containerStyle = { width: containerW };

          if (slide.type === "winner") {
            const winner = usersById[winnerUserId] || { id: winnerUserId };
            const name = winner?.full_name || winner?.email || "Winner";
            return (
              <View key={`winner-${tournament.id}`} style={containerStyle}>
                <View style={{ alignItems: "center", marginBottom: 6, minHeight: TITLE_BLOCK_MIN_H, justifyContent: "center" }}>
                  <Text style={{ fontWeight: "800", color: "#ffffffff", marginBottom: 6 }}>Challenge Winner</Text>
                  <View style={styles.winnerChip}>
                  <Text style={styles.winnerChipText}>{winner?.full_name}</Text>
                  </View>
                </View>
                <WinnerPitch pulse={pulse} winner={winner} pitchW={containerW - 4} pitchH={unifiedPitchHAll} />
                <View style={{ marginTop: 8, alignItems: "center", minHeight: BOTTOM_BLOCK_MIN_H, justifyContent: "center" }}>
                  <Text
                    style={{
                      color: "#e2e8f0",
                      textAlign: "center",
                      fontWeight: "700",
                      lineHeight: 20,
                    }}
                  >
                    {stake > 0 ? `${name} takes the crown. Pot: ${pot} pts.` : `${name} takes the crown.`}
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
            <RoundSlide
              key={r.id}
              containerStyle={containerStyle}
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
            />
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
}) {
  const r = round;

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

  return (
    <View style={containerStyle}>
      {/* Above the arena: round & survivors left (fixed min-height) */}
      <View style={{ alignItems: "center", marginBottom: 6, minHeight: TITLE_BLOCK_MIN_H, justifyContent: "center" }}>
        <Text
  style={{
    fontWeight: "800",
    color: r.is_elimination ? "#ef4444" : "#e2e8f0", // 🔴 red if elimination
    marginBottom: 6,
  }}
>
  Round {r.round_number}
</Text>

        <View style={styles.countdownChip}>
        <Text style={styles.countdownChipText}>
          {r.closed_at
            ? `Closed ${fmtDateTime(r.closed_at)}`
            : r.ends_at
            ? `Ends in ${liveCountdown}`
            : r.started_at
            ? `Started ${fmtDateTime(r.started_at)}`
            : "—"}
        </Text>
        </View>
      </View>

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

      {/* Under arena: finished => player info or live => Play (fixed min-height) */}
      <View style={{ marginTop: 8, alignItems: "center", minHeight: BOTTOM_BLOCK_MIN_H, justifyContent: "center" }}>
        {!r.closed_at ? (
          youPlayed ? (
            // already played => no button
            <Text style={{ color: "#94a3b8", fontSize: 12 }}>lets see if you've survived...</Text>
          ) : (
            <TouchableOpacity onPress={onPlay} style={[styles.primaryBtn, { alignSelf: "center" }]}>
              <Text style={styles.primaryBtnText}>Play to Survive</Text>
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
                <Text style={{ color: "#e2e8f0", fontWeight: "800" }}>
                  {p?.name || "Round Player"}
                </Text>
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
          <Text style={{ color: "#e2e8f0", fontWeight: "800" }}>
            {tableOpen ? "Hide" : "Show"} Round Standings
          </Text>
        </TouchableOpacity>

        {tableOpen && (
          <View style={styles.tableWrap}>
            {/* header */}
            <View style={[styles.tableRow, styles.tableHeader]}>
              <Text style={[styles.tableCellName, { fontWeight: "800" }]}>Name</Text>
              <Text style={[styles.tableCellSmall, { fontWeight: "800" }]}>Accum.</Text>
              <Text style={[styles.tableCellSmall, { fontWeight: "800" }]}>Curr.</Text>
              <Text style={[styles.tableCellSmall, { fontWeight: "800" }]}>Played</Text>
            </View>

            {/* rows */}
            {tableRows.map((row) => (
              <View key={row.id} style={styles.tableRow}>
                <Text numberOfLines={1} style={styles.tableCellName}>
                  {row.name}
                </Text>
                <Text style={styles.tableCellSmall}>{row.acc}</Text>
                <Text style={styles.tableCellSmall}>{row.rnd}</Text>
                <View style={[styles.tableCellSmall, { alignItems: "flex-end" }]}>
                  {row.played ? (
                    <View style={styles.playedPill}>
                      <Text style={{ color: "#0b0b0b", fontWeight: "800", fontSize: 10 }}>✔️</Text>
                    </View>
                  ) : (
                    <Text style={{ color: "#94a3b8", fontSize: 12 }}>⭕</Text>
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
      shadowOpacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.08, 0.35] }),
      shadowRadius: pulse.interpolate({ inputRange: [0, 1], outputRange: [4, 14] }),
      shadowColor: isElimination ? "#ef4444" : "#10b981", // 🔴 red pulse if elimination
      borderColor: isElimination ? "rgba(239,68,68,0.25)" : "rgba(16,185,129,0.25)",
    },
    ]}>
      <Animated.View
        style={[
    styles.pitch,
    heightOverride ? { height: heightOverride, borderRadius: 20, width: pitchW } : { width: pitchW },
    {
      shadowOpacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.08, 0.35] }),
      shadowRadius: pulse.interpolate({ inputRange: [0, 1], outputRange: [4, 14] }),
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
          <Text style={styles.playedStarGlyph}>🔆</Text>
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
              <Text style={styles.tooltipTitle}>{fullName}</Text>
              <Text style={styles.tooltipRow}>
                Accummulated: <Text style={styles.tooltipStrong}>{acc}</Text> pts
              </Text>
              <Text style={styles.tooltipRow}>
                Curr. round: <Text style={styles.tooltipStrong}>{rp}</Text> pts
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
    backgroundColor: "#0b1310",
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: "#1f2937",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },

  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
    borderWidth: 1,
  },
  headerLive: {
    backgroundColor: "#0d1713",
    borderColor: "#1e7a55",
  },
  headerUpcoming: {
    backgroundColor: "#0e1620",
    borderColor: "#2b6cb0",
  },
  headerFinished: {
    backgroundColor: "#141414",
    borderColor: "#3a3a3a",
  },

  cardTitle: { fontSize: 16, fontWeight: "800", color: "#e2e8f0" },
  cardSub: { fontSize: 12, color: "#93c5aa" },

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
    backgroundColor: "#0f2f25",
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
    borderWidth: 1,
    borderColor: "rgba(16,185,129,0.18)",
  },
  pitchBorderInner: {
    position: "absolute",
    top: 20,
    bottom: 20,
    left: 20,
    right: 20,
    borderRadius: 12,
    borderWidth: 1,
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
    borderWidth: 1,
    borderColor: "rgba(16,185,129,0.15)",
  },

  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginVertical: 8 },
  chip: {
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#0a0f0b",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  chipLabel: { fontSize: 10, color: "#94a3b8" },
  chipValue: { fontSize: 12, fontWeight: "800", color: "#e2e8f0" },

  filtersBox: {
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#0a0f0b",
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

  joinedChip: {
    backgroundColor: "#064e3b",
    borderWidth: 1,
    borderColor: "#10b981",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  joinedChipText: { color: "#ecfeff", fontWeight: "800", fontSize: 12 },

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
    backgroundColor: "#3f1a1a",
    borderWidth: 1,
    borderColor: "#fecaca",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  countdownChipText: { color: "#fecaca", fontWeight: "800", fontSize: 12 },

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

  smallMuted: { fontSize: 12, color: "#94a3b8" },
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
    borderColor: "#1f2937",
    backgroundColor: "#0a0f0b",
    borderRadius: 10,
    overflow: "hidden",
  },

  tableHeader: {
    backgroundColor: "#0f172a",
    borderBottomWidth: 1,
    borderBottomColor: "#1f2937",
  },

  tableRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(31,41,55,0.6)",
  },

  tableCellName: {
    flex: 1,
    color: "#e2e8f0",
    fontSize: 12,
    marginRight: 8,
  },

  tableCellSmall: {
    width: 64,
    color: "#e2e8f0",
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
      <Text style={styles.chipLabel}>{label}</Text>
      <Text style={[styles.chipValue, valueColor]}> {value}</Text>
    </View>
  );
}
