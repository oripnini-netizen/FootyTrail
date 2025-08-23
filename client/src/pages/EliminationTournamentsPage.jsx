// src/pages/EliminationTournamentsPage.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
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

/* ------------------------------------------------------------
   Page: EliminationTournamentsPage
------------------------------------------------------------ */
export default function EliminationTournamentsPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("live");
  const [showCreateModal, setShowCreateModal] = useState(false);

  const [live, setLive] = useState([]);
  const [finished, setFinished] = useState([]);
  const [loading, setLoading] = useState({ live: true, finished: true });
  const [error, setError] = useState({ live: "", finished: "" });

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

  const tabs = [
    { key: "live", label: "Live" },
    { key: "finished", label: "Finished" },
  ];

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
    }
  };

  // Initial / on user change
  useEffect(() => {
    reloadLists();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-green-50 to-transparent">
      <div className="fixed inset-0 -z-10 bg-gradient-to-b from-green-50 to-transparent" />
      <div className="container mx-auto py-8 px-4 max-w-6xl">
        {/* Page header */}
        <header className="mb-4 sm:mb-6">
          <h1 className="text-4xl font-extrabold text-green-800">
            Elimination Tournaments
          </h1>
          <p className="mt-2 text-sm text-gray-700">
            Create and follow elimination tournaments with friends. Each round
            uses the same mystery player for everyone. Lowest score(s) are
            eliminated until a single winner remains.
          </p>
          {activeTab === "live" && (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={handleOpenCreate}
                className="rounded-lg bg-green-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-green-800"
              >
                Create Tournament
              </button>
            </div>
          )}
        </header>

        {/* Tabs */}
        <div className="flex items-center justify-center gap-2 bg-white/70 rounded-full px-2 py-1 w-fit mx-auto my-5 shadow-sm">
          {tabs.map((t) => {
            const isActive = activeTab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key)}
                className={classNames(
                  "px-4 py-1.5 rounded-full text-sm font-medium",
                  isActive
                    ? "bg-green-700 text-white"
                    : "bg-white text-gray-700 border"
                )}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Content area */}
        <section
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
          aria-live="polite"
          aria-busy={activeTab === "live" ? loading.live : loading.finished}
        >
          {activeTab === "live" ? (
            <>
              {loading.live && (
                <>
                  <SkeletonCard />
                  <SkeletonCard />
                  <SkeletonCard />
                </>
              )}
              {!loading.live && error.live && (
                <ErrorCard
                  title="Couldn't load live tournaments"
                  message={error.live}
                />
              )}
              {!loading.live && !error.live && live.length > 0 && (
                <>
                  {live.map((t) => (
                    <TournamentCard
                      key={t.id}
                      tournament={t}
                      compIdToLabel={compIdToLabel}
                      onAdvanced={reloadLists}
                    />
                  ))}
                </>
              )}
              {!loading.live && !error.live && live.length === 0 && (
                <PlaceholderCard
                  title="No live tournaments"
                  subtitle="Start an elimination tournament to see it here in real time."
                  ctaLabel="Create Tournament"
                  onCtaClick={handleOpenCreate}
                />
              )}
            </>
          ) : (
            <>
              {loading.finished && (
                <>
                  <SkeletonCard />
                  <SkeletonCard />
                  <SkeletonCard />
                </>
              )}
              {!loading.finished && error.finished && (
                <ErrorCard
                  title="Couldn't load finished tournaments"
                  message={error.finished}
                />
              )}
              {!loading.finished && !error.finished && finished.length > 0 && (
                <>
                  {finished.map((t) => (
                    <TournamentCard
                      key={t.id}
                      tournament={t}
                      compIdToLabel={compIdToLabel}
                      onAdvanced={reloadLists}
                    />
                  ))}
                </>
              )}
              {!loading.finished && !error.finished && finished.length === 0 && (
                <PlaceholderCard
                  title="No finished tournaments"
                  subtitle="Completed tournaments and winners will appear here."
                  ctaLabel="View Rules"
                  onCtaClick={() => {}}
                />
              )}
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
function PlaceholderCard({ title, subtitle, ctaLabel, onCtaClick }) {
  return (
    <div className="flex flex-col justify-between rounded-2xl border bg-white p-5 shadow-sm transition hover:shadow-md">
      <div>
        <h3 className="text-base font-semibold text-gray-900">{title}</h3>
        <p className="mt-1 text-sm text-gray-600">{subtitle}</p>
      </div>
      <div className="mt-4">
        <button
          type="button"
          onClick={onCtaClick}
          className="w-full rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-green-800"
        >
          {ctaLabel}
        </button>
      </div>
    </div>
  );
}

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

  return <span>{left}</span>;
}

function TournamentCard({ tournament, compIdToLabel, onAdvanced }) {
  const navigate = useNavigate();
  const createdAt = new Date(tournament.created_at);
  const dateStr = createdAt.toLocaleString();
  const isLive = tournament.status === "live";
  const timeLimitMin = Math.round(
    (tournament.round_time_limit_seconds || 0) / 60
  );

  const [participants, setParticipants] = useState([]);
  const [activeRound, setActiveRound] = useState(null); // {id, ends_at, round_number, player_id}
  const [playerMeta, setPlayerMeta] = useState(null); // row from players_in_seasons for active player

  // Fetch participants + active round for countdown AND player_id
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // participants
        const { data: partRows } = await supabase
          .from("elimination_participants")
          .select("user_id")
          .eq("tournament_id", tournament.id);

        const ids = (partRows || []).map((r) => r.user_id);
        if (ids.length) {
          const { data: usersRows } = await supabase
            .from("users")
            .select("id, full_name, email")
            .in("id", ids);
          if (!cancelled) setParticipants(usersRows || []);
        } else if (!cancelled) {
          setParticipants([]);
        }
      } catch {
        if (!cancelled) setParticipants([]);
      }

      try {
        // current active round (needs player_id now)
        const { data: round } = await supabase
          .from("elimination_rounds")
          .select("id, ends_at, round_number, player_id")
          .eq("tournament_id", tournament.id)
          .is("closed_at", null)
          .order("round_number", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!cancelled) setActiveRound(round || null);
      } catch {
        if (!cancelled) setActiveRound(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tournament.id]);

  // When activeRound.player_id changes, fetch player meta from players_in_seasons
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!activeRound?.player_id) {
        if (alive) setPlayerMeta(null);
        return;
      }
      // We just need one row for the player; any season suffices for bio/photo
      const { data, error } = await supabase
        .from("players_in_seasons")
        .select(
          "player_id, player_name, player_position, player_dob_age, player_nationality, player_photo"
        )
        .eq("player_id", activeRound.player_id)
        .limit(1)
        .maybeSingle();

      if (!alive) return;
      if (error) {
        setPlayerMeta(null);
      } else {
        setPlayerMeta(data || null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [activeRound?.player_id]);

  // Auto-advance: when time passes and every 30s as safety
  useEffect(() => {
    if (!isLive) return;

    let timeoutId = null;
    let intervalId = null;

    const scheduleTimeout = () => {
      if (!activeRound?.ends_at) return;
      const ends = new Date(activeRound.ends_at).getTime();
      const now = Date.now();
      const ms = ends - now;
      if (ms <= 0) {
        // already past, advance now
        advanceNow();
      } else {
        timeoutId = setTimeout(advanceNow, ms + 250); // small buffer
      }
    };

    // Safety polling every 30s (in case someone finished early)
    intervalId = setInterval(() => {
      advanceNow(true); // silent on noop
    }, 30000);

    scheduleTimeout();

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive, activeRound?.id, activeRound?.ends_at]);

  const advanceNow = async (silent = false) => {
    try {
      const { data, error } = await supabase.rpc(
        "advance_elimination_tournament",
        { p_tournament_id: tournament.id }
      );
      if (error) {
        if (!silent) {
          // eslint-disable-next-line no-console
          console.error("advance RPC error", error);
        }
        return;
      }
      const action = data?.action;
      if (action && action !== "noop") {
        // tournament advanced (either finished or new round) → tell parent to refresh
        onAdvanced?.();
      } else {
        // even if noop, refetch active round to keep countdown honest
        await refreshActiveRound();
      }
    } catch (e) {
      if (!silent) {
        // eslint-disable-next-line no-console
        console.error("advance exception", e);
      }
    }
  };

  const refreshActiveRound = async () => {
    try {
      const { data: round } = await supabase
        .from("elimination_rounds")
        .select("id, ends_at, round_number, player_id")
        .eq("tournament_id", tournament.id)
        .is("closed_at", null)
        .order("round_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      setActiveRound(round || null);
    } catch {
      // ignore
    }
  };

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
    const mvChip =
      mv > 0 ? { key: "MV", label: `Min MV: €${fmtCurrency(mv)}` } : null;

    return { compChips, seasonChips, mvChip };
  }, [tournament.filters, compIdToLabel]);

  const handlePlayRound = async () => {
    // Ensure we have active round and player meta
    if (!activeRound?.id || !activeRound?.round_number || !playerMeta) return;

    const playerPayload = {
      id: Number(playerMeta.player_id),
      name: playerMeta.player_name || "",
      age: playerMeta.player_dob_age || "", // raw age/dob text
      nationality: playerMeta.player_nationality || "",
      position: playerMeta.player_position || "",
      photo: playerMeta.player_photo || "",
    };

    const elimination = {
      tournamentId: tournament.id,
      tournamentName: tournament.name,
      roundId: activeRound.id,
      roundNumber: activeRound.round_number,
    };

    navigate("/live", {
      state: {
        player: playerPayload,
        elimination,
      },
    });
  };

  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm transition hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-semibold text-gray-900">
          {tournament.name}
        </h3>
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

      {/* Difficulty Filters as grouped chips */}
      <div className="mt-3">
        <div className="text-xs font-semibold mb-1 text-gray-700">
          Difficulty Filters
        </div>

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
                  className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-800 ring-1 ring-inset ring-green-600/20"
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
            <div className="text-[11px] font-medium text-gray-600 mb-1">
              Seasons
            </div>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {seasonChips.map((c) => (
                <span
                  key={c.key}
                  className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-800 ring-1 ring-inset ring-green-600/20"
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
            <div className="flex flex-wrap gap-1.5">
              <span
                key={mvChip.key}
                className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-800 ring-1 ring-inset ring-green-600/20"
              >
                {mvChip.label}
              </span>
            </div>
          </>
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
            participants.map((p) => (
              <span
                key={p.id}
                className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-800 ring-1 ring-inset ring-gray-300"
              >
                {p.full_name || p.email}
              </span>
            ))
          )}
        </div>
      </div>

      {/* Current round & countdown */}
      {isLive && (
        <div className="mt-3 space-y-1.5">
          <div className="text-xs text-gray-600">
            Round {activeRound?.round_number ?? "—"} ends in:{" "}
            <span className="font-semibold">
              <Countdown endsAt={activeRound?.ends_at || null} />
            </span>
          </div>
          {timeLimitMin ? (
            <div className="text-[11px] text-gray-500">
              Round limit: {timeLimitMin} min
            </div>
          ) : null}

          {/* Small player preview (optional) */}
          {playerMeta && (
            <div className="mt-2 flex items-center gap-2">
              {playerMeta.player_photo ? (
                <img
                  src={playerMeta.player_photo}
                  alt={playerMeta.player_name || "Player"}
                  className="h-8 w-8 rounded object-cover"
                />
              ) : (
                <div className="h-8 w-8 rounded bg-gray-200" />
              )}
              <div className="text-xs text-gray-700">
                <div className="font-medium">
                  Current Round Player (hidden in-game)
                </div>
                <div className="text-[11px] text-gray-500">
                  {playerMeta.player_name || "—"} •{" "}
                  {playerMeta.player_position || "?"} •{" "}
                  {playerMeta.player_nationality || "?"}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex items-center justify-end gap-2">
        {isLive && (
          <button
            type="button"
            className="rounded-lg border border-green-600 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-50 disabled:opacity-60"
            onClick={handlePlayRound}
            title={
              activeRound?.round_number === 1 ? "Play 1st Round" : "Play Round"
            }
            disabled={!activeRound?.id || !playerMeta}
          >
            {activeRound?.round_number === 1 ? "Play 1st Round" : "Play Round"}
          </button>
        )}
        <button
          type="button"
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          onClick={() => navigate(`/elimination-tournaments/${tournament.id}`)}
        >
          View
        </button>
      </div>
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
   - Difficulty Filters copied from GamePage (competitions, seasons, min MV)
   - Invite UI copied from MyLeaguesPage
   - Round time (5..1440)
   - On submit: create tournament, participants, notifications, first round
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
  const [compCollapsed, setCompCollapsed] = useState(false);
  const [seasonsCollapsed, setSeasonsCollapsed] = useState(false);
  const [mvCollapsed, setMvCollapsed] = useState(false);

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
        const { poolCount: filteredCount, totalCount: dbTotal } =
          countsResult || {};
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
      cancelled = true;
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
        if (active) setEmailResults([]);
        return;
      }
      const { data } = await supabase
        .from("users")
        .select("id, email, full_name")
        .ilike("email", `%${q}%`)
        .limit(10);
      const filtered = (data || []).filter((u) => u.id !== currentUser?.id);
      if (active) setEmailResults(filtered);
    }, 250);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [searchEmail, currentUser?.id]);

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
    setSelectedCompetitionIds(
      flatCompetitions.map((c) => String(c.competition_id))
    );

  const selectTop10Competitions = () => {
    const arr = [...flatCompetitions];
    arr.sort(
      (a, b) => Number(b.total_value_eur || 0) - Number(a.total_value_eur || 0)
    );
    setSelectedCompetitionIds(
      arr.slice(0, 10).map((c) => String(c.competition_id))
    );
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
    setSearchEmail("");
    setEmailResults([]);
  };
  const removeInvite = (id) =>
    setInvites((prev) => prev.filter((x) => x.id !== id));

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
      // Build filters exactly like GamePage payload
      const filtersPayload = {
        competitions: selectedCompetitionIds,
        seasons: selectedSeasons,
        minMarketValue: Number(minMarketValue) || 0,
      };

      // First: pick a player to guarantee a playable round
      const randomPlayer = await getRandomPlayer(
        { ...filtersPayload, userId: currentUser?.id },
        currentUser?.id
      );
      if (!randomPlayer || !randomPlayer.id) {
        throw new Error(
          "No players found for the selected filters. Try broadening your selection."
        );
      }

      // Create tournament
      const { data: tournament, error: tErr } = await supabase
        .from("elimination_tournaments")
        .insert([
          {
            owner_id: currentUser.id,
            name: name.trim(),
            filters: filtersPayload,
            round_time_limit_seconds: Math.floor(Number(roundTimeMinutes) * 60),
            status: "live",
          },
        ])
        .select()
        .single();

      if (tErr) throw new Error(tErr.message || "Failed to create tournament.");
      if (!tournament?.id) throw new Error("Tournament creation returned no id.");

      // Participants: owner + invites
      const people = [
        {
          id: currentUser.id,
          email: currentUser.email,
          full_name:
            currentUser.full_name ||
            currentUser.user_metadata?.full_name ||
            "You",
        },
        ...invites,
      ];
      const partsPayload = people.map((p) => ({
        tournament_id: tournament.id,
        user_id: p.id,
        state: "active",
      }));
      if (partsPayload.length) {
        await supabase.from("elimination_participants").insert(partsPayload);
      }

      // Notifications for invited users (not the owner)
      const invitedHumans = invites.filter(
        (i) => !!i.id && i.id !== currentUser.id
      );
      if (invitedHumans.length) {
        const payloads = invitedHumans.map((uRow) => ({
          user_id: uRow.id,
          type: "elimination_invite",
          payload: {
            tournament_id: tournament.id,
            tournament_name: tournament.name,
            round_time_limit_minutes: Math.floor(Number(roundTimeMinutes)),
            creator_name:
              currentUser.user_metadata?.full_name ||
              currentUser.full_name ||
              currentUser.email ||
              "A user",
            filters: filtersPayload,
          },
        }));
        await supabase.from("notifications").insert(payloads);

        // Let the navbar know to refresh axe dot immediately
        window.dispatchEvent(new Event("elimination-notifications-new"));
      }

      // Create Round 1 immediately with the random player (schema-correct)
      const now = new Date();
      const endsAt = new Date(
        now.getTime() + Math.floor(Number(roundTimeMinutes)) * 60 * 1000
      );
      await supabase.from("elimination_rounds").insert([
        {
          tournament_id: tournament.id,
          round_number: 1,
          player_id: randomPlayer.id,
          started_at: now.toISOString(),
          ends_at: endsAt.toISOString(),
          // closed_at null by default
        },
      ]);

      // done → refresh list and close
      await onCreated?.();
      onClose?.();
    } catch (ex) {
      setSubmitError(
        ex instanceof Error ? ex.message : "Failed to create tournament."
      );
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

              {/* Difficulty Filters (same controls as GamePage) */}
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
                compSugOpen={compSugOpen}
                setCompSugOpen={setCompSugOpen}
                compSug={compSug}
                compSugIndex={compSugIndex}
                setCompSugIndex={setCompSugIndex}
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
              <div className="rounded-xl shadow-sm border bg-white p-4">
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Invite users (by email)
                </label>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={searchEmail}
                    onChange={(e) => setSearchEmail(e.target.value)}
                    placeholder="Type an email to search…"
                    className="flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-700"
                  />
                </div>

                {/* search results */}
                {emailResults.length > 0 && (
                  <div className="mt-2 border rounded-md">
                    {emailResults.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => addInvite(u)}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                      >
                        {u.full_name ? `${u.full_name} — ${u.email}` : u.email}
                      </button>
                    ))}
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
              </div>

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
          <span className="font-medium text-green-900">{title}</span>
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

function SelectedChips({
  title,
  items,
  onClear,
  getLabel,
  onRemoveItem,
  hoverClose = false,
}) {
  if (!items?.length) return null;
  return (
    <div className="mb-2">
      {title && <div className="text-xs text-gray-600 mb-1">{title}</div>}
      <div className="flex flex-wrap gap-2">
        {items.map((t, index) => {
          const label = getLabel ? getLabel(t) : String(t);
          return (
            <span
              key={`${String(t)}-${index}`}
              className={classNames(
                "group relative inline-flex items-center gap-2 px-2 py-1 rounded-full text-xs bg-green-100 text-green-800",
                hoverClose && "pr-6"
              )}
            >
              {label}
              {hoverClose && onRemoveItem && (
                <button
                  type="button"
                  onClick={() => onRemoveItem(t)}
                  className="absolute right-0 top-0 bottom-0 hidden group-hover:flex items-center justify-center w-5 text-red-600 hover:text-red-700"
                  title="Remove"
                >
                  ×
                </button>
              )}
            </span>
          );
        })}
        <button
          type="button"
          onClick={onClear}
          className="text-xs text-gray-600 underline hover:text-gray-800"
        >
          Clear
        </button>
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
            <div
              className="mb-3 relative"
              onClick={(e) => e.stopPropagation()}
            >
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

            <SelectedChips
              title="Chosen competitions"
              items={selectedCompetitionIds}
              onClear={clearCompetitions}
              getLabel={(id) => compIdToLabel[id] || `Competition ${id}`}
              onRemoveItem={(id) => toggleCompetition(id)}
              hoverClose
            />
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
                          const checked =
                            selectedCompetitionIds.includes(cid);
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
                              <span className="text-sm">
                                {c.competition_name}
                              </span>
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
            <SelectedChips
              items={selectedSeasons}
              onClear={clearSeasons}
              onRemoveItem={(season) =>
                setSelectedSeasons((prev) => prev.filter((x) => x !== season))
              }
              hoverClose
            />
            <div className="max-h-60 overflow-y-auto pr-2">
              {allSeasons.map((s) => {
                const checked = selectedSeasons.includes(s);
                return (
                  <label
                    key={s}
                    className="flex items-center gap-2 cursor-pointer"
                  >
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
                onChange={(e) =>
                  setMinMarketValue(Math.max(0, Number(e.target.value)))
                }
                className="w-44 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-green-700"
              />
            </div>
            <div className="mt-3 text-xs text-gray-600">
              {loadingCounts
                ? "Calculating player pool…"
                : `Player pool: ${poolCount} of ${totalCount}`}
            </div>
          </Section>
        </div>
      )}
    </div>
  );
}
