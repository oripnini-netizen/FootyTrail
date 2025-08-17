// client/src/pages/MyLeaguesPage.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabase';
import { useAuth } from '../context/AuthContext';
import { Plus, Users, Calendar, Flag, ChevronDown, ChevronUp, X, Clock, Trophy, ChevronRight } from 'lucide-react';

// ---------- helpers ----------

const today = new Date();
const tomorrowStr = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
})();

const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const byDateAsc = (a, b) => new Date(a.match_date) - new Date(b.match_date);

// Turn a list of participants (participant rows) into standings computed from completed match-days (<= today)
function computeStandings(participants, matches, dayPointsMap) {
  const stats = new Map();
  const ensure = (pid, name, isBot, userId) => {
    if (!stats.has(pid)) {
      stats.set(pid, { pid, userId, name, isBot, P: 0, W: 0, D: 0, L: 0, PTS: 0 });
    }
    return stats.get(pid);
  };

  const todayMidnight = new Date();
  todayMidnight.setHours(0,0,0,0);

  matches
    .filter(m => new Date(m.match_date) <= todayMidnight) // include today as "live"
    .forEach(m => {
      const home = participants.find(p => p.id === m.home_participant_id);
      const away = participants.find(p => p.id === m.away_participant_id);
      if (!home || !away) return;

      const homePts = dayPointsMap.get(keyDP(m, home)) ?? 0;
      const awayPts = dayPointsMap.get(keyDP(m, away)) ?? 0;

      const A = ensure(home.id, displayName(home), home.is_bot, home.user_id);
      const B = ensure(away.id, displayName(away), away.is_bot, away.user_id);
      A.P += 1; B.P += 1;
      if (homePts > awayPts) { A.W += 1; A.PTS += 3; B.L += 1; }
      else if (homePts < awayPts) { B.W += 1; B.PTS += 3; A.L += 1; }
      else { A.D += 1; B.D += 1; A.PTS += 1; B.PTS += 1; }
    });

  // Ensure everyone appears even if no matches elapsed yet
  participants.forEach(p => ensure(p.id, displayName(p), p.is_bot, p.user_id));

  return Array.from(stats.values())
    .sort((a, b) => b.PTS - a.PTS || (b.W - a.W) || (a.L - b.L) || a.name.localeCompare(b.name));
}

const displayName = (p) => (p.is_bot ? p.display_name : (p.user?.full_name || p.user_full_name || 'Unknown'));
const keyDP = (m, p) => `${m.league_id}|${m.match_date}|${p.id}`;

// small seeded helper (still used only for visual breakdown splits)
function seededRandomInt(seed, min, max) {
  function xmur3(str) {
    for (var i = 0, h = 1779033703 ^ str.length; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19;
    }
    return function() {
      h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
      return (h ^= h >>> 16) >>> 0;
    };
  }
  function sfc32(a, b, c, d) {
    return function() {
      a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
      var t = (a + b) | 0; a = b ^ b >>> 9;
      b = c + (c << 3) | 0; c = (c << 21 | c >>> 11);
      d = d + 1 | 0; t = t + d | 0; c = c + t | 0;
      return (t >>> 0) / 4294967296;
    };
  }
  const seedFn = xmur3(seed);
  const rand = sfc32(seedFn(), seedFn(), seedFn(), seedFn());
  const r = rand();
  return Math.floor(min + r * (max - min + 1));
}

const BOT_PREFIX = ['Robo', 'Auto', 'Mecha', 'Cyber', 'Machine', 'Quantum', 'Galacto', 'Vector', 'Atlas', 'Proto'];
const BOT_SUFFIX = ['United', 'FC', 'Athletic', 'Calcio', 'City', 'Town', 'Dynamos', 'Wanderers', 'Botos', 'Botlandia', 'Robotics'];
const randomBotName = () => {
  const p = BOT_PREFIX[seededRandomInt(String(Math.random()), 0, BOT_PREFIX.length - 1)];
  const s = BOT_SUFFIX[seededRandomInt(String(Math.random()*1000), 0, BOT_SUFFIX.length - 1)];
  return `${p} ${s}`;
};

