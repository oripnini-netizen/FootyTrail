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
  Modal,
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
  // xorshift32
  let x = seed | 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  // map to [0,1)
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

/* ---------------------------------- Page ---------------------------------- */
export default function EliminationScreen() {
  const router = useRouter();
  const [userId, setUserId] = useState(null);

  const [upcoming, setUpcoming] = useState([]); // “lobby”
  const [live, setLive] = useState([]);
  const [finished, setFinished] = useState([]);

  const [loading, setLoading] = useState({ upcoming: true, live: true, finished: true });
  const [error, setError] = useState({ upcoming: "", live: "", finished: "" });
  const [refreshing, setRefreshing] = useState(false);
  const [showAllFinished, setShowAllFinished] = useState(false);

  const [refreshToken, setRefreshToken] = useState(0);
  const [hardRefreshToken, setHardRefreshToken] = useState(0);
  const autoStartTriedRef = useRef(new Set());

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

      // Opportunistic auto-start for due upcoming tournaments
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

  // finished visible subset control
  const visibleFinished = useMemo(
    () => (showAllFinished ? finished : finished.slice(0, 1)),
    [showAllFinished, finished]
  );

  return (
    <View style={{ flex: 1, backgroundColor: "#0a0f0b" }}>
      <ScrollView
        contentContainerStyle={{ padding: 12, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* --------- Top CTA: Create Challenge --------- */}
        <View style={{ marginBottom: 12 }}>
          <TouchableOpacity
            style={[styles.primaryBtn, { alignSelf: "flex-start", paddingHorizontal: 14 }]}
            onPress={() => useRouter().push("/elimination-create")}
          >
            <Text style={styles.primaryBtnText}>+ Create Challenge</Text>
          </TouchableOpacity>
        </View>

        {/* ------------------------------- Live ------------------------------- */}
        <SectionHeader title={`Live (${live.length})`} />
        {loading.live ? (
          <Skeleton />
        ) : error.live ? (
          <ErrorBox message={error.live} />
        ) : live.length === 0 ? (
          <EmptyText text="No live challenges." />
        ) : (
          <View style={{ gap: 12 }}>
            {live.map((t) => (
              <TournamentCardMobileBR
                key={t.id}
                tournament={t}
                userId={userId}
                refreshToken={refreshToken}
                hardRefreshToken={hardRefreshToken}
                onChanged={reloadLists}
                defaultCollapsed={false /* Live expanded by default */}
              />
            ))}
          </View>
        )}

        {/* ----------------------------- Upcoming ---------------------------- */}
        <SectionHeader title={`Upcoming (${upcoming.length})`} />
        {loading.upcoming ? (
          <Skeleton />
        ) : error.upcoming ? (
          <ErrorBox message={error.upcoming} />
        ) : upcoming.length === 0 ? (
          <EmptyText text="No upcoming challenges." />
        ) : (
          <View style={{ gap: 12 }}>
            {upcoming.map((t) => (
              <TournamentCardMobileBR
                key={t.id}
                tournament={t}
                userId={userId}
                refreshToken={refreshToken}
                hardRefreshToken={hardRefreshToken}
                onChanged={reloadLists}
                defaultCollapsed={true /* Upcoming collapsed by default */}
              />
            ))}
          </View>
        )}

        {/* ----------------------------- Finished ---------------------------- */}
        <SectionHeader title={`Finished (${finished.length})`} />
        {loading.finished ? (
          <Skeleton />
        ) : error.finished ? (
          <ErrorBox message={error.finished} />
        ) : finished.length === 0 ? (
          <EmptyText text="No finished challenges yet." />
        ) : (
          <>
            <View style={{ gap: 12 }}>
              {visibleFinished.map((t) => (
                <TournamentCardMobileBR
                  key={t.id}
                  tournament={t}
                  userId={userId}
                  refreshToken={refreshToken}
                  hardRefreshToken={hardRefreshToken}
                  onChanged={reloadLists}
                  defaultCollapsed={true}
                />
              ))}
            </View>
            {finished.length > 1 && (
              <View style={{ alignItems: "center", marginTop: 8 }}>
                <TouchableOpacity
                  onPress={() => setShowAllFinished((v) => !v)}
                  style={styles.showMoreBtn}
                >
                  <Text style={styles.showMoreText}>
                    {showAllFinished
                      ? "Hide previous finished challenges"
                      : `Show previous finished challenges (${finished.length - 1})`}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </>
        )}
        <View style={{ height: 24 }} />
      </ScrollView>
    </View>
  );
}

/* --------------------------- Small UI atoms --------------------------- */
function SectionHeader({ title }) {
  return (
    <View style={{ paddingVertical: 6 }}>
      <Text style={{ fontSize: 18, fontWeight: "800", color: "#a7f3d0" }}>{title}</Text>
    </View>
  );
}
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
  defaultCollapsed = true,
}) {
  const router = useRouter();
  const isUpcoming = tournament.status === "lobby";
  const isLive = tournament.status === "live";
  const isFinished = tournament.status === "finished";
  const timeLimitMin = Math.round((tournament.round_time_limit_seconds || 0) / 60);
  const roundsToElim = Math.max(1, Number(tournament.rounds_to_elimination || 1));

  const [loading, setLoading] = useState(true);
  const [participants, setParticipants] = useState([]); // from elimination_participants
  const [rounds, setRounds] = useState([]); // rounds meta
  const [entriesByRound, setEntriesByRound] = useState({}); // round_id -> entries
  const [usersById, setUsersById] = useState({}); // ANY user we need (participants or entries)
  const [youEliminatedRound, setYouEliminatedRound] = useState(null);
  const [busy, setBusy] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);

  // pulsing aura (kept)
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
        // participants (may be empty in your data)
        const { data: partRows } = await supabase
          .from("elimination_participants")
          .select("user_id, state, invite_status, eliminated_at_round")
          .eq("tournament_id", tournament.id);

        const participantIds = (partRows || []).map((r) => r.user_id);

        // rounds
        const { data: roundRows } = await supabase
          .from("elimination_rounds")
          .select("id, round_number, started_at, ends_at, closed_at, player_id, is_elimination")
          .eq("tournament_id", tournament.id)
          .order("round_number", { ascending: true });

        // entries per round (include game_record_id so we can mark "played")
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

        // fetch users for participants + users who appear in entries
        const allIds = Array.from(new Set([...participantIds, ...entryUserIds]));
        let usersRows = [];
        if (allIds.length) {
          const { data: uRows } = await supabase
            .from("users")
            .select("id, full_name, email, profile_photo_url")
            .in("id", allIds);
          usersRows = uRows || [];
        }
        const usersByIdNext = Object.fromEntries(usersRows.map((u) => [u.id, u]));

        // attach meta to participants (if any)
        const withMeta = (participantIds.length ? participantIds : allIds).map((uid) => {
          const u = usersByIdNext[uid] || { id: uid };
          const p = (partRows || []).find((x) => x.user_id === uid);
          return {
            ...u,
            state: p?.state || null,
            invite_status: p?.invite_status || "accepted", // assume accepted if he started
            eliminated_at_round: p?.eliminated_at_round ?? null,
          };
        });

        if (!cancelled) {
          setParticipants(withMeta);
          setRounds(Array.isArray(roundRows) ? roundRows : []);
          setEntriesByRound(entriesMap);
          setUsersById(usersByIdNext);

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
  }, [tournament.id, refreshToken, hardRefreshToken, userId]);

  const acceptedCount = useMemo(
    () => participants.filter((p) => (p.invite_status || "").toLowerCase() === "accepted").length,
    [participants]
  );
  const pot = useMemo(
    () => Number(tournament.stake_points || 0) * Number(acceptedCount || 0),
    [tournament.stake_points, acceptedCount]
  );
  const joinCountdown = useCountdown(isUpcoming ? tournament.join_deadline : null);
  const userHasJoined = useMemo(() => {
    const me = participants.find((p) => p.id === userId);
    return (me?.invite_status || "").toLowerCase() === "accepted";
  }, [participants, userId]);

  async function handleJoin() {
    if (!isUpcoming || userHasJoined || busy) return;
    setBusy("join");
    try {
      const res = await supabase.rpc("accept_tournament_invite", {
        p_tournament_id: tournament.id,
        p_user_id: userId,
      });
      if (res?.error) {
        // fallback
        await supabase.from("elimination_participants").upsert({
          tournament_id: tournament.id,
          user_id: userId,
          invite_status: "accepted",
          state: "active",
        });
      }
    } finally {
      setBusy("");
      onChanged && onChanged();
    }
  }

  const roundsAsc = useMemo(() => [...rounds].sort((a, b) => (a.round_number || 0) - (b.round_number || 0)), [rounds]);
  const roundsDesc = useMemo(() => [...roundsAsc].reverse(), [roundsAsc]);

  // Winner / You styling
  const winnerUserId = tournament.winner_user_id || null;
  const youWon = !!winnerUserId && winnerUserId === userId;

  // Accumulated points across all rounds (global)
  const totalPointsByUserAll = useMemo(() => {
    const m = new Map();
    for (const rId in entriesByRound) {
      for (const e of entriesByRound[rId] || []) {
        m.set(e.user_id, (m.get(e.user_id) || 0) + (Number(e.points_earned) || 0));
      }
    }
    return m;
  }, [entriesByRound]);

  // Filters -> chips
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

  return (
    <View style={styles.card}>
      {/* ----- Header ----- */}
      <View
        style={[
          styles.cardHeader,
          youWon && isFinished ? styles.winnerHeader : styles.battleHeader,
        ]}
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{tournament.name || "Untitled"}</Text>
          <Text style={styles.cardSub}>
            {isUpcoming ? "Upcoming" : isLive ? "Live" : "Finished"}
          </Text>
        </View>

        {/* Right side header actions for Upcoming / Finished */}
        {isUpcoming ? (
          <View style={{ alignItems: "flex-end", gap: 6 }}>
            <Text style={styles.smallMuted}>
              Participants: <Text style={styles.bold}>{acceptedCount}</Text>
            </Text>
            {userHasJoined ? (
              <View style={styles.joinedChip}>
                <Text style={styles.joinedChipText}>Joined</Text>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.primaryBtn, busy && { opacity: 0.6 }]}
                disabled={busy === "join"}
                onPress={handleJoin}
              >
                <Text style={styles.primaryBtnText}>Join Challenge</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : isFinished ? (
          <View style={{ alignItems: "flex-end", gap: 6 }}>
            {youWon ? (
              <Text style={[styles.smallMuted, { fontWeight: "700", color: "#fef08a" }]}>
                ⭐ You won!
              </Text>
            ) : youEliminatedRound ? (
              <View style={styles.elimChip}>
                <Text style={styles.elimChipText}>Eliminated R{youEliminatedRound}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>

      {/* ----- Summary row (always visible) ----- */}
      <View style={styles.row}>
        <InfoChip label="Stake" value={`${Number(tournament.stake_points || 0)} pts`} />
        <InfoChip label="Pot" value={`${pot} pts`} />
        <InfoChip label="Min/Round" value={`${timeLimitMin} min`} />
        <InfoChip label="Elim every" value={`${roundsToElim} rnds`} />
        {isUpcoming ? <InfoChip label="Join ends in" value={joinCountdown} tone="danger" /> : null}
      </View>

      {/* ----- Filters (collapsible, collapsed by default) ----- */}
      {!!filterChips.length && (
        <View style={[styles.filtersBox, { paddingTop: 10 }]}>
          <Pressable
            onPress={() => setFiltersOpen((v) => !v)}
            style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
          >
            <Text style={styles.filtersTitle}>Filters</Text>
            <Text style={styles.smallMuted}>{filtersOpen ? "▾" : "▸"}</Text>
          </Pressable>

          {filtersOpen && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
              {filterChips.map((c, i) => (
                <View key={i} style={styles.chip}>
                  <Text style={styles.chipLabel}>{c.label}</Text>
                  <Text style={styles.chipValue}> {c.value}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      {/* ----- SWIPEABLE ARENA: newest → older rounds ----- */}
      {(isLive || isFinished) && (
        <SwipeableArena
          tournament={tournament}
          roundsAsc={roundsAsc}
          roundsDesc={roundsDesc}
          participants={participants}
          entriesByRound={entriesByRound}
          usersById={usersById}
          totalPointsByUserAll={totalPointsByUserAll}
          pulse={pulse}
          onPlay={() => {
            const latest = roundsDesc[0];
            if (latest) {
              router.push({
                pathname: "/live-game",
                params: {
                  payload: JSON.stringify({
                    type: "elimination",
                    tournamentId: tournament.id,
                    roundId: latest.id,
                  }),
                },
              });
            }
          }}
        />
      )}

      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator />
        </View>
      )}
    </View>
  );
}

// (Modal removed and replaced with inline anchored tooltip next to avatar)

/* ------------------------- Swipeable rounds + arena ------------------------ */
function SwipeableArena({
  tournament,
  roundsAsc,
  roundsDesc,
  participants,
  entriesByRound,
  usersById,
  totalPointsByUserAll,
  pulse,
  onPlay,
}) {
  const screenW = Dimensions.get("window").width;

  // quick access map: roundId -> roundNumber
  const roundNumById = useMemo(() => {
    const m = new Map();
    for (const r of roundsAsc) m.set(r.id, r.round_number);
    return m;
  }, [roundsAsc]);

  return (
    <View style={{ marginTop: 6 }}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        snapToInterval={screenW - 24 /* card horizontal padding area */}
        decelerationRate="fast"
        contentContainerStyle={{ paddingVertical: 4 }}
      >
        {roundsDesc.map((r, idx) => {
          const entries = entriesByRound[r.id] || [];

          // who started this round (explicit or points available)
          const startedUserIds = new Set(
            entries
              .filter((e) => e.started === true || e.points_earned !== null)
              .map((e) => e.user_id)
          );

          const startedCount = startedUserIds.size;

          // survivors = not eliminated by/at this round
          const eliminatedByRound = new Set(
            participants
              .filter(
                (p) =>
                  Number.isFinite(p.eliminated_at_round) &&
                  p.eliminated_at_round <= r.round_number
              )
              .map((p) => p.id)
          );
          const survivorsCount = Math.max(
            0,
            participants.length ? participants.length - eliminatedByRound.size : startedCount
          );

          // dynamic arena height based on # who started
          const baseH = 220;
          const dynH = baseH + Math.min(160, startedCount * 8);

          const isRoundLive = !r.closed_at;

          // points in THIS round
          const roundPts = new Map(entries.map((e) => [e.user_id, Number(e.points_earned) || 0]));
          const playedThisRound = new Set(
            entries.filter((e) => !!e.game_record_id).map((e) => e.user_id)
          );

          // cumulative points UP TO this round (use only rounds with round_number <= current)
          const cumPointsAtRound = (() => {
            const m = new Map();
            for (const rr of roundsAsc) {
              if ((rr.round_number || 0) > (r.round_number || 0)) break;
              for (const e of entriesByRound[rr.id] || []) {
                m.set(e.user_id, (m.get(e.user_id) || 0) + (Number(e.points_earned) || 0));
              }
            }
            return m;
          })();

          // active (not yet eliminated by this round) candidates
          const activeUserIds = participants
            .filter((p) => !eliminatedByRound.has(p.id))
            .map((p) => p.id);

          // compute current "lowest cumulative" among ACTIVE users
          let minCum = Infinity;
          for (const uid of activeUserIds) {
            const v = cumPointsAtRound.get(uid) || 0;
            if (v < minCum) minCum = v;
          }
          const lowestCumUsers = new Set(
            activeUserIds.filter((uid) => (cumPointsAtRound.get(uid) || 0) === minCum)
          );

          // Build avatar list strictly from users who STARTED this round
          const avatars = Array.from(startedUserIds).map((uid) => {
            return usersById[uid] || { id: uid, profile_photo_url: "", email: "User" };
          });

          // Generate deterministic jittered positions for avatars inside arena
          const arenaPadding = 18;
          const avatarSize = 32;
          const pitchW = screenW - 24 - 4; // card width minus small padding
          const pitchH = dynH;
          const innerW = pitchW - arenaPadding * 2 - avatarSize;
          const innerH = pitchH - arenaPadding * 2 - avatarSize;

          const avatarPositions = avatars.map((u, i) => {
            const seed = strHash(String(r.id) + ":" + String(u.id));
            const rx = seededRand(seed + 11);
            const ry = seededRand(seed + 23);
            const x = arenaPadding + rx * innerW;
            const y = arenaPadding + ry * innerH;
            return { id: u.id, x, y };
          });

          return (
            <View
              key={r.id}
              style={{ width: screenW - 24, paddingRight: idx === roundsDesc.length - 1 ? 0 : 8 }}
            >
              {/* Above the arena: round & survivors */}
              <View style={{ alignItems: "center", marginBottom: 6 }}>
                <Text style={{ fontWeight: "800", color: "#e2e8f0" }}>
                  Round {r.round_number} • {survivorsCount} survivors
                </Text>
                <Text style={styles.smallMuted}>
                  {r.closed_at
                    ? `Closed ${fmtDateTime(r.closed_at)}`
                    : r.ends_at
                    ? `Ends ${fmtDateTime(r.ends_at)}`
                    : r.started_at
                    ? `Started ${fmtDateTime(r.started_at)}`
                    : "—"}
                </Text>
              </View>

              {/* Single arena with avatars */}
              <ArenaPitch
                heightOverride={dynH}
                pulse={pulse}
                pitchId={r.id}
                avatars={avatars}
                avatarPositions={avatarPositions}
                roundPts={roundPts}
                cumPointsAtRound={cumPointsAtRound}
                lowestCumUsers={lowestCumUsers}
                playedThisRound={playedThisRound}
              />

              {/* Under arena: finished => player info, live => Play button */}
              <View style={{ marginTop: 8 }}>
                {isRoundLive ? (
                  <TouchableOpacity
                    onPress={onPlay}
                    style={[styles.primaryBtn, { alignSelf: "center" }]}
                  >
                    <Text style={styles.primaryBtnText}>Play to Survive</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

/* ---------------------------- Arena visualization ---------------------------- */
/**
 * Single centered “football pitch” with:
 *  - jittered avatars (absolute-positioned)
 *  - green border: not currently last in cumulative
 *  - red border: currently last in cumulative (would be eliminated now)
 *  - yellow ring overlay: this user played this round (has game_record_id)
 *  - anchored tooltip at top-right of tapped avatar
 */
function ArenaPitch({
  heightOverride,
  pulse,
  pitchId,
  avatars,
  avatarPositions,
  roundPts,
  cumPointsAtRound,
  lowestCumUsers,
  playedThisRound,
}) {
  const [tooltip, setTooltip] = useState(null); // { id, x, y }

  const handleAvatarPress = (u, pos) => {
    // toggle if same; else show
    if (tooltip && tooltip.id === u.id) {
      setTooltip(null);
    } else {
      // place tooltip slightly to the top-right of avatar
      setTooltip({
        id: u.id,
        x: pos.x + 24,
        y: Math.max(6, pos.y - 6),
      });
    }
  };

  return (
    <View style={[styles.arenaContainer, heightOverride ? { paddingVertical: 6 } : null]}>
      <Animated.View
        style={[
          styles.pitch,
          heightOverride ? { height: heightOverride, borderRadius: 20 } : null,
          {
            shadowOpacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.08, 0.25] }),
            shadowRadius: pulse.interpolate({ inputRange: [0, 1], outputRange: [4, 10] }),
          },
        ]}
      >
        {/* Football pitch lines (very light/faded) */}
        <View style={styles.pitchBorderOuter} />
        <View style={styles.pitchBorderInner} />
        <View style={styles.pitchHalfLine} />
        <View style={styles.pitchCenterCircle} />

        {/* Avatars - absolute, jittered */}
        {avatars.map((u) => {
          const pos = avatarPositions.find((p) => p.id === u.id) || { x: 20, y: 20 };
          const isLowest = lowestCumUsers.has(u.id);
          const played = playedThisRound.has(u.id);
          const baseColor = isLowest ? "#ef4444" : "#10b981"; // red vs green

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
                },
              ]}
            >
              <Image source={{ uri: u.profile_photo_url || "" }} style={styles.userAvatarArena} />
              {played && <View pointerEvents="none" style={styles.avatarRingPlayed} />}
            </TouchableOpacity>
          );
        })}

        {/* Tooltip anchored to selected avatar, shows full username + accumulated + round pts */}
        {tooltip && (() => {
          const u = avatars.find((x) => x.id === tooltip.id);
          if (!u) return null;
          const fullName = u.full_name || u.email || "User";
          const acc = cumPointsAtRound.get(u.id) || 0;
          const rp = Number.isFinite(roundPts.get(u.id)) ? roundPts.get(u.id) : 0;
          return (
            <View
              style={[
                styles.tooltipCard,
                {
                  left: tooltip.x,
                  top: tooltip.y,
                },
              ]}
            >
              <Text style={styles.tooltipTitle}>{fullName}</Text>
              <Text style={styles.tooltipRow}>Accumulated: <Text style={styles.tooltipStrong}>{acc}</Text> pts</Text>
              <Text style={styles.tooltipRow}>This round: <Text style={styles.tooltipStrong}>{rp}</Text> pts</Text>
            </View>
          );
        })()}
      </Animated.View>
    </View>
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
  battleHeader: {
    backgroundColor: "#0d1713",
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: "#163b2b",
    marginBottom: 10,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  winnerHeader: {
    backgroundColor: "#3b2f0a",
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: "#b08900",
    marginBottom: 10,
  },
  cardTitle: { fontSize: 16, fontWeight: "800", color: "#e2e8f0" },
  cardSub: { fontSize: 12, color: "#93c5aa" },

  arenaContainer: { paddingVertical: 6, paddingHorizontal: 2 },

  // New single "pitch" arena
  pitch: {
    height: 240,
    borderRadius: 20,
    position: "relative",
    backgroundColor: "#0f2f25",
    borderWidth: 2,
    borderColor: "rgba(16,185,129,0.25)",
    shadowColor: "#10b981",
    overflow: "hidden", // ensure fully seen and popups clipped inside arena
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
    backgroundColor: "#10b981",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  primaryBtnText: { color: "#052e22", fontWeight: "800" },

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

  smallMuted: { fontSize: 12, color: "#94a3b8" },
  bold: { fontWeight: "800" },

  showMoreBtn: {
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#0a0f0b",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  showMoreText: { fontWeight: "800", color: "#e2e8f0" },

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
    width: 32,
    height: 32,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: "#334155",
    overflow: "hidden",
    backgroundColor: "#1f2937",
  },
  userAvatarArena: { width: "100%", height: "100%" },

  // Yellow "played" ring
  avatarRingPlayed: {
    position: "absolute",
    left: -3,
    top: -3,
    right: -3,
    bottom: -3,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: "#facc15",
  },

  // Anchored tooltip next to avatar (top-right), compact
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

  playerPhoto: { width: 44, height: 44, borderRadius: 8 },
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
