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
  Bell, // NEW: for notifications banner icon
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

async function finalizeLatestRoundForTournament(tournamentId, nextPlayerId = null, force = false) {
  const roundId = await getLatestOpenRoundIdForTournament(tournamentId);
  if (!roundId) {
    throw new Error(`No open round found for tournament ${tournamentId}`);
  }
  const { data, error } = await supabase.rpc("finalize_round", {
    p_round_id: roundId,             // ✅ guaranteed to be a round_id
    p_force: Boolean(force),
    p_next_player_id: nextPlayerId ?? null,
  });
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
  const [finished, setFinished] = useState([]);
  const [loading, setLoading] = useState({ live: true, finished: true });
  const [error, setError] = useState({ live: "", finished: "" });

  // Notifications banner (NEW) — load unread on first visit, mark as read, show once
  const [notifBanner, setNotifBanner] = useState([]);

  // Force children to refetch on page reloads / realtime updates
  const [refreshTick, setRefreshTick] = useState(0);

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
        /* ignore — we’ll just show raw ids if this fails */
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

  // Reload both lists (used on mount and after create or advance)
  const reloadLists = async () => {
    if (!user?.id) {
      setLive([]);
      setFinished([]);
      setLoading({ live: false, finished: false });
      setError({ live: "", finished: "" });
      return;
    }

    // Live
    setLoading((s) => ({ ...s, live: true }));
    setError((e) => ({ ...e, live: "" }));
    try {
      const { data, error: err } = await supabase
        .from("elimination_tournaments")
        .select(
          "id, name, status, created_at, round_time_limit_seconds, filters, winner_user_id"
        )
        .eq("status", "live")
        .order("created_at", { ascending: false });
      if (err) {
        setError((e) => ({ ...e, live: err.message || "Failed to load." }));
        setLive([]);
      } else {
        setLive(Array.isArray(data) ? data : []);
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
          "id, name, status, created_at, round_time_limit_seconds, filters, winner_user_id"
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
      // bump refresh token so TournamentCards refetch internals
      setRefreshTick((t) => t + 1);
    }
  };

  // Initial / on user change
  useEffect(() => {
    reloadLists();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Auto-reload every 30s ONLY if there is a live challenge
  useEffect(() => {
    if (!live || live.length === 0) return;
    const id = setInterval(() => {
      reloadLists();
    }, 30_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.length]);

  // Realtime subscriptions: reload on any change in elim tables
  useEffect(() => {
    const ch = supabase
      .channel("elim-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "elimination_tournaments" },
        () => reloadLists()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "elimination_rounds" },
        () => reloadLists()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "elimination_round_entries" },
        () => reloadLists()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "elimination_participants" },
        () => reloadLists()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load unread elimination notifications ON FIRST VISIT, then mark as read (NEW)
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    async function loadAndMark() {
      const { data: unread } = await supabase
        .from("notifications")
        .select("id, payload, created_at")
        .eq("user_id", user.id)
        .eq("type", "elimination_invite")
        .is("read_at", null)
        .order("created_at", { ascending: false });

      if (!cancelled && unread?.length) {
        setNotifBanner(
          unread.map((n) => ({
            id: n.id,
            created_at: n.created_at,
            ...n.payload,
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
            eliminated until a single winner remains.
          </p>

          {/* Notifications banner (NEW) */}
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
                        You were added to{" "}
                        <span className="font-medium">{n.tournament_name}</span>{" "}
                        by <span className="font-medium">{n.creator_name}</span>
                        {typeof n.round_time_limit_minutes === "number" ? (
                          <>
                            {" "}
                            — round time limit{" "}
                            <span className="font-medium">
                              {n.round_time_limit_minutes} min
                            </span>
                          </>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Create button stays available (was previously Live-tab only) */}
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

        {/* Combined content: Live (expanded) then Finished (collapsed except most recent) */}
        <section
          className="grid grid-cols-1 gap-4 sm:grid-cols-1 lg:grid-cols-1"
          aria-live="polite"
          aria-busy={loading.live || loading.finished}
        >
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
                  defaultCollapsed={false} // LIVE → expanded by default
                  refreshToken={refreshTick}
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
              {finished.map((t) => (
                <TournamentCard
                  key={t.id}
                  tournament={t}
                  compIdToLabel={compIdToLabel}
                  onAdvanced={reloadLists}
                  defaultCollapsed={t.id === mostRecentFinishedId ? false : true}
                  refreshToken={refreshTick}
                />
              ))}
            </>
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
function Countdown({ endsAt }) {
  const [left, setLeft] = useState(() => format(endsAt));

  useEffect(() => {
    setLeft(format(endsAt));
    if (!endsAt) return;
    const id = setInterval(() => setLeft(format(endsAt)), 1000);
    return () => clearInterval(id);
  }, [endsAt]);

  function format(endIso) {
    if (!endIso) return "—";
    const end = new Date(endIso).getTime();
    const now = Date.now();
    const ms = Math.max(0, end - now);
    const s = Math.floor(ms / 1000);
    const h = String(Math.floor(s / 3600)).padStart(2, "0");
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    return `${h}:${m}:${ss}`;
  }

  // Requested: countdown in red
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

function WinnerCelebrationCard({ tournamentName, winner, stats, ranking }) {
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
            You conquered <span className="font-semibold">{tournamentName}</span> and outlasted everyone. Glory secured!
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
function LoserFinalCard({ tournamentName, winner, stats, ranking }) {
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
            . Train harder and return stronger.
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
   Tournament Card
------------------------------------------------------------ */
function TournamentCard({
  tournament,
  compIdToLabel,
  onAdvanced,
  defaultCollapsed = false,
  refreshToken, // NEW: force internal refetches
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const userId = user?.id || null;

  const createdAt = new Date(tournament.created_at);
  const dateStr = createdAt.toLocaleString();
  const isLive = tournament.status === "live";
  const timeLimitMin = Math.round(
    (tournament.round_time_limit_seconds || 0) / 60
  );

  const [participants, setParticipants] = useState([]); // [{id, full_name, email, profile_photo_url, state}]
  const [rounds, setRounds] = useState([]); // [{id, round_number, started_at, ends_at, closed_at, player_id}]
  const [entriesByRound, setEntriesByRound] = useState({}); // { round_id : [{user_id, points_earned}] }

  // NEW: card-level collapse (default uses incoming prop)
  const [cardCollapsed, setCardCollapsed] = useState(Boolean(defaultCollapsed));
  // NEW: filters section collapse (defaults to COLLAPSED)
  const [filtersCollapsed, setFiltersCollapsed] = useState(true);

  // Fetch participants + all rounds (+ fill in any missing users from entries)
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // participants + states
        const { data: partRows } = await supabase
          .from("elimination_participants")
          .select("user_id, state")
          .eq("tournament_id", tournament.id);

        const idsFromParticipants = (partRows || []).map((r) => r.user_id);
        const stateByUserId = new Map(
          (partRows || []).map((r) => [r.user_id, r.state])
        );

        let userRows = [];
        if (idsFromParticipants.length) {
          const { data: usersRows } = await supabase
            .from("users")
            .select("id, full_name, email, profile_photo_url")
            .in("id", idsFromParticipants);
          userRows = usersRows || [];
        }

        // rounds
        const { data: roundRows } = await supabase
          .from("elimination_rounds")
          .select("id, round_number, started_at, ends_at, closed_at, player_id")
          .eq("tournament_id", tournament.id)
          .order("round_number", { ascending: true });

        const roundsArr = Array.isArray(roundRows) ? roundRows : [];
        const entriesMap = {};

        // entries per round (batched) + collect any extra user_ids
        const extraUserIds = new Set();
        for (const r of roundsArr) {
          const { data: ent } = await supabase
            .from("elimination_round_entries")
            .select("user_id, points_earned, finished_at")
            .eq("round_id", r.id);
          const e = Array.isArray(ent) ? ent : [];
          entriesMap[r.id] = e;
          for (const row of e) {
            if (!idsFromParticipants.includes(row.user_id)) {
              extraUserIds.add(row.user_id);
            }
          }
        }

        if (extraUserIds.size) {
          const { data: extraUsers } = await supabase
            .from("users")
            .select("id, full_name, email, profile_photo_url")
            .in("id", Array.from(extraUserIds));
          userRows = [...userRows, ...(extraUsers || [])];
        }

        // attach participant state to user objects
        const userRowsWithState = (userRows || []).map((u) => ({
          ...u,
          state: stateByUserId.get(u.id) || null,
        }));

        if (!cancelled) {
          setParticipants(userRowsWithState);
          setRounds(roundsArr);
          setEntriesByRound(entriesMap);
        }
      } catch {
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
  }, [tournament.id, refreshToken]); // <- NEW dep to refetch when parent reloads

  const participantsMap = useMemo(() => {
    const m = new Map();
    for (const p of participants) m.set(p.id, p);
    return m;
  }, [participants]);

  const entriesFor = (roundId) => entriesByRound[roundId] || [];

  // Build filter chips grouped under headings
  const { compChips, seasonChips, mvChip } = useMemo(() => {
    const f = tournament.filters || {};
    const seasons = Array.isArray(f.seasons) ? f.seasons : [];
    const comps = Array.isArray(f.competitions) ? f.competitions : [];
    const mv = Number(f.minMarketValue || 0);

    const compChips = comps.map((id) => ({
      key: `C-${id}`,
      label: compIdToLabel?.[String(id)] || `League ${id}`,
    }));
    const seasonChips = seasons.map((s) => ({
      key: `S-${s}`,
      label: String(s),
    }));
    const mvChip = mv > 0 ? { key: "MV", label: `Min MV: €${fmtCurrency(mv)}` } : null;

    return { compChips, seasonChips, mvChip };
  }, [tournament.filters, compIdToLabel]);

  // --- MY STATE: determine if I'm eliminated (used to block play) ---
  const iAmEliminated =
    ((participantsMap.get(userId)?.state || "").toLowerCase() === "eliminated");

  // ***** Per-round active users (already implemented) *****
  const activeUsersByRound = useMemo(() => {
    const result = new Map();
    if (!Array.isArray(rounds) || rounds.length === 0) return result;
    if (!Array.isArray(participants) || participants.length === 0) return result;

    let activeSet = new Set(participants.map((p) => p.id));
    const ordered = [...rounds].sort((a, b) => (a.round_number || 0) - (b.round_number || 0));
    for (const r of ordered) {
      result.set(r.id, new Set(activeSet));

      const isClosed =
        !!r.closed_at ||
        (r.ends_at ? new Date(r.ends_at).getTime() <= Date.now() : false);

      if (!isClosed) continue;

      const entries = entriesByRound[r.id] || [];
      const ptsByUser = new Map(entries.map((e) => [e.user_id, Number(e.points_earned ?? 0)]));

      const played = [];
      const notPlayed = [];
      for (const uid of activeSet) {
        if (ptsByUser.has(uid)) played.push(uid);
        else notPlayed.push(uid);
      }

      const eliminated = new Set();
      for (const uid of notPlayed) eliminated.add(uid);

      if (played.length > 0) {
        let minPts = Infinity;
        for (const uid of played) {
          const v = ptsByUser.get(uid);
          if (v < minPts) minPts = v;
        }
        for (const uid of played) {
          if (ptsByUser.get(uid) === minPts) eliminated.add(uid);
        }
      }

      for (const uid of eliminated) activeSet.delete(uid);
    }

    return result;
  }, [rounds, participants, entriesByRound]);

  // ***** Winner + standings + stats for finished tournaments *****
  const celebrationData = useMemo(() => {
    if (tournament.status !== "finished") return null;
    if (!rounds?.length || !participants?.length) return null;

    const winner =
      (tournament.winner_user_id && participantsMap.get(tournament.winner_user_id)) ||
      null;

    let activeSet = new Set(participants.map((p) => p.id));
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

      const played = [];
      const notPlayed = [];
      for (const uid of activeSet) {
        if (ptsByUser.has(uid)) played.push(uid);
        else notPlayed.push(uid);
      }

      const eliminated = new Set();
      for (const uid of notPlayed) {
        eliminated.add(uid);
        eliminatedRecords.push({
          userId: uid,
          eliminatedAtRound: r.round_number,
          lastPoints: null,
        });
      }

      if (played.length > 0) {
        let minPts = Infinity;
        for (const uid of played) {
          const v = ptsByUser.get(uid);
          if (v < minPts) minPts = v;
        }
        for (const uid of played) {
          if (ptsByUser.get(uid) === minPts) {
            eliminated.add(uid);
            eliminatedRecords.push({
              userId: uid,
              eliminatedAtRound: r.round_number,
              lastPoints: ptsByUser.get(uid),
            });
          }
        }
      }

      for (const uid of eliminated) activeSet.delete(uid);
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
  ]);

  // Play handler — sends a FLATTENED player payload
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

  // Auto-finalization (hardened): if a bad id slips through, fallback to latest open round
  const finalizingRef = useRef(new Set());
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!Array.isArray(rounds) || rounds.length === 0) return;
      if (!Array.isArray(participants) || participants.length === 0) return;

      const usedPlayerIds = new Set(
        (rounds || [])
          .map((x) => x?.player_id)
          .filter((v) => v !== null && v !== undefined)
      );

      const activeCount =
        participants.filter((p) => (p.state || "").toLowerCase() === "active")
          .length || participants.length;

      for (const r of rounds) {
        const entries = entriesByRound[r.id] || [];
        const everyonePlayed = entries.length >= activeCount;
        const now = Date.now();
        const timeUp = r.ends_at ? new Date(r.ends_at).getTime() <= now : false;
        const shouldFinalize = !r.closed_at && (everyonePlayed || timeUp);

        if (!shouldFinalize) continue;
        if (finalizingRef.current.has(r.id)) continue;

        finalizingRef.current.add(r.id);
        try {
          const laterRoundExists = rounds.some((x) => x.round_number > r.round_number);

          let nextPlayerId = null;
          if (!laterRoundExists) {
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

          // Normal path: finalize THIS round id
          const { error } = await supabase.rpc("finalize_round", {
            p_round_id: r.id,                      // ✅ round id
            p_next_player_id: nextPlayerId ?? null,
            p_force: Boolean(nextPlayerId),
          });

          if (error) {
            // If the server says "round ... not found", fall back to latest open round by tournament id
            const msg = String(error?.message || "").toLowerCase();
            const isNotFound = msg.includes("not found") && msg.includes("round");
            if (error.code === "P0001" && isNotFound) {
              console.warn("[elim] finalize_round reported not found for round", r.id, "— retrying with latest open round");
              await finalizeLatestRoundForTournament(
                tournament.id,
                nextPlayerId ?? null,
                Boolean(nextPlayerId)
              );
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
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rounds, entriesByRound, participants, tournament.id, userId, onAdvanced]);

  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm transition hover:shadow-md">
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
          <h3 className="text-base font-semibold text-gray-900">
            {tournament.name}
          </h3>
        </div>
        <span
          className={classNames(
            "shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold",
            isLive ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"
          )}
        >
          {isLive ? "Live" : "Finished"}
        </span>
      </div>

      <p className="mt-2 text-xs text-gray-500">Created: {dateStr}</p>

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
                />
              ) : (
                <LoserFinalCard
                  tournamentName={tournament.name}
                  winner={celebrationData.winner}
                  stats={celebrationData.stats}
                  ranking={celebrationData.ranking}
                />
              )}
            </div>
          )}
          {/* ===== END ===== */}

          {/* Difficulty Filters as grouped chips (now collapsible, default collapsed) */}
          <div className="mt-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-gray-700">
                Difficulty Filters
              </div>
              <button
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
                {/* Competitions */}
                {compChips.length > 0 && (
                  <>
                    <div className="text-[11px] font-medium text-gray-600 mb-1">
                      Competitions
                    </div>
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {compChips.map((c) => (
                        <span
                          key={c.key}
                          className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text:[11px] font-medium text-green-800 ring-1 ring-inset ring-green-600/20"
                        >
                          {c.label}
                        </span>
                      ))}
                    </div>
                  </>
                )}

                {/* Seasons */}
                {seasonChips.length > 0 && (
                  <>
                    <div className="text:[11px] font-medium text-gray-600 mb-1">
                      Seasons
                    </div>
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {seasonChips.map((c) => (
                        <span
                          key={c.key}
                          className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text:[11px] font-medium text-green-800 ring-1 ring-inset ring-green-600/20"
                        >
                          {c.label}
                        </span>
                      ))}
                    </div>
                  </>
                )}

                {/* Minimum MV */}
                {mvChip && (
                  <>
                    <div className="text-[11px] font-medium text-gray-600 mb-1">
                      Minimum MV
                    </div>
                    <div className="flex flex.wrap gap-1.5">
                      <span
                        key={mvChip.key}
                        className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text:[11px] font-medium text-green-800 ring-1 ring-inset ring-green-600/20"
                      >
                        {mvChip.label}
                      </span>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

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
                  const isEliminated =
                    (p.state || "").toLowerCase() === "eliminated";
                  return (
                    <span
                      key={p.id}
                      className={classNames(
                        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
                        isActive &&
                          "bg-emerald-50 text-emerald-800 ring-emerald-600/20",
                        isEliminated &&
                          "bg-red-50 text-red-700 ring-red-600/20 opacity-70",
                        !isActive &&
                          !isEliminated &&
                          "bg-gray-100 text-gray-800 ring-gray-300"
                      )}
                    >
                      {p.full_name || p.email}
                    </span>
                  );
                })
              )}
            </div>
          </div>

          {/* Rounds list */}
          <div className="mt-4 space-y-3">
            {rounds.length === 0 ? (
              <div className="text-sm text-gray-500">No rounds yet.</div>
            ) : (
              rounds.map((r) => {
                const entries = entriesFor(r.id);
                const entryByUser = new Map(entries.map((e) => [e.user_id, e]));

                const activeIdsForRound =
                  activeUsersByRound.get(r.id) ||
                  new Set(participants.map((p) => p.id));

                const activeCount = activeIdsForRound.size;

                const entriesFromActive = entries.filter((e) =>
                  activeIdsForRound.has(e.user_id)
                );

                const now = Date.now();
                const endsAt = r.ends_at ? new Date(r.ends_at).getTime() : null;
                const derivedActive =
                  !r.closed_at &&
                  (!!endsAt ? endsAt > now : true) &&
                  entriesFromActive.length < activeCount;

                const mePlayed =
                  userId && activeIdsForRound.has(userId)
                    ? entryByUser.has(userId)
                    : false;

                const playedPoints = entriesFromActive.map((e) =>
                  Number(e.points_earned ?? 0)
                );
                const hasAnyPlayed = playedPoints.length > 0;
                const maxPts = hasAnyPlayed ? Math.max(...playedPoints) : null;
                const minPts = hasAnyPlayed ? Math.min(...playedPoints) : null;
                const singleValueOnly = hasAnyPlayed && maxPts === minPts;

                const unifiedRows = participants
                  .filter((p) => activeIdsForRound.has(p.id))
                  .map((p) => {
                    const e = entryByUser.get(p.id) || null;
                    const points =
                      e && typeof e.points_earned === "number" ? e.points_earned : null;
                    return { user: p, points };
                  });

                unifiedRows.sort((a, b) => {
                  if (a.points === null && b.points === null) return 0;
                  if (a.points === null) return 1;
                  if (b.points === null) return -1;
                  return b.points - a.points;
                });

                return (
                  <div key={r.id} className="rounded-xl border bg-gray-50 p-3">
                    <div className="flex items-center justify-between">
                      <div className="font-semibold text-gray-800">
                        Round {r.round_number}
                      </div>
                      <div
                        className={classNames(
                          "text-xs px-2 py-0.5 rounded-full",
                          derivedActive
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-gray-200 text-gray-700"
                        )}
                      >
                        {derivedActive ? "Active" : "Finished"}
                      </div>
                    </div>

                    <div className="mt-1 text-xs text-gray-600">
                      {derivedActive ? (
                        <>
                          Ends in:{" "}
                          <span className="font-semibold">
                            <Countdown endsAt={r.ends_at || null} />
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
                      {unifiedRows.length === 0 ? (
                        <div className="text-xs text-gray-500">No participants.</div>
                      ) : (
                        <ul className="space-y-1">
                          {unifiedRows.map(({ user: u, points }, idx) => {
                            const isMax =
                              points !== null && maxPts !== null && points === maxPts;
                            const isMin =
                              points !== null && minPts !== null && points === minPts;

                            const scoreClass =
                              points === null
                                ? "text-gray-500"
                                : isMax
                                ? "text-emerald-700 font-semibold"
                                : isMin && !singleValueOnly
                                ? "text-red-600 font-semibold"
                                : "text-gray-800 font-medium";

                            return (
                              <li
                                key={`${u.id}-${idx}`}
                                className="text-sm flex items-center justify-between bg-white rounded-md border px-2 py-1"
                              >
                                <span className="truncate mr-2">
                                  {u.full_name || u.email}
                                </span>
                                <span className={scoreClass}>
                                  {points === null ? "—" : `${points} pts`}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>

                    {/* Actions (centered, bigger, and hidden if already played or eliminated) */}
                    {isLive && derivedActive && !iAmEliminated && !mePlayed && (
                      <div className="mt-4 flex items-center justify.center">
                        <button
                          type="button"
                          className="rounded-xl bg-green-700 px-6 py-2.5 text-sm md:text-base font-semibold text.white shadow hover:bg-green-800 transition transform hover:-translate-y-0.5"
                          onClick={() => handlePlayRound(r)}
                          disabled={!r.player_id}
                          title="Play Round to Survive!"
                        >
                          Play Round to Survive!
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
   (CHANGED: adds keyboard navigation for invite results)
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

  const [expandedCountries, setExpandedCountries] = useState({});
  // Default collapsed as requested:
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

  // Invites (MyLeaguesPage mechanism)
  const [searchEmail, setSearchEmail] = useState("");
  const [emailResults, setEmailResults] = useState([]);
  const [invites, setInvites] = useState([]); // rows from users table

  // NEW: keep the search box focused after adding an invite
  const searchEmailRef = useRef(null);

  // NEW: keyboard nav for invite results
  const [inviteIndex, setInviteIndex] = useState(-1);
  const inviteListRef = useRef(null);
  const inviteItemRefs = useRef([]);

  // Round time limit (minutes)
  const [roundTimeMinutes, setRoundTimeMinutes] = useState(5);

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
  useEffect(() => {
    const q = (compSearch || "").trim().toLowerCase();
    if (!q) {
      setCompSug([]);
      setCompSugOpen(false);
      setCompSugIndex(-1);
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
    setCompSugIndex(suggestions.length ? 0 : -1);
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
      setCompSugIndex((i) => (i + 1) % compSug.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCompSugIndex((i) => (i - 1 + compSug.length) % compSug.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const sel = compSug[compSugIndex] || compSug[0];
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

  /* ---------- filters UI helpers (GamePage parity) ---------- */
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

  // clear results and re-focus for rapid entry
  setSearchEmail("");
  setEmailResults([]);
  setInviteIndex(-1);
  // focus next tick so DOM has updated
  setTimeout(() => searchEmailRef.current?.focus(), 0);
};

  const removeInvite = (id) => {
  setInvites((prev) => prev.filter((x) => x.id !== id));
  setTimeout(() => searchEmailRef.current?.focus(), 0);
};

  /* ---------- validation ---------- */
  const validate = () => {
    const next = {};
    if (!name.trim()) next.name = "Please enter a tournament name.";
    const mins = Math.floor(Number(roundTimeMinutes));
    if (!Number.isFinite(mins) || mins < 5 || mins > 1440) {
      next.roundTimeMinutes = "Round time must be between 5 and 1440 minutes.";
    }
    if (!currentUser?.id) {
      next.user = "You must be logged in to create a tournament.";
    }
    if ((invites || []).length < 1) {
      next.invites = "Invite at least one other user (minimum 2 participants).";
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
    };

    // Call the server-side RPC that does everything atomically:
    //  - creates the tournament (owner = currentUser.id)
    //  - inserts participants (owner + invited users)
    //  - creates round 1 with an eligible random player based on filters
    //  - (optionally: your SQL may also enqueue notifications)
    const { data, error } = await supabase.rpc("create_elimination_tournament_full", {
      p_name: name.trim(),
      p_filters: filtersPayload,
      p_round_time_limit_seconds: Math.floor(Number(roundTimeMinutes) * 60),
      p_invited_user_ids: invites.map((u) => u.id),
    });

    if (error) {
      throw new Error(error.message || "Failed to create tournament.");
    }

    // If you still want to emit client-side notifications here,
    // keep your previous notifications insert, otherwise omit.

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
                  className="mt-1 w-full rounded-md border border-gray-300 bg.white px-3 py-2 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-green-700"
                />
                {errors.name && (
                  <p className="mt-1 text-xs text-red-600">{errors.name}</p>
                )}
              </div>

              {/* Difficulty Filters (summary chips ABOVE, sections can be collapsed) */}
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
                compSugIndex={compSugIndex}
                setCompSugIndex={setCompSugIndex}
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
                loadingCounts={loadingCounts}
                poolCount={poolCount}
                totalCount={totalCount}
              />

              {/* Invites */}
              <div className="rounded-xl shadow-sm border bg.white p-4">
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Invite users (by email)
                </label>

                <div className="flex gap-2">
                  <input
                    ref={searchEmailRef}              // <-- add this
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

                {/* validation message */}
                {errors.invites && (
                  <p className="mt-2 text-xs text-red-600">{errors.invites}</p>
                )}
              </div>

              {/* Round time */}
              <div className="rounded-xl shadow-sm border bg.white p-4">
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
    <div className="rounded-lg border bg.white/60">
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
  onRemoveCompetition,
  onRemoveSeason,
  onClearAll,
}) {
  const hasAny =
    (selectedCompetitionIds?.length || 0) +
      (selectedSeasons?.length || 0) +
      (minMarketValue ? 1 : 0) >
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
    loadingCounts,
    poolCount,
    totalCount,
  } = props;

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
          onRemoveCompetition={(id) => toggleCompetition(id)}
          onRemoveSeason={(s) =>
            setSelectedSeasons((prev) => prev.filter((x) => x !== s))
          }
          onClearAll={() => {
            clearCompetitions();
            clearSeasons();
            setMinMarketValue(0);
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
                  className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border bg.white hover:bg-gray-50"
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
                  placeholder="Search country or competition…"
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
            title="Minimum Market Value (€)"
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
        </div>
      )}
    </div>
  );
}