// Generate double round-robin schedule; returns [{match_day, pairs:[{home,away}]}...]
function generateDoubleRoundRobin(participantIds) {
  const n = participantIds.length;
  if (n < 2) return [];
  const arr = [...participantIds];
  if (n % 2 !== 0) arr.push(null);
  const m = arr.length;
  const rounds = [];
  for (let r = 0; r < m - 1; r++) {
    const pairs = [];
    for (let i = 0; i < m / 2; i++) {
      const a = arr[i];
      const b = arr[m - 1 - i];
      if (a != null && b != null) {
        pairs.push(r % 2 === 0 ? { home: a, away: b } : { home: b, away: a });
      }
    }
    rounds.push({ match_day: r + 1, pairs });
    const fixed = arr[0];
    const rest = arr.slice(1);
    rest.unshift(rest.pop());
    arr.splice(0, arr.length, fixed, ...rest);
  }
  const secondLeg = rounds.map((r, idx) => ({
    match_day: rounds.length + idx + 1,
    pairs: r.pairs.map(p => ({ home: p.away, away: p.home }))
  }));
  return [...rounds, ...secondLeg];
}

// Get midnight range for a date
const dayRange = (date) => {
  const s = new Date(date); s.setHours(0,0,0,0);
  const e = new Date(s); e.setDate(e.getDate()+1);
  return { start: s.toISOString(), end: e.toISOString() };
};

// ---------- UI components ----------

function SectionCard({ children }) {
  return <div className="bg-white rounded-xl shadow-md p-6">{children}</div>;
}

