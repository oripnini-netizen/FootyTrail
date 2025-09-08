// src/pages/EliminationTournamentsPage.jsx
import React, { useEffect, useMemo, useRef, useState, createRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../supabase";
import { useAuth } from "../context/AuthContext";

// Reuse the same API helpers used by GamePage
import {
  getCompetitions,
  getSeasons,
  getCounts,
  getRandomPlayer,
} from "../api";

import {
  Search,
  Star,
  CheckSquare,
  Trash2,
  CalendarClock,
  Axe,
  Bell,
  Coins, 
  Check,  
  X as XIcon,
  Play,
  User, 
} from "lucide-react";

/* ------------------------------------------------------------
   Small util(s)
------------------------------------------------------------ */
function classNames(...s) {
  return s.filter(Boolean).join(" ");
}

function fmtCurrency(n) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(Number(n || 0));
}

function normalizeSeasons(payload) {
  let raw = [];
  if (Array.isArray(payload)) raw = payload;
  else if (payload && Array.isArray(payload.seasons)) raw = payload.seasons;
  else if (payload && Array.isArray(payload.data)) raw = payload.data;
  const uniq = Array.from(new Set(raw.map(String)));
  uniq.sort((a, b) => String(b).localeCompare(String(a)));
  return uniq;
}

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

