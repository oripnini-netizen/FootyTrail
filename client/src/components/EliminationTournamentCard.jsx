import React, { useMemo, useState } from "react";

/**
 * TournamentCard (Battle Royale theme)
 *
 * Props:
 * - tournament: {
 *     id: string,
 *     name: string,
 *     currentRound: number,
 *     totalRounds: number,
 *     survivorsCount: number,
 *     you: { userId: string, eliminatedRound: number | null },
 *   }
 * - rounds: Array<{
 *     roundNumber: number,                  // 1..N
 *     player: { id: string, name: string, imageUrl?: string }, // footballer of that round
 *     eliminatedUserIds: string[]           // who were knocked out this round
 *   }>
 * - users: Array<{
 *     id: string,
 *     full_name: string,
 *     profile_photo_url?: string,
 *   }>
 *
 * Behavior:
 * - Shows a shrinking "arena" circle indicating current round.
 * - Horizontal "Round History" chips: footballer image + name per round.
 * - Searchable "Elimination Log" listing who got eliminated on which round (and which player).
 * - Status pill for "you".
 */

export default function TournamentCard({
  tournament,
  rounds,
  users,
}) {
  const [filter, setFilter] = useState("all"); // all | surviving | eliminated
  const [query, setQuery] = useState("");
  const [focusedRound, setFocusedRound] = useState(null); // null or number

  const { byUserId, eliminatedMap, lastRoundForUser } = useMemo(() => {
    // Build quick lookups
    const byUserId = new Map(users.map((u) => [u.id, u]));
    const eliminatedMap = new Map(); // userId -> eliminatedRound
    for (const r of rounds) {
      for (const uid of r.eliminatedUserIds) {
        // First time we see a user eliminated is their actual elimination round
        if (!eliminatedMap.has(uid)) {
          eliminatedMap.set(uid, r.roundNumber);
        }
      }
    }
    // If a user never appears in eliminatedMap => still surviving
    const lastRoundForUser = (uid) => {
      if (eliminatedMap.has(uid)) return eliminatedMap.get(uid);
      // still in the game ⇒ has reached up to tournament.currentRound
      return null;
    };
    return { byUserId, eliminatedMap, lastRoundForUser };
  }, [users, rounds, tournament]);

  const survivorsSet = useMemo(() => {
    const eliminatedSet = new Set([...eliminatedMap.keys()]);
    const survivors = users.filter((u) => !eliminatedSet.has(u.id)).map((u) => u.id);
    return new Set(survivors);
  }, [users, eliminatedMap]);

  const filteredUsers = useMemo(() => {
    let list = users;

    if (filter === "surviving") {
      list = list.filter((u) => survivorsSet.has(u.id));
    } else if (filter === "eliminated") {
      list = list.filter((u) => !survivorsSet.has(u.id));
    }

    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((u) => (u.full_name || "").toLowerCase().includes(q));
    }

    // Sort: surviving first, then by elimination round asc, then name
    list = list.sort((a, b) => {
      const aSurv = survivorsSet.has(a.id) ? 0 : 1;
      const bSurv = survivorsSet.has(b.id) ? 0 : 1;
      if (aSurv !== bSurv) return aSurv - bSurv;

      const aElim = eliminatedMap.get(a.id) || Infinity;
      const bElim = eliminatedMap.get(b.id) || Infinity;
      if (aElim !== bElim) return aElim - bElim;

      return (a.full_name || "").localeCompare(b.full_name || "");
    });

    return list;
  }, [users, filter, query, survivorsSet, eliminatedMap]);

  const currentRound = tournament.currentRound ?? 1;
  const totalRounds = Math.max(tournament.totalRounds ?? currentRound, currentRound);

  // For the "Focused Round" context (which footballer)
  const roundByNumber = useMemo(() => {
    const map = new Map();
    for (const r of rounds) map.set(r.roundNumber, r);
    return map;
  }, [rounds]);

  const youStatus = useMemo(() => {
    const elim = eliminatedMap.get(tournament.you?.userId);
    if (elim) return { text: `Eliminated R${elim}`, tone: "danger" };
    return { text: "You’re still in!", tone: "success" };
  }, [eliminatedMap, tournament]);

  return (
    <div className="w-full rounded-2xl bg-zinc-900 text-zinc-100 shadow-xl ring-1 ring-zinc-800 overflow-hidden">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 px-4 md:px-6 py-4 bg-gradient-to-r from-zinc-900 to-zinc-800">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-zinc-700 flex items-center justify-center text-sm font-semibold">
            KO
          </div>
          <div>
            <h3 className="text-lg md:text-xl font-semibold">{tournament.name}</h3>
            <p className="text-xs md:text-sm text-zinc-400">
              Round {currentRound} / {totalRounds} • Survivors {tournament.survivorsCount}
            </p>
          </div>
        </div>
        <span
          className={[
            "inline-flex items-center rounded-full px-3 py-1 text-xs font-medium",
            youStatus.tone === "success"
              ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/30"
              : "bg-rose-500/15 text-rose-300 ring-1 ring-rose-400/30",
          ].join(" ")}
        >
          {youStatus.text}
        </span>
      </div>

      {/* Body */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 p-4 md:p-6">
        {/* Arena (concentric shrinking circle) */}
        <div className="order-1 lg:order-1">
          <ArenaCircle
            currentRound={currentRound}
            totalRounds={totalRounds}
            survivorsCount={tournament.survivorsCount}
          />
        </div>

        {/* Round History (chips with footballer) */}
        <div className="order-3 lg:order-2 lg:col-span-2">
          <RoundHistory
            rounds={rounds}
            focusedRound={focusedRound}
            setFocusedRound={setFocusedRound}
          />
        </div>

        {/* Elimination Log */}
        <div className="order-2 lg:order-3 lg:col-span-3">
          <EliminationLog
            users={users}
            eliminatedMap={eliminatedMap}
            survivorsSet={survivorsSet}
            filter={filter}
            setFilter={setFilter}
            query={query}
            setQuery={setQuery}
            roundByNumber={roundByNumber}
          />
        </div>
      </div>
    </div>
  );
}

