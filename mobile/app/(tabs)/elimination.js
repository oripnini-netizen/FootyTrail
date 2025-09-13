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
  Dimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { supabase } from "../../lib/supabase"; // fixed path

// ---------- Small utils ----------
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
  try { return new Date(iso).toLocaleString(); } catch { return "—"; }
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

// ---------- Screen ----------
export default function EliminationScreen() {
  const router = useRouter();
  const [userId, setUserId] = useState(null);

  const [lobby, setLobby] = useState([]);
  const [live, setLive] = useState([]);
  const [finished, setFinished] = useState([]);

  const [loading, setLoading] = useState({ lobby: true, live: true, finished: true });
  const [error, setError] = useState({ lobby: "", live: "", finished: "" });
  const [refreshing, setRefreshing] = useState(false);

  const [refreshToken, setRefreshToken] = useState(0);
  const [hardRefreshToken, setHardRefreshToken] = useState(0);
  const autoStartTriedRef = useRef(new Set());

  // swipe state
  const [tabIndex, setTabIndex] = useState(0);
  const scrollRef = useRef(null);
  const { width } = Dimensions.get("window");

  // get user id
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await supabase.auth.getUser();
      if (!alive) return;
      setUserId(error ? null : data?.user?.id ?? null);
    })();
    return () => { alive = false; };
  }, []);

  const reloadLists = useCallback(async () => {
    if (!userId) {
      setLobby([]); setLive([]); setFinished([]);
      setLoading({ lobby: false, live: false, finished: false });
      setError({ lobby: "", live: "", finished: "" });
      return;
    }

    // Lobby
    setLoading(s => ({ ...s, lobby: true }));
    setError(e => ({ ...e, lobby: "" }));
    try {
      const { data, error: err } = await supabase
        .from("elimination_tournaments")
        .select("id, name, status, created_at, round_time_limit_seconds, filters, winner_user_id, rounds_to_elimination, stake_points, min_participants, join_deadline, owner_id")
        .eq("status", "lobby")
        .order("created_at", { ascending: false });
      if (err) throw err;

      const all = Array.isArray(data) ? data : [];
      const pub = all.filter(t => ((t?.filters || {}).visibility || "private") === "public");
      const priv = all.filter(t => ((t?.filters || {}).visibility || "private") !== "public");
      let canSeePriv = [];
      if (priv.length) {
        const ids = priv.map(t => t.id);
        const { data: mine } = await supabase
          .from("elimination_participants")
          .select("tournament_id, invite_status")
          .eq("user_id", userId)
          .in("tournament_id", ids);
        const allowedIds = new Set((mine || []).map(r => r.tournament_id));
        canSeePriv = priv.filter(t => t.owner_id === userId || allowedIds.has(t.id));
      }
      const list = [...pub, ...canSeePriv].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      setLobby(list);

      // Opportunistic autostart
      const due = list.filter(t => {
        const dl = t?.join_deadline ? new Date(t.join_deadline) : null;
        const isDue = !!dl && dl <= new Date();
        const notTried = !autoStartTriedRef.current.has(t.id);
        return isDue && notTried;
      });
      if (due.length) {
        due.forEach(t => autoStartTriedRef.current.add(t.id));
        await Promise.allSettled(
          due.map(t => supabase.rpc("start_elimination_tournament", { p_tournament_id: t.id }))
        );
      }
    } catch (e) {
      setError(s => ({ ...s, lobby: e?.message || "Failed to load." }));
      setLobby([]);
    } finally {
      setLoading(s => ({ ...s, lobby: false }));
    }

    // Live
    setLoading(s => ({ ...s, live: true }));
    setError(e => ({ ...e, live: "" }));
    try {
      const { data, error: err } = await supabase
        .from("elimination_tournaments")
        .select("id, name, status, created_at, round_time_limit_seconds, filters, winner_user_id, rounds_to_elimination, stake_points, min_participants, join_deadline, owner_id")
        .eq("status", "live")
        .order("created_at", { ascending: false });
      if (err) throw err;
      const all = Array.isArray(data) ? data : [];
      const ids = all.map(t => t.id);
      const { data: myRows } = await supabase
        .from("elimination_participants")
        .select("tournament_id, invite_status")
        .eq("user_id", userId)
        .in("tournament_id", ids);
      const accepted = new Set((myRows || []).filter(r => (r.invite_status || "").toLowerCase() === "accepted").map(r => r.tournament_id));
      setLive(all.filter(t => accepted.has(t.id)));
    } catch (e) {
      setError(s => ({ ...s, live: e?.message || "Failed to load." }));
      setLive([]);
    } finally {
      setLoading(s => ({ ...s, live: false }));
    }

    // Finished
    setLoading(s => ({ ...s, finished: true }));
    setError(e => ({ ...e, finished: "" }));
    try {
      const { data, error: err } = await supabase
        .from("elimination_tournaments")
        .select("id, name, status, created_at, round_time_limit_seconds, filters, winner_user_id, rounds_to_elimination, stake_points, min_participants, join_deadline, owner_id")
        .eq("status", "finished")
        .order("created_at", { ascending: false });
      if (err) throw err;
      setFinished(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(s => ({ ...s, finished: e?.message || "Failed to load." }));
      setFinished([]);
    } finally {
      setLoading(s => ({ ...s, finished: false }));
      setRefreshToken(t => t + 1);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    reloadLists();
  }, [userId, reloadLists]);

  useEffect(() => {
    if ((lobby.length || live.length) === 0) return;
    const id = setInterval(() => reloadLists(), 30000);
    return () => clearInterval(id);
  }, [lobby.length, live.length, reloadLists]);

  // realtime subscriptions
  useEffect(() => {
    const ch = supabase
      .channel("elim-mobile-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "elimination_tournaments" }, payload => {
        const isInsert = payload?.eventType === "INSERT";
        const stakeChanged = (payload?.old?.stake_points ?? null) !== (payload?.new?.stake_points ?? null);
        if (isInsert || stakeChanged) setHardRefreshToken(t => t + 1);
        reloadLists();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "elimination_rounds" }, payload => {
        const wasOpen = payload?.old?.closed_at == null;
        const nowClosed = payload?.new?.closed_at != null;
        if (wasOpen && nowClosed) setHardRefreshToken(t => t + 1);
        reloadLists();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "elimination_round_entries" }, () => reloadLists())
      .on("postgres_changes", { event: "*", schema: "public", table: "elimination_participants" }, payload => {
        const isInsert = payload?.eventType === "INSERT";
        if (isInsert) setHardRefreshToken(t => t + 1);
        reloadLists();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "point_transactions" }, () => reloadLists())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [reloadLists]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await reloadLists(); } finally { setRefreshing(false); }
  }, [reloadLists]);

  // swipe helpers
  const goToTab = (index) => {
    setTabIndex(index);
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ x: width * index, animated: true });
    }
  };
  const onMomentumEnd = (e) => {
    const page = Math.round(e.nativeEvent.contentOffset.x / width);
    if (page !== tabIndex) setTabIndex(page);
  };

  // Section renderers
  const renderList = (items, statusKey) => {
    const isLoading = loading[statusKey];
    const err = error[statusKey];

    if (isLoading) {
      return (
        <View style={styles.loadingRow}>
          <ActivityIndicator />
          <Text style={styles.loadingText}>Loading…</Text>
        </View>
      );
    }
    if (err) {
      return (
        <View style={styles.errorBox}>
          <Text style={styles.errorTitle}>Couldn’t load</Text>
          <Text style={styles.errorText}>{String(err)}</Text>
        </View>
      );
    }
    if (!items.length) {
      return <Text style={styles.emptyText}>No challenges here.</Text>;
    }

    return (
      <View style={{ gap: 12 }}>
        {items.map((t) => (
          <TournamentCardMobileBR
            key={t.id}
            tournament={t}
            userId={userId}
            refreshToken={refreshToken}
            hardRefreshToken={hardRefreshToken}
            onChanged={reloadLists}
          />
        ))}
      </View>
    );
  };

  return (
    <View style={{ flex: 1 }}>
      {/* Tabs header */}
      <View style={styles.tabsHeader}>
        {["Lobby", "Live", "Finished"].map((label, i) => (
          <TouchableOpacity key={label} onPress={() => goToTab(i)} style={[styles.tabBtn, tabIndex === i && styles.tabBtnActive]}>
            <Text style={[styles.tabText, tabIndex === i && styles.tabTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={styles.createBtn} onPress={() => router.push("/elimination-create")}>
          <Text style={styles.createBtnText}>+ Create</Text>
        </TouchableOpacity>
      </View>

      {/* Swipeable pages */}
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onMomentumEnd}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={[styles.page, { width }]}>{renderList(lobby, "lobby")}</View>
        <View style={[styles.page, { width }]}>{renderList(live, "live")}</View>
        <View style={[styles.page, { width }]}>{renderList(finished.slice(0, 1), "finished")}</View>
      </ScrollView>
    </View>
  );
}

// ---------- Battle-Royale styled tournament card (React-Native port) ----------
function TournamentCardMobileBR({
  tournament,
  userId,
  refreshToken,
  hardRefreshToken,
  onChanged,
}) {
  const isLobby = tournament.status === "lobby";
  const isLive = tournament.status === "live";
  const isFinished = tournament.status === "finished";
  const timeLimitMin = Math.round((tournament.round_time_limit_seconds || 0) / 60);
  const roundsToElim = Math.max(1, Number(tournament.rounds_to_elimination || 1));

  const [loading, setLoading] = useState(true);
  const [participants, setParticipants] = useState([]); // users with invite+state
  const [rounds, setRounds] = useState([]);             // rounds meta
  const [entriesByRound, setEntriesByRound] = useState({}); // round_id -> entries
  const [availableToday, setAvailableToday] = useState(null);
  const [busy, setBusy] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data: partRows } = await supabase
          .from("elimination_participants")
          .select("user_id, state, invite_status")
          .eq("tournament_id", tournament.id);

        const ids = (partRows || []).map(r => r.user_id);
        let users = [];
        if (ids.length) {
          const { data: usersRows } = await supabase
            .from("users")
            .select("id, full_name, email, profile_photo_url")
            .in("id", ids);
          users = usersRows || [];
        }
        const withMeta = (users || []).map(u => {
          const p = (partRows || []).find(x => x.user_id === u.id);
          return { ...u, state: p?.state || null, invite_status: p?.invite_status || "pending" };
        });

        const { data: roundRows } = await supabase
          .from("elimination_rounds")
          .select("id, round_number, started_at, ends_at, closed_at, player_id, is_elimination")
          .eq("tournament_id", tournament.id)
          .order("round_number", { ascending: true });

        const entriesMap = {};
        for (const r of (roundRows || [])) {
          const { data: ent } = await supabase
            .from("elimination_round_entries")
            .select("user_id, points_earned")
            .eq("round_id", r.id);
          entriesMap[r.id] = Array.isArray(ent) ? ent : [];
        }

        let avail = null;
        try {
          const { data } = await supabase.rpc("pt_available_today", { p_uid: userId });
          avail = Number(data || 0);
        } catch { /* ignore */ }

        if (!cancelled) {
          setParticipants(withMeta);
          setRounds(Array.isArray(roundRows) ? roundRows : []);
          setEntriesByRound(entriesMap);
          setAvailableToday(avail);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tournament.id, refreshToken, hardRefreshToken, userId]);

  // compute live round & countdown
  const activeRound = useMemo(() => {
    if (!rounds?.length) return null;
    const open = [...rounds].reverse().find(r => !r.closed_at);
    return open || null;
  }, [rounds]);
  const countdown = useCountdown(activeRound?.ends_at || null);

  // acceptance / decline
  const acceptInvite = useCallback(async () => {
    setBusy("accept");
    try {
      const { error } = await supabase.rpc("accept_tournament_invite", { p_tournament_id: tournament.id });
      if (error) throw error;
      onChanged && onChanged();
    } catch (e) {
      console.warn("[elim] accept failed", e);
    } finally { setBusy(""); }
  }, [tournament.id, onChanged]);

  const declineInvite = useCallback(async () => {
    setBusy("decline");
    try {
      const { error } = await supabase.rpc("decline_tournament_invite", { p_tournament_id: tournament.id });
      if (error) throw error;
      onChanged && onChanged();
    } catch (e) {
      console.warn("[elim] decline failed", e);
    } finally { setBusy(""); }
  }, [tournament.id, onChanged]);

  // derive battle-royale datasets
  const acceptedUsers = useMemo(
    () => participants.filter(p => (p.invite_status || "").toLowerCase() === "accepted"),
    [participants]
  );
  const survivorsSet = useMemo(() => {
    // build elimination via block-sum logic at elim rounds
    let activeSet = new Set(acceptedUsers.map(u => u.id));
    let blockPoints = new Map([...activeSet].map(uid => [uid, 0]));
    const ordered = [...rounds].sort((a,b) => (a.round_number||0) - (b.round_number||0));
    for (const r of ordered) {
      const entries = entriesByRound[r.id] || [];
      const ptsByUser = new Map(entries.map(e => [e.user_id, Number(e.points_earned ?? 0)]));
      for (const uid of activeSet) {
        const prev = blockPoints.get(uid) ?? 0;
        blockPoints.set(uid, prev + (ptsByUser.get(uid) ?? 0));
      }
      const isElimination = typeof r.is_elimination === "boolean"
        ? r.is_elimination
        : ((Number(r.round_number) || 0) % Math.max(1, Number(tournament.rounds_to_elimination || 1)) === 0);
      if (!isElimination) continue;

      let minSum = Infinity, maxSum = -Infinity;
      for (const uid of activeSet) {
        const v = blockPoints.get(uid) ?? 0;
        if (v < minSum) minSum = v;
        if (v > maxSum) maxSum = v;
      }
      const allTied = Number.isFinite(minSum) && minSum === maxSum;
      if (!allTied && maxSum > minSum) {
        for (const uid of Array.from(activeSet)) {
          if ((blockPoints.get(uid) ?? 0) === minSum) activeSet.delete(uid);
        }
      }
      blockPoints = new Map([...activeSet].map(uid => [uid, 0]));
    }
    return activeSet;
  }, [acceptedUsers, rounds, entriesByRound, tournament.rounds_to_elimination]);

  const eliminatedMap = useMemo(() => {
    // map userId -> elimination round (first elim round where they dropped)
    const map = new Map();
    let activeSet = new Set(acceptedUsers.map(u => u.id));
    let blockPoints = new Map([...activeSet].map(uid => [uid, 0]));
    const ordered = [...rounds].sort((a,b) => (a.round_number||0) - (b.round_number||0));
    for (const r of ordered) {
      const entries = entriesByRound[r.id] || [];
      const ptsByUser = new Map(entries.map(e => [e.user_id, Number(e.points_earned ?? 0)]));
      for (const uid of activeSet) {
        const prev = blockPoints.get(uid) ?? 0;
        blockPoints.set(uid, prev + (ptsByUser.get(uid) ?? 0));
      }
      const isElimination = typeof r.is_elimination === "boolean"
        ? r.is_elimination
        : ((Number(r.round_number) || 0) % Math.max(1, Number(tournament.rounds_to_elimination || 1)) === 0);
      if (!isElimination) continue;

      let minSum = Infinity, maxSum = -Infinity;
      for (const uid of activeSet) {
        const v = blockPoints.get(uid) ?? 0;
        if (v < minSum) minSum = v;
        if (v > maxSum) maxSum = v;
      }
      const allTied = Number.isFinite(minSum) && minSum === maxSum;
      if (!allTied && maxSum > minSum) {
        for (const uid of Array.from(activeSet)) {
          if ((blockPoints.get(uid) ?? 0) === minSum) {
            map.set(uid, r.round_number || 0);
            activeSet.delete(uid);
          }
        }
      }
      blockPoints = new Map([...activeSet].map(uid => [uid, 0]));
    }
    return map;
  }, [acceptedUsers, rounds, entriesByRound, tournament.rounds_to_elimination]);

  const survivorsCount = survivorsSet.size;
  const youElimRound = eliminatedMap.get(userId) || null;
  const youStatusText = youElimRound ? `Eliminated R${youElimRound}` : "You’re still in!";

  const inviteStats = useMemo(() => {
    let a = 0, p = 0, d = 0, mine = null;
    for (const u of participants) {
      const s = (u.invite_status || "pending").toLowerCase();
      if (s === "accepted") a++; else if (s === "declined") d++; else p++;
      if (u.id === userId) mine = s;
    }
    return { acceptedCount: a, pendingCount: p, declinedCount: d, myInviteStatus: mine };
  }, [participants, userId]);

  const pot = (Number(tournament.stake_points || 0) * inviteStats.acceptedCount) || 0;

  // round history chips (player names are optional)
  const roundHistory = useMemo(() => {
    return (rounds || []).map(r => {
      const isClosed = !!r.closed_at || (r.ends_at ? new Date(r.ends_at) <= new Date() : false);
      return {
        roundNumber: r.round_number,
        endsAt: r.ends_at,
        isClosed,
      };
    });
  }, [rounds]);

  return (
    <View style={styles.brCard}>
      {/* Header */}
      <View style={styles.brHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.brTitle}>{tournament.name || "Elimination"}</Text>
          <Text style={styles.brMeta}>
            {isLobby ? "Lobby" : isLive ? "Live" : "Finished"} • Stake {Number(tournament.stake_points || 0)} pts
            {Number.isFinite(timeLimitMin) && timeLimitMin > 0 ? ` • ${timeLimitMin}m rounds` : ""}
            {roundsToElim ? ` • ELIM each ${roundsToElim}r` : ""}
          </Text>
        </View>
        <View style={[styles.statusPill, youElimRound ? styles.pillDanger : styles.pillSuccess]}>
          <Text style={[styles.pillText, youElimRound ? styles.pillTextDanger : styles.pillTextSuccess]}>
            {youStatusText}
          </Text>
        </View>
      </View>

      {/* Body grid */}
      <View style={styles.brBody}>
        {/* Arena */}
        <ArenaCircle survivorsCount={survivorsCount} currentRound={activeRound?.round_number || Math.max(...rounds.map(r => r.round_number || 0), 1)} totalRounds={Math.max(...rounds.map(r => r.round_number || 0), 1)} />

        {/* Right side: chips + log + lobby actions */}
        <View style={{ flex: 1, gap: 10 }}>
          {/* Round history */}
          <View style={styles.roundHistoryBox}>
            <View style={styles.rowBetween}>
              <Text style={styles.rhTitle}>Round History</Text>
              {isLive && activeRound?.ends_at ? <Text style={styles.rhCountdown}>⏳ {useCountdown(activeRound.ends_at)}</Text> : null}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {roundHistory.map(r => (
                <View key={r.roundNumber} style={[styles.rhChip, r.isClosed ? styles.rhChipClosed : styles.rhChipOpen]}>
                  <Text style={[styles.rhChipText, r.isClosed ? styles.rhChipTextClosed : styles.rhChipTextOpen]}>
                    R{r.roundNumber}
                  </Text>
                </View>
              ))}
            </ScrollView>
          </View>

          {/* Badges */}
          <View style={styles.badgesRow}>
            <Badge text={`Accepted ${inviteStats.acceptedCount}`} tone="green" />
            <Badge text={`Pending ${inviteStats.pendingCount}`} tone="amber" />
            {!!inviteStats.declinedCount && <Badge text={`Declined ${inviteStats.declinedCount}`} tone="red" />}
            <Badge text={`Pot ${pot} pts`} tone="indigo" />
          </View>

          {/* Lobby actions */}
          {isLobby && (
            <View style={styles.actionsRow}>
              {inviteStats.myInviteStatus !== "accepted" ? (
                <TouchableOpacity
                  style={[styles.btn, styles.btnPrimary, (availableToday === 0 || busy === "accept") && styles.btnDisabled]}
                  disabled={availableToday === 0 || busy === "accept"}
                  onPress={acceptInvite}
                >
                  <Text style={styles.btnText}>{busy === "accept" ? "Accepting…" : "Accept Invite"}</Text>
                </TouchableOpacity>
              ) : (
                <Badge text="You joined" tone="green" />
              )}
              {inviteStats.myInviteStatus !== "declined" && (
                <TouchableOpacity
                  style={[styles.btn, styles.btnGhost, busy === "decline" && styles.btnDisabled]}
                  disabled={busy === "decline"}
                  onPress={declineInvite}
                >
                  <Text style={styles.btnGhostText}>{busy === "decline" ? "Declining…" : "Decline"}</Text>
                </TouchableOpacity>
              )}
              {tournament.join_deadline ? (
                <View style={{ marginLeft: "auto" }}>
                  <Text style={styles.deadlineText}>Join by {fmtDateTime(tournament.join_deadline)}</Text>
                </View>
              ) : null}
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

// Arena visualization (concentric rings)
function ArenaCircle({ currentRound, totalRounds, survivorsCount }) {
  const rings = Array.from({ length: Math.max(totalRounds || 1, 1) }, (_, i) => i + 1);
  return (
    <View style={styles.arenaWrap}>
      <View style={styles.arena}>
        {rings.map((r) => {
          const active = r <= (currentRound || 1);
          return (
            <View
              key={r}
              style={[
                StyleSheet.absoluteFillObject,
                styles.arenaRing,
                { top: (r - 1) * 10, left: (r - 1) * 10, right: (r - 1) * 10, bottom: (r - 1) * 10 },
                active ? styles.arenaRingActive : styles.arenaRingIdle,
              ]}
            />
          );
        })}
        <View style={styles.arenaCenter}>
          <Text style={styles.arenaSurvivors}>{survivorsCount}</Text>
          <Text style={styles.arenaSub}>survivors</Text>
          <Text style={styles.arenaSubSmall}>Round {currentRound || 1} of {Math.max(totalRounds || 1, 1)}</Text>
        </View>
      </View>
    </View>
  );
}

function Badge({ text, tone = "gray" }) {
  const color = {
    gray: { bg: "#e5e7eb", fg: "#111827" },
    green: { bg: "#dcfce7", fg: "#166534" },
    amber: { bg: "#fef3c7", fg: "#92400e" },
    red: { bg: "#fee2e2", fg: "#991b1b" },
    indigo: { bg: "#e0e7ff", fg: "#3730a3" },
  }[tone] || { bg: "#e5e7eb", fg: "#111827" };
  return (
    <View style={[styles.badge, { backgroundColor: color.bg }]}>
      <Text style={[styles.badgeText, { color: color.fg }]}>{text}</Text>
    </View>
  );
}

// ---------- Styles ----------
const styles = StyleSheet.create({
  tabsHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
    backgroundColor: "#fff",
  },
  tabBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: "#f3f4f6",
  },
  tabBtnActive: {
    backgroundColor: "#166534",
  },
  tabText: { fontWeight: "700", color: "#111827" },
  tabTextActive: { color: "#fff" },
  createBtn: {
    marginLeft: "auto",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "#166534",
  },
  createBtnText: { color: "#fff", fontWeight: "700" },

  page: {
    flexGrow: 1,
    padding: 14,
    backgroundColor: "#fafafa",
  },

  loadingRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 },
  loadingText: { color: "#374151" },
  errorBox: { borderWidth: 1, borderColor: "#fecaca", backgroundColor: "#fee2e2", padding: 10, borderRadius: 10 },
  errorTitle: { color: "#991b1b", fontWeight: "700", marginBottom: 2 },
  errorText: { color: "#7f1d1d" },
  emptyText: { color: "#6b7280", fontStyle: "italic" },

  // BR card
  brCard: {
    borderWidth: 1, borderColor: "#111827", backgroundColor: "#0b0b0f",
    borderRadius: 16, overflow: "hidden",
  },
  brHeader: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 12, paddingVertical: 12,
    backgroundColor: "#111217", borderBottomWidth: 1, borderBottomColor: "#181a20",
  },
  brTitle: { fontSize: 16, fontWeight: "800", color: "#e5e7eb" },
  brMeta: { fontSize: 12, color: "#9ca3af" },
  statusPill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  pillSuccess: { borderColor: "#34d39933", backgroundColor: "#10b98126" },
  pillDanger: { borderColor: "#fda4af33", backgroundColor: "#ef444426" },
  pillText: { fontSize: 12, fontWeight: "700" },
  pillTextSuccess: { color: "#a7f3d0" },
  pillTextDanger: { color: "#fecaca" },

  brBody: { flexDirection: "row", gap: 12, padding: 12 },
  arenaWrap: { width: 220, alignItems: "center", justifyContent: "center" },
  arena: { width: 220, height: 220, position: "relative" },
  arenaRing: { borderRadius: 999, borderWidth: 1 },
  arenaRingActive: { borderColor: "#34d39966", backgroundColor: "#10b98112" },
  arenaRingIdle: { borderColor: "#3f3f46", backgroundColor: "#1f1f24" },
  arenaCenter: { position: "absolute", inset: 0, alignItems: "center", justifyContent: "center" },
  arenaSurvivors: { color: "#e5e7eb", fontSize: 32, fontWeight: "900" },
  arenaSub: { color: "#9ca3af", fontSize: 12, marginTop: 2 },
  arenaSubSmall: { color: "#6b7280", fontSize: 11, marginTop: 2 },

  roundHistoryBox: { backgroundColor: "#0c0c12", borderWidth: 1, borderColor: "#1f2937", borderRadius: 12, padding: 10 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  rhTitle: { color: "#d1d5db", fontWeight: "700" },
  rhCountdown: { color: "#fca5a5", fontWeight: "700" },
  rhChip: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1 },
  rhChipOpen: { backgroundColor: "#065f4622", borderColor: "#10b98155" },
  rhChipClosed: { backgroundColor: "#27272a", borderColor: "#3f3f46" },
  rhChipText: { fontWeight: "700", fontSize: 12 },
  rhChipTextOpen: { color: "#a7f3d0" },
  rhChipTextClosed: { color: "#d4d4d8" },

  badgesRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  badgeText: { fontSize: 11, fontWeight: "600" },

  actionsRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  btn: { borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14 },
  btnPrimary: { backgroundColor: "#166534" },
  btnText: { color: "white", fontWeight: "700" },
  btnGhost: { backgroundColor: "#f3f4f6", borderWidth: 1, borderColor: "#e5e7eb" },
  btnGhostText: { color: "#111827", fontWeight: "700" },
  btnDisabled: { opacity: 0.6 },

  deadlineText: { fontSize: 11, color: "#6b7280" },
});