/* ------------------------------------------------------------
   FIX HELPERS: always resolve a round_id (never a tournament_id)
------------------------------------------------------------ */
async function getLatestOpenRoundIdForTournament(tournamentId) {
  const { data, error } = await supabase
    .from("elimination_rounds")
    .select("id, round_number, closed_at")
    .eq("tournament_id", tournamentId)
    .is("closed_at", null)
    .order("round_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data?.id ?? null;
}

async function finalizeLatestRoundForTournament(tournamentId) {
  const roundId = await getLatestOpenRoundIdForTournament(tournamentId);
  if (!roundId) throw new Error(`No open round found for tournament ${tournamentId}`);
  const { data, error } = await supabase.rpc("finalize_round", { p_round_id: roundId });
  if (error) throw error;
  return data;
}


/* ------------------------------------------------------------
   Page: EliminationTournamentsPage
------------------------------------------------------------ */
export default function EliminationTournamentsPage() {
  const { user } = useAuth();
  const [showCreateModal, setShowCreateModal] = useState(false);

  const [live, setLive] = useState([]);
  const [lobby, setLobby] = useState([]);
  const [finished, setFinished] = useState([]);
  const autoStartTriedRef = useRef(new Set());
  const [showAllFinished, setShowAllFinished] = useState(false);
  const [loading, setLoading] = useState({ lobby: true, live: true, finished: true });
  const [error, setError] = useState({ lobby: "", live: "", finished: "" });

  // Notifications banner (existing)
  const [notifBanner, setNotifBanner] = useState([]);

  // Force children to refetch on page reloads / realtime updates
  const [refreshTick, setRefreshTick] = useState(0);
  const [hardRefreshTick, setHardRefreshTick] = useState(0);

  // For pretty filter chips on cards
  const [groupedCompetitions, setGroupedCompetitions] = useState({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const compsRes = await getCompetitions();
        if (!cancelled) {
          setGroupedCompetitions(compsRes.groupedByCountry || {});
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const compIdToLabel = useMemo(() => {
    const map = {};
    Object.entries(groupedCompetitions || {}).forEach(([country, comps]) => {
      (comps || []).forEach((c) => {
        map[String(c.competition_id)] = `${country} - ${c.competition_name}`;
      });
    });
    return map;
  }, [groupedCompetitions]);

  const handleOpenCreate = () => setShowCreateModal(true);

  // Reload both lists (used on mount and after create || advance)
  const reloadLists = async () => {
    if (!user?.id) {
      setLobby([]);
      setLive([]);
      setFinished([]);
      setLoading({ lobby: false, live: false, finished: false });
      setError({ lobby: "", live: "", finished: "" });
      return;
    }

    
// Lobby
setLoading((s) => ({ ...s, lobby: true }));
setError((e) => ({ ...e, lobby: "" }));
try {
  const { data, error: err } = await supabase
    .from("elimination_tournaments")
    .select(
      "id, name, status, created_at, round_time_limit_seconds, filters, winner_user_id, rounds_to_elimination, stake_points, min_participants, join_deadline, owner_id"
    )
    .eq("status", "lobby")
    .order("created_at", { ascending: false });
  if (err) {
    setError((e) => ({ ...e, lobby: err.message || "Failed to load." }));
    setLobby([]);
  } else {
    
    // Apply visibility filtering for Lobby
    try {
      const all = Array.isArray(data) ? data : [];
      const pub = all.filter(t => ((t?.filters || {}).visibility || 'private') === 'public');
      const priv = all.filter(t => ((t?.filters || {}).visibility || 'private') !== 'public');
      let canSeePriv = [];
      if (priv.length && user?.id) {
        const ids = priv.map(t => t.id);
        const { data: mine } = await supabase
          .from('elimination_participants')
          .select('tournament_id, invite_status')
          .eq('user_id', user.id)
          .in('tournament_id', ids);
        const setIds = new Set((mine || []).map(r => r.tournament_id));
        canSeePriv = priv.filter(t => t.owner_id === user.id || setIds.has(t.id));
      }
      setLobby([...pub, ...canSeePriv].sort((a,b)=> new Date(b.created_at)-new Date(a.created_at)));

      // Opportunistic auto-start of due lobby tournaments (join_deadline passed)
      try {
        const dueLobbies = ([...pub, ...canSeePriv] || []).filter(t => {
          const dl = t?.join_deadline ? new Date(t.join_deadline) : null;
          const isLobby = t?.status === 'lobby';
          const isDue = !!dl && dl <= new Date();
          const notTried = !autoStartTriedRef.current.has(t?.id);
          return isLobby && isDue && notTried;
        });
        if (dueLobbies.length) {
          dueLobbies.forEach(t => autoStartTriedRef.current.add(t.id));
          await Promise.allSettled(
            dueLobbies.map(t => supabase.rpc('start_elimination_tournament', { p_tournament_id: t.id }))
          );
        }
      } catch (e) {
        console.warn('[elim] opportunistic autostart failed', e);
      }

    } catch { setLobby(Array.isArray(data) ? data : []); }

  // Opportunistic auto-start (fallback branch)
  try {
    const allLobbies = (Array.isArray(data) ? data : []).filter(t => {
      const dl = t?.join_deadline ? new Date(t.join_deadline) : null;
      const isLobby = t?.status === 'lobby';
      const isDue = !!dl && dl <= new Date();
      const notTried = !autoStartTriedRef.current.has(t?.id);
      return isLobby && isDue && notTried;
    });
    if (allLobbies.length) {
      allLobbies.forEach(t => autoStartTriedRef.current.add(t.id));
      await Promise.allSettled(
        allLobbies.map(t => supabase.rpc('start_elimination_tournament', { p_tournament_id: t.id }))
      );
    }
  } catch (e) {
    console.warn('[elim] opportunistic autostart (fallback) failed', e);
  }


  }
} catch {
  setError((e) => ({ ...e, lobby: "Failed to load." }));
  setLobby([]);
} finally {
  setLoading((s) => ({ ...s, lobby: false }));
}

    // Live
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
      if (err) {
        setError((e) => ({ ...e, live: err.message || "Failed to load." }));
        setLive([]);
      } else {
        
    // Apply visibility filtering for Live
    try {
      const all = Array.isArray(data) ? data : [];
      if (user?.id) {
        const ids = all.map(t => t.id);
        const { data: mine } = await supabase
          .from('elimination_participants')
          .select('tournament_id, invite_status')
          .eq('user_id', user.id)
          .in('tournament_id', ids);
        const accepted = new Set((mine || []).filter(r => (r.invite_status||'').toLowerCase()==='accepted').map(r => r.tournament_id));
        setLive(all.filter(t => accepted.has(t.id)).sort((a,b)=> new Date(b.created_at)-new Date(a.created_at)));
      } else {
        setLive([]);
      }
    } catch { setLive([]); }

      }
    } catch {
      setError((e) => ({ ...e, live: "Failed to load." }));
      setLive([]);
    } finally {
      setLoading((s) => ({ ...s, live: false }));
    }

    // Finished
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
      if (err) {
        setError((e) => ({
          ...e,
          finished: err.message || "Failed to load.",
        }));
        setFinished([]);
      } else {
        setFinished(Array.isArray(data) ? data : []);
      }
    } catch {
      setError((e) => ({ ...e, finished: "Failed to load." }));
      setFinished([]);
    } finally {
      setLoading((s) => ({ ...s, finished: false }));
      setRefreshTick((t) => t + 1);
    }
  };

  // Initial / on user change
  useEffect(() => {
    reloadLists();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
  // Auto-refresh every 30s ONLY when there are lobby/live tournaments
  useEffect(() => {
    if ((live.length || lobby.length) === 0) return;
    const id = setInterval(() => {
      reloadLists();
    }, 30000);
    return () => clearInterval(id);
  }, [live.length, lobby.length]);


  // Realtime subscriptions: reload on any change in elim tables
  useEffect(() => {
    const ch = supabase
      .channel("elim-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "elimination_tournaments" },
        (payload) => {
          const isInsert = payload?.eventType === "INSERT";
          const stakeChanged = (payload?.old?.stake_points ?? null) !== (payload?.new?.stake_points ?? null);
          if (isInsert || stakeChanged) {
            setHardRefreshTick((t) => t + 1);
          }
          reloadLists();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "elimination_rounds" },
        (payload) => {
          const wasOpen = payload?.old?.closed_at == null;
          const nowClosed = payload?.new?.closed_at != null;
          const isInsert = payload?.eventType === "INSERT";
          if ((wasOpen && nowClosed) || isInsert) {
            setHardRefreshTick((t) => t + 1);
            reloadLists();
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "elimination_round_entries" },
        () => reloadLists()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "elimination_participants" },
        (payload) => {
          const isInsert = payload?.eventType === "INSERT";
          if (isInsert) setHardRefreshTick((t) => t + 1);
          reloadLists();
        }
      )
      
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "point_transactions" },
        () => reloadLists()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load unread elimination notifications ON FIRST VISIT, then mark as read
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    async function loadAndMark() {
      const { data: unread } = await supabase
        .from("notifications")
        .select("id, type, payload, created_at") // <-- IMPORTANT: include type so we can render details
        .eq("user_id", user.id)
        .in("type", [
          "elimination_invite",
          "elim_invite_accepted",
          "elim_invite_declined",
          "elim_invite_expired",
          "elim_tournament_started",
          "elim_tournament_canceled_refund",
        ])
        .is("read_at", null)
        .order("created_at", { ascending: false });

      if (!cancelled && unread?.length) {
        setNotifBanner(
          unread.map((n) => ({
            id: n.id,
            created_at: n.created_at,
            type: n.type,           // now present
            ...n.payload,           // flatten payload for convenient access
          }))
        );

        const ids = unread.map((n) => n.id);
        await supabase
          .from("notifications")
          .update({ read_at: new Date().toISOString() })
          .in("id", ids);

        window.dispatchEvent(new Event("elimination-notifications-read"));
      }
    }
    loadAndMark();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // Identify the most recent finished tournament (created_at desc)
  const mostRecentFinishedId = finished?.[0]?.id || null;

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-green-50 to-transparent">
      <div className="fixed inset-0 -z-10 bg-gradient-to-b from-green-50 to-transparent" />
      <div className="container mx-auto py-8 px-4 max-w-6xl">
        {/* Page header */}
        <header className="mb-4 sm:mb-6 text-center">
          <h1 className="flex items-center justify-center gap-3 text-4xl font-extrabold text-green-800">
            <Axe className="h-8 w-8 text-green-800" aria-hidden="true" />
            <span>Elimination Challenges</span>
          </h1>
          <p className="mt-2 text-sm text-gray-700">
            Create and follow elimination challenges with friends. Each round
            uses the same mystery player for everyone. Lowest score(s) are
            eliminated until a single winner remains. Creators choose how often eliminations occur (every 1–5 rounds).
          </p>
          {/* User Stats */}
          {user?.id && (
            <UserElimStats userId={user.id} />
          )}


          {/* Notifications banner */}
          {notifBanner.length > 0 && (
            <div className="mt-6 rounded-xl border bg-amber-50 px-4 py-3 shadow-sm text-left">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 h-8 w-8 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center">
                  <Bell className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-amber-900 mb-1">
                    Notifications
                  </div>
                  <ul className="space-y-1">
                    {notifBanner.map((n) => (
                      <li key={n.id} className="text-sm text-amber-900">
                        {n.type === "elimination_invite" && (
                          <>
                            You were invited to{" "}
                            <span className="font-medium">{n.tournament_name || "a challenge"}</span>{" "}
                            {n.creator_name ? (
                              <>
                                by{" "}
                                <span className="font-medium">{n.creator_name}</span>
                              </>
                            ) : null}
                            {typeof n.round_time_limit_minutes === "number" ? (
                              <>
                                {" "}
                                — round limit{" "}
                                <span className="font-medium">
                                  {n.round_time_limit_minutes} min
                                </span>
                              </>
                            ) : null}
                            {Number.isFinite(Number(n.stake_points)) && Number(n.stake_points) > 0 ? (
                              <>
                                {" • "}stake{" "}
                                <span className="font-medium">{Number(n.stake_points)} pts</span>
                              </>
                            ) : null}
                            {Number.isFinite(Number(n.rounds_to_elimination)) && Number(n.rounds_to_elimination) > 0 ? (
                              <>
                                {" • "}elimination every{" "}
                                <span className="font-medium">
                                  {Number(n.rounds_to_elimination)}
                                </span>{" "}
                                {Number(n.rounds_to_elimination) === 1 ? "round" : "rounds"}
                              </>
                            ) : null}
                            {Number.isFinite(Number(n.min_participants)) && Number(n.min_participants) > 0 ? (
                              <>
                                {" • "}min{" "}
                                <span className="font-medium">
                                  {Number(n.min_participants)}
                                </span>{" "}
                                players
                              </>
                            ) : null}
                            {n.join_deadline ? (
                              <>
                                {" • "}join by{" "}
                                <span className="font-medium">
                                  {new Date(n.join_deadline).toLocaleString()}
                                </span>
                              </>
                            ) : null}
                          </>
                        )}
                        {n.type === "elim_invite_accepted" && (
                          <>
                            Someone accepted your invite for{" "}
                            <span className="font-medium">{n.tournament_name}</span>.
                          </>
                        )}
                        {n.type === "elim_invite_declined" && (
                          <>
                            Someone declined your invite for{" "}
                            <span className="font-medium">{n.tournament_name}</span>.
                          </>
                        )}
                        {n.type === "elim_invite_expired" && (
                          <>
                            Your invite to{" "}
                            <span className="font-medium">{n.tournament_name}</span>{" "}
                            expired.
                          </>
                        )}
                        {n.type === "elim_tournament_started" && (
                          <>
                            <span className="font-medium">{n.tournament_name}</span>{" "}
                            has started
                            {Number.isFinite(Number(n.pot)) && Number(n.pot) > 0 ? (
                              <>
                                {" — "}pot <span className="font-medium">{Number(n.pot)} pts</span>
                              </>
                            ) : null}
                            {Number.isFinite(Number(n.stake_points)) && Number(n.stake_points) > 0 ? (
                              <>
                                {" • "}stake{" "}
                                <span className="font-medium">{Number(n.stake_points)} pts</span>
                              </>
                            ) : null}
                          </>
                        )}
                        {n.type === "elim_tournament_canceled_refund" && (
                          <>
                            <span className="font-medium">{n.tournament_name}</span>{" "}
                            was canceled, your stake was refunded
                            {Number.isFinite(Number(n.stake_points)) && Number(n.stake_points) > 0 ? (
                              <>
                                {" "}
                                (<span className="font-medium">{Number(n.stake_points)} pts</span>)
                              </>
                            ) : null}
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Create button */}
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              onClick={handleOpenCreate}
              className="rounded-lg bg-green-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-green-800"
            >
              + Create New Elimination Challenge
            </button>
          </div>
        </header>

        {/* Content */}
        <section
          className="grid grid-cols-1 gap-4 sm:grid-cols-1 lg:grid-cols-1"
          aria-live="polite"
          aria-busy={loading.lobby || loading.live || loading.finished}
        >

{/* Lobby */}
{loading.lobby ? (
  <>
    <SkeletonCard />
    <SkeletonCard />
    <SkeletonCard />
  </>
) : error.lobby ? (
  <ErrorCard
    title="Couldn't load lobby tournaments"
    message={error.lobby}
  />
) : (
  <>
    {lobby.map((t) => (
      <TournamentCard
        key={t.id}
        tournament={t}
        compIdToLabel={compIdToLabel}
        onAdvanced={reloadLists}
        defaultCollapsed={false}
        refreshToken={refreshTick}
        hardRefreshToken={hardRefreshTick}
      />
    ))}
  </>
)}

          {/* Live */}
          {loading.live ? (
            <>
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </>
          ) : error.live ? (
            <ErrorCard
              title="Couldn't load live tournaments"
              message={error.live}
            />
          ) : (
            <>
              {live.map((t) => (
                <TournamentCard
                  key={t.id}
                  tournament={t}
                  compIdToLabel={compIdToLabel}
                  onAdvanced={reloadLists}
                  defaultCollapsed={false}
                  refreshToken={refreshTick}
                  hardRefreshToken={hardRefreshTick}
                />
              ))}
            </>
          )}

          {/* Finished */}
          {loading.finished ? (
            <>
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </>
          ) : error.finished ? (
            <ErrorCard
              title="Couldn't load finished tournaments"
              message={error.finished}
            />
          ) : (
            <>
              {(() => {
                const visibleFinished = showAllFinished ? finished : finished.slice(0, 1);
                return (
                  <>
                    {visibleFinished.map((t) => (
                      <TournamentCard
                        key={t.id}
                        tournament={t}
                        compIdToLabel={compIdToLabel}
                        onAdvanced={reloadLists}
                        defaultCollapsed={!(lobby.length === 0 && live.length === 0 && t.id === mostRecentFinishedId)}
                        refreshToken={refreshTick}
                        hardRefreshToken={hardRefreshTick}
                      />
                    ))}
                    {finished.length > 1 && (
                      <div className="mt-2 flex justify-center">
                        <button
                          type="button"
                          onClick={() => setShowAllFinished(v => !v)}
                          className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium shadow-sm bg-white hover:bg-gray-50"
                        >
                          {showAllFinished ? 'Hide previous finished challenges' : `Show previous finished challenges (${finished.length - 1})`}
                        </button>
                      </div>
                    )}
                  </>
                );
              })()}</>
          )}
        </section>
      </div>

      {showCreateModal && (
        <CreateTournamentModal
          currentUser={user || null}
          onClose={() => setShowCreateModal(false)}
          onCreated={reloadLists}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------
   Cards & helpers
------------------------------------------------------------ */
function Countdown({ endsAt, onEnd }) {
  const [left, setLeft] = useState(() => format(endsAt));
  const endedRef = useRef(false);

  useEffect(() => {
  setLeft(format(endsAt));
  endedRef.current = false;
  if (!endsAt) return;
  const id = setInterval(() => {
    // compute remaining ms to trigger onEnd once
    const endMs = new Date(endsAt).getTime();
    const diff = endMs - Date.now();
    if (diff <= 0 && !endedRef.current) {
      endedRef.current = true;
      try { onEnd && onEnd(); } catch (_) {}
    }
    setLeft(format(endsAt));
  }, 1000);
  return () => clearInterval(id);
}, [endsAt, onEnd]);
function format(endIso) {
    if (!endIso) return "—";
    const end = new Date(endIso).getTime();
    const now = Date.now();
    const ms = Math.max(0, end - now);
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${ss}s`;
    return `${ss}s`;
  }

  return <span className="text-red-600">{left}</span>;
}

/** Fetches player meta only when needed (for finished rounds) */
function RoundPlayer({ playerId }) {
  const [meta, setMeta] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!playerId) return;
      const { data, error } = await supabase
        .from("players_in_seasons")
        .select(
          "player_id, player_name, player_position, player_dob_age, player_nationality, player_photo"
        )
        .eq("player_id", playerId)
        .limit(1)
        .maybeSingle();
      if (!alive) return;
      setMeta(error ? null : data || null);
    })();
    return () => {
      alive = false;
    };
  }, [playerId]);

  if (!meta)
    return <div className="text-sm text-gray-500">Player details unavailable.</div>;

  return (
    <div className="flex items-center gap-3">
      {meta.player_photo ? (
        <img
          src={meta.player_photo}
          alt={meta.player_name || "Player"}
          className="h-10 w-10 rounded object-cover"
        />
      ) : (
        <div className="h-10 w-10 rounded bg-gray-200" />
      )}
      <div className="text-sm text-gray-700">
        <div className="font-medium">{meta.player_name || "—"}</div>
        <div className="text-xs text-gray-500">
          {(meta.player_position || "?") + " • " + (meta.player_nationality || "?")}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------
   Confetti + Winner Celebration (existing)
------------------------------------------------------------ */
function ConfettiRain({ count = 80, durationMs = 4000 }) {
  const pieces = useMemo(() => {
    const arr = [];
    for (let i = 0; i < count; i++) {
      const left = Math.random() * 100;
      const delay = Math.random() * 0.8;
      const scale = 0.6 + Math.random() * 0.8;
      const rotate = Math.floor(Math.random() * 360);
      arr.push({ left, delay, scale, rotate });
    }
    return arr;
  }, [count]);

  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-0 h-0 overflow-visible"
      aria-hidden="true"
    >
      {pieces.map((p, idx) => (
        <span
          key={idx}
          className="absolute block"
          style={{
            left: `${p.left}%`,
            top: "-16px",
            width: "10px",
            height: "14px",
            transform: `scale(${p.scale}) rotate(${p.rotate}deg)`,
            background: ["#16a34a", "#22c55e", "#a3e635", "#065f46", "#34d399"][idx % 5],
            animation: `ft-fall ${durationMs}ms linear ${p.delay}s 1`,
            borderRadius: "2px",
          }}
        />
      ))}
      <style>{`
        @keyframes ft-fall {
          0% { transform: translateY(0) rotate(0deg); opacity: 1; }
          100% { transform: translateY(220px) rotate(360deg); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

function WinnerStarAvatar({ src, alt }) {
  return (
    <div className="relative inline-flex items-center justify-center">
      <svg viewBox="0 0 100 100" className="w-28 h-28 text-yellow-400 drop-shadow">
        <polygon
          points="50,5 61,35 95,35 67,55 77,88 50,70 23,88 33,55 5,35 39,35"
          fill="currentColor"
          stroke="#eab308"
          strokeWidth="2"
        />
      </svg>
      <img
        src={src || ""}
        alt={alt || "Winner"}
        className="absolute w-20 h-20 rounded-full object-cover ring-4 ring-white"
        style={{ top: 30, left: 30 }}
        onError={(e) => {
          e.currentTarget.style.display = "none";
        }}
      />
    </div>
  );
}

function WinnerCelebrationCard({ tournamentName, winner, stats, ranking, potPoints }) {
  return (
    <div className="relative overflow-hidden rounded-xl border bg-gradient-to-b from-amber-50 to-white p-4 md:p-5 shadow-sm">
      <ConfettiRain />

      <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-6">
        <div className="flex items-center justify-center md:justify-start">
          <WinnerStarAvatar
            src={winner?.profile_photo_url || ""}
            alt={winner?.full_name || winner?.email || "Winner"}
          />
        </div>

        <div className="flex-1">
          <div className="text-2xl font-extrabold text-green-800 flex items-center gap-2">
            🏆 Congratulations, {winner?.full_name || winner?.email || "Champion"}!
          </div>
          <p className="mt-1 text-sm text-gray-700">
            You conquered <span className="font-semibold">{tournamentName}</span> and outlasted everyone. Glory secured! You won <span className="font-semibold">{potPoints} pts</span>.
          </p>

          {/* Stats */}
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="rounded-lg bg-white border p-3">
              <div className="text-xs text-gray-500">Rounds</div>
              <div className="text-lg font-semibold text-gray-900">{stats.rounds}</div>
            </div>
            <div className="rounded-lg bg-white border p-3">
              <div className="text-xs text-gray-500">Time Played</div>
              <div className="text-lg font-semibold text-gray-900">{stats.timePlayed}</div>
            </div>
            <div className="rounded-lg bg-white border p-3">
              <div className="text-xs text-gray-500">Participants</div>
              <div className="text-lg font-semibold text-gray-900">{stats.participants}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Ranking of other users */}
      <div className="mt-5">
        <div className="text-sm font-semibold text-gray-700 mb-2">Final Standings</div>
        {ranking.length === 0 ? (
          <div className="text-sm text-gray-500">No other participants.</div>
        ) : (
          <ol className="space-y-1">
            <li className="flex items-center justify-between rounded-md bg-emerald-50 border border-emerald-100 px-3 py-2">
              <span className="font-semibold text-emerald-800">
                1. {winner?.full_name || winner?.email || "Winner"}
              </span>
              <span className="text-xs text-emerald-700">Winner</span>
            </li>
            {ranking.map((r, idx) => (
              <li
                key={r.user.id}
                className="flex items-center justify-between rounded-md bg-white border px-3 py-2"
              >
                <span className="truncate">
                  {idx + 2}. {r.user.full_name || r.user.email}
                </span>
                <span className="text-xs text-gray-600">
                  Eliminated R{r.eliminatedAtRound}
                  {Number.isFinite(r.lastPoints) ? ` • ${r.lastPoints} pts` : ""}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------
   NEW: Loser Final Card (shown to non-winners)
------------------------------------------------------------ */
function LoserFinalCard({ tournamentName, winner, stats, ranking, stakePoints }) {
  return (
    <div className="relative overflow-hidden rounded-xl border bg-gradient-to-b from-red-50 to-white p-4 md:p-5 shadow-sm">
      <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-6">
        <div className="flex items-center justify-center md:justify-start">
          {/* Winner avatar in a simple ring (no star, no confetti) */}
          <img
            src={winner?.profile_photo_url || ""}
            alt={winner?.full_name || winner?.email || "Winner"}
            className="w-24 h-24 rounded-full object-cover ring-4 ring-red-100"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        </div>

        <div className="flex-1">
          <div className="text-2xl font-extrabold text-red-700 flex items-center gap-2">
            ❌ You lost {tournamentName}.
          </div>
          <p className="mt-1 text-sm text-gray-700">
            Shamefully defeated—bow before{" "}
            <span className="font-semibold">
              {winner?.full_name || winner?.email || "the victor"}
            </span>
            . Train harder and return stronger. You lost <span className="font-semibold">{stakePoints} pts</span>.
          </p>

        {/* Stats */}
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="rounded-lg bg-white border p-3">
              <div className="text-xs text-gray-500">Rounds</div>
              <div className="text-lg font-semibold text-gray-900">{stats.rounds}</div>
            </div>
            <div className="rounded-lg bg-white border p-3">
              <div className="text-xs text-gray-500">Time Played</div>
              <div className="text-lg font-semibold text-gray-900">{stats.timePlayed}</div>
            </div>
            <div className="rounded-lg bg-white border p-3">
              <div className="text-xs text-gray-500">Participants</div>
              <div className="text-lg font-semibold text-gray-900">{stats.participants}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Full standings (same list) */}
      <div className="mt-5">
        <div className="text-sm font-semibold text-gray-700 mb-2">Final Standings</div>
        {ranking.length === 0 ? (
          <div className="text-sm text-gray-500">No other participants.</div>
        ) : (
          <ol className="space-y-1">
            <li className="flex items-center justify-between rounded-md bg-emerald-50 border border-emerald-100 px-3 py-2">
              <span className="font-semibold text-emerald-800">
                1. {winner?.full_name || winner?.email || "Winner"}
              </span>
              <span className="text-xs text-emerald-700">Winner</span>
            </li>
            {ranking.map((r, idx) => (
              <li
                key={r.user.id}
                className="flex items-center justify-between rounded-md bg-white border px-3 py-2"
              >
                <span className="truncate">
                  {idx + 2}. {r.user.full_name || r.user.email}
                </span>
                <span className="text-xs text-gray-600">
                  Eliminated R{r.eliminatedAtRound}
                  {Number.isFinite(r.lastPoints) ? ` • ${r.lastPoints} pts` : ""}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}


/* ------------------------------------------------------------
   UserElimStats: small KPIs row
------------------------------------------------------------ */

/* ------------------------------------------------------------
   UserElimStats: small KPIs row (+ net elimination points)
------------------------------------------------------------ */
function UserElimStats({ userId }) {
  const [stats, setStats] = useState({ created: 0, participated: 0, wins: 0, roundsSurvived: 0, pointsNet: 0 });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Basic counts
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

        // Sum elimination net points directly from point_transactions.amount (client-side sum to avoid PostgREST aggregate quirks)
        let net = 0;
        try {
          const { data: tx, error: txErr } = await supabase
            .from("point_transactions")
            .select("amount")
            .eq("user_id", userId)
            .limit(10000);

          if (!txErr && Array.isArray(tx)) {
            net = tx.reduce((acc, r) => acc + (Number(r?.amount) || 0), 0);
          }
        } catch (e) {
          // leave net=0 on error
        }

        if (!cancelled) {
          setStats({
            created: p3?.count || 0,
            participated: p1?.count || 0,
            wins: p2?.count || 0,
            roundsSurvived: p4?.count || 0,
            pointsNet: net,
          });
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const netColor =
    stats.pointsNet > 0
      ? "text-emerald-700"
      : stats.pointsNet < 0
      ? "text-rose-700"
      : "text-gray-900";

  const netLabel =
    stats.pointsNet > 0 ? `+${stats.pointsNet}` : `${stats.pointsNet}`;

  return (
    <div className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-3 max-w-2xl mx-auto">
      <div className="rounded-lg border bg-white p-3 text-center shadow-sm">
  <div className="text-xs text-gray-500">Created</div>
  <div className="text-xl font-bold text-gray-900">{stats.created}</div>
</div>
<div className="rounded-lg border bg-white p-3 text-center shadow-sm">
  <div className="text-xs text-gray-500">Participated</div>
  <div className="text-xl font-bold text-gray-900">{stats.participated}</div>
</div>
<div className="rounded-lg border bg-white p-3 text-center shadow-sm">
  <div className="text-xs text-gray-500">Wins</div>
  <div className="text-xl font-bold text-gray-900">{stats.wins}</div>
</div>
<div className="rounded-lg border bg-white p-3 text-center shadow-sm">
  <div className="text-xs text-gray-500">Rounds Survived</div>
  <div className="text-xl font-bold text-gray-900">{stats.roundsSurvived}</div>
</div>
<div className="rounded-lg border bg-white p-3 text-center shadow-sm">
  <div className="flex items-center justify-center gap-1 text-xs text-gray-500">
    <Coins className="w-3.5 h-3.5" />
    <span>Points</span>
  </div>
  <div className={`text-xl font-bold ${netColor}`}>{netLabel}</div>
</div>
    </div>
  );
}
/* ------------------------------------------------------------
   Tournament Card
------------------------------------------------------------ */
function TournamentCard({
  tournament,
  compIdToLabel,
  onAdvanced,
  defaultCollapsed = false,
  refreshToken,
  hardRefreshToken,
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const userId = user?.id || null;

  const createdAt = new Date(tournament.created_at);
  const dateStr = createdAt.toLocaleString();
  const isLobby = tournament.status === "lobby";
  const isLive = tournament.status === "live";
  const isFinished = tournament.status === "finished";
  const timeLimitMin = Math.round(
    (tournament.round_time_limit_seconds || 0) / 60
  );

  const roundsToElim = Math.max(1, Number(tournament.rounds_to_elimination || 1));

  const [participants, setParticipants] = useState([]); // {id, full_name, email, profile_photo_url, state, invite_status}
  const [rounds, setRounds] = useState([]);
  const [entriesByRound, setEntriesByRound] = useState({});
  const [availableToday, setAvailableToday] = useState(null); 
  // Realtime bump for this card
  const [rtTick, setRtTick] = useState(0);
// NEW

  // NEW: card collapse, filters collapse
    const [toast, setToast] = useState(null);
const [cardCollapsed, setCardCollapsed] = useState(Boolean(defaultCollapsed));
  const [filtersCollapsed, setFiltersCollapsed] = useState(true);

  // Fetch participants + rounds + entries
  
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 2500); return () => clearTimeout(id); }, [toast]);
useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // participants + invite statuses + states
        const { data: partRows, error: partErr } = await supabase
          .from("elimination_participants")
          .select("user_id, state, invite_status, accepted_at, declined_at")
          .eq("tournament_id", tournament.id);

        if (partErr) console.error("[elim] participants load error", partErr);

        const idsFromParticipants = (partRows || []).map((r) => r.user_id);
        const stateByUserId = new Map(
          (partRows || []).map((r) => [r.user_id, r.state || null])
        );
        const inviteByUserId = new Map(
          (partRows || []).map((r) => [r.user_id, r.invite_status || "pending"])
        );

        let userRows = [];
        if (idsFromParticipants.length) {
          const { data: usersRows, error: usersErr } = await supabase
            .from("users")
            .select("id, full_name, email, profile_photo_url")
            .in("id", idsFromParticipants);
          if (usersErr) console.error("[elim] users load error", usersErr);
          userRows = usersRows || [];
        }

        // rounds (incl. is_elimination)
        const { data: roundRows, error: roundErr } = await supabase
          .from("elimination_rounds")
          .select("id, round_number, started_at, ends_at, closed_at, player_id, is_elimination")
          .eq("tournament_id", tournament.id)
          .order("round_number", { ascending: true });

        if (roundErr) console.error("[elim] rounds load error", roundErr);

        const roundsArr = Array.isArray(roundRows) ? roundRows : [];
        const entriesMap = {};

        // entries per round
        const extraUserIds = new Set();
        for (const r of roundsArr) {
          const { data: ent, error: entErr } = await supabase
            .from("elimination_round_entries")
            .select("user_id, points_earned, finished_at")
            .eq("round_id", r.id);
          if (entErr) console.error("[elim] entries load error", entErr);
          const e = Array.isArray(ent) ? ent : [];
          entriesMap[r.id] = e;
          for (const row of e) {
            if (!idsFromParticipants.includes(row.user_id)) {
              extraUserIds.add(row.user_id);
            }
          }
        }

        if (extraUserIds.size) {
          const { data: extraUsers, error: extraErr } = await supabase
            .from("users")
            .select("id, full_name, email, profile_photo_url")
            .in("id", Array.from(extraUserIds));
          if (extraErr) console.error("[elim] extra users load error", extraErr);
          userRows = [...userRows, ...(extraUsers || [])];
        }

        // attach participant state + invite_status
        const userRowsWithMeta = (userRows || []).map((u) => ({
          ...u,
          state: stateByUserId.get(u.id) || null,
          invite_status: inviteByUserId.get(u.id) || "pending",
        }));

        if (!cancelled) {
          setParticipants(userRowsWithMeta);
          setRounds(roundsArr);
          setEntriesByRound(entriesMap);
        }
      } catch (e) {
        console.error("[elim] load block error", e);
        if (!cancelled) {
          setParticipants([]);
          setRounds([]);
          setEntriesByRound({});
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tournament.id, refreshToken, rtTick, hardRefreshToken]);

  
  // Realtime: update this card when its round entries change
  useEffect(() => {
    const roundIds = new Set((rounds || []).map(r => r.id));
    const ch = supabase
      .channel(`elim-card-${tournament.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "elimination_round_entries" },
        (payload) => {
          const rid = payload?.new?.round_id ?? payload?.old?.round_id;
          if (rid && roundIds.has(rid)) {
            setRtTick((t) => t + 1);
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // Recreate when the set of rounds for this tournament changes
  }, [tournament.id, rounds]);
// Load my available "today" (for Accept button enable/disable)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!userId) return;
      const { data, error } = await supabase.rpc("pt_available_today", {
        p_uid: userId,
      });
      if (!cancelled) {
        if (error) console.error("[elim] pt_available_today error", error);
        setAvailableToday(error ? null : Number(data || 0));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, refreshToken]);

  const participantsMap = useMemo(() => {
    const m = new Map();
    for (const p of participants) m.set(p.id, p);
    return m;
  }, [participants]);

  
  // Display users for a given round: if tournament is finished, show all users who posted an entry;
  // otherwise show currently active users for that round. Each item includes user meta + points for that round.
  const getDisplayUsersForRound = (round) => {
    if (!round?.id) return [];
    const entries = entriesByRound[round.id] || [];
    const pointsMap = new Map(entries.map(e => [e.user_id, Number(e.points_earned ?? 0)]));
    if (isFinished) {
      const ids = Array.from(new Set(entries.map(e => e.user_id)));
      return ids.map(uid => ({
        ...(participantsMap.get(uid) || { id: uid }),
        points: pointsMap.get(uid) ?? null,
      }));
    } else {
      const ids = Array.from(activeUsersByRound.get(round.id) || []);
      return ids.map(uid => ({
        ...(participantsMap.get(uid) || { id: uid }),
        points: pointsMap.get(uid) ?? null,
      }));
    }
  };
const isPublic = ((tournament?.filters || {}).visibility || "private") === "public";
  const amParticipant = participantsMap.has(userId);


  const entriesFor = (roundId) => entriesByRound[roundId] || [];

  // Quick invite-status counters + my status
  const { acceptedCount, pendingCount, declinedCount, myInviteStatus } = useMemo(() => {
    let a = 0, p = 0, d = 0, mine = null;
    for (const u of participants) {
      const s = (u.invite_status || "pending").toLowerCase();
      if (s === "accepted") a++;
      else if (s === "declined") d++;
      else if (s === "pending") p++;
      if (u.id === userId) mine = s;
    }
    return { acceptedCount: a, pendingCount: p, declinedCount: d, myInviteStatus: mine };
  }, [participants, userId]);

  const pot = (Number(tournament.stake_points || 0) * acceptedCount) || 0;

  // Show if current user is eliminated (state from participants table)
  const iAmEliminated =
    ((participantsMap.get(userId)?.state || "").toLowerCase() === "eliminated");

  /* ------------------------------------------------------------
     Active users by round (unchanged logic, works post-start)
  ------------------------------------------------------------ */
  const activeUsersByRound = useMemo(() => {
    const result = new Map();
    if (!Array.isArray(rounds) || rounds.length === 0) return result;
    if (!Array.isArray(participants) || participants.length === 0) return result;

    let activeSet = new Set(participants.filter(p => ((p.invite_status || '').toLowerCase() === 'accepted')).map(p => p.id));
    let blockPoints = new Map([...activeSet].map((uid) => [uid, 0]));

    const ordered = [...rounds].sort((a, b) => (a.round_number || 0) - (b.round_number || 0));

    for (const r of ordered) {
      result.set(r.id, new Set(activeSet));

      const isClosed =
        !!r.closed_at ||
        (r.ends_at ? new Date(r.ends_at).getTime() <= Date.now() : false);
      if (!isClosed) continue;

      const entries = entriesByRound[r.id] || [];
      const ptsByUser = new Map(entries.map((e) => [e.user_id, Number(e.points_earned ?? 0)]));

      for (const uid of activeSet) {
        const prev = blockPoints.get(uid) ?? 0;
        const add = ptsByUser.get(uid) ?? 0;
        blockPoints.set(uid, prev + add);
      }

      const isElimRound =
        typeof r.is_elimination === "boolean"
          ? r.is_elimination
          : ((Number(r.round_number) || 0) % roundsToElim === 0);

      if (!isElimRound) continue;

      let minSum = Infinity;
      let maxSum = -Infinity;
      for (const uid of activeSet) {
        const v = blockPoints.get(uid) ?? 0;
        if (v < minSum) minSum = v;
        if (v > maxSum) maxSum = v;
      }

      const allTied = Number.isFinite(minSum) && minSum === maxSum;
      if (!allTied && maxSum > minSum) {
        for (const uid of Array.from(activeSet)) {
          const v = blockPoints.get(uid) ?? 0;
          if (v === minSum) activeSet.delete(uid);
        }
      }

      blockPoints = new Map([...activeSet].map((uid) => [uid, 0]));
    }

    return result;
  }, [rounds, participants, entriesByRound, roundsToElim]);

  /* ------------------------------------------------------------
     Winner + standings (unchanged)
  ------------------------------------------------------------ */
  const celebrationData = useMemo(() => {
    if (tournament.status !== "finished") return null;
    if (!rounds?.length || !participants?.length) return null;

    const winner =
      (tournament.winner_user_id && participantsMap.get(tournament.winner_user_id)) ||
      null;

    let activeSet = new Set(participants.filter(p => ((p.invite_status || '').toLowerCase() === 'accepted') && (p.state || 'active') !== 'eliminated').map(p => p.id));
    let blockPoints = new Map([...activeSet].map((uid) => [uid, 0]));
    const eliminatedRecords = [];

    const ordered = [...rounds].sort(
      (a, b) => (a.round_number || 0) - (b.round_number || 0)
    );

    for (const r of ordered) {
      const isClosed =
        !!r.closed_at ||
        (r.ends_at ? new Date(r.ends_at).getTime() <= Date.now() : false);
      if (!isClosed) continue;

      const entries = entriesByRound[r.id] || [];
      const ptsByUser = new Map(entries.map((e) => [e.user_id, Number(e.points_earned ?? 0)]));

      for (const uid of activeSet) {
        const prev = blockPoints.get(uid) ?? 0;
        const add = ptsByUser.get(uid) ?? 0;
        blockPoints.set(uid, prev + add);
      }

      const isElimRound =
        typeof r.is_elimination === "boolean"
          ? r.is_elimination
          : ((Number(r.round_number) || 0) % roundsToElim === 0);

      if (!isElimRound) continue;

      let minSum = Infinity;
      let maxSum = -Infinity;
      for (const uid of activeSet) {
        const v = blockPoints.get(uid) ?? 0;
        if (v < minSum) minSum = v;
        if (v > maxSum) maxSum = v;
      }

      const allTied = Number.isFinite(minSum) && minSum === maxSum;
      if (!allTied && maxSum > minSum) {
        const eliminatedNow = [];
        for (const uid of Array.from(activeSet)) {
          const v = blockPoints.get(uid) ?? 0;
          if (v === minSum) {
            eliminatedNow.push(uid);
          }
        }
        eliminatedNow.forEach((uid) => {
          activeSet.delete(uid);
          eliminatedRecords.push({
            userId: uid,
            eliminatedAtRound: r.round_number,
            lastPoints: blockPoints.get(uid) ?? 0,
          });
        });
      }

      blockPoints = new Map([...activeSet].map((uid) => [uid, 0]));
    }

    let computedWinner = winner;
    if (!computedWinner && activeSet.size === 1) {
      const wId = Array.from(activeSet)[0];
      computedWinner = participantsMap.get(wId) || null;
    }

    const ranking = eliminatedRecords
      .map((rec) => ({
        user: participantsMap.get(rec.userId),
        eliminatedAtRound: rec.eliminatedAtRound,
        lastPoints: rec.lastPoints === null || rec.lastPoints === undefined ? null : Number(rec.lastPoints),
      }))
      .filter((x) => x.user && (!computedWinner || x.user.id !== computedWinner.id))
      .sort((a, b) => {
        if (b.eliminatedAtRound !== a.eliminatedAtRound) {
          return b.eliminatedAtRound - a.eliminatedAtRound;
        }
        const ap = a.lastPoints ?? -Infinity;
        const bp = b.lastPoints ?? -Infinity;
        if (bp !== ap) return bp - ap;
        const an = (a.user.full_name || a.user.email || "").toLowerCase();
        const bn = (b.user.full_name || b.user.email || "").toLowerCase();
        return an.localeCompare(bn);
      });

    const roundsCount = ordered.length;
    const startMs = ordered
      .map((r) => (r.started_at ? new Date(r.started_at).getTime() : null))
      .filter((v) => v !== null)
      .reduce((min, v) => (min === null ? v : Math.min(min, v)), null);
    const endMs = ordered
      .map((r) =>
        r.closed_at
          ? new Date(r.closed_at).getTime()
          : r.ends_at
          ? new Date(r.ends_at).getTime()
          : null
      )
      .filter((v) => v !== null)
      .reduce((max, v) => (max === null ? v : Math.max(max, v)), null);
    const timePlayed = startMs !== null && endMs !== null ? fmtDuration(endMs - startMs) : "—";

    return {
      winner: computedWinner,
      ranking,
      stats: {
        rounds: roundsCount,
        timePlayed,
        participants: participants.length,
      },
    };
  }, [
    tournament.status,
    tournament.winner_user_id,
    participants,
    participantsMap,
    rounds,
    entriesByRound,
    roundsToElim,
  ]);

  // Play handler
  const handlePlayRound = async (round) => {
    if (!round?.id || !round?.round_number || !round?.player_id) return;

    if (iAmEliminated) return;

    const already = entriesFor(round.id).some((e) => e.user_id === userId);
    if (already) return;

    const { data: meta } = await supabase
      .from("players_in_seasons")
      .select(
        "player_id, player_name, player_position, player_dob_age, player_nationality, player_photo"
      )
      .eq("player_id", round.player_id)
      .limit(1)
      .maybeSingle();

    if (!meta?.player_id) return;

    navigate("/live", {
      state: {
        id: Number(meta.player_id),
        name: meta.player_name || "",
        age: meta.player_dob_age || "",
        nationality: meta.player_nationality || "",
        position: meta.player_position || "",
        photo: meta.player_photo || "",
        potentialPoints: 10000,
        elimination: {
          tournamentId: tournament.id,
          tournamentName: tournament.name,
          roundId: round.id,
          roundNumber: round.round_number,
        },
      },
    });
  };

  // Auto-finalization (existing)
  const finalizingRef = useRef(new Set());
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!Array.isArray(rounds) || rounds.length === 0) return;
      if (!Array.isArray(participants) || participants.length === 0) return;

      const open = rounds
        .filter((r) => !r.closed_at)
        .sort((a, b) => (b.round_number || 0) - (a.round_number || 0));
      const r = open[0];
      if (!r) return;

      const activeCount = participants.filter(
  (p) =>
    ((p.invite_status || "").toLowerCase() === "accepted") &&
    (p.state || "active") !== "eliminated"
).length;

      const entries = entriesByRound[r.id] || [];
      const everyonePlayed = entries.length >= activeCount;
      const timeUp = r.ends_at ? new Date(r.ends_at).getTime() <= Date.now() : false;
      const shouldFinalize = !r.closed_at && (everyonePlayed || timeUp);

      if (!shouldFinalize) return;
      if (finalizingRef.current.has(r.id)) return;

      finalizingRef.current.add(r.id);
      try {
        const laterRoundExists = rounds.some((x) => x.round_number > r.round_number);

        let nextPlayerId = null;
        if (!laterRoundExists) {
          const usedPlayerIds = new Set(
            (rounds || [])
              .map((x) => x?.player_id)
              .filter((v) => v !== null && v !== undefined)
          );

          const maxAttempts = 24;
          for (let i = 0; i < maxAttempts; i++) {
            const candidate = await getRandomPlayer(
              {
                ...(tournament.filters || {}),
                userId,
                excludePlayerIds: Array.from(usedPlayerIds),
              },
              userId
            );
            const candId = candidate?.id || null;
            if (candId && !usedPlayerIds.has(candId)) {
              nextPlayerId = candId;
              break;
            }
          }
        }

        const { error } = await supabase.rpc("finalize_round", { p_round_id: r.id });
if (error) {
  const msg = String(error?.message || "").toLowerCase();
  const isNotFound = msg.includes("not found") && msg.includes("round");
  if (error.code === "P0001" && isNotFound) {
    await finalizeLatestRoundForTournament(tournament.id);
  } else if (error.code === "PGRST202") {
    console.warn("[elim] finalize_round not in schema cache yet; will retry");
  } else {
    throw error;
  }
}
if (onAdvanced) await onAdvanced();
      } catch (e) {
        console.error("[elim] auto-finalize error", e);
      } finally {
        finalizingRef.current.delete(r.id);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rounds, entriesByRound, participants, tournament.id, userId, onAdvanced]);

  // NEW: Accept / Decline handlers
const [accepting, setAccepting] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [startNowBusy, setStartNowBusy] = useState(false);

  const handleAccept = async () => {
    if (!userId) return;
    setAccepting(true);
    try {
      const { error } = await supabase.rpc("accept_tournament_invite", {
        p_tournament_id: tournament.id,
      });
      if (error) throw error;
      
      // Snack: joined successfully
      setToast({ kind: "success", message: `Joined!${(Number(tournament.stake_points)||0)>0? " Stake hold placed: " + Number(tournament.stake_points) + " pts" : ""}` });
// refresh points + participants
      const { data } = await supabase.rpc("pt_available_today", { p_uid: userId });
      setAvailableToday(Number(data || 0));
      if (onAdvanced) await onAdvanced();
    } catch (e) {
      console.error("[elim] accept invite error", e);
      alert(e.message || "Failed to accept invite.");
    } finally {
      setAccepting(false);
    }
  };

  const handleDecline = async () => {
    if (!userId) return;
    if (myInviteStatus !== "pending") return;
    setDeclining(true);
    try {
      const { error } = await supabase.rpc("decline_tournament_invite", {
        p_tournament_id: tournament.id,
      });
      if (error) throw error;
      if (onAdvanced) await onAdvanced();
    } catch (e) {
      console.error("[elim] decline invite error", e);
      alert(e.message || "Failed to decline invite.");
    } finally {
      setDeclining(false);
    }
  };

  // CHANGED: isCreator uses owner_id
  const isCreator = userId && tournament.owner_id === userId;
  const joinDeadline = tournament.join_deadline || null;
  const canStartNow = isCreator && acceptedCount >= Math.max(2, Number(tournament.min_participants || 2));

  // ====== CHANGED: Start Now sends p_force_start and then hard-refreshes rounds ======
const handleStartNow = async () => {
  if (!canStartNow) return;
  setStartNowBusy(true);
  try {
    console.log("[elim] Start Now RPC call", { tournamentId: tournament.id });
    const { data, error } = await supabase.rpc("start_elimination_tournament", {
      p_tournament_id: tournament.id,
      p_force_start: true,           // <— important: bypass join window and actually start
    });
    if (error) {
      console.error("[elim] start_elimination_tournament error", error);
      alert(error.message || "Failed to start the challenge.");
      return;
    }
    console.log("[elim] Start Now RPC success", data);

    // After starting, poll a few times for the first round to appear so UI updates right away.
    const maxAttempts = 6; // ~3 seconds total
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const { data: roundRows, error: rerr } = await supabase
        .from("elimination_rounds")
        .select("id, round_number, started_at, ends_at, closed_at, player_id, is_elimination")
        .eq("tournament_id", tournament.id)
        .order("round_number", { ascending: true });

      if (!rerr && Array.isArray(roundRows) && roundRows.length > 0) {
        setRounds(roundRows);
        break;
      }
      await new Promise((res) => setTimeout(res, 500));
    }

    if (onAdvanced) await onAdvanced();
  } catch (e) {
    console.error("[elim] Start Now exception", e);
    alert(e.message || "Failed to start the challenge.");
  } finally {
    setStartNowBusy(false);
  }
}

// Prevent duplicate processing per tournament when the join countdown ends
const processedJoinEndRef = useRef(new Set());

// When the lobby join window ends: if accepted < min participants, finish with no winner; then hard refresh.
const handleJoinCountdownEnd = async () => {
  try {
    if (tournament.status !== "lobby") return;
    if (!joinDeadline) return;
    if (processedJoinEndRef.current.has(tournament.id)) return;
    processedJoinEndRef.current.add(tournament.id);

    // Count accepted participants from DB (authoritative)
    const { count: acceptedCountNow, error: cntErr } = await supabase
      .from("elimination_participants")
      .select("user_id", { count: "exact", head: true })
      .eq("tournament_id", tournament.id)
      .eq("invite_status", "accepted");

    if (cntErr) {
      console.error("[elim] accepted-count error", cntErr);
      // Fallback: one refresh to let server-side logic settle
      window.location.reload();
      return;
    }

    const minRequired = Math.max(2, Number(tournament.min_participants || 2));

    if ((acceptedCountNow || 0) < minRequired) {
      // Not enough participants — finish without a winner
      const { error: updErr } = await supabase
        .from("elimination_tournaments")
        .update({ status: "finished", finished_at: new Date().toISOString() })
        .eq("id", tournament.id);

      if (updErr) {
        console.error("[elim] finish (insufficient participants) failed", updErr);
        // Avoid reload loop if update failed
        return;
      }
    }

    // Reflect the final state (either finished or started elsewhere)
    window.location.reload();
  } catch (e) {
    console.error("[elim] handleJoinCountdownEnd fatal", e);
  }
};

;
// ====== /CHANGED ======


  // UI bits for accept controls
  const needMore = Math.max(0, Number(tournament.stake_points || 0) - Number(availableToday || 0));
  const canAfford = availableToday === null ? true : needMore <= 0;
    const showAcceptControls =
    (isLobby || isLive) && (
      (myInviteStatus === "pending") || (isPublic && !amParticipant)
    ) && (!!joinDeadline ? new Date(joinDeadline).getTime() > Date.now() : true);

  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm transition hover:shadow-md relative">
        {toast && (
          <div className="pointer-events-none absolute right-3 top-3 z-20">
            <div className="rounded-md bg-emerald-600/95 text-white px-3 py-2 text-xs shadow-lg">
              {toast.message}
            </div>
          </div>
        )}
      {/* Card header with collapse toggle */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setCardCollapsed((v) => !v)}
            className="rounded-md border px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
            title={cardCollapsed ? "Expand" : "Collapse"}
            aria-label={cardCollapsed ? "Expand" : "Collapse"}
          >
            {cardCollapsed ? "▼" : "▲"}
          </button>
          <h3 className="text-lg sm:text-xl font-extrabold text-gray-900 tracking-tight">
            <span className="align-middle">🏁 {tournament.name}</span></h3>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <span
            className={classNames(
              "shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold",
              isLive ? "bg-green-100 text-green-800" : (isLobby ? "bg-blue-100 text-blue-800" : "bg-gray-100 text-gray-800")
            )}
          >
            {isLive ? "Live" : (isLobby ? "Lobby" : "Finished")}
          </span>

          {/* NEW: Stake per player */}
          {Number(tournament.stake_points || 0) > 0 && (
            <span className="inline-flex items-center gap-1 shrink-0 rounded-full bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200 px-2 py-0.5 text-[11px]">
              <Coins className="h-3.5 w-3.5" />
              Stake: {tournament.stake_points} pts
            </span>
          )}

          {/* NEW: Pot */}
          {Number(tournament.stake_points || 0) > 0 && (
            <span className="inline-flex items-center gap-1 shrink-0 rounded-full bg-yellow-50 text-yellow-700 ring-1 ring-yellow-200 px-2 py-0.5 text-[11px]">
              Pot: {pot} pts
            </span>
          )}

          {/* Eliminates every N rounds */}
          <span className="shrink-0 rounded-full bg-rose-50 text-rose-700 ring-1 ring-rose-200 px-2 py-0.5 text-[11px]">
            Eliminates every {roundsToElim} {roundsToElim === 1 ? "round" : "rounds"}
          </span>
        </div>
      </div>

      <p className="mt-2 text-xs text-gray-500">Created: {dateStr}</p>

      {/* NEW: Join window countdown + Start Now (creator) */}
      {isLobby && !!joinDeadline && (
        <div className="mt-1 text-xs text-gray-700 flex items-center gap-2 flex-wrap">
          <span className="rounded bg-orange-50 text-orange-700 ring-1 ring-orange-200 px-1.5 py-0.5">
            {new Date(joinDeadline).getTime() > Date.now() ? (<>Join closes in <Countdown endsAt={joinDeadline} onEnd={handleJoinCountdownEnd} /></>) : (<span>Join closed</span>)}
          </span>
          <span className="text-gray-400">•</span>
          <span>Accepted: {acceptedCount}</span>
          <span className="text-gray-400">/</span>
          <span>Min required: {Math.max(2, Number(tournament.min_participants || 2))}</span>

          {canStartNow && rounds.length === 0 && (
            <button
              type="button"
              onClick={handleStartNow}
              disabled={startNowBusy}
              className="ml-auto inline-flex items-center gap-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 text-xs font-semibold"
              title="Start Now"
            >
              <Play className="h-3.5 w-3.5" />
              {startNowBusy ? "Starting…" : "Start Now"}
            </button>
          )}
        </div>
      )}

      {/* Winner (finished) */}
      {!isLive && tournament.winner_user_id && (
        <div className="mt-2 text-xs font-medium text-green-800">
          Winner: <WinnerName userId={tournament.winner_user_id} />
        </div>
      )}

      {/* Collapsible body */}
      {!cardCollapsed && (
        <>
          {/* ===== Winner / Loser Final Card (finished only) ===== */}
          {!isLive && celebrationData?.winner && (
            <div className="mt-4">
              {userId && celebrationData.winner?.id === userId ? (
                <WinnerCelebrationCard
                  tournamentName={tournament.name}
                  winner={celebrationData.winner}
                  stats={celebrationData.stats}
                  ranking={celebrationData.ranking}
                  potPoints={pot}
                />
              ) : (
                <LoserFinalCard
                  tournamentName={tournament.name}
                  winner={celebrationData.winner}
                  stats={celebrationData.stats}
                  ranking={celebrationData.ranking}
                  stakePoints={tournament.stake_points}
                />
              )}
            </div>
          )}
          {/* ===== END ===== */}

          {/* Difficulty Filters as grouped chips */}
          <div className="mt-3">
            <div className="flex items-center gap-2"><div className="text-xs font-semibold text-gray-700">Difficulty Filters</div><button
                type="button"
                onClick={() => setFiltersCollapsed((v) => !v)}
                className="text-xs text-gray-600 hover:text-gray-800"
                title={filtersCollapsed ? "Expand filters" : "Collapse filters"}
              >
                {filtersCollapsed ? "▼ Show" : "▲ Hide"}
              </button>
            </div>

            {!filtersCollapsed && (
              <div className="mt-2">
                {(() => {
                  const f = tournament.filters || {};
                  const compIds = Array.isArray(f.competitions) ? f.competitions : [];
                  const seasons = Array.isArray(f.seasons) ? f.seasons : [];
                  const mv = Number(f.minMarketValue || 0);
                  const ma = Number(f.minAppearances || 0);

                  const hasAny =
                    (compIds.length || 0) + (seasons.length || 0) + (mv > 0 ? 1 : 0) + (ma > 0 ? 1 : 0) > 0;

                  if (!hasAny) {
                    return (
                      <div className="rounded-md border border-dashed p-3 text-xs text-gray-600 bg-white">
                        No filters (all players).
                      </div>
                    );
                  }

                  return (
                    <div className="rounded-md border p-3 bg-white">
                      <div className="flex flex-wrap items-center gap-2">
                        {compIds.map((id) => (
                          <span
                            key={`comp-${id}`}
                            className="inline-flex items-center gap-2 px-2 py-1 rounded-full text-[11px] bg-green-100 text-green-800"
                            title={compIdToLabel?.[String(id)] || `Competition ${id}`}
                          >
                            {compIdToLabel?.[String(id)] || `Competition ${id}`}
                          </span>
                        ))}
                        {seasons.map((s) => (
                          <span
                            key={`season-${s}`}
                            className="inline-flex items-center gap-2 px-2 py-1 rounded-full text-[11px] bg-green-100 text-green-800"
                          >
                            {String(s)}
                          </span>
                        ))}
                        {mv > 0 && (
                          <span className="inline-flex items-center gap-2 px-2 py-1 rounded-full text-[11px] bg-green-100 text-green-800">
                            Min MV: €{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(mv)).replace('€', '').trim()}
                          </span>
                        )}
                        {ma > 0 && (
                          <span className="inline-flex items-center gap-2 px-2 py-1 rounded-full text-[11px] bg-green-100 text-green-800">
                            Min Apps: {Number(ma)}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>

          {/* NEW: Invite status + Accept/Decline */}
          {(isLobby || isLive) && (
            <div className="mt-3 rounded-lg border bg-slate-50 p-3">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="text-xs font-semibold text-gray-700">Invites</div>
                <span className="rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 px-2 py-0.5 text-[11px]">
                  Accepted {acceptedCount}
                </span>
                <span className="rounded-full bg-gray-100 text-gray-800 ring-1 ring-gray-300 px-2 py-0.5 text-[11px]">
                  Pending {pendingCount}
                </span>
                <span className="rounded-full bg-rose-50 text-rose-700 ring-1 ring-rose-200 px-2 py-0.5 text-[11px]">
                  Declined {declinedCount}
                </span>

                {/* Accept/Decline controls for me */}
                {showAcceptControls && (
                  <div className="ml-auto flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleAccept}
                      disabled={accepting || !canAfford}
                      className={classNames(
                        "inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-semibold",
                        canAfford
                          ? "bg-emerald-600 text-white hover:bg-emerald-700"
                          : "bg-gray-200 text-gray-500 cursor-not-allowed"
                      )}
                      title={
                        canAfford
                          ? "Accept invite and put the stake"
                          : `You need ${needMore} more points today`
                      }
                    >
                      <Check className="h-3.5 w-3.5" />
                      {accepting ? "Accepting…" : `Accept (${tournament.stake_points} pts)`}
                    </button>
                    {myInviteStatus === "pending" && (
<button
                      type="button"
                      onClick={handleDecline}
                      disabled={declining}
                      className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-semibold bg-white text-rose-700 border border-rose-300 hover:bg-rose-50"
                      title="Decline invite"
                    >
                      <XIcon className="h-3.5 w-3.5" />
                      {declining ? "Declining…" : "Decline"}
                    </button>
)}
                  </div>
                )}

                {/* Show my status if not pending */}
                {!showAcceptControls && myInviteStatus && (
                  <span
                    className={classNames(
                      "ml-auto rounded-full px-2 py-0.5 text-[11px] ring-1",
                      myInviteStatus === "accepted" &&
                        "bg-emerald-50 text-emerald-700 ring-emerald-200",
                      myInviteStatus === "declined" &&
                        "bg-rose-50 text-rose-700 ring-rose-200",
                      myInviteStatus === "auto_removed" &&
                        "bg-orange-50 text-orange-700 ring-orange-200"
                    )}
                  >
                    My status: {myInviteStatus}
                  </span>
                )}
              </div>

              {/* Available today hint */}
              {availableToday !== null && (
                <div className="mt-2 text-[11px] text-gray-600">
                  Your available points today:{" "}
                  <span className={classNames(needMore > 0 ? "text-rose-600 font-semibold" : "text-emerald-700 font-semibold")}>
                    {availableToday}
                  </span>
                  {Number(tournament.stake_points || 0) > 0 && (
                    <>
                      {" "}
                      • Required stake: <span className="font-semibold">{tournament.stake_points}</span>
                      {needMore > 0 && (
                        <>
                          {" "}
                          • Short by <span className="font-semibold text-rose-600">{needMore}</span>
                        </>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Participants as chips */}
          <div className="mt-3">
            <div className="text-xs font-semibold mb-1 text-gray-700">
              Participants
            </div>
            <div className="flex flex-wrap gap-1.5">
              {participants.length === 0 ? (
                <span className="text-[11px] text-gray-500">—</span>
              ) : (
                participants.map((p) => {
                  const isActive = (p.state || "").toLowerCase() === "active";
                  const isEliminated = (p.state || "").toLowerCase() === "eliminated";
                  const inv = (p.invite_status || "pending").toLowerCase();
                  return (
                    <span
                      key={p.id}
                      className={classNames(
                        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset gap-1",
                        isActive &&
                          "bg-emerald-50 text-emerald-800 ring-emerald-600/20",
                        isEliminated &&
                          "bg-red-50 text-red-700 ring-red-600/20 opacity-70",
                        !isActive &&
                          !isEliminated &&
                          "bg-gray-100 text-gray-800 ring-gray-300"
                      )}
                      title={`Invite: ${inv}`}
                    >
                      {p.full_name || p.email}
                      <span
                        className={classNames(
                          "ml-1 rounded-full px-1 text-[10px] ring-1",
                          inv === "accepted" && "bg-emerald-100 text-emerald-800 ring-emerald-200",
                          inv === "pending" && "bg-gray-200 text-gray-700 ring-gray-300",
                          inv === "declined" && "bg-rose-100 text-rose-700 ring-rose-200",
                          inv === "auto_removed" && "bg-orange-100 text-orange-700 ring-orange-200"
                        )}
                      >
                        {inv}
                      </span>
                    </span>
                  );
                })
              )}
            </div>
          </div>

          {/* Rounds list (unchanged except cosmetics) */}
          <div className="mt-4 space-y-3">
            {rounds.length === 0 ? (
              <div className="text-sm text-gray-500">Waiting for challenge to start...</div>
            ) : (
              [...rounds].sort((a,b)=>(b.round_number||0)-(a.round_number||0)).map((r) => {
                const entries = entriesFor(r.id);
                const entryByUser = new Map(entries.map((e) => [e.user_id, e]));

                const activeIdsForRound =
                  activeUsersByRound.get(r.id) ||
                  new Set(participants.filter(p => ((p.invite_status || '').toLowerCase() === 'accepted') && (p.state || 'active') !== 'eliminated').map(p => p.id));

                const activeCount = activeIdsForRound.size;

                const entriesFromActive = entries.filter((e) => (activeUsersByRound.get(r.id) || new Set()).has(e.user_id));

                const now = Date.now();
                const endsAt = r.ends_at ? new Date(r.ends_at).getTime() : null;
                const derivedActive =
                  !r.closed_at &&
                  (!!endsAt ? endsAt > now : true) &&
                  entriesFromActive.length < activeCount;

                const mePlayed = userId ? entryByUser.has(userId) : false;

                // -------- ACCUMULATION & RESET FIX (begin) --------
const isElimRoundCheck = (roundObj) =>
  typeof roundObj?.is_elimination === "boolean"
    ? roundObj.is_elimination
    : ((Number(roundObj?.round_number) || 0) % roundsToElim === 0);

const earlierRounds = rounds.filter(
  (rr) => (rr.round_number || 0) < (r.round_number || 0)
);

const lastElimBefore = [...earlierRounds]
  .reverse()
  .find((rr) => isElimRoundCheck(rr));

// A block starts at round 1 || immediately after the last elimination
const blockStartNumber = lastElimBefore
  ? (lastElimBefore.round_number || 0) + 1
  : 1;

// All previous rounds in the block
const prevBlockRounds = earlierRounds.filter(
  (rr) =>
    (rr.round_number || 0) >= blockStartNumber &&
    (rr.round_number || 0) < (r.round_number || 0)
);

// Build a per-round map of user -> points for previous rounds in the block
const pointsByRound = new Map();
for (const pr of prevBlockRounds) {
  const ents = entriesByRound[pr.id] || [];
  const m = new Map();
  for (const e of ents) {
    m.set(e.user_id, Number(e.points_earned ?? 0));
  }
  pointsByRound.set(pr.id, m);
}

// CURRENT round points map
const currentEntries = entriesByRound[r.id] || [];
const currentPointsMap = new Map();
for (const e of currentEntries) {
  currentPointsMap.set(e.user_id, Number(e.points_earned ?? 0));
}

// Build rows for **all active** users this round
const scoreRows = [];
for (const uid of (activeUsersByRound.get(r.id) || new Set())) {
  const playedCurrent = entryByUser.has(uid);
  let sumPrev = 0;
  for (const pr of prevBlockRounds) {
    const m = pointsByRound.get(pr.id);
    const v = m ? m.get(uid) ?? 0 : 0;
    sumPrev += v;
  }
  const roundPts = currentPointsMap.get(uid) ?? 0;
  const totalPts = sumPrev + (playedCurrent ? roundPts : 0); // keep previous sum if not played yet

  const u = participants.find((p) => p.id === uid);
  if (u) scoreRows.push({ user: u, totalPts, roundPts: playedCurrent ? roundPts : null, prevPts: sumPrev, playedCurrent });
}

// Highlight min/max based on totals (include zeros for no-shows)
const totals = scoreRows.map((row) => Number(row.totalPts ?? 0));
const hasTotals = totals.length > 0;
const maxTotal = hasTotals ? Math.max(...totals) : null;
const minTotal = hasTotals ? Math.min(...totals) : null;
const singleValueOnly = hasTotals && maxTotal === minTotal;

// Sort primarily by totals (desc), then those who played current round first, then name
scoreRows.sort((a, b) => {
  const ap = Number(a.totalPts ?? 0);
  const bp = Number(b.totalPts ?? 0);
  if (bp !== ap) return bp - ap;
  if (a.playedCurrent !== b.playedCurrent) return a.playedCurrent ? -1 : 1;
  const an = (a.user.full_name || a.user.email || "").toLowerCase();
  const bn = (b.user.full_name || b.user.email || "").toLowerCase();
  return an.localeCompare(bn);
});
// -------- ACCUMULATION & RESET FIX (end) --------



                const isElimRound =
                  typeof r.is_elimination === "boolean"
                    ? r.is_elimination
                    : ((Number(r.round_number) || 0) % roundsToElim === 0);

                return (
                  <div
                    key={r.id}
                    className={classNames(
                      "rounded-xl border p-3 transition",
                      isElimRound
                        ? "bg-red-50 border-red-200 ring-1 ring-red-200 animate-pulse"
                        : "bg-gray-50"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-semibold text-gray-800">
                        Round {r.round_number}
                      </div>
                      <div className="flex items-center gap-2">
                        {isElimRound && (
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 ring-1 ring-rose-200">
                            Elimination Round
                          </span>
                        )}
                        <span
                          className={classNames(
                            "text-xs px-2 py-0.5 rounded-full",
                            derivedActive
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-gray-200 text-gray-700"
                          )}
                        >
                          {derivedActive ? "Active" : "Finished"}
                        </span>
                      </div>
                    </div>

                    <div className="mt-1 text-xs text-gray-600">
                      {derivedActive ? (
                        <>
                          Ends in:{" "}
                          <span className="font-semibold">
                            <Countdown endsAt={r.ends_at || null} onEnd={() => window.location.reload()} />
                          </span>{" "}
                          {timeLimitMin ? `• Limit: ${timeLimitMin} min` : null}
                        </>
                      ) : (
                        <>
                          Started:{" "}
                          {r.started_at
                            ? new Date(r.started_at).toLocaleString()
                            : "—"}
                          {" • "}
                          Ended:{" "}
                          {r.closed_at
                            ? new Date(r.closed_at).toLocaleString()
                            : r.ends_at
                            ? new Date(r.ends_at).toLocaleString()
                            : "—"}
                        </>
                      )}
                    </div>

                    {/* Player details: ONLY show after the round is finished */}
                    {!derivedActive && r.player_id ? (
                      <div className="mt-3">
                        <div className="text-xs font-semibold text-gray-700 mb-1">
                          Round Player
                        </div>
                        <RoundPlayer playerId={r.player_id} />
                      </div>
                    ) : null}

                    {/* Scores — only ACTIVE users for this round */}
                    <div className="mt-3">
                      <div className="text-xs font-semibold text-gray-700 mb-1">
                        Scores
                      </div>
                      {scoreRows.length === 0 ? (
                        <div className="text-xs text-gray-500">No participants.</div>
                      ) : (
                        <ul className="space-y-1">
                          {scoreRows.map(({ user: u, totalPts, roundPts, playedCurrent }, idx) => {
  const isMax = maxTotal !== null && totalPts === maxTotal;
  const isMin = minTotal !== null && totalPts === minTotal;
  const scoreClass =
    isMax
      ? "text-emerald-700 font-semibold"
      : isMin && !singleValueOnly
      ? "text-red-600 font-semibold"
      : "text-gray-800 font-medium";
  return (
    <li
      key={`${u.id}-${idx}`}
      className="text-sm flex items-center justify-between bg-white rounded-md border px-2 py-1"
    >
      <div className="flex items-center gap-2 truncate mr-2">
        <span className="truncate">{u.full_name || u.email}</span>
        {playedCurrent && (
          <span className="shrink-0 inline-flex items-center rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 px-1.5 py-0.5 text-[10px]">
            played
          </span>
        )}
      </div>
      <div className="ml-2 flex items-center gap-2">
        <span className={scoreClass}>{Number(totalPts || 0)} pts</span>
        {Number.isFinite(roundPts) && (
          <span className="text-xs text-gray-500">(+{Number(roundPts || 0)})</span>
        )}
      </div>
    </li>
  );
})}

                        </ul>
                      )}
                    </div>

                    {/* Actions */}
                    {isLive && derivedActive && !iAmEliminated && !entriesFor(r.id).some((e) => e.user_id === userId) && (
                      <div className="mt-4 flex items-center justify=center">
                        <button
                          type="button"
                          className="play-round-btn rounded-2xl bg-gradient-to-r from-green-600 via-green-400 to-green-600 px-8 py-4 text-lg md:text-xl font-bold text-white shadow-lg transition-all duration-200 transform hover:scale-105 hover:from-green-700 hover:to-green-500 hover:shadow-2xl hover:ring-4 hover:ring-green-300 focus:outline-none"
                          onClick={() => handlePlayRound(r)}
                          disabled={!r.player_id}
                          title="Play Round to Survive!"
                        >
                          🎯 Play Round to Survive!
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}

function WinnerName({ userId }) {
  const [name, setName] = useState("");
  useEffect(() => {
    let active = true;
    (async () => {
      if (!userId) return;
      const { data } = await supabase
        .from("users")
        .select("id, full_name, email")
        .eq("id", userId)
        .limit(1)
        .maybeSingle();
      if (active) setName(data?.full_name || data?.email || "—");
    })();
    return () => {
      active = false;
    };
  }, [userId]);
  return <>{name || "—"}</>;
}

function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-2xl border bg-white p-5">
      <div className="h-4 w-1/2 rounded bg-gray-200" />
      <div className="mt-3 h-3 w-2/3 rounded bg-gray-100" />
      <div className="mt-6 flex justify-end">
        <div className="h-7 w-20 rounded bg-gray-100" />
      </div>
    </div>
  );
}

function ErrorCard({ title, message }) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-800 shadow-sm">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-1 text-sm opacity-90">{message}</p>
    </div>
  );
}

/* ------------------------------------------------------------
   CreateTournamentModal
   CHANGED: Adds stake, min participants, join window,
            uses create_elimination_tournament_with_stakes RPC,
            shows available points today.
------------------------------------------------------------ */
function CreateTournamentModal({ currentUser, onClose, onCreated }) {
  const dialogRef = useRef(null);

  // Core fields
  const [name, setName] = useState("");

  // Filters (GamePage mechanism)
  const [loadingFilters, setLoadingFilters] = useState(true);
  const [groupedCompetitions, setGroupedCompetitions] = useState({});
  const [allSeasons, setAllSeasons] = useState([]);

  const [selectedCompetitionIds, setSelectedCompetitionIds] = useState([]);
  const [selectedSeasons, setSelectedSeasons] = useState([]);
  const [minMarketValue, setMinMarketValue] = useState(0);
  const [minAppearances, setMinAppearances] = useState(0);

  const [expandedCountries, setExpandedCountries] = useState({});
  const [compCollapsed, setCompCollapsed] = useState(true);
  const [seasonsCollapsed, setSeasonsCollapsed] = useState(true);
  const [mvCollapsed, setMvCollapsed] = useState(true);

  // Counts
  const [poolCount, setPoolCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [loadingCounts, setLoadingCounts] = useState(false);

  // Competition search (GamePage)
  const [compSearch, setCompSearch] = useState("");
  const [compSug, setCompSug] = useState([]);
  const [compSugOpen, setCompSugOpen] = useState(false);
  const [compSugIndex, setCompSugIndex] = useState(-1);
  const compSearchRef = useRef(null);
  const compSugBoxRef = useRef(null);

  // Invites
  const [searchEmail, setSearchEmail] = useState("");
  const [emailResults, setEmailResults] = useState([]);
  const [invites, setInvites] = useState([]); // rows from users table
  const searchEmailRef = useRef(null);
  const [inviteIndex, setInviteIndex] = useState(-1);
  const inviteListRef = useRef(null);
  const inviteItemRefs = useRef([]);

  // Round time limit (minutes)
  const [roundTimeMinutes, setRoundTimeMinutes] = useState(5);

  // Rounds to elimination (1–5)
  const [roundsToElimination, setRoundsToElimination] = useState(1);

  // NEW: Stakes & lobby settings
  const [stakePoints, setStakePoints] = useState(0);
  const [minParticipants, setMinParticipants] = useState(2);
  const [joinWindowMinutes, setJoinWindowMinutes] = useState(60);

    // Visibility (Public / Private)
  const [visibility, setVisibility] = useState("private");

// Available today
  const [availableToday, setAvailableToday] = useState(null);

  
  // Realtime bump for this card
  const [rtTick, setRtTick] = useState(0);
// Submit
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [errors, setErrors] = useState({});

  // Mount: load competitions & seasons like GamePage
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoadingFilters(true);

        const compsRes = await getCompetitions();
        if (!cancelled) {
          const grouped = compsRes.groupedByCountry || {};
          setGroupedCompetitions(grouped);
          const initialCollapse = {};
          Object.keys(grouped).forEach((c) => (initialCollapse[c] = false));
          setExpandedCountries(initialCollapse);
        }

        const seasonsRes = await getSeasons();
        if (!cancelled) setAllSeasons(normalizeSeasons(seasonsRes));
      } finally {
        if (!cancelled) setLoadingFilters(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Counts on filter change
  useEffect(() => {
    let cancelled = false;
    if (loadingFilters) return;

    (async () => {
      try {
        setLoadingCounts(true);
        const payload = {
          competitions: selectedCompetitionIds,
          seasons: selectedSeasons,
          minMarketValue: Number(minMarketValue) || 0,
          minAppearances: Number(minAppearances) || 0,
          userId: currentUser?.id,
        };
        const countsResult = await getCounts(payload);
        const { poolCount: filteredCount, totalCount: dbTotal } = countsResult || {};
        if (!cancelled) {
          setPoolCount(filteredCount || 0);
          setTotalCount(dbTotal || 0);
        }
      } catch {
        if (!cancelled) {
          setPoolCount(0);
          setTotalCount(0);
        }
      } finally {
        if (!cancelled) setLoadingCounts(false);
      }
    })();

    return () => {
      cancelled = false;
    };
  }, [
    selectedCompetitionIds,
    selectedSeasons,
    minMarketValue,
    minAppearances,
    currentUser?.id,
    loadingFilters,
  ]);

  // Escape to close
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Focus trap start
  useEffect(() => {
    const prev = document.activeElement;
    dialogRef.current?.focus();
    return () => prev && prev.focus && prev.focus();
  }, []);

  // Email search (exclude me)
  useEffect(() => {
    let active = true;
    const t = setTimeout(async () => {
      const q = (searchEmail || "").trim();
      if (!q || q.length < 2) {
        if (active) {
          setEmailResults([]);
          setInviteIndex(-1);
        }
        return;
      }
      const { data } = await supabase
        .from("users")
        .select("id, email, full_name")
        .ilike("email", `%${q}%`)
        .limit(10);
      const filtered = (data || []).filter((u) => u.id !== currentUser?.id);
      if (active) {
        setEmailResults(filtered);
        setInviteIndex(filtered.length ? 0 : -1);
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [searchEmail, currentUser?.id]);

  // Keep inviteItemRefs array in sync and auto-scroll active item into view
  useEffect(() => {
    inviteItemRefs.current = emailResults.map(
      (_, i) => inviteItemRefs.current[i] || createRef()
    );
    if (inviteIndex >= 0 && inviteItemRefs.current[inviteIndex]?.current) {
      inviteItemRefs.current[inviteIndex].current.scrollIntoView({
        block: "nearest",
      });
    }
  }, [emailResults, inviteIndex]);

  // Competition suggestion logic (copied pattern)
  const [compSugIndexInternal, setCompSugIndexInternal] = useState(-1);
  useEffect(() => {
    const q = (compSearch || "").trim().toLowerCase();
    if (!q) {
      setCompSug([]);
      setCompSugOpen(false);
      setCompSugIndexInternal(-1);
      return;
    }
    const suggestions = [];
    Object.entries(groupedCompetitions || {}).forEach(([country, comps]) => {
      (comps || []).forEach((c) => {
        const name = c.competition_name || "";
        const hit =
          name.toLowerCase().includes(q) ||
          (country || "").toLowerCase().includes(q);
        if (hit) {
          suggestions.push({
            id: String(c.competition_id),
            label: `${country} — ${name}`,
            country,
            name,
            logo_url: c.logo_url || null,
          });
        }
      });
    });
    setCompSug(suggestions.slice(0, 50));
    setCompSugOpen(suggestions.length > 0);
    setCompSugIndexInternal(suggestions.length ? 0 : -1);
  }, [compSearch, groupedCompetitions]);

  useEffect(() => {
    const onDocClick = (e) => {
      if (!compSearchRef.current && !compSugBoxRef.current) return;
      const inInput = compSearchRef.current?.contains(e.target);
      const inBox = compSugBoxRef.current?.contains(e.target);
      if (!inInput && !inBox) setCompSugOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const handleCompSearchKeyDown = (e) => {
    if (!compSugOpen || compSug.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCompSugIndexInternal((i) => (i + 1) % compSug.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCompSugIndexInternal((i) => (i - 1 + compSug.length) % compSug.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const sel = compSug[compSugIndexInternal] || compSug[0];
      if (sel) {
        toggleCompetition(sel.id);
        setCompSearch("");
        setCompSug([]);
        setCompSugOpen(false);
      }
    } else if (e.key === "Escape") {
      setCompSugOpen(false);
    }
  };

  /* ---------- filters UI helpers ---------- */
  const flatCompetitions = useMemo(() => {
    const out = [];
    Object.values(groupedCompetitions).forEach((arr) =>
      (arr || []).forEach((c) => out.push(c))
    );
    return out;
  }, [groupedCompetitions]);

  const compIdToLabelLocal = useMemo(() => {
    const map = {};
    Object.entries(groupedCompetitions || {}).forEach(([country, comps]) => {
      (comps || []).forEach((c) => {
        map[String(c.competition_id)] = `${country} - ${c.competition_name}`;
      });
    });
    return map;
  }, [groupedCompetitions]);

  const toggleCompetition = (id) => {
    const sid = String(id);
    setSelectedCompetitionIds((prev) =>
      prev.includes(sid) ? prev.filter((x) => x !== sid) : [...prev, sid]
    );
  };
  const clearCompetitions = () => setSelectedCompetitionIds([]);
  const selectAllCompetitions = () =>
    setSelectedCompetitionIds(flatCompetitions.map((c) => String(c.competition_id)));

  const selectTop10Competitions = () => {
    const arr = [...flatCompetitions];
    arr.sort(
      (a, b) => Number(b.total_value_eur || 0) - Number(a.total_value_eur || 0)
    );
    setSelectedCompetitionIds(arr.slice(0, 10).map((c) => String(c.competition_id)));
  };

  const clearSeasons = () => setSelectedSeasons([]);
  const selectAllSeasons = () => setSelectedSeasons(allSeasons);
  const handleLast5Seasons = () => setSelectedSeasons(allSeasons.slice(0, 5));

  const toggleCountry = (country) =>
    setExpandedCountries((prev) => ({ ...prev, [country]: !prev[country] }));

  // Invites helpers
  const addInvite = (u) => {
    if (!u || u.id === currentUser?.id) return;
    if (invites.find((x) => x.id === u.id)) return;
    setInvites((prev) => [...prev, u]);

    // clear results and re-focus
    setSearchEmail("");
    setEmailResults([]);
    setInviteIndex(-1);
    setTimeout(() => searchEmailRef.current?.focus(), 0);
  };

  const removeInvite = (id) => {
    setInvites((prev) => prev.filter((x) => x.id !== id));
    setTimeout(() => searchEmailRef.current?.focus(), 0);
  };

  // Load available points today
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!currentUser?.id) return;
      const { data, error } = await supabase.rpc("pt_available_today", {
        p_uid: currentUser.id,
      });
      if (!cancelled) setAvailableToday(error ? null : Number(data || 0));
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUser?.id]);

  /* ---------- validation ---------- */
  const validate = () => {
    const next = {};
    if (!name.trim()) next.name = "Please enter a tournament name.";
    const mins = Math.floor(Number(roundTimeMinutes));
    if (!Number.isFinite(mins) || mins < 5 || mins > 1440) {
      next.roundTimeMinutes = "Round time must be between 5 and 1440 minutes.";
    }
    const r2e = Math.floor(Number(roundsToElimination));
    if (!Number.isFinite(r2e) || r2e < 1 || r2e > 5) {
      next.roundsToElimination = "Rounds to elimination must be between 1 and 5.";
    }
    if (!currentUser?.id) {
      next.user = "You must be logged in to create a tournament.";
    }
    if (visibility === "private" && (invites || []).length < 1) {
      next.invites = "Invite at least one other user (minimum 2 participants).";
    }
    const stake = Math.floor(Number(stakePoints));
    if (!Number.isFinite(stake) || stake < 0) {
      next.stakePoints = "Stake must be 0 || a positive integer.";
    }
    const minP = Math.floor(Number(minParticipants));
    if (!Number.isFinite(minP) || minP < 2) {
      next.minParticipants = "Minimum participants must be at least 2.";
    }
    const jw = Math.floor(Number(joinWindowMinutes));
    if (!Number.isFinite(jw) || jw < 5 || jw > 1440) {
      next.joinWindowMinutes = "Join window must be between 5 and 1440 minutes.";
    }
    if (availableToday !== null && stake > availableToday) {
      next.stakePoints = `You have only ${availableToday} points available today.`;
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  /* ---------- submit ---------- */
  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError("");
    if (!validate()) return;

    setSubmitting(true);
    try {
      const filtersPayload = {
        competitions: selectedCompetitionIds,
        seasons: selectedSeasons,
        minMarketValue: Number(minMarketValue) || 0,
        minAppearances: Number(minAppearances) || 0,
        visibility: visibility // Make sure visibility is included in filters
      };

      // NEW: use the stakes RPC
      const { data, error } = await supabase.rpc(
        "create_elimination_tournament_with_stakes",
        {
          p_filters: filtersPayload,
          p_invited_user_ids: visibility === "public" ? [] : invites.map((u) => u.id),
          p_name: name.trim(),
          p_round_time_limit_seconds: Math.floor(Number(roundTimeMinutes) * 60),
          p_rounds_to_elimination: Math.floor(Number(roundsToElimination)),
          p_stake_points: Math.floor(Number(stakePoints)),
          p_join_window_minutes: Math.floor(Number(joinWindowMinutes)),
          p_min_participants: Math.floor(Number(minParticipants)),
        }
      );
      if (error) throw new Error(error.message || "Failed to create tournament.");
      const createdId = data || null;

      // Ensure a true "friendly" (0 stake) even if server defaults to 1
      if (createdId && Math.floor(Number(stakePoints)) === 0) {
        await supabase
          .from("elimination_tournaments")
          .update({ stake_points: 0 })
          .eq("id", createdId);
      // After ensuring friendly stake=0, refresh lists for the creator immediately
      try { onCreated && (await onCreated()); } catch (e) { /* ignore */ }
      }
      // Notify invitees (existing behavior — complements DB lifecycle notifications)
      if (visibility === "private" && invites.length > 0) {
        const notifRows = invites.map((u) => ({
          user_id: u.id,
          type: "elimination_invite",
          payload: {
            tournament_id: createdId || "unknown",
            tournament_name: name.trim(),
            creator_name: currentUser?.full_name || currentUser?.email || "Someone",
            round_time_limit_minutes: roundTimeMinutes,
          },
        }));

        await supabase.from("notifications").insert(notifRows);
      }

      await onCreated?.();
      onClose?.();
    } catch (ex) {
      setSubmitError(ex instanceof Error ? ex.message : "Failed to create tournament.");
    } finally {
      setSubmitting(false);
    }
  };

  /* ---------- UI ---------- */
  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Create Elimination Tournament"
        tabIndex={-1}
        ref={dialogRef}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        {/* Fixed-height panel with internal scrolling */}
        <div className="w-full max-w-3xl max-h-[85vh] flex flex-col rounded-2xl border border-gray-200 bg-white p-0 shadow-xl">
          <div className="flex items-center justify-between border-b border-gray-200 p-4">
            <h2 className="text-lg font-semibold text-gray-900">
              Create Elimination Tournament
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-2 py-1 text-sm text-gray-600 hover:bg-gray-100"
            >
              Close
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex-1 min-h-0 flex flex-col">
            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-6">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Tournament Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Friday Night Knockout"
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-green-700"
                />
                {errors.name && (
                  <p className="mt-1 text-xs text-red-600">{errors.name}</p>
                )}
              </div>

              {/* Difficulty Filters */}
              <DifficultyFilters
                loadingFilters={loadingFilters}
                compCollapsed={compCollapsed}
                setCompCollapsed={setCompCollapsed}
                seasonsCollapsed={seasonsCollapsed}
                setSeasonsCollapsed={setSeasonsCollapsed}
                mvCollapsed={mvCollapsed}
                setMvCollapsed={setMvCollapsed}
                compSearch={compSearch}
                setCompSearch={setCompSearch}
                compSugOpen={setCompSugOpen}
                compSugIndex={compSugIndexInternal}
                setCompSugIndex={setCompSugIndexInternal}
                compSug={compSug}
                compSearchRef={compSearchRef}
                compSugBoxRef={compSugBoxRef}
                handleCompSearchKeyDown={handleCompSearchKeyDown}
                groupedCompetitions={groupedCompetitions}
                expandedCountries={expandedCountries}
                toggleCountry={toggleCountry}
                selectedCompetitionIds={selectedCompetitionIds}
                toggleCompetition={toggleCompetition}
                clearCompetitions={clearCompetitions}
                selectAllCompetitions={selectAllCompetitions}
                selectTop10Competitions={selectTop10Competitions}
                compIdToLabel={compIdToLabelLocal}
                allSeasons={allSeasons}
                selectedSeasons={selectedSeasons}
                setSelectedSeasons={setSelectedSeasons}
                clearSeasons={clearSeasons}
                selectAllSeasons={selectAllSeasons}
                handleLast5Seasons={handleLast5Seasons}
                minMarketValue={minMarketValue}
                setMinMarketValue={setMinMarketValue}
                minAppearances={minAppearances}
                setMinAppearances={setMinAppearances}
                loadingCounts={loadingCounts}
                poolCount={poolCount}
                totalCount={totalCount}
                />                

              {/* Visibility */}
              <div className="rounded-xl shadow-sm border bg-white p-4">
                <label className="block text-sm font-semibold text-gray-700 mb-2">Challenge Type</label>
                <div className="flex items-center gap-4 text-sm">
                  <label className="inline-flex items-center gap-2">
                    <input type="radio" name="visibility" value="private"
                      checked={visibility === "private"}
                      onChange={() => setVisibility("private")}
                    />
                    <span>Private (invite-only)</span>
                  </label>
                  <label className="inline-flex items-center gap-2">
                    <input type="radio" name="visibility" value="public"
                      checked={visibility === "public"}
                      onChange={() => setVisibility("public")}
                    />
                    <span>Public (anyone can join)</span>
                  </label>
                </div>
                <p className="mt-2 text-xs text-gray-600">Public challenges appear to all users in the lobby. Private challenges are visible only to invited users.</p>
              </div>

              {/* Invites */}
              {visibility === "private" && (
              <div className="rounded-xl shadow-sm border bg-white p-4">
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Invite users (by email)
                </label>

                <div className="flex gap-2">
                  <input
                    ref={searchEmailRef}
                    type="text"
                    value={searchEmail}
                    onChange={(e) => setSearchEmail(e.target.value)}
                    onKeyDown={(e) => {
                      if (!emailResults.length) return;

                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setInviteIndex((i) =>
                          i < 0 ? 0 : (i + 1) % emailResults.length
                        );
                      } else if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setInviteIndex((i) =>
                          i < 0 ? emailResults.length - 1 : (i - 1 + emailResults.length) % emailResults.length
                        );
                      } else if (e.key === "Enter" || e.key === " ") {
                        if (inviteIndex >= 0 && emailResults[inviteIndex]) {
                          e.preventDefault();
                          addInvite(emailResults[inviteIndex]);
                        }
                      } else if (e.key === "Escape") {
                        setEmailResults([]);
                        setInviteIndex(-1);
                      }
                    }}
                    placeholder="Type an email to search…"
                    className="flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-700"
                    aria-autocomplete="list"
                    aria-controls="invite-results-list"
                    aria-expanded={emailResults.length > 0}
                    aria-activedescendant={
                      inviteIndex >= 0 ? `invite-item-${inviteIndex}` : undefined
                    }
                  />
                </div>
              
                {/* search results with keyboard nav */}
                {emailResults.length > 0 && (
                  <div
                    id="invite-results-list"
                    ref={inviteListRef}
                    role="listbox"
                    className="mt-2 border rounded-md max-h-60 overflow-auto"
                  >
                    {emailResults.map((u, idx) => {
                      const active = idx === inviteIndex;
                      return (
                        <button
                          key={u.id}
                          ref={inviteItemRefs.current[idx]}
                          id={`invite-item-${idx}`}
                          role="option"
                          aria-selected={active}
                          type="button"
                          onClick={() => addInvite(u)}
                          className={classNames(
                            "w-full text-left px-3 py-2 text-sm flex items-center justify-between",
                            active ? "bg-green-100" : "hover:bg-gray-50"
                          )}
                        >
                          <span className="truncate">
                            {u.full_name ? `${u.full_name} — ${u.email}` : u.email}
                          </span>
                          <span className="text-xs text-gray-500 ml-3">Add</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Selected invites as chips */}
                {invites.length > 0 && (
                  <div className="mt-3">
                    <div className="text-xs text-gray-600 mb-1">Invited</div>
                    <div className="flex flex-wrap gap-2">
                      {invites.map((u) => (
                        <span
                          key={u.id}
                          className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-800"
                        >
                          {u.full_name || u.email}
                          <button
                            type="button"
                            className="ml-1 text-gray-500 hover:text-red-600"
                            title="Remove"
                            onClick={() => removeInvite(u.id)}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {errors.invites && (
                  <p className="mt-2 text-xs text-red-600">{errors.invites}</p>
                )}
              </div>
              )}

{/* Round time */}
              <div className="rounded-xl shadow-sm border bg-white p-4">
                <label className="block text-sm font-semibold text-gray-700">
                  Round Time Limit (minutes)
                </label>
                <input
                  type="number"
                  min={5}
                  max={1440}
                  step={5}
                  value={roundTimeMinutes}
                  onChange={(e) => setRoundTimeMinutes(e.target.value)}
                  className="mt-1 w-44 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-700"
                />
                {errors.roundTimeMinutes && (
                  <p className="mt-1 text-xs text-red-600">
                    {errors.roundTimeMinutes}
                  </p>
                )}
              </div>

              {/* Rounds to Elimination */}
              <div className="rounded-xl shadow-sm border bg-white p-4">
                <label className="block text.sm font-semibold text-gray-700">
                  Rounds to Elimination (1–5)
                </label>
                <input
                  type="number"
                  min={1}
                  max={5}
                  step={1}
                  value={roundsToElimination}
                  onChange={(e) => setRoundsToElimination(e.target.value)}
                  className="mt-1 w-44 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-700"
                />
                {errors.roundsToElimination && (
                  <p className="mt-1 text-xs text-red-600">
                    {errors.roundsToElimination}
                  </p>
                )}
                <p className="mt-2 text-xs text-gray-600">
                  Scores are summed across each block of rounds and eliminations occur at the end of those blocks (including the elimination round).
                </p>
              </div>

              {/* NEW: Stake & Lobby settings */}
              <div className="rounded-xl shadow-sm border bg-white p-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700">
                      Stake (points per player)
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={stakePoints}
                      onChange={(e) => setStakePoints(e.target.value)}
                      className="mt-1 w-44 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-700"
                    />
                    {errors.stakePoints && (
                      <p className="mt-1 text-xs text-red-600">
                        {errors.stakePoints}
                      </p>
                    )}
                    {availableToday !== null && (
                      <p className="mt-1 text-[11px] text-gray-600">
                        You have <span className="font-semibold">{availableToday}</span> points available today.
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700">
                      Minimum Participants
                    </label>
                    <input
                      type="number"
                      min={2}
                      step={1}
                      value={minParticipants}
                      onChange={(e) => setMinParticipants(e.target.value)}
                      className="mt-1 w-44 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-700"
                    />
                    {errors.minParticipants && (
                      <p className="mt-1 text-xs text-red-600">
                        {errors.minParticipants}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700">
                      Join Window (minutes)
                    </label>
                    <input
                      type="number"
                      min={5}
                      max={1440}
                      step={5}
                      value={joinWindowMinutes}
                      onChange={(e) => setJoinWindowMinutes(e.target.value)}
                      className="mt-1 w-44 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-700"
                    />
                    {errors.joinWindowMinutes && (
                      <p className="mt-1 text-xs text-red-600">
                        {errors.joinWindowMinutes}
                      </p>
                    )}
                  </div>
                </div>

                <p className="mt-2 text-xs text-gray-600">
                  Each accepted participant (including you) pays the stake immediately. If the lobby is canceled at the deadline due to low turnout, stakes are refunded automatically.
                </p>
              </div>

              {submitError && (
                <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-800">
                  {submitError}
                </div>
              )}
            </div>

            {/* Fixed footer */}
            <div className="border-t p-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-green-800 disabled:opacity-60"
                disabled={submitting}
              >
                {submitting ? "Creating…" : "Create"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}

/* ----------------- Difficulty Filters section (reused) ----------------- */
function Section({ title, icon, collapsed, onToggle, actions, children }) {
  return (
    <div className="rounded-lg border bg-white/60">
      <div className="flex items-center justify-between px-3 py-2">
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex items-center gap-2"
        >
          {icon}
          <span className="font.medium text-green-900">{title}</span>
          <span className="ml-1 text-gray-600">{collapsed ? "▼" : "▲"}</span>
        </button>
        <div className="hidden sm:flex items-center gap-2 flex-wrap">
          {actions}
        </div>
      </div>
      {actions && (
        <div className="sm:hidden px-3 pb-2">
          <div className="flex flex-wrap gap-2">{actions}</div>
        </div>
      )}
      {!collapsed && <div className="p-3 pt-0">{children}</div>}
    </div>
  );
}

function SelectedChipsRow({
  selectedCompetitionIds,
  compIdToLabel,
  selectedSeasons,
  minMarketValue,
  minAppearances,
  onRemoveCompetition,
  onRemoveSeason,
  onClearAll,
}) {
  const hasAny =
    (selectedCompetitionIds?.length || 0) +
      (selectedSeasons?.length || 0) +
      (minMarketValue ? 1 : 0) +
      (minAppearances ? 1 : 0) >
    0;

  if (!hasAny) {
    return (
      <div className="rounded-md border border-dashed p-3 text-xs text-gray-600 bg-white">
        No filters selected yet.
      </div>
    );
  }

  return (
    <div className="rounded-md border p-3 bg-white">
      <div className="flex flex-wrap items-center gap-2">
        {selectedCompetitionIds?.map((id) => (
          <span
            key={`comp-${id}`}
            className="inline-flex items-center gap-2 px-2 py-1 rounded-full text-xs bg-green-100 text-green-800"
          >
            {compIdToLabel?.[id] || `Competition ${id}`}
            {onRemoveCompetition && (
              <button
                type="button"
                onClick={() => onRemoveCompetition(id)}
                className="text-red-600 hover:text-red-700"
                title="Remove"
              >
                ×
              </button>
            )}
          </span>
        ))}
        {selectedSeasons?.map((s) => (
          <span
            key={`season-${s}`}
            className="inline-flex items.center gap-2 px-2 py-1 rounded-full text-xs bg-green-100 text-green-800"
          >
            {String(s)}
            {onRemoveSeason && (
              <button
                type="button"
                onClick={() => onRemoveSeason(s)}
                className="text-red-600 hover:text-red-700"
                title="Remove"
              >
                ×
              </button>
            )}
          </span>
        ))}
        {minMarketValue ? (
          <span className="inline-flex items-center gap-2 px-2 py-1 rounded-full text-xs bg-green-100 text-green-800">
            Min MV: €{fmtCurrency(minMarketValue)}
          </span>
        ) : null}
        {minAppearances ? (
          <span className="inline-flex items-center gap-2 px-2 py-1 rounded-full text-xs bg-green-100 text-green-800">
            Min Apps: {minAppearances}
          </span>
        ) : null}
        {onClearAll && (
          <button
            type="button"
            onClick={onClearAll}
            className="ml-1 text-xs text-gray-600 underline hover:text-gray-800"
            title="Clear all filters"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

function PresetButton({ onClick, children, title, active = false }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      title={title}
      className={classNames(
        "inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border transition-colors",
        active
          ? "bg-green-600 text-white border-green-700"
          : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
      )}
    >
      {children}
    </button>
  );
}

function DifficultyFilters(props) {
  const {
    loadingFilters,
    compCollapsed,
    setCompCollapsed,
    seasonsCollapsed,
    setSeasonsCollapsed,
    mvCollapsed,
    setMvCollapsed,
    compSearch,
    setCompSearch,
    compSugOpen,
    setCompSugOpen,
    compSug,
    compSugIndex,
    setCompSugIndex,
    compSearchRef,
    compSugBoxRef,
    handleCompSearchKeyDown,
    groupedCompetitions,
    expandedCountries,
    toggleCountry,
    selectedCompetitionIds,
    toggleCompetition,
    clearCompetitions,
    selectAllCompetitions,
    selectTop10Competitions,
    compIdToLabel,
    allSeasons,
    selectedSeasons,
    setSelectedSeasons,
    clearSeasons,
    selectAllSeasons,
    handleLast5Seasons,
    minMarketValue,
    setMinMarketValue,
    minAppearances,
    setMinAppearances,
    loadingCounts,
    poolCount,
    totalCount,
  } = props;

  const [appsCollapsed, setAppsCollapsed] = useState(true);
  return (
    <div className="rounded-xl shadow-sm border bg-green-50/60 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-green-900 font-semibold">Difficulty Filters</span>
        </div>
      </div>

      {/* Selected filters chips row */}
      <div className="mt-3">
        <SelectedChipsRow
          selectedCompetitionIds={selectedCompetitionIds}
          compIdToLabel={compIdToLabel}
          selectedSeasons={selectedSeasons}
          minMarketValue={minMarketValue}
          minAppearances={minAppearances}
          onRemoveCompetition={(id) => toggleCompetition(id)}
          onRemoveSeason={(s) =>
            setSelectedSeasons((prev) => prev.filter((x) => x !== s))
          }
          onClearAll={() => {
            clearCompetitions();
            clearSeasons();
            setMinMarketValue(0);
            setMinAppearances(0);
          }}
        />
        <div className="mt-2 text-xs text-gray-600">
          {loadingCounts
            ? "Calculating player pool…"
            : `Player pool: ${poolCount} of ${totalCount}`}
        </div>
      </div>

      {!loadingFilters && (
        <div className="mt-4 space-y-6">
          {/* Competitions */}
          <Section
            title="Competitions"
            icon={<Star className="h-4 w-4 text-green-700" />}
            collapsed={compCollapsed}
            onToggle={() => setCompCollapsed((v) => !v)}
            actions={
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    selectTop10Competitions();
                  }}
                  className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
                >
                  <Star className="h-3 w-3" /> Top 10
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    selectAllCompetitions();
                  }}
                  className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
                >
                  <CheckSquare className="h-3 w-3" /> Select All
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    clearCompetitions();
                  }}
                  className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
                >
                  <Trash2 className="h-3 w-3" />
                  Clear All
                </button>
              </>
            }
          >
            {/* search */}
            <div className="mb-3 relative" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-2 border rounded-md bg-white px-2 py-1">
                <Search className="h-4 w-4 text-gray-500" />
                <input
                  ref={compSearchRef}
                  type="text"
                  value={compSearch}
                  onChange={(e) => setCompSearch(e.target.value)}
                  onFocus={() => setCompSugOpen(compSug.length > 0)}
                  onKeyDown={handleCompSearchKeyDown}
                  placeholder="Search country || competition…"
                  className="w-full outline-none text-sm"
                />
              </div>
              {compSugOpen && compSug.length > 0 && (
                <div
                  ref={compSugBoxRef}
                  className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-white shadow"
                >
                  {compSug.map((s, idx) => {
                    const active = idx === compSugIndex;
                    const checked = selectedCompetitionIds.includes(s.id);
                    return (
                      <button
                        key={`${s.id}-${idx}`}
                        type="button"
                        onClick={() => {
                          toggleCompetition(s.id);
                          setCompSearch("");
                          setCompSugOpen(false);
                          setCompSugIndex(-1);
                        }}
                        className={classNames(
                          "w-full text-left px-2 py-1 flex items-center gap-2 text-sm",
                          active ? "bg-green-100" : "hover:bg-gray-50"
                        )}
                      >
                        {s.logo_url && (
                          <img
                            src={s.logo_url}
                            alt={s.name}
                            className="w-4 h-4 object-contain"
                          />
                        )}
                        <span className="flex-1">{s.label}</span>
                        {checked && (
                          <span className="text-green-700 text-xs font-semibold">
                            selected
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="max-h-72 overflow-y-auto pr-2">
              {Object.entries(groupedCompetitions)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([country, comps]) => (
                  <div key={country} className="mb-2">
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        toggleCountry(country);
                      }}
                      type="button"
                      className="w-full flex items-center justify-between p-2 hover:bg-green-50 rounded"
                    >
                      <div className="flex items-center gap-2">
                        {comps?.[0]?.flag_url && (
                          <img
                            src={comps[0].flag_url}
                            alt={country}
                            className="w-6 h-4 object-cover rounded"
                          />
                        )}
                        <span>{country}</span>
                        <span className="text-xs text-gray-500">
                          ({comps.length})
                        </span>
                      </div>
                      <span className="text-sm text-gray-600">
                        {expandedCountries[country] ? "▲" : "▼"}
                      </span>
                    </button>

                    {expandedCountries[country] && (
                      <div className="ml-8 space-y-2 mt-2">
                        {comps.map((c) => {
                          const cid = String(c.competition_id);
                          const checked = selectedCompetitionIds.includes(cid);
                          return (
                            <label
                              key={cid}
                              className="flex items-center gap-2 cursor-pointer"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleCompetition(cid)}
                                className="rounded"
                              />
                              {c.logo_url && (
                                <img
                                  src={c.logo_url}
                                  alt={c.competition_name}
                                  className="w-5 h-5 object-contain"
                                />
                              )}
                              <span className="text-sm">{c.competition_name}</span>
                              {c.tier && (
                                <span className="ml-2 text:[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700">
                                  Tier {c.tier}
                                </span>
                              )}
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
            </div>
          </Section>

          {/* Seasons */}
          <Section
            title="Seasons"
            icon={<CalendarClock className="h-4 w-4 text-green-700" />}
            collapsed={seasonsCollapsed}
            onToggle={() => setSeasonsCollapsed((v) => !v)}
            actions={
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleLast5Seasons();
                  }}
                  className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
                >
                  <CalendarClock className="h-3 w-3" /> Last 5
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    selectAllSeasons();
                  }}
                  className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
                >
                  <CheckSquare className="h-3 w-3" /> Select All
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    clearSeasons();
                  }}
                  className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
                >
                  <Trash2 className="h-3 w-3" />
                  Clear All
                </button>
              </>
            }
          >
            <div className="max-h-60 overflow-y-auto pr-2">
              {allSeasons.map((s) => {
                const checked = selectedSeasons.includes(s);
                return (
                  <label key={s} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        setSelectedSeasons((prev) =>
                          prev.includes(s)
                            ? prev.filter((x) => x !== s)
                            : [...prev, s]
                        );
                      }}
                      className="rounded"
                    />
                    <span className="text-sm">{s}</span>
                  </label>
                );
              })}
            </div>
          </Section>

          {/* Minimum Market Value */}
          <Section
            title="Min Market Value (€)"
            icon={<Star className="h-4 w-4 text-green-700" />}
            collapsed={mvCollapsed}
            onToggle={() => setMvCollapsed((v) => !v)}
            actions={
              <>
                {[0, 100_000, 500_000, 1_000_000, 5_000_000, 10_000_000]
                  .concat([25_000_000, 50_000_000])
                  .map((v) => (
                    <PresetButton
                      key={v}
                      onClick={() => setMinMarketValue(v)}
                      active={minMarketValue === v}
                    >
                      {v >= 1_000_000 ? `${v / 1_000_000}M €` : `${v / 1_000}K €`}
                    </PresetButton>
                  ))}
              </>
            }
          >
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                step={100000}
                value={minMarketValue}
                onChange={(e) => setMinMarketValue(Math.max(0, Number(e.target.value)))}
                className="w-44 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-700"
              />
            </div>
          </Section>
          
          {/* Minimum Appearances */}
            <Section
    title="Min Appearances"
    icon={<User className="h-4 w-4 text-green-700" />}
    actions={
      <>
        {[0,5,10,15,20,25,30].map((v) => (
          <PresetButton key={v} onClick={() => setMinAppearances(v)} active={minAppearances === v}>
            {v}
          </PresetButton>
        ))}
      </>
    }
     collapsed={appsCollapsed}
     onToggle={() => setAppsCollapsed((v) => !v)}
  >
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                step={1}
                value={minAppearances}
                onChange={(e) => setMinAppearances(Math.max(0, Number(e.target.value)))}
                className="w-44 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-700"
              />
            </div>
          </Section>
        </div>
      )}
    </div>
  );
}