/** Concentric arena visualization */
function ArenaCircle({ currentRound, totalRounds, survivorsCount }) {
  // Build rings: outer = R1, inner = R(total)
  const rings = Array.from({ length: totalRounds }, (_, i) => i + 1);
  // Size steps
  const base = 280; // px
  const step = 16;  // ring thickness/spacing

  return (
    <div className="flex items-center justify-center">
      <div className="relative" style={{ width: base, height: base }}>
        {rings.map((r) => {
          const inset = (r - 1) * step;
          const active = r <= currentRound;
          return (
            <div
              key={r}
              className={[
                "absolute rounded-full border",
                active
                  ? "border-emerald-400/40 bg-emerald-500/5 shadow-[0_0_30px_rgba(16,185,129,0.15)]"
                  : "border-zinc-700/70 bg-zinc-800/30",
              ].join(" ")}
              style={{
                inset: inset,
              }}
            />
          );
        })}

        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <div className="text-3xl font-bold">{survivorsCount}</div>
            <div className="text-xs text-zinc-400">survivors</div>
            <div className="mt-2 text-[11px] text-zinc-500">
              Round {currentRound} of {totalRounds}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Horizontal chip row with footballer headshots per round */
function RoundHistory({ rounds, focusedRound, setFocusedRound }) {
  return (
    <div className="rounded-xl bg-zinc-950/60 ring-1 ring-zinc-800 p-3">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold">Round History</h4>
        {focusedRound ? (
          <button
            className="text-xs text-zinc-400 hover:text-zinc-200"
            onClick={() => setFocusedRound(null)}
          >
            Clear focus
          </button>
        ) : null}
      </div>
      <div className="overflow-x-auto no-scrollbar">
        <div className="flex gap-3 min-w-max">
          {rounds.map((r) => (
            <button
              key={r.roundNumber}
              onClick={() => setFocusedRound(r.roundNumber)}
              className={[
                "group flex items-center gap-3 px-3 py-2 rounded-lg ring-1 transition",
                focusedRound === r.roundNumber
                  ? "bg-emerald-500/10 ring-emerald-400/40"
                  : "bg-zinc-900 ring-zinc-800 hover:bg-zinc-800/70",
              ].join(" ")}
              title={r.player?.name || `Round ${r.roundNumber}`}
            >
              <div className="h-9 w-9 flex-none rounded-full overflow-hidden bg-zinc-800 ring-1 ring-zinc-700/70">
                {r.player?.imageUrl ? (
                  <img
                    src={r.player.imageUrl}
                    alt={r.player.name || "Player"}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="h-full w-full grid place-items-center text-[10px] text-zinc-400">
                    No Img
                  </div>
                )}
              </div>
              <div className="flex flex-col items-start text-left">
                <span className="text-xs text-zinc-300 leading-tight">
                  R{r.roundNumber}
                </span>
                <span className="text-xs font-medium truncate max-w-[160px] group-hover:underline">
                  {r.player?.name || "Unknown Player"}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
      <p className="mt-3 text-[11px] text-zinc-500">
        Tip: tap a round to focus; the Elimination Log will show who fell on that round’s player.
      </p>
    </div>
  );
}

/** Searchable list of participants with elimination round + player tag */
function EliminationLog({
  users,
  eliminatedMap,
  survivorsSet,
  filter,
  setFilter,
  query,
  setQuery,
  roundByNumber,
}) {
  const [expanded, setExpanded] = useState(true);
  const [onlyFocusedRound, setOnlyFocusedRound] = useState(false);

  // We read the focused round from a custom event to avoid prop‑drilling deep (simple pattern)
  // If you decide to wire focus directly, replace with prop from parent.
  // For now, we’ll keep the toggle but won’t auto-filter by focused round here.

  return (
    <div className="rounded-xl bg-zinc-950/60 ring-1 ring-zinc-800">
      {/* Header */}
      <div className="flex items-center justify-between px-3 md:px-4 py-3 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <h4 className="text-sm font-semibold">Elimination Log</h4>
          <div className="hidden md:flex items-center gap-2 text-xs text-zinc-400">
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-emerald-400/70" /> Surviving
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-rose-400/70" /> Eliminated
            </span>
          </div>
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-zinc-400 hover:text-zinc-100"
        >
          {expanded ? "Collapse" : "Expand"}
        </button>
      </div>

      {expanded && (
        <>
          {/* Controls */}
          <div className="flex flex-col md:flex-row gap-3 md:items-center px-3 md:px-4 py-3">
            <div className="flex gap-2">
              {["all", "surviving", "eliminated"].map((k) => (
                <button
                  key={k}
                  onClick={() => setFilter(k)}
                  className={[
                    "px-3 py-1.5 rounded-lg text-xs font-medium ring-1 transition",
                    filter === k
                      ? "bg-zinc-800 ring-zinc-700"
                      : "bg-zinc-900 ring-zinc-800 hover:bg-zinc-800",
                  ].join(" ")}
                >
                  {k[0].toUpperCase() + k.slice(1)}
                </button>
              ))}
            </div>

            <div className="flex-1" />

            <div className="flex items-center gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search users…"
                className="w-full md:w-64 px-3 py-2 text-sm rounded-lg bg-zinc-900 ring-1 ring-zinc-800 placeholder:text-zinc-500 focus:outline-none focus:ring-emerald-400/40"
              />
            </div>
          </div>

          {/* List */}
          <div className="max-h-[360px] overflow-auto px-2 md:px-3 pb-3">
            <ul className="divide-y divide-zinc-800">
              {users.length === 0 && (
                <li className="p-3 text-sm text-zinc-400">No participants.</li>
              )}

              {users.map((u) => {
                const eliminatedRound = eliminatedMap.get(u.id) || null;
                const surviving = survivorsSet.has(u.id);

                const playerTag =
                  eliminatedRound && roundByNumber.get(eliminatedRound)?.player?.name
                    ? roundByNumber.get(eliminatedRound).player.name
                    : null;

                return (
                  <li key={u.id} className="flex items-center gap-3 p-3">
                    <div className="h-8 w-8 rounded-full overflow-hidden bg-zinc-800 ring-1 ring-zinc-700/70 flex-none">
                      {u.profile_photo_url ? (
                        <img
                          src={u.profile_photo_url}
                          alt={u.full_name || "User"}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="h-full w-full grid place-items-center text-[10px] text-zinc-400">
                          ?
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">{u.full_name || "Unknown"}</p>
                        <span
                          className={[
                            "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1",
                            surviving
                              ? "bg-emerald-500/10 text-emerald-300 ring-emerald-400/30"
                              : "bg-rose-500/10 text-rose-300 ring-rose-400/30",
                          ].join(" ")}
                        >
                          {surviving ? "Surviving" : `Eliminated R${eliminatedRound}`}
                        </span>
                        {!surviving && playerTag && (
                          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-zinc-800 ring-1 ring-zinc-700/70 text-zinc-300">
                            {playerTag}
                          </span>
                        )}
                      </div>

                      {!surviving && (
                        <p className="text-[11px] text-zinc-500 mt-0.5">
                          Fell on Round {eliminatedRound}
                          {playerTag ? ` (${playerTag})` : ""}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
