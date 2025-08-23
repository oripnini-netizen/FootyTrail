import React, { useEffect, useRef, useState } from "react";
import { supabase } from "../supabase";
import { useAuth } from "../context/AuthContext";

/**
 * EliminationTournamentsPage
 * ------------------------------------------------------------
 * Lists Live / Finished tournaments using Supabase.
 * - Tabs: Live | Finished
 * - "Create Tournament" button opens a modal (now submits to Supabase)
 * - Renders tournament cards for each tab
 */
export default function EliminationTournamentsPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("live");
  const [showCreateModal, setShowCreateModal] = useState(false);

  const [live, setLive] = useState([]);
  const [finished, setFinished] = useState([]);
  const [loading, setLoading] = useState({ live: true, finished: true });
  const [error, setError] = useState({ live: "", finished: "" });

  const tabs = [
    { key: "live", label: "Live" },
    { key: "finished", label: "Finished" },
  ];

  // Lifted handler so PlaceholderCard can open the modal
  const handleOpenCreate = () => setShowCreateModal(true);

  // Helper: reload both lists (used on mount and after create)
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
        .select("id, name, status, created_at")
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
        .select("id, name, status, created_at")
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

  // Initial/when user changes
  useEffect(() => {
    reloadLists();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  return (
    <div className="min-h-screen w-full bg-gray-50 dark:bg-gray-900">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:py-8">
        {/* Page header */}
        <header className="mb-6 sm:mb-8 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
              Elimination Tournaments
            </h1>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              Create and follow elimination tournaments with friends. Each round
              uses the same mystery player for everyone. Lowest score(s) are eliminated
              until a single winner remains.
            </p>
          </div>

          {/* Quick create button (also exists in empty-state card) */}
          {activeTab === "live" && (
            <button
              type="button"
              onClick={handleOpenCreate}
              className="shrink-0 rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 dark:bg-white dark:text-gray-900"
            >
              Create Tournament
            </button>
          )}
        </header>

        {/* Tabs */}
        <div className="mb-4 flex items-center gap-2 overflow-x-auto">
          {tabs.map((t) => {
            const isActive = activeTab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key)}
                className={[
                  "whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition",
                  isActive
                    ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
                    : "bg-white text-gray-700 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700",
                ].join(" ")}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Tab underline (visual separator) */}
        <div className="mb-6 h-px w-full bg-gray-200 dark:bg-gray-700" />

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
                    <TournamentCard key={t.id} tournament={t} />
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
                    <TournamentCard key={t.id} tournament={t} />
                  ))}
                </>
              )}
              {!loading.finished && !error.finished && finished.length === 0 && (
                <PlaceholderCard
                  title="No finished tournaments"
                  subtitle="Completed tournaments and winners will appear here."
                  ctaLabel="View Rules"
                  onCtaClick={() => {
                    // Later we can navigate to About/Tutorial sections
                  }}
                />
              )}
            </>
          )}
        </section>
      </div>

      {/* Create Tournament Modal */}
      {showCreateModal && (
        <CreateTournamentModal
          currentUserId={user?.id || null}
          onClose={() => setShowCreateModal(false)}
          onCreated={reloadLists}
        />
      )}
    </div>
  );
}

function PlaceholderCard({ title, subtitle, ctaLabel, onCtaClick }) {
  return (
    <div className="flex flex-col justify-between rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition hover:shadow-md dark:border-gray-700 dark:bg-gray-800">
      <div>
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          {title}
        </h3>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{subtitle}</p>
      </div>
      <div className="mt-4">
        <button
          type="button"
          onClick={onCtaClick}
          className="w-full rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 dark:bg-white dark:text-gray-900"
        >
          {ctaLabel}
        </button>
      </div>
    </div>
  );
}

/** Tournament card (minimal info for now) */
function TournamentCard({ tournament }) {
  const createdAt = new Date(tournament.created_at);
  const dateStr = createdAt.toLocaleString();

  const isLive = tournament.status === "live";

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition hover:shadow-md dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          {tournament.name}
        </h3>
        <span
          className={[
            "shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold",
            isLive
              ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-200"
              : "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200",
          ].join(" ")}
        >
          {isLive ? "Live" : "Finished"}
        </span>
      </div>

      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
        Created: {dateStr}
      </p>

      <div className="mt-4 flex items-center justify-end">
        <button
          type="button"
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
          onClick={() => {
            // Later: navigate to tournament details page
            // e.g., navigate(`/elimination-tournaments/${tournament.id}`)
          }}
        >
          View
        </button>
      </div>
    </div>
  );
}