function Chip({ children, tone='default' }) {
  const tones = {
    default: 'bg-gray-100 text-gray-700',
    green: 'bg-green-100 text-green-800',
    blue: 'bg-blue-100 text-blue-800',
    yellow: 'bg-yellow-100 text-yellow-800',
  };
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

function Tabs({ items, value, onChange }) {
  return (
    <div className="flex items-center justify-center gap-2 bg-white/60 rounded-full px-2 py-1 w-fit mx-auto my-4">
      {items.map((it) => (
        <button
          key={it}
          onClick={() => onChange(it)}
          className={`px-4 py-1.5 rounded-full text-sm ${value === it ? 'bg-green-600 text-white' : 'bg-white text-gray-700 border'}`}
        >
          {it}
        </button>
      ))}
    </div>
  );
}

// ---------- Page ----------

export default function MyLeaguesPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState('Active');
  const [loading, setLoading] = useState(true);
  const [leagues, setLeagues] = useState([]); // each: {league, participants[], matches[]}

  // Modal (create league)
  const [openCreate, setOpenCreate] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [startDate, setStartDate] = useState(tomorrowStr);
  const [searchEmail, setSearchEmail] = useState('');
  const [emailResults, setEmailResults] = useState([]);
  const [invites, setInvites] = useState([]); // {id, email, full_name}

  // Modal (user click -> profile)
  const [openUser, setOpenUser] = useState(null);
  const [userRecent, setUserRecent] = useState([]);
  const [userStats, setUserStats] = useState({ totalPoints: 0, games: 0, avgTime: 0, successRate: 0 });
  const [loadingUser, setLoadingUser] = useState(false);

  // live tick to refresh day-points every 20s
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 20000);
    return () => clearInterval(id);
  }, []);

  // Fetch user's leagues: get participant rows, then join leagues, participants, matches.
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const { data: myParts, error: e1 } = await supabase
          .from('league_participants')
          .select('league_id')
          .eq('user_id', user.id);
        if (e1) throw e1;

        const leagueIds = [...new Set((myParts || []).map(p => p.league_id))];
        if (leagueIds.length === 0) {
          setLeagues([]);
          return;
        }

        const { data: leaguesData, error: e2 } = await supabase
          .from('leagues')
          .select('*')
          .in('id', leagueIds);
        if (e2) throw e2;

        const { data: parts, error: e3 } = await supabase
          .from('league_participants')
          .select('id, league_id, user_id, is_bot, display_name')
          .in('league_id', leagueIds);
        if (e3) throw e3;

        let userIds = parts?.filter(p => p.user_id).map(p => p.user_id) || [];
        userIds = [...new Set(userIds)];
        const userMap = new Map();
        if (userIds.length) {
          const { data: usersRows } = await supabase
            .from('users')
            .select('id, full_name, profile_photo_url')
            .in('id', userIds);
          (usersRows || []).forEach(u => userMap.set(u.id, u));
        }
        const partsHydrated = (parts || []).map(p => ({ ...p, user: p.user_id ? userMap.get(p.user_id) : null, user_full_name: p.user ? p.user.full_name : undefined }));

        const { data: matches, error: e4 } = await supabase
          .from('league_matches')
          .select('*')
          .in('league_id', leagueIds);
        if (e4) throw e4;

        const grouped = leagueIds.map(id => ({
          league: leaguesData.find(l => l.id === id),
          participants: partsHydrated.filter(p => p.league_id === id),
          matches: (matches || []).filter(m => m.league_id === id).sort(byDateAsc)
        }));

        if (!cancelled) setLeagues(grouped);
      } catch (err) {
        console.error('MyLeagues load error:', err);
        if (!cancelled) setLeagues([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // --- Email search for invite ---
  useEffect(() => {
    let active = true;
    const t = setTimeout(async () => {
      const q = (searchEmail || '').trim();
      if (!q || q.length < 2) { if (active) setEmailResults([]); return; }
      const { data } = await supabase
        .from('users')
        .select('id, email, full_name')
        .ilike('email', `%${q}%`)
        .limit(10);
      if (active) setEmailResults(data || []);
    }, 250);
    return () => { active = false; clearTimeout(t); };
  }, [searchEmail]);

  // --- Clicking on a user name opens modal with stats (like Leaderboard) ---
  const onRowClickUser = async (userId, fullName, profilePhoto) => {
    setOpenUser({ userId, name: fullName, profilePhoto });
    setLoadingUser(true);
    try {
      const { data: games } = await supabase
        .from('games_records')
        .select('id, player_name, won, points_earned, time_taken_seconds, guesses_attempted, hints_used, created_at, is_daily_challenge')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(20);
      setUserRecent(games || []);

      const { data: allGames } = await supabase
        .from('games_records')
        .select('won, points_earned, time_taken_seconds')
        .eq('user_id', userId);

      const total = allGames?.length || 0;
      const pts = (allGames || []).reduce((s, g) => s + (g.points_earned || 0), 0);
      const wins = (allGames || []).filter(g => g.won).length;
      const time = (allGames || []).reduce((s, g) => s + (g.time_taken_seconds || 0), 0);
      setUserStats({
        totalPoints: pts,
        games: total,
        avgTime: total ? Math.round(time / total) : 0,
        successRate: total ? Math.round((wins / total) * 100) : 0
      });
    } finally {
      setLoadingUser(false);
    }
  };

  // ----- Derived per league: day totals map for standings & fixtures -----
  // Map key: `${league_id}|${match_date}|${participant_id}` -> total points that day
  const [dayPoints, setDayPoints] = useState(new Map());
  useEffect(() => {
    let cancelled = false;

    async function compute() {
      const map = new Map();

      for (const L of leagues) {
        const { league, participants, matches } = L;
        const dates = [...new Set(matches.map(m => m.match_date))];

        for (const d of dates) {
          const { start, end } = dayRange(d);
          const humans = participants.filter(p => !p.is_bot);
          const humanIds = humans.map(h => h.user_id).filter(Boolean);

          let byUser = new Map();
          if (humanIds.length) {
            const { data: records } = await supabase
              .from('games_records')
              .select('user_id, points_earned')
              .in('user_id', humanIds)
              .gte('created_at', start)
              .lt('created_at', end);

            byUser = new Map();
            (records || []).forEach(r => {
              byUser.set(r.user_id, (byUser.get(r.user_id) || 0) + (r.points_earned || 0));
            });
          }

          // Average of all humans in the league for that date (include 0 for users with no games yet)
          const humanCount = humans.length;
          const sumHumans = humans.reduce((s, h) => s + (byUser.get(h.user_id) || 0), 0);
          const avgHuman = humanCount ? Math.round(sumHumans / humanCount) : 0;

          // Store per participant
          participants.forEach(p => {
            const val = p.is_bot ? avgHuman : (byUser.get(p.user_id) || 0);
            map.set(keyDP({ league_id: league.id, match_date: d }, p), val);
          });
        }
      }

      if (!cancelled) setDayPoints(map);
    }

    if (leagues.length) compute();
    return () => { cancelled = true; };
    // re-run on live tick to keep “who’s leading now” fresh
  }, [leagues, tick]);

  // classify into Scheduled / Active / Ended
  const classified = useMemo(() => {
    const out = { Scheduled: [], Active: [], Ended: [] };
    const today0 = new Date(); today0.setHours(0,0,0,0);
    for (const L of leagues) {
      const s = new Date(L.league.start_date);
      const lastMatch = L.matches.length ? new Date(L.matches[L.matches.length - 1].match_date) : s;
      const isScheduled = s > today0;
      const isEnded = lastMatch < today0;
      const key = isScheduled ? 'Scheduled' : (isEnded ? 'Ended' : 'Active');
      out[key].push(L);
    }
    return out;
  }, [leagues]);

  // ---------- actions ----------

  const addInvite = (u) => {
    if (invites.find(x => x.id === u.id)) return;
    setInvites(prev => [...prev, u]);
    setSearchEmail(''); setEmailResults([]);
  };
  const removeInvite = (id) => setInvites(prev => prev.filter(x => x.id !== id));

  const canCreate = name.trim() && startDate;

  const onCreateLeague = async () => {
    if (!user?.id || !canCreate) return;

    // Build participant list (creator + invited; add bot if odd)
    let people = [{ id: user.id, email: user.email, full_name: user.user_metadata?.full_name || user.full_name || 'You' }, ...invites];
    if (people.length % 2 === 1) {
      people.push({ id: null, email: null, full_name: randomBotName(), is_bot: true });
    }

    // Insert league
    const { data: leagueRow, error: e1 } = await supabase
      .from('leagues')
      .insert([{ name: name.trim(), description: desc || null, creator_id: user.id, start_date: startDate }])
      .select()
      .single();
    if (e1) { console.error(e1); return; }

    // Insert participants
    const partsPayload = people.map(p => ({
      league_id: leagueRow.id,
      user_id: p.is_bot ? null : p.id,
      is_bot: !!p.is_bot,
      display_name: p.is_bot ? p.full_name : null
    }));
    const { data: parts, error: e2 } = await supabase
      .from('league_participants')
      .insert(partsPayload)
      .select();
    if (e2) { console.error(e2); return; }

    // Build schedule (double round-robin)
    const partIds = parts.map(p => p.id);
    const rounds = generateDoubleRoundRobin(partIds);

    // Map rounds to dates
    const start = new Date(startDate);
    const matchesPayload = [];
    rounds.forEach((round, idx) => {
      const date = new Date(start); date.setDate(start.getDate() + idx);
      round.pairs.forEach(pair => {
        matchesPayload.push({
          league_id: leagueRow.id,
          match_day: round.match_day,
          match_date: date.toISOString().slice(0,10),
          home_participant_id: pair.home,
          away_participant_id: pair.away
        });
      });
    });

    const { error: e3 } = await supabase.from('league_matches').insert(matchesPayload);
    if (e3) { console.error(e3); return; }

    // Reset & reload quickly
    setOpenCreate(false);
    setName(''); setDesc(''); setInvites([]); setStartDate(tomorrowStr);

    // Hard reload from DB to show the just-created league
    const { data: myParts } = await supabase
      .from('league_participants')
      .select('league_id')
      .eq('user_id', user.id);
    const ids = [...new Set((myParts || []).map(p => p.league_id))];
    if (!ids.length) return;
    const { data: leaguesData } = await supabase.from('leagues').select('*').in('id', ids);
    const { data: parts2 } = await supabase.from('league_participants').select('id,league_id,user_id,is_bot,display_name').in('league_id', ids);
    let userIds = parts2?.filter(p => p.user_id).map(p => p.user_id) || [];
    userIds = [...new Set(userIds)];
    const userMap = new Map();
    if (userIds.length) {
      const { data: usersRows } = await supabase.from('users').select('id,full_name,profile_photo_url').in('id', userIds);
      (usersRows || []).forEach(u => userMap.set(u.id, u));
    }
    const partsHydrated = (parts2 || []).map(p => ({ ...p, user: p.user_id ? userMap.get(p.user_id) : null, user_full_name: p.user ? p.user.full_name : undefined }));
    const { data: matches } = await supabase.from('league_matches').select('*').in('league_id', ids);
    const grouped = ids.map(id => ({
      league: leaguesData.find(l => l.id === id),
      participants: partsHydrated.filter(p => p.league_id === id),
      matches: (matches || []).filter(m => m.league_id === id).sort(byDateAsc)
    }));
    setLeagues(grouped);
  };

  // ---------- Render ----------

  const currentList = classified[tab] || [];

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-green-50 to-transparent">
      <div className="fixed inset-0 -z-10 bg-gradient-to-b from-green-50 to-transparent" />

      <div className="container mx-auto py-8 px-4 max-w-6xl">
        <h1 className="text-4xl font-extrabold text-center text-green-800">My Leagues</h1>
        <p className="text-center text-gray-600 mt-2">Compete with friends and track your progress in exciting football leagues</p>

        <div className="flex justify-center mt-6">
          <button
            onClick={() => setOpenCreate(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-green-700 text-white rounded-lg hover:bg-green-800"
          >
            <Plus className="h-5 w-5" /> Create New League
          </button>
        </div>

        <Tabs items={['Active', 'Scheduled', 'Ended']} value={tab} onChange={setTab} />

        {loading ? (
          <div className="flex justify-center my-12">
            <div className="h-10 w-10 rounded-full border-b-2 border-green-700 animate-spin" />
          </div>
        ) : currentList.length === 0 ? (
          <div className="text-center mt-16">
            <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-green-100 flex items-center justify-center">
              <Trophy className="h-8 w-8 text-green-700" />
            </div>
            <div className="text-xl font-semibold">No leagues found</div>
            <p className="text-gray-600">Create your first league or wait to be invited!</p>
          </div>
        ) : (
          <div className="space-y-6 mt-6">
            {currentList.map((L) => (
              <LeagueCard
                key={L.league.id}
                league={L.league}
                participants={L.participants}
                matches={L.matches}
                dayPoints={dayPoints}
                onClickUser={onRowClickUser}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create league modal */}
      {openCreate && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-white rounded-xl shadow-xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="text-lg font-semibold">Create a New League</div>
              <button className="p-1 rounded-full hover:bg-gray-100" onClick={() => setOpenCreate(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div>
                <label className="text-sm text-gray-600">League Name</label>
                <input
                  className="w-full border rounded px-3 py-2"
                  placeholder="e.g., Premier Guessers League"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div>
                <label className="text-sm text-gray-600">Description (optional)</label>
                <textarea
                  className="w-full border rounded px-3 py-2"
                  rows={3}
                  placeholder="A brief description of your league"
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                />
              </div>

              <div>
                <label className="text-sm text-gray-600">Add Participants by Email</label>
                <div className="flex gap-2">
                  <input
                    className="flex-1 border rounded px-3 py-2"
                    placeholder="Search email..."
                    value={searchEmail}
                    onChange={(e) => setSearchEmail(e.target.value)}
                  />
                  <button
                    className="px-3 py-2 rounded bg-gray-100 text-gray-700"
                    type="button"
                    disabled
                    title="Type to search; click result below to add"
                  >
                    Search
                  </button>
                </div>
                {!!emailResults.length && (
                  <ul className="border rounded mt-2 max-h-40 overflow-auto">
                    {emailResults.map(u => (
                      <li
                        key={u.id}
                        onClick={() => addInvite(u)}
                        className="px-3 py-2 hover:bg-gray-50 cursor-pointer"
                      >
                        <div className="font-medium">{u.full_name || 'Unknown'}</div>
                        <div className="text-xs text-gray-500">{u.email}</div>
                      </li>
                    ))}
                  </ul>
                )}
                {!!invites.length && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {invites.map(i => (
                      <span key={i.id} className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-green-100 text-green-800 text-sm">
                        {i.full_name || i.email}
                        <button onClick={() => removeInvite(i.id)} className="ml-1 text-green-800 hover:text-green-900">×</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="text-sm text-gray-600">Start Date</label>
                <input
                  type="date"
                  className="w-full border rounded px-3 py-2"
                  min={tomorrowStr}
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
                <p className="text-xs text-gray-500 mt-1">Leagues can only start from tomorrow onwards.</p>
              </div>

              <div className="pt-2">
                <button
                  onClick={onCreateLeague}
                  disabled={!canCreate}
                  className={`w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded ${canCreate ? 'bg-green-700 text-white hover:bg-green-800' : 'bg-gray-300 text-gray-600'}`}
                >
                  <Plus className="h-5 w-5" /> Create League
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* User modal (stats + recent 20) */}
      {openUser && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-white rounded-xl shadow-xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="flex items-center gap-3">
                {openUser.profilePhoto ? (
                  <img src={openUser.profilePhoto} alt="" className="h-10 w-10 rounded-full object-cover" />
                ) : (
                  <div className="h-10 w-10 rounded-full bg-green-100 flex items-center justify-center text-green-700">
                    {(openUser.name || '?')[0]}
                  </div>
                )}
                <div className="font-semibold">{openUser.name}</div>
              </div>
              <button className="p-1 rounded-full hover:bg-gray-100" onClick={() => setOpenUser(null)}>
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4">
              <div className="rounded border p-3 text-center">
                <div className="text-xs text-gray-500">Total Points</div>
                <div className="text-lg font-semibold text-green-700">{userStats.totalPoints?.toLocaleString?.() || 0}</div>
              </div>
              <div className="rounded border p-3 text-center">
                <div className="text-xs text-gray-500">Games</div>
                <div className="text-lg font-semibold">{userStats.games || 0}</div>
              </div>
              <div className="rounded border p-3 text-center">
                <div className="text-xs text-gray-500">Avg Time</div>
                <div className="text-lg font-semibold">{userStats.avgTime || 0}s</div>
              </div>
              <div className="rounded border p-3 text-center">
                <div className="text-xs text-gray-500">Success</div>
                <div className="text-lg font-semibold">{userStats.successRate || 0}%</div>
              </div>
            </div>

            <div className="max-h-96 overflow-y-auto px-4 pb-4">
              {loadingUser ? (
                <div className="flex h-32 items-center justify-center">
                  <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-green-700" />
                </div>
              ) : userRecent.length === 0 ? (
                <div className="p-6 text-center text-gray-500">No recent games.</div>
              ) : (
                <div className="space-y-3">
                  {userRecent.map(g => (
                    <div key={g.id} className="rounded border p-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className={`font-medium ${g.is_daily_challenge ? 'text-yellow-600 font-semibold' : ''}`}>
                            {g.player_name || 'Unknown Player'}
                          </div>
                          <div className="text-xs text-gray-500">{new Date(g.created_at).toLocaleString()}</div>
                        </div>
                        <div className="text-right">
                          <div className={`font-semibold ${g.won ? 'text-green-600' : 'text-red-600'}`}>
                            {g.won ? `+${g.points_earned}` : '0'} pts
                          </div>
                          <div className="text-xs text-gray-500">
                            {g.guesses_attempted} {g.guesses_attempted === 1 ? 'guess' : 'guesses'}
                            {g.is_daily_challenge && ' • Daily'}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- league card ------------

function LeagueCard({ league, participants, matches, dayPoints, onClickUser }) {
  const [subtab, setSubtab] = useState('Table');

  const participantsById = useMemo(() => {
    const map = new Map();
    participants.forEach(p => map.set(p.id, p));
    return map;
  }, [participants]);

  const standings = useMemo(() => computeStandings(participants, matches, dayPoints), [participants, matches, dayPoints]);

  return (
    <div className="rounded-2xl border bg-white shadow-sm overflow-hidden">
      <div className="h-2 bg-green-700" />
      <div className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xl font-bold">{league.name}</div>
            <div className="flex items-center gap-2 mt-1">
              <Chip tone="blue">Start: {fmtDate(league.start_date)}</Chip>
              {matches.length ? <Chip tone="green">Match Days: {new Set(matches.map(m => m.match_day)).size}</Chip> : null}
            </div>
          </div>
          {league.description ? <div className="text-sm text-gray-600 max-w-md">{league.description}</div> : null}
        </div>

        <div className="mt-3 text-sm bg-blue-50 border border-blue-100 rounded p-2">
          Created by: <span className="font-medium">{league.creator_id?.slice(0, 8)}…</span>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={() => setSubtab('Table')}
            className={`px-3 py-1.5 rounded ${subtab==='Table' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700'}`}
          >
            <span className="inline-flex items-center gap-1"><Trophy className="h-4 w-4" /> Table</span>
          </button>
          <button
            onClick={() => setSubtab('Fixtures')}
            className={`px-3 py-1.5 rounded ${subtab==='Fixtures' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700'}`}
          >
            <span className="inline-flex items-center gap-1"><Calendar className="h-4 w-4" /> Fixtures & Results</span>
          </button>
        </div>

        {subtab === 'Table' ? (
          <LeagueTable standings={standings} participants={participants} onClickUser={onClickUser} />
        ) : (
          <FixturesList
            league={league}
            matches={matches}
            participantsById={participantsById}
            dayPoints={dayPoints}
            onClickUser={onClickUser}
          />
        )}
      </div>
    </div>
  );
}

function LeagueTable({ standings, participants, onClickUser }) {
  const findUser = (pid) => {
    const p = participants.find(x => x.id === pid);
    if (!p) return {};
    return {
      name: p.is_bot ? p.display_name : (p.user?.full_name || 'Unknown'),
      isBot: !!p.is_bot,
      userId: p.user_id,
      photo: p.user?.profile_photo_url
    };
  };

  return (
    <div className="mt-4">
      <div className="text-green-800 font-semibold mb-2 flex items-center gap-2">
        <Flag className="h-4 w-4" /> League Table
      </div>
      <div className="overflow-x-auto rounded border">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="px-3 py-2 text-left">POS</th>
              <th className="px-3 py-2 text-left">PLAYER</th>
              <th className="px-3 py-2 text-center">P</th>
              <th className="px-3 py-2 text-center">W</th>
              <th className="px-3 py-2 text-center">D</th>
              <th className="px-3 py-2 text-center">L</th>
              <th className="px-3 py-2 text-right">PTS</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((s, i) => {
              const u = findUser(s.pid);
              return (
                <tr key={s.pid} className="border-t">
                  <td className="px-3 py-2">{i+1}</td>
                  <td className="px-3 py-2">
                    {u.isBot ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-purple-100 text-purple-700 text-xs">B</span>
                        <span className="font-medium">{u.name}</span>
                      </span>
                    ) : (
                      <button
                        className="font-medium text-green-700 hover:underline"
                        onClick={() => onClickUser?.(u.userId, u.name, u.photo)}
                        title="View profile"
                      >
                        {u.name}
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">{s.P}</td>
                  <td className="px-3 py-2 text-center text-green-700 font-semibold">{s.W}</td>
                  <td className="px-3 py-2 text-center">{s.D}</td>
                  <td className="px-3 py-2 text-center text-red-600 font-semibold">{s.L}</td>
                  <td className="px-3 py-2 text-right font-bold">{s.PTS}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FixturesList({ league, matches, participantsById, dayPoints, onClickUser }) {
  const grouped = useMemo(() => {
    const m = new Map();
    matches.forEach(mt => {
      const key = `${mt.match_day}|${mt.match_date}`;
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(mt);
    });
    return Array.from(m.entries())
      .map(([key, arr]) => {
        const [md, dt] = key.split('|');
        return { match_day: Number(md), match_date: dt, items: arr.sort((a,b)=>a.id.localeCompare(b.id)) };
      })
      .sort((a,b)=> new Date(a.match_date) - new Date(b.match_date));
  }, [matches]);

  return (
    <div className="mt-4">
      <div className="text-green-800 font-semibold mb-2 flex items-center gap-2">
        <Calendar className="h-4 w-4" /> Fixtures & Results
      </div>

      <div className="space-y-3">
        {grouped.map(group => (
          <FixtureDay
            key={`${group.match_day}-${group.match_date}`}
            league={league}
            group={group}
            participantsById={participantsById}
            dayPoints={dayPoints}
            onClickUser={onClickUser}
          />
        ))}
      </div>
    </div>
  );
}

function FixtureDay({ league, group, participantsById, dayPoints, onClickUser }) {
  const [open, setOpen] = useState(false);
  const isPast = new Date(group.match_date) < new Date(new Date().toDateString());

  return (
    <div className="rounded border">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 bg-gray-50"
      >
        <div className="flex items-center gap-2">
          <Chip tone="green">Match Day {group.match_day}</Chip>
          <Chip tone={isPast ? 'yellow' : 'blue'}>{fmtDate(group.match_date)}</Chip>
        </div>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      <div className="divide-y">
        {group.items.map(item => {
          const H = participantsById.get(item.home_participant_id);
          const A = participantsById.get(item.away_participant_id);

          const hName = displayName(H);
          const aName = displayName(A);
          const homePts = dayPoints.get(keyDP({ league_id: league.id, match_date: group.match_date }, H)) ?? 0;
          const awayPts = dayPoints.get(keyDP({ league_id: league.id, match_date: group.match_date }, A)) ?? 0;

          return (
            <div key={item.id} className="p-3">
              <div className="flex items-center justify-between">
                <SideName p={H} name={hName} onClickUser={onClickUser} />
                <div className="text-sm text-gray-500 flex items-center gap-1">
                  <Clock className="h-4 w-4"/> {fmtDate(group.match_date)}
                </div>
                <SideName p={A} name={aName} align="right" onClickUser={onClickUser} />
              </div>

              <div className="mt-2 flex items-center justify-between">
                <div className="font-semibold text-green-700">{homePts.toLocaleString()}</div>
                <ChevronRight className="h-4 w-4 text-gray-400" />
                <div className="font-semibold text-red-700">{awayPts.toLocaleString()}</div>
              </div>

              {open && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                  <PlayersBreakdown label={hName} participant={H} date={group.match_date} botTotal={H.is_bot ? homePts : null} />
                  <PlayersBreakdown label={aName} participant={A} date={group.match_date} botTotal={A.is_bot ? awayPts : null} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SideName({ p, name, align='left', onClickUser }) {
  return p.is_bot ? (
    <div className={`flex items-center gap-2 ${align==='right' ? 'flex-row-reverse text-right' : ''}`}>
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-purple-100 text-purple-700 text-xs">B</span>
      <span className="font-medium">{name}</span>
    </div>
  ) : (
    <div className={`flex items-center gap-2 ${align==='right' ? 'flex-row-reverse text-right' : ''}`}>
      <button
        className="font-medium text-green-700 hover:underline"
        onClick={() => onClickUser?.(p.user_id, p.user?.full_name || 'Player', p.user?.profile_photo_url)}
      >
        {name}
      </button>
    </div>
  );
}

function PlayersBreakdown({ label, participant, date, botTotal }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        if (participant.is_bot) {
          // Split the *actual bot total* (league's live human average) into 5 faux scorers
          const total = Math.max(0, Number(botTotal || 0));
          const names = ['Auto Striker', 'Mecha Playmaker', 'Cyber Winger', 'Robo Mid', 'Quantum Back'];
          const parts = [0.28,0.22,0.20,0.18,0.12];
          const list = parts.map((p, i) => ({ player_name: names[i], points_earned: Math.round(total * p) }));
          if (!cancelled) setRows(list);
        } else {
          const { start, end } = dayRange(date);
          const { data } = await supabase
            .from('games_records')
            .select('player_name, points_earned')
            .eq('user_id', participant.user_id)
            .gte('created_at', start)
            .lt('created_at', end)
            .order('points_earned', { ascending: false })
            .limit(10);
          if (!cancelled) setRows(data || []);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [participant.id, participant.is_bot, participant.user_id, date, botTotal]);

  return (
    <div className="rounded border bg-gray-50">
      <div className="px-3 py-2 bg-white border-b font-medium">{label}</div>
      <div className="p-3 space-y-2">
        {loading ? (
          <div className="text-center text-gray-500 text-sm">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-center text-gray-500 text-sm">No players recorded for this day.</div>
        ) : (
          rows.map((r, idx) => (
            <div key={`${r.player_name}-${idx}`} className="flex items-center justify-between text-sm">
              <div className="truncate">{r.player_name}</div>
              <div className="font-semibold">{r.points_earned}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
