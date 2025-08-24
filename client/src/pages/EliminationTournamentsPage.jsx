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

  // Notifications banner (NEW) — load unread on first visit, mark as read, show once
  const [notifBanner, setNotifBanner] = useState([]);

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
  const handleCloseCreate = () => setShowCreateModal(false);

  const [countsLoading, setCountsLoading] = useState(true);
  const [poolCount, setPoolCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  // Notifications for "added to elimination challenge"
  const [hasUnreadElimination, setHasUnreadElimination] = useState(false);

  // Load counts for filters, and any notifications once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setCountsLoading(true);
        const countsRes = await getCounts();
        if (!cancelled) {
          setPoolCount(countsRes.poolCount || 0);
          setTotalCount(countsRes.totalCount || 0);
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setCountsLoading(false);
      }
    })();

    // Notifications: if user was added to elimination challenge, show banner (first time only)
    (async () => {
      if (!user?.id) return;
      try {
        const { data } = await supabase
          .from("notifications")
          .select("*")
          .eq("user_id", user.id)
          .eq("type", "elimination_added")
          .is("seen_at", null)
          .limit(20);
        const unread = Array.isArray(data) ? data : [];
        setHasUnreadElimination(unread.length > 0);
        if (unread.length > 0) {
          setNotifBanner(unread);
          // Mark as seen
          const ids = unread.map((r) => r.id);
          await supabase.from("notifications").update({ seen_at: new Date().toISOString() }).in("id", ids);
        }
      } catch {
        /* ignore */
      }
    })();

    return () => { cancelled = true; };
  }, [user?.id]);

  // Load lists (live + finished)
  const reloadLists = async () => {
    try {
      setLoading((s) => ({ ...s, live: true }));
      setError((e) => ({ ...e, live: "" }));
      const { data, error: err } = await supabase
        .from("elimination_tournaments")
        .select("*")
        .eq("status", "live")
        .order("created_at", { ascending: false });
      if (err) throw err;
      setLive(Array.isArray(data) ? data : []);
    } catch {
      setError((e) => ({ ...e, live: "Failed to load." }));
      setLive([]);
    } finally {
      setLoading((s) => ({ ...s, live: false }));
    }

    try {
      setLoading((s) => ({ ...s, finished: true }));
      setError((e) => ({ ...e, finished: "" }));
      const { data, error: err } = await supabase
        .from("elimination_tournaments")
        .select("*")
        .eq("status", "finished")
        .order("created_at", { ascending: false });
      if (err) throw err;
      setFinished(Array.isArray(data) ? data : []);
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

  // Tab counters
  const liveCount = live.length;
  const finishedCount = finished.length;

  return (
    <div className="mx-auto max-w-5xl p-4">
      {/* Global title + tabs */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Elimination Challenges</h1>
          <p className="text-sm text-gray-600">Create and compete in knockout-style challenges.</p>
        </div>
        <button
          type="button"
          onClick={handleOpenCreate}
          className="inline-flex items-center gap-2 rounded-lg bg-green-700 px-3 py-2 text-sm font-semibold text-white hover:bg-green-800"
        >
          <span className="text-lg">+</span> Create New Elimination Challenge
        </button>
      </div>

      {/* Notification banner when user was added to an elimination challenge */}
      {hasUnreadElimination && notifBanner.length > 0 && (
        <div className="mb-4 rounded-xl border border-green-200 bg-green-50 p-3 text-green-900 shadow-sm">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4" />
            <div className="font-semibold">You were added to an Elimination challenge!</div>
          </div>
          <div className="mt-1 text-xs opacity-90">
            Head into the challenge card below — your axe icon now has a red dot to let you know there’s something new.
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="mb-4 flex items-center gap-2">
        {[
          { key: "live", label: `Live (${liveCount})` },
          { key: "finished", label: `Finished (${finishedCount})` },
        ].map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActiveTab(t.key)}
            className={classNames(
              "rounded-md border px-3 py-1.5 text-sm",
              activeTab === t.key ? "bg-green-700 text-white border-green-800" : "bg-white text-gray-800 border-gray-300"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Lists */}
      {activeTab === "live" ? (
        <TournamentList
          items={live}
          loading={loading.live}
          error={error.live}
          compIdToLabel={compIdToLabel}
          onReload={reloadLists}
          emptyText="No live challenges yet."
        />
      ) : (
        <TournamentList
          items={finished}
          loading={loading.finished}
          error={error.finished}
          compIdToLabel={compIdToLabel}
          onReload={reloadLists}
          emptyText="No finished challenges yet."
        />
      )}

      {showCreateModal && (
        <CreateTournamentModal currentUser={user} onClose={handleCloseCreate} onCreated={reloadLists} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------
   TournamentList
------------------------------------------------------------ */
function TournamentList({ items, loading, error, compIdToLabel, onReload, emptyText }) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }
  if (error) {
    return <ErrorCard title="Failed to load" message={error} />;
  }
  if (!items || items.length === 0) {
    return null; // Hidden when no live/finished tournaments, per your request
  }

  return (
    <div className="grid grid-cols-1 gap-3">
      {items.map((t) => (
        <TournamentCard key={t.id} tournament={t} compIdToLabel={compIdToLabel} onAdvanced={onReload} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------
   TournamentCard
------------------------------------------------------------ */
function TournamentCard({ tournament, compIdToLabel, onAdvanced }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const userId = user?.id || null;

  const createdAt = new Date(tournament.created_at);
  the_header_date: {
    // no-op block retained
  }
  const dateStr = createdAt.toLocaleString();
  const isLive = tournament.status === "live";
  const timeLimitMin = Math.round(
    (tournament.round_time_limit_seconds || 0) / 60
  );

  const [participants, setParticipants] = useState([]); // [{id, full_name, email, state}]
  const [rounds, setRounds] = useState([]); // [{id, round_number, created_at, started_at, closed_at, ends_at, player_id}]
  const [entriesByRound, setEntriesByRound] = useState({}); // round_id -> [{user_id, points_earned, finished_at}]
  const [cardCollapsed, setCardCollapsed] = useState(false);

  // Load tournament sub-data
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // participants
        const { data: participantsRows } = await supabase
          .from("elimination_participants")
          .select("user_id, state")
          .eq("tournament_id", tournament.id);

        const idsFromParticipants = (participantsRows || []).map((r) => r.user_id);
        const { data: usersRows } = await supabase
          .from("users")
          .select("id, full_name, email, profile_photo_url")
          .in("id", idsFromParticipants);

        const usersMap = new Map();
        (Array.isArray(usersRows) ? usersRows : []).forEach((u) => usersMap.set(u.id, u));

        const participants = (participantsRows || []).map((r) => {
          const u = usersMap.get(r.user_id);
          return {
            id: r.user_id,
            full_name: u?.full_name || "",
            email: u?.email || "",
            profile_photo_url: u?.profile_photo_url || "",
            state: r.state || "active",
          };
        });

        // rounds
        const { data: roundsRows } = await supabase
          .from("elimination_rounds")
          .select("*")
          .eq("tournament_id", tournament.id)
          .order("round_number", { ascending: true });

        // entries for each round, and ensure we can render names for any non-participant ids
        const entriesMap = {};
        const extraUserIds = new Set();
        for (const r of roundsRows || []) {
          const { data: ent } = await supabase
            .from("games_records")
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

        // fetch any missing users referenced by entries (avoids GUID fallback)
        if (extraUserIds.size) {
          const { data: extraUsers } = await supabase
            .from("users")
            .select("id, full_name, email, profile_photo_url")
            .in("id", Array.from(extraUserIds));
          (Array.isArray(extraUsers) ? extraUsers : []).forEach((u) => {
            if (!usersMap.has(u.id)) usersMap.set(u.id, u);
          });
        }

        if (!cancelled) {
          setParticipants(participants);
          setRounds(Array.isArray(roundsRows) ? roundsRows : []);
          setEntriesByRound(entriesMap);
        }
      } catch (e) {
        console.error("[tournament load]", e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tournament.id]);

  const participantsMap = useMemo(() => {
    const m = new Map();
    for (const p of participants) m.set(p.id, p);
    return m;
  }, [participants]);

  const entriesFor = (roundId) => entriesByRound[roundId] || [];

  // Build filter chips grouped under headings
  const { compChips, seasonChips, mvChip } = useMemo(() => {
    const f = tournament.filters || {};
    const leagues = Array.isArray(f.competition_ids) ? f.competition_ids : [];
    const seasons = Array.isArray(f.seasons) ? f.seasons : [];
    const mv = Number(f.min_market_value_eur || 0);

    const compChips = leagues.map((id) => ({
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

  // --- MY STATE: determine if I'm eliminated (used to block play) ---
  const myParticipant = userId ? participantsMap.get(userId) : null;
  const iAmEliminated = !!myParticipant && myParticipant.state !== "active";

  // Round helpers — compute active users per round and played status
  const activeUsersByRound = useMemo(() => {
    const result = {};
    const allIds = participants.map((p) => p.id);

    let activeSet = new Set(allIds);
    for (const r of rounds || []) {
      const entries = entriesFor(r.id);
      const playedSet = new Set(entries.map((e) => e.user_id));
      const dnfs = Array.from(activeSet).filter((uid) => !playedSet.has(uid));

      // compute min points among those who played
      let minPts = null;
      if (playedSet.size > 0) {
        for (const uid of playedSet) {
          const row = entries.find((e) => e.user_id === uid);
          const val = Number(row?.points_earned ?? 0);
          if (minPts === null || val < minPts) minPts = val;
        }
      }

      // derive eliminated set = DNFs + those with min points
      const eliminated = new Set(dnfs);
      if (minPts !== null) {
        for (const uid of playedSet) {
          const row = entries.find((e) => e.user_id === uid);
          const val = Number(row?.points_earned ?? 0);
          if (val === minPts) eliminated.add(uid);
        }
      }

      result[r.id] = {
        active: new Set(activeSet),
        played: playedSet,
        eliminatedThisRound: eliminated,
      };

      // update activeSet for next round: remove eliminated
      for (const uid of eliminated) activeSet.delete(uid);
    }

    return result;
  }, [participants, rounds, entriesByRound]);

  // For this user, identify the current open round (highest round without my entry)
  const myOpenRound = useMemo(() => {
    if (!isLive) return null;
    let target = null;
    for (const r of rounds || []) {
      const entries = entriesFor(r.id);
      const iPlayed = entries.some((e) => e.user_id === userId);
      if (!iPlayed && (!r.closed_at || new Date(r.closed_at) > new Date())) {
        target = r;
        break;
      }
    }
    return target;
  }, [isLive, rounds, entriesByRound, userId]);

  const handlePlayRound = (r) => {
    navigate(`/live?elimination=1&tournament_id=${tournament.id}&round_id=${r.id}&player_id=${r.player_id || ""}`);
  };

  // Card UI
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
            {/* Requested: just an arrow, no text */}
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

      {/* created date */}
      <p className="mt-1 text-xs text-gray-500">Created: {dateStr}</p>

      {/* Winner (finished) */}
      {!isLive && tournament.winner_user_id && (
        <div className="mt-2 text-xs font-medium text-green-800">
          Winner: <WinnerName userId={tournament.winner_user_id} />
        </div>
      )}

      {/* Collapsible body */}
      {!cardCollapsed && (
        <>
          {/* Winner Celebration (finished) */}
          {!isLive && (
            <WinnerCelebrationCard
              tournament={tournament}
              participants={participants}
              rounds={rounds}
              entriesByRound={entriesByRound}
            />
          )}

          {/* Difficulty Filters as grouped chips (now collapsible, default collapsed) */}
          <div className="mt-4">
            <div className="rounded-xl border bg-gray-50 p-3">
              <div className="text-xs font-semibold text-gray-700 mb-2">Filters</div>
              {/* Chips */}
              <div className="flex flex-wrap items-center gap-2">
                {compChips.map((c) => (
                  <span key={c.key} className="inline-flex items-center gap-2 rounded-full bg-green-100 text-green-800 px-2 py-1 text-xs">
                    {c.label}
                  </span>
                ))}
                {seasonChips.map((c) => (
                  <span key={c.key} className="inline-flex items-center gap-2 rounded-full bg-green-100 text-green-800 px-2 py-1 text-xs">
                    {c.label}
                  </span>
                ))}
                {mvChip ? (
                  <span key={mvChip.key} className="inline-flex items-center gap-2 rounded-full bg-green-100 text-green-800 px-2 py-1 text-xs">
                    {mvChip.label}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          {/* Participants row with states (active=green, eliminated=faded red) */}
          <div className="mt-4">
            <div className="text-xs font-semibold text-gray-700 mb-2">Participants</div>
            <div className="flex flex-wrap gap-2">
              {participants.length === 0 ? (
                <div className="text-xs text-gray-500">No participants yet.</div>
              ) : (
                participants.map((p) => (
                  <span
                    key={p.id}
                    className={classNames(
                      "inline-flex items-center gap-2 rounded-full px-2 py-1 text-xs border",
                      p.state === "active"
                        ? "bg-green-100 border-green-200 text-green-800"
                        : "bg-red-50 border-red-200 text-red-600 opacity-70"
                    )}
                  >
                    {p.full_name || p.email}
                  </span>
                ))
              )}
            </div>
          </div>

          {/* Rounds */}
          <div className="mt-4">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-gray-700">Rounds</div>
              <div className="text-xs text-gray-500">Time limit per round: {timeLimitMin} min</div>
            </div>

            {(!rounds || rounds.length === 0) ? (
              <div className="mt-2 text-xs text-gray-500">No rounds yet.</div>
            ) : (
              <div className="mt-2 grid grid-cols-1 gap-3">
                {rounds.map((r) => {
                  const state = activeUsersByRound[r.id] || { active: new Set(), played: new Set(), eliminatedThisRound: new Set() };
                  const derivedActive = Array.from(state.active || []);
                  const playedSet = state.played || new Set();
                  const eliminatedThisRound = state.eliminatedThisRound || new Set();
                  const myPlayed = playedSet.has(userId);
                  const iAmEliminatedThisRound = eliminatedThisRound.has(userId);
                  const iAmEliminatedOverall = iAmEliminated;

                  // show only ACTIVE users for this round
                  const unifiedRows = derivedActive.map((uid) => {
                    const u = participantsMap.get(uid) || { id: uid, full_name: "", email: uid };
                    const entry = entriesFor(r.id).find((e) => e.user_id === uid);
                    return {
                      user: u,
                      points: entry ? Number(entry.points_earned || 0) : null,
                    };
                  });

                  // compute score coloring
                  const numericVals = unifiedRows.map((x) => x.points).filter((v) => v !== null);
                  const uniqueVals = Array.from(new Set(numericVals));
                  const singleValueOnly = uniqueVals.length <= 1;
                  const maxPts = numericVals.length ? Math.max(...numericVals) : null;
                  const minPts = numericVals.length ? Math.min(...numericVals) : null;

                  // Player for the round
                  const showRoundPlayer = !!r.player_id;

                  return (
                    <div key={r.id} className="rounded-lg border bg-white p-3">
                      <div className="flex items-center justify-between">
                        <div className="font-semibold text-sm">Round {r.round_number}</div>
                        <div className="text-xs text-gray-500">
                          {r.started_at ? `Started: ${new Date(r.started_at).toLocaleString()}` : "Not started"}
                          {r.closed_at ? ` • Closed: ${new Date(r.closed_at).toLocaleString()}` : ""}
                        </div>
                      </div>

                      {/* Round player (if present) */}
                      {showRoundPlayer ? (
                        <div className="mt-3">
                          <div className="text-xs font-semibold text-gray-700 mb-1">Round Player</div>
                          <RoundPlayer playerId={r.player_id} />
                        </div>
                      ) : null}

                      {/* Scores — only ACTIVE users for this round */}
                      <div className="mt-3">
                        <div className="text-xs font-semibold text-gray-700 mb-1">Scores</div>
                        {unifiedRows.length === 0 ? (
                          <div className="text-xs text-gray-500">No participants.</div>
                        ) : (
                          <ul className="space-y-1">
                            {unifiedRows.map(({ user: u, points }, idx) => {
                              const isMax = points !== null && maxPts !== null && points === maxPts;
                              const isMin = points !== null && minPts !== null && points === minPts;

                              // If only one unique value, treat it as "max" (green) and not as "min"
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
                                  <span className="truncate mr-2">{u.full_name || u.email}</span>
                                  <span className={scoreClass}>{points === null ? "—" : `${points} pts`}</span>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>

                      {/* Actions (centered, bigger, and hidden if already played or eliminated) */}
                      {isLive && !iAmEliminatedOverall && !myPlayed && (
                        <div className="mt-4 flex items-center justify-center">
                          <button
                            type="button"
                            className="rounded-xl bg-green-700 px-6 py-2.5 text-sm md:text-base font-semibold text-white shadow hover:bg-green-800 transition transform hover:-translate-y-0.5"
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
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function RoundPlayer({ playerId }) {
  const [player, setPlayer] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!playerId) return;
        const { data } = await getRandomPlayer({ fixed_player_id: playerId });
        if (!cancelled) {
          setPlayer(Array.isArray(data) ? data[0] : data);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [playerId]);

  if (!playerId) return <div className="text-xs text-gray-500">TBD</div>;
  if (!player) return <div className="text-xs text-gray-500">Loading…</div>;

  return (
    <div className="flex items-center gap-3 text-sm">
      <div className="h-8 w-8 overflow-hidden rounded-full border bg-gray-100">
        {player.photo_url ? (
          <img src={player.photo_url} alt={player.full_name || player.name || "Player"} className="h-8 w-8 object-cover" />
        ) : null}
      </div>
      <div className="font-medium">{player.full_name || player.name || "Player"}</div>
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
        .select("id, full_name, email, profile_photo_url")
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

/* ------------------------------------------------------------
   Winner Celebration Card (ADDED)
------------------------------------------------------------ */
function WinnerCelebrationCard({ tournament, participants, rounds, entriesByRound }) {
  const winnerId = tournament?.winner_user_id || null;

  const participantsMap = useMemo(() => {
    const m = new Map();
    (participants || []).forEach((p) => m.set(p.id, p));
    return m;
  }, [participants]);

  const orderedRounds = useMemo(
    () =>
      Array.isArray(rounds)
        ? [...rounds].sort((a, b) => (a.round_number || 0) - (b.round_number || 0))
        : [],
    [rounds]
  );

  // Derive stats
  const { totalRounds, startedAt, finishedAt, durationLabel } = useMemo(() => {
    const totalRounds = orderedRounds.length || 0;
    let startedAt = null;
    let finishedAt = null;
    if (totalRounds > 0) {
      for (const r of orderedRounds) {
        if (r?.started_at && !startedAt) startedAt = new Date(r.started_at);
      }
      for (let i = orderedRounds.length - 1; i >= 0; i--) {
        const r = orderedRounds[i];
        if (r?.closed_at) { finishedAt = new Date(r.closed_at); break; }
        if (r?.ends_at)   { finishedAt = new Date(r.ends_at);   break; }
      }
    }
    let durationLabel = "—";
    if (startedAt && finishedAt) {
      const ms = Math.max(0, finishedAt.getTime() - startedAt.getTime());
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      durationLabel =
        (h ? h + "h " : "") + (m ? String(m).padStart(2, "0") + "m " : "") + String(s).padStart(2, "0") + "s";
    }
    return { totalRounds, startedAt, finishedAt, durationLabel };
  }, [orderedRounds]);

  // Compute final standings (winner first, then elimination order)
  const standings = useMemo(() => {
    const ids = (participants || []).map((p) => p.id);
    const active = new Set(ids);
    const elimInfo = new Map(); // id -> {round, points, dnf:boolean}
    for (const r of orderedRounds) {
      // active at this round
      const entries = (entriesByRound?.[r.id] || []).filter((e) => active.has(e.user_id));
      const pts = new Map(entries.map((e) => [e.user_id, Number(e.points_earned ?? 0)]));
      const played = new Set(entries.map((e) => e.user_id));
      const dnfs = Array.from(active).filter((uid) => !played.has(uid));
      // DNFs eliminated
      dnfs.forEach((uid) => {
        elimInfo.set(uid, { round: r.round_number, points: -Infinity, dnf: true });
      });
      // Among those who played, eliminate all with minimum points
      if (played.size > 0) {
        let minPts = Infinity;
        played.forEach((uid) => { const v = pts.get(uid); if (v < minPts) minPts = v; });
        played.forEach((uid) => {
          if (pts.get(uid) === minPts) {
            if (!elimInfo.has(uid)) elimInfo.set(uid, { round: r.round_number, points: minPts, dnf: false });
          }
        });
      }
      // Remove eliminated from active set
      elimInfo.forEach((_, uid) => { if (active.has(uid)) active.delete(uid); });
    }
    // Winner: either explicit or last remaining
    const theWinnerId = winnerId && ids.includes(winnerId) ? winnerId : (active.size === 1 ? Array.from(active)[0] : null);

    const rest = ids.filter((id) => id !== theWinnerId).map((id) => {
      const info = elimInfo.get(id) || { round: 0, points: -Infinity, dnf: true };
      return { id, ...info };
    });

    // Sort: later round eliminated first; tie-breaker by points desc; then name asc
    rest.sort((a, b) => {
      if (a.round !== b.round) return b.round - a.round;
      if (a.points !== b.points) return b.points - a.points;
      const an = (participantsMap.get(a.id)?.full_name || participantsMap.get(a.id)?.email || "").toLowerCase();
      const bn = (participantsMap.get(b.id)?.full_name || participantsMap.get(b.id)?.email || "").toLowerCase();
      return an.localeCompare(bn);
    });

    const out = [];
    if (theWinnerId) out.push({ id: theWinnerId, winner: true });
    rest.forEach((x) => out.push({ id: x.id, eliminatedAtRound: x.round, points: x.points, dnf: x.dnf }));
    return out;
  }, [participants, participantsMap, orderedRounds, entriesByRound, winnerId]);

  // Winner info
  const winner = standings.find((s) => s.winner);
  const winnerUser = winner ? participantsMap.get(winner.id) : null;
  const winnerName = winnerUser?.full_name || winnerUser?.email || "—";
  const winnerInitials = (winnerName || " ").split(" ").map((w) => w[0]).filter(Boolean).slice(0,2).join("").toUpperCase();

  // Confetti pieces setup (stable per mount)
  const confetti = useMemo(() => {
    const colors = ["#16a34a","#22c55e","#84cc16","#a3e635","#fde047","#f59e0b","#ef4444","#06b6d4","#3b82f6","#8b5cf6"];
    const pieces = 26;
    return Array.from({ length: pieces }, (_, i) => ({
      left: Math.round((i / pieces) * 100),
      delay: (Math.random() * 1.2).toFixed(2),
      duration: (2.6 + Math.random() * 1.7).toFixed(2),
      size: 6 + Math.round(Math.random() * 6),
      color: colors[i % colors.length],
      rotate: Math.round(Math.random() * 360),
    }));
  }, []);

  return (
    <div className="relative mt-4 rounded-xl border border-yellow-200 bg-gradient-to-b from-yellow-50 to-white p-4 overflow-hidden">
      {/* lightweight confetti */}
      <style>{`
        @keyframes confetti-fall {
          0%   { transform: translateY(-120%) rotate(0deg);    opacity: 0.9; }
          100% { transform: translateY(120vh) rotate(360deg);  opacity: 0.9; }
        }
      `}</style>
      <div className="pointer-events-none absolute inset-x-0 -top-2 h-0">
        {confetti.map((c, idx) => (
          <span
            key={idx}
            aria-hidden="true"
            style={{
              position: "absolute",
              top: "-12px",
              left: `${c.left}%`,
              width: `${c.size}px`,
              height: `${Math.round(c.size * 1.6)}px`,
              background: c.color,
              borderRadius: "2px",
              transform: `rotate(${c.rotate}deg)`,
              animation: `confetti-fall ${c.duration}s linear infinite`,
              animationDelay: `${c.delay}s`,
            }}
          />
        ))}
      </div>

      <div className="flex items-center gap-4">
        {/* Star-framed avatar */}
        <div className="relative h-20 w-20">
          <div className="absolute inset-0 rounded-full blur-md bg-yellow-300 opacity-60" />
          <div className="relative h-20 w-20">
            {winnerUser?.profile_photo_url ? (
              <img
                src={winnerUser.profile_photo_url}
                alt={winnerName}
                className="h-20 w-20 object-cover"
                style={{
                  clipPath:
                    "polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)",
                }}
              />
            ) : (
              <div
                className="flex items-center justify-center text-2xl font-bold text-yellow-900 bg-yellow-200 h-20 w-20"
                style={{
                  clipPath:
                    "polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)",
                }}
              >
                {winnerInitials || "🏆"}
              </div>
            )}
            <Star className="absolute -top-2 -right-2 h-6 w-6 text-yellow-500 drop-shadow" />
          </div>
        </div>

        <div className="flex-1">
          <div className="text-sm text-gray-800">🏆 Winner</div>
          <div className="text-xl font-extrabold text-green-800">{winnerName}</div>
          <div className="text-sm text-gray-600">
            All hail the champion of <span className="font-semibold">{tournament?.name}</span>!
          </div>
        </div>
      </div>

      {/* Stats & standings */}
      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-lg bg-white/70 border p-3">
          <div className="text-xs text-gray-500">Number of rounds</div>
          <div className="text-lg font-semibold text-gray-900">{totalRounds || "—"}</div>
        </div>
        <div className="rounded-lg bg-white/70 border p-3">
          <div className="text-xs text-gray-500">Time played</div>
          <div className="text-lg font-semibold text-gray-900">{durationLabel}</div>
        </div>
        <div className="rounded-lg bg-white/70 border p-3">
          <div className="text-xs text-gray-500">Participants</div>
          <div className="text-lg font-semibold text-gray-900">{(participants || []).length}</div>
        </div>
      </div>

      {/* Final ranking */}
      <div className="mt-4">
        <div className="text-sm font-semibold text-gray-800 mb-2">Final Standings</div>
        <ol className="space-y-1">
          {standings.map((row, idx) => {
            const u = participantsMap.get(row.id) || {};
            const name = u.full_name || u.email || row.id;
            const isChamp = !!row.winner;
            return (
              <li
                key={row.id}
                className={
                  "flex items-center justify-between rounded-md border bg-white px-2 py-1 text-sm " +
                  (isChamp ? "border-green-300 ring-1 ring-green-400/40" : "border-gray-200")
                }
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={
                      "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold " +
                      (isChamp ? "bg-green-600 text-white" : "bg-gray-200 text-gray-700")
                    }
                  >
                    {idx + 1}
                  </span>
                  <span className={"truncate " + (isChamp ? "font-semibold text-green-800" : "text-gray-800")}>
                    {name}
                  </span>
                </div>
                {!isChamp ? (
                  <span className="text-xs text-gray-600">
                    Eliminated R{row.eliminatedAtRound || "?"}
                    {Number.isFinite(row.points) && row.points > -Infinity ? ` • ${row.points} pts` : " • DNF"}
                  </span>
                ) : (
                  <span className="text-xs text-emerald-700 font-semibold">Champion</span>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
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
   (unchanged for this request)
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

  // Competition search
  const [compSearch, setCompSearch] = useState("");
  const [compSugOpen, setCompSugOpen] = useState(false);
  const [compSug, setCompSug] = useState([]);
  const [compSugIndex, setCompSugIndex] = useState(-1);
  const compSearchRef = useRef(null);
  const compSugBoxRef = useRef(null);

  useEffect(() => {
    const onDocClick = (e) => {
      if (!compSugBoxRef.current) return;
      if (!compSugBoxRef.current.contains(e.target) && !compSearchRef.current.contains(e.target)) {
        setCompSugOpen(false);
      }
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  const handleCompSearchKeyDown = (e) => {
    if (!compSugOpen) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCompSugIndex((i) => Math.min(i + 1, compSug.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCompSugIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = compSug[compSugIndex];
      if (item) toggleCompetition(item.competition_id);
    } else if (e.key === "Escape") {
      setCompSugOpen(false);
    }
  };

  // Load competitions / seasons
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoadingFilters(true);
        const compsRes = await getCompetitions();
        const seasonsRes = await getSeasons();
        if (!cancelled) {
          setGroupedCompetitions(compsRes.groupedByCountry || {});
          setAllSeasons(normalizeSeasons(seasonsRes));
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoadingFilters(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Counts
  const [loadingCounts, setLoadingCounts] = useState(false);
  const [poolCount, setPoolCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoadingCounts(true);
        const countsRes = await getCounts({
          competition_ids: selectedCompetitionIds,
          seasons: selectedSeasons,
          min_market_value_eur: minMarketValue,
        });
        if (!cancelled) {
          setPoolCount(countsRes.poolCount || 0);
          setTotalCount(countsRes.totalCount || 0);
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoadingCounts(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedCompetitionIds, selectedSeasons, minMarketValue]);

  // Country expand/collapse
  const toggleCountry = (country) =>
    setExpandedCountries((prev) => ({ ...prev, [country]: !prev[country] }));

  // Toggle competition
  const toggleCompetition = (id) => {
    setSelectedCompetitionIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const clearCompetitions = () => setSelectedCompetitionIds([]);

  const selectAllCompetitions = () => {
    const all = [];
    Object.values(groupedCompetitions || {}).forEach((arr) => {
      (arr || []).forEach((c) => {
        all.push(c.competition_id);
      });
    });
    setSelectedCompetitionIds(all);
  };

  const selectTop10Competitions = () => {
    const top = [];
    const comps = Object.values(groupedCompetitions || {}).flat() || [];
    for (const c of comps) {
      if (top.length >= 10) break;
      top.push(c.competition_id);
    }
    setSelectedCompetitionIds(top);
  };

  // Seasons
  const clearSeasons = () => setSelectedSeasons([]);
  const selectAllSeasons = () => setSelectedSeasons(allSeasons);

  const handleLast5Seasons = () => {
    const last = [];
    for (const s of allSeasons) {
      if (last.length >= 5) break;
      last.push(s);
    }
    setSelectedSeasons(last);
  };

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-3xl rounded-2xl bg-white p-4 shadow-xl">
        <div className="flex items-center justify-between">
          <div className="text-lg font-semibold">Create New Elimination Challenge</div>
          <button
            type="button"
            className="rounded-md border px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border px-3 py-2 text-sm"
              placeholder="e.g. Friday Knockout"
            />
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
            compIdToLabel={compIdToLabel}
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

          {/* Actions */}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border px-3 py-2 text-sm text-gray-800 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={async () => {
                try {
                  const payload = {
                    name: name || "Elimination Challenge",
                    filters: {
                      competition_ids: selectedCompetitionIds,
                      seasons: selectedSeasons,
                      min_market_value_eur: minMarketValue,
                    },
                    status: "live",
                    round_time_limit_seconds: 60 * 60, // 60 min default
                  };
                  const { data, error } = await supabase
                    .from("elimination_tournaments")
                    .insert(payload)
                    .select("*")
                    .single();
                  if (error) throw error;
                  if (onCreated) onCreated(data);
                  onClose();
                } catch (e) {
                  console.error("[create tournament]", e);
                }
              }}
              className="inline-flex items-center gap-2 rounded-lg bg-green-700 px-3 py-2 text-sm font-semibold text-white hover:bg-green-800"
            >
              <Axe className="h-4 w-4" />
              Create
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------
   Section (collapsible)
------------------------------------------------------------ */
function Section({ title, icon, collapsed, onToggle, actions, children }) {
  return (
    <div className="rounded-xl border bg-white">
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          {icon}
          <div className="text-sm font-semibold text-gray-900">{title}</div>
        </div>
        <div className="flex items-center gap-2">
          {actions}
          <button
            type="button"
            onClick={onToggle}
            className="rounded-md border px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
          >
            {collapsed ? "Expand" : "Collapse"}
          </button>
        </div>
      </div>
      {!collapsed && <div className="px-3 pb-3 pt-1">{children}</div>}
    </div>
  );
}

/* ------------------------------------------------------------
   Chips row (selected filters)
------------------------------------------------------------ */
function SelectedChipsRow({
  selectedCompetitionIds = [],
  compIdToLabel = {},
  selectedSeasons = [],
  minMarketValue = 0,
  onRemoveCompetition,
  onRemoveSeason,
  onClearAll,
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {selectedCompetitionIds.length > 0 ? (
        selectedCompetitionIds.map((id) => (
          <span
            key={`comp-${id}`}
            className="inline-flex items-center gap-2 px-2 py-1 rounded-full text-xs bg-green-100 text-green-800"
          >
            {compIdToLabel?.[String(id)] || `League ${id}`}
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
        ))
      ) : (
        <span className="text-xs text-gray-500">No leagues selected</span>
      )}

      {selectedSeasons.length > 0 ? (
        selectedSeasons.map((s) => (
          <span
            key={`season-${s}`}
            className="inline-flex items-center gap-2 px-2 py-1 rounded-full text-xs bg-green-100 text-green-800"
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
        ))
      ) : (
        <span className="text-xs text-gray-500">No seasons selected</span>
      )}

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
  );
}

/* ------------------------------------------------------------
   DifficultyFilters
------------------------------------------------------------ */
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
          {loadingCounts ? "Calculating player pool…" : `Player pool: ${poolCount} of ${totalCount}`}
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
                  className="text-xs underline text-gray-700 hover:text-gray-900"
                  title="Quick select top 10 leagues"
                >
                  Top 10
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    selectAllCompetitions();
                  }}
                  className="text-xs underline text-gray-700 hover:text-gray-900"
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    clearCompetitions();
                  }}
                  className="text-xs underline text-gray-700 hover:text-gray-900"
                >
                  Clear
                </button>
              </>
            }
          >
            <div className="mt-2">
              {/* Search box */}
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                <input
                  ref={compSearchRef}
                  value={compSearch}
                  onChange={(e) => {
                    const v = e.target.value;
                    setCompSearch(v);
                    // build suggestions
                    const arr = [];
                    Object.entries(groupedCompetitions || {}).forEach(([country, comps]) => {
                      (comps || []).forEach((c) => {
                        const label = `${country} - ${c.competition_name}`;
                        if (!v || label.toLowerCase().includes(v.toLowerCase())) {
                          arr.push({ country, competition_id: c.competition_id, label });
                        }
                      });
                    });
                    setCompSug(arr.slice(0, 50));
                    setCompSugOpen(true);
                    setCompSugIndex(arr.length ? 0 : -1);
                  }}
                  onKeyDown={handleCompSearchKeyDown}
                  onFocus={() => setCompSugOpen(true)}
                  placeholder="Search competitions…"
                  className="w-full rounded-md border pl-7 pr-2 py-1.5 text-sm"
                />
                {compSugOpen && compSug.length > 0 && (
                  <div ref={compSugBoxRef} className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-white p-1 shadow-md">
                    {compSug.map((sug, idx) => (
                      <div
                        key={`${sug.country}-${sug.competition_id}`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          toggleCompetition(sug.competition_id);
                        }}
                        className={classNames(
                          "cursor-pointer rounded px-2 py-1 text-xs",
                          idx === compSugIndex ? "bg-green-100 text-green-900" : "hover:bg-gray-50"
                        )}
                      >
                        {sug.label}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Countries expand/collapse */}
              <div className="mt-3 space-y-2">
                {Object.entries(groupedCompetitions || {}).map(([country, comps]) => {
                  const expanded = !!expandedCountries[country];
                  return (
                    <div key={country} className="rounded-md border bg-white">
                      <div className="flex items-center justify-between px-2 py-1.5">
                        <div className="text-xs font-semibold">{country}</div>
                        <button
                          type="button"
                          className="rounded-md border px-2 py-0.5 text-[11px] text-gray-700 hover:bg-gray-50"
                          onClick={() => toggleCountry(country)}
                        >
                          {expanded ? "Hide" : "Show"}
                        </button>
                      </div>
                      {expanded && (
                        <div className="px-2 py-1.5">
                          <div className="flex flex-wrap gap-2">
                            {(comps || []).map((c) => {
                              const selected = selectedCompetitionIds.includes(c.competition_id);
                              return (
                                <button
                                  type="button"
                                  key={c.competition_id}
                                  onClick={() => toggleCompetition(c.competition_id)}
                                  className={classNames(
                                    "rounded-full border px-2 py-1 text-xs",
                                    selected
                                      ? "bg-green-600 border-green-700 text-white"
                                      : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
                                  )}
                                >
                                  {c.competition_name}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
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
                    selectAllSeasons();
                  }}
                  className="text-xs underline text-gray-700 hover:text-gray-900"
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleLast5Seasons();
                  }}
                  className="text-xs underline text-gray-700 hover:text-gray-900"
                >
                  Last 5
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    clearSeasons();
                  }}
                  className="text-xs underline text-gray-700 hover:text-gray-900"
                >
                  Clear
                </button>
              </>
            }
          >
            <div className="mt-2">
              <div className="flex flex-wrap items-center gap-2">
                {allSeasons.length === 0 ? (
                  <span className="text-xs text-gray-500">No seasons found</span>
                ) : (
                  allSeasons.map((s) => {
                    const selected = selectedSeasons.includes(s);
                    return (
                      <button
                        type="button"
                        key={s}
                        onClick={() =>
                          setSelectedSeasons((prev) =>
                            prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
                          )
                        }
                        className={classNames(
                          "rounded-full border px-2 py-1 text-xs",
                          selected
                            ? "bg-green-600 border-green-700 text-white"
                            : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
                        )}
                      >
                        {String(s)}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </Section>

          {/* Minimum Market Value */}
          <Section
            title="Minimum Market Value (€)"
            icon={<CheckSquare className="h-4 w-4 text-green-700" />}
            collapsed={mvCollapsed}
            onToggle={() => setMvCollapsed((v) => !v)}
          >
            <div className="mt-2 flex items-center gap-2">
              <input
                type="number"
                value={minMarketValue}
                onChange={(e) => setMinMarketValue(Number(e.target.value || 0))}
                className="w-40 rounded-md border px-2 py-1 text-sm"
                min={0}
                step={1000000}
              />
              <div className="text-xs text-gray-600">Players with market value ≥ this amount.</div>
            </div>
          </Section>
        </div>
      )}

      {/* Footer actions */}
      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-gray-50"
          onClick={onClose}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------
   PresetButton
------------------------------------------------------------ */
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