/** Loading skeleton (simple) */
function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <div className="h-4 w-1/2 rounded bg-gray-200 dark:bg-gray-700" />
      <div className="mt-3 h-3 w-2/3 rounded bg-gray-100 dark:bg-gray-700/80" />
      <div className="mt-6 flex justify-end">
        <div className="h-7 w-20 rounded bg-gray-100 dark:bg-gray-700/80" />
      </div>
    </div>
  );
}

/** Error card */
function ErrorCard({ title, message }) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-800 shadow-sm dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-1 text-sm opacity-90">{message}</p>
    </div>
  );
}

/** ----------------------------------------------------------------
 * CreateTournamentModal
 * Submits to Supabase:
 *  - Insert elimination_tournaments (owner_id, name, filters, round_time_limit_seconds)
 *  - Insert owner into elimination_participants (state 'active')
 * ----------------------------------------------------------------*/
function CreateTournamentModal({ currentUserId, onClose, onCreated }) {
  const dialogRef = useRef(null);

  // Basic form state
  const [name, setName] = useState("");
  const [difficulty, setDifficulty] = useState("medium"); // easy | medium | hard | expert
  const [league, setLeague] = useState(""); // optional single-select (UI only)
  const [seasons, setSeasons] = useState([]); // optional multi-select (UI only)
  const [minAppearances, setMinAppearances] = useState(0);
  const [roundTimeMinutes, setRoundTimeMinutes] = useState(5); // UX minutes
  const [invitesRaw, setInvitesRaw] = useState("");

  // UX
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  // Simple local validation helpers
  const [errors, setErrors] = useState({});

  // Close on Escape
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // rudimentary focus trap starter
  useEffect(() => {
    const prev = document.activeElement;
    dialogRef.current?.focus();
    return () => prev && prev.focus && prev.focus();
  }, []);

  const toggleSeason = (value) => {
    setSeasons((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  };

  const parseInvites = () => {
    return invitesRaw
      .split(/[\n,]+/g)
      .map((s) => s.trim())
      .filter(Boolean);
  };

  const validate = () => {
    const next = {};
    if (!name.trim()) next.name = "Please enter a tournament name.";
    const secs = Math.floor(Number(roundTimeMinutes) * 60);
    if (!Number.isFinite(secs) || secs < 30 || secs > 86400) {
      next.roundTimeMinutes = "Round time must be between 0.5 and 1440 minutes.";
    }
    if (!currentUserId) {
      next.user = "You must be logged in to create a tournament.";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError("");
    if (!validate()) return;

    setSubmitting(true);
    try {
      // Prepare payload
      const payload = {
        owner_id: currentUserId,
        name: name.trim(),
        // Persist difficulty inside filters for now; can explode to columns later if needed
        filters: {
          difficulty,
          league: league || null,
          seasons,
          min_appearances: Number(minAppearances) || 0,
        },
        round_time_limit_seconds: Math.floor(Number(roundTimeMinutes) * 60),
        // status defaults to 'live' (per schema), no need to set
      };

      // 1) Insert tournament
      const { data: tournament, error: tErr } = await supabase
        .from("elimination_tournaments")
        .insert([payload])
        .select()
        .single();

      if (tErr) throw new Error(tErr.message || "Failed to create tournament.");
      if (!tournament?.id) throw new Error("Tournament creation returned no id.");

      // 2) Ensure owner is a participant
      const { error: pErr } = await supabase
        .from("elimination_participants")
        .insert([
          {
            tournament_id: tournament.id,
            user_id: currentUserId,
            state: "active",
          },
        ]);

      if (pErr) {
        // Not fatal for creation, but we should surface
        // eslint-disable-next-line no-console
        console.warn("[CreateTournament] participant insert warning:", pErr);
      }

      // (Invites will be resolved later by email/username → user_id)

      // Refresh lists, close modal
      try {
        await onCreated?.();
      } catch {
        /* ignore refresh error */
      }
      onClose?.();
    } catch (ex) {
      setSubmitError(
        ex instanceof Error ? ex.message : "Failed to create tournament."
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Create Elimination Tournament"
        tabIndex={-1}
        ref={dialogRef}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        onClick={(e) => {
          // prevent closing when clicking inside the panel
          e.stopPropagation();
        }}
      >
        <div className="w-full max-w-2xl rounded-2xl border border-gray-200 bg-white p-0 shadow-xl dark:border-gray-700 dark:bg-gray-800">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-200 p-4 dark:border-gray-700">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Create Elimination Tournament
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-2 py-1 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              Close
            </button>
          </div>

          {/* Body */}
          <form onSubmit={handleSubmit} className="p-4 space-y-6">
            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                Tournament Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Friday Night Knockout"
                className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:ring-2 focus:ring-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
              />
              {errors.name && (
                <p className="mt-1 text-xs text-red-600">{errors.name}</p>
              )}
            </div>

            {/* Difficulty */}
            <div>
              <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-200">
                Difficulty
              </p>
              <div className="flex flex-wrap gap-2">
                {["easy", "medium", "hard", "expert"].map((lvl) => {
                  const active = difficulty === lvl;
                  return (
                    <button
                      key={lvl}
                      type="button"
                      onClick={() => setDifficulty(lvl)}
                      className={[
                        "rounded-full px-4 py-2 text-sm font-medium transition",
                        active
                          ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
                          : "bg-white text-gray-700 hover:bg-gray-100 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600",
                      ].join(" ")}
                    >
                      {lvl[0].toUpperCase() + lvl.slice(1)}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                We’ll use this to bias the player selection for each round.
              </p>
            </div>

            {/* Optional Filters (UI only for now) */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                  League (optional)
                </label>
                <select
                  value={league}
                  onChange={(e) => setLeague(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:ring-2 focus:ring-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                >
                  <option value="">Any</option>
                  <option value="EPL">Premier League</option>
                  <option value="LaLiga">LaLiga</option>
                  <option value="SerieA">Serie A</option>
                  <option value="Bundesliga">Bundesliga</option>
                  <option value="Ligue1">Ligue 1</option>
                </select>
              </div>

              <div>
                <p className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                  Seasons (optional)
                </p>
                <div className="mt-1 grid grid-cols-3 gap-2">
                  {["24/25", "23/24", "22/23", "21/22", "20/21", "19/20"].map(
                    (s) => {
                      const on = seasons.includes(s);
                      return (
                        <button
                          key={s}
                          type="button"
                          onClick={() => toggleSeason(s)}
                          className={[
                            "rounded-lg px-2 py-1 text-xs font-medium transition",
                            on
                              ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
                              : "bg-white text-gray-700 hover:bg-gray-100 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600",
                          ].join(" ")}
                        >
                          {s}
                        </button>
                      );
                    }
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                  Minimum Appearances (optional)
                </label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={minAppearances}
                  onChange={(e) => setMinAppearances(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:ring-2 focus:ring-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Helps avoid obscure one‑appearance players if desired.
                </p>
              </div>

              {/* Round time limit */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                  Round Time Limit (minutes)
                </label>
                <input
                  type="number"
                  min={0.5}
                  max={1440}
                  step={0.5}
                  value={roundTimeMinutes}
                  onChange={(e) => setRoundTimeMinutes(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:ring-2 focus:ring-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                />
                {errors.roundTimeMinutes && (
                  <p className="mt-1 text-xs text-red-600">
                    {errors.roundTimeMinutes}
                  </p>
                )}
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Must be between 0.5 and 1440 minutes (30 seconds to 24 hours).
                </p>
              </div>
            </div>

            {/* Invites */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                Invites (emails or usernames)
              </label>
              <textarea
                rows={3}
                value={invitesRaw}
                onChange={(e) => setInvitesRaw(e.target.value)}
                placeholder="friend1@email.com, friend2@email.com
or
@username1
@username2"
                className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:ring-2 focus:ring-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Separate by commas or new lines. We’ll resolve them later.
              </p>
            </div>

            {/* Submit error */}
            {submitError ? (
              <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
                {submitError}
              </div>
            ) : null}

            {/* Actions */}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60 dark:bg-white dark:text-gray-900"
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
