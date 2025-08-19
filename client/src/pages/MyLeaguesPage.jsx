// client/src/pages/MyLeaguesPage.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabase';
import { useAuth } from '../context/AuthContext';
import {
  Plus,
  Users,
  CalendarDays,
  Flag,
  ChevronDown,
  ChevronUp,
  X,
  User as UserIcon,
  Bell,
} from 'lucide-react';

/* =========================================================
   Time helpers — use a single universal UTC+2 day boundary
   =======================================================*/
const TZ_OFFSET_MIN = 120; // UTC+2

function toUtcPlus2Midnight(dateLike) {
  const d =
    typeof dateLike === 'string'
      ? new Date(`${dateLike}T00:00:00.000Z`)
      : new Date(dateLike);
  const utcMid = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  return new Date(utcMid.getTime() + TZ_OFFSET_MIN * 60 * 1000);
}
function todayUtcPlus2Midnight() {
  const now = new Date();
  const utcMid = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return new Date(utcMid.getTime() + TZ_OFFSET_MIN * 60 * 1000);
}
function dayRangeUtcPlus2(dateStr) {
  const start = toUtcPlus2Midnight(dateStr);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}
const tomorrowStr = (() => {
  const t = todayUtcPlus2Midnight();
  const plus1 = new Date(t.getTime() + 24 * 60 * 60 * 1000);
  return plus1.toISOString().slice(0, 10);
})();

const fmtShort = (d) =>
  new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

const byDateAsc = (a, b) => new Date(a.match_date) - new Date(b.match_date);
const displayName = (p) => (p.is_bot ? p.display_name : p.user?.full_name || 'Unknown');
const keyDP = (m, p) => `${m.league_id}|${m.match_date}|${p.id}`;

/* =========================================================
   Live standings from “today’s totals” (games_records)
   =======================================================*/
function computeStandings(participants, matches, dayPointsMap) {
  const stats = new Map();
  const ensure = (pid, name, isBot) => {
    if (!stats.has(pid)) {
      stats.set(pid, { pid, name, isBot, P: 0, W: 0, D: 0, L: 0, PTS: 0 });
    }
    return stats.get(pid);
  };

  const today0 = todayUtcPlus2Midnight();

  matches
    .filter((m) => new Date(m.match_date) <= today0) // include today (live)
    .forEach((m) => {
      const home = participants.find((p) => p.id === m.home_participant_id);
      const away = participants.find((p) => p.id === m.away_participant_id);
      if (!home || !away) return;

      const homePts = dayPointsMap.get(keyDP(m, home)) ?? 0;
      const awayPts = dayPointsMap.get(keyDP(m, away)) ?? 0;

      const A = ensure(home.id, displayName(home), home.is_bot);
      const B = ensure(away.id, displayName(away), away.is_bot);

      A.P += 1;
      B.P += 1;
      if (homePts > awayPts) {
        A.W += 1;
        A.PTS += 3;
        B.L += 1;
      } else if (homePts < awayPts) {
        B.W += 1;
        B.PTS += 3;
        A.L += 1;
      } else {
        A.D += 1;
        B.D += 1;
        A.PTS += 1;
        B.PTS += 1;
      }
    });

  // ensure everyone is present
  participants.forEach((p) => ensure(p.id, displayName(p), p.is_bot));

  return Array.from(stats.values()).sort(
    (a, b) => b.PTS - a.PTS || b.W - a.W || a.L - b.L || a.name.localeCompare(b.name)
  );
}

/* =========================================================
   Fun bot names
   =======================================================*/
const BOT_PREFIX = [
  'Robo',
  'Auto',
  'Mecha',
  'Cyber',
  'Quantum',
  'Galacto',
  'Vector',
  'Atlas',
  'Proto',
  'Machine',
];
const BOT_SUFFIX = [
  'United',
  'FC',
  'Athletic',
  'Calcio',
  'City',
  'Town',
  'Dynamos',
  'Wanderers',
  'Botos',
  'Botlandia',
  'Robotics',
];
const randomBotName = () =>
  `${BOT_PREFIX[Math.floor(Math.random() * BOT_PREFIX.length)]} ${
    BOT_SUFFIX[Math.floor(Math.random() * BOT_SUFFIX.length)]
  }`;

/* =========================================================
   Page
   =======================================================*/
export default function MyLeaguesPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState('Active');
  const [loading, setLoading] = useState(true);
  const [leagues, setLeagues] = useState([]); // [{ league, creatorUser, participants, matches }]

  // NEW: notifications banner (load once, then mark as read)
  const [notifBanner, setNotifBanner] = useState([]); // store rows to display

  // live refresh for coloring/standings
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 20000);
    return () => clearInterval(id);
  }, []);

  // Modal for user quick profile (same look as Leaderboard)
  const [modalUser, setModalUser] = useState(null);

  // Create League modal state
  const [openCreate, setOpenCreate] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [startDate, setStartDate] = useState(tomorrowStr);
  const [searchEmail, setSearchEmail] = useState('');
  const [emailResults, setEmailResults] = useState([]);
  const [invites, setInvites] = useState([]); // {id, email, full_name}

  // Load NOTIFICATIONS (unread) once on first visit, then mark read
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    async function loadAndMark() {
      // 1) load unread
      const { data: unread } = await supabase
        .from('notifications')
        .select('id, payload, created_at')
        .eq('user_id', user.id)
        .eq('type', 'league_invite')
        .is('read_at', null)
        .order('created_at', { ascending: false });

      if (!cancelled && unread?.length) {
        // keep a copy for the banner before marking as read
        setNotifBanner(
          unread.map((n) => ({
            id: n.id,
            created_at: n.created_at,
            ...n.payload,
          }))
        );

        // 2) mark as read (fire & forget)
        const ids = unread.map((n) => n.id);
        await supabase
          .from('notifications')
          .update({ read_at: new Date().toISOString() })
          .in('id', ids);

        // 3) ping navbar to refresh dot immediately
        window.dispatchEvent(new Event('leagues-notifications-read'));
      }
    }
    loadAndMark();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // Load all leagues where I participate
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

        const leagueIds = [...new Set((myParts || []).map((p) => p.league_id))];
        if (!leagueIds.length) {
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

        // fetch all relevant users (participants + creators)
        let userIds = parts?.filter((p) => p.user_id).map((p) => p.user_id) || [];
        const creatorIds = leaguesData.map((l) => l.creator_id).filter(Boolean);
        userIds = [...new Set([...userIds, ...creatorIds])];

        const userMap = new Map();
        if (userIds.length) {
          const { data: usersRows } = await supabase
            .from('users')
            .select('id, full_name, profile_photo_url, email, created_at')
            .in('id', userIds);
          (usersRows || []).forEach((u) => userMap.set(u.id, u));
        }

        const participantsHydrated =
          parts?.map((p) => ({ ...p, user: p.user_id ? userMap.get(p.user_id) : null })) || [];

        const { data: matches, error: e4 } = await supabase
          .from('league_matches')
          .select('*')
          .in('league_id', leagueIds);
        if (e4) throw e4;

        const grouped = leagueIds.map((id) => ({
          league: leaguesData.find((l) => l.id === id),
          creatorUser: userMap.get(leaguesData.find((l) => l.id === id)?.creator_id),
          participants: participantsHydrated.filter((p) => p.league_id === id),
          matches: (matches || []).filter((m) => m.league_id === id).sort(byDateAsc),
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
  }, [user?.id]);

  // Email search (exclude me)
  useEffect(() => {
    let active = true;
    const t = setTimeout(async () => {
      const q = (searchEmail || '').trim();
      if (!q || q.length < 2) {
        if (active) setEmailResults([]);
        return;
      }
      const { data } = await supabase
        .from('users')
        .select('id, email, full_name')
        .ilike('email', `%${q}%`)
        .limit(10);
      const filtered = (data || []).filter((u) => u.id !== user?.id);
      if (active) setEmailResults(filtered);
    }, 250);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [searchEmail, user?.id]);

  // Tab buckets by status using UTC+2
  const classified = useMemo(() => {
    const out = { Scheduled: [], Active: [], Ended: [] };
    const today0 = todayUtcPlus2Midnight();

    for (const L of leagues) {
      const start = toUtcPlus2Midnight(L.league.start_date);
      const last = L.matches.length
        ? toUtcPlus2Midnight(L.matches[L.matches.length - 1].match_date)
        : start;

      const key = start > today0 ? 'Scheduled' : last < today0 ? 'Ended' : 'Active';
      out[key].push(L);
    }
    return out;
  }, [leagues]);

  const counts = useMemo(
    () => ({
      Active: classified.Active.length,
      Scheduled: classified.Scheduled.length,
      Ended: classified.Ended.length,
    }),
    [classified]
  );

  // Live day totals map for standings & fixtures
  const [dayPoints, setDayPoints] = useState(new Map());
  useEffect(() => {
    let cancelled = false;
    async function compute() {
      const map = new Map();
      for (const L of leagues) {
        const { league, participants, matches } = L;
        const dates = [...new Set(matches.map((m) => m.match_date))];

        for (const d of dates) {
          const { start, end } = dayRangeUtcPlus2(d);
          const humans = participants.filter((p) => !p.is_bot);
          const humanIds = humans.map((h) => h.user_id).filter(Boolean);

          let byUser = new Map();
          if (humanIds.length) {
            const { data: records } = await supabase
              .from('games_records')
              .select('user_id, points_earned')
              .in('user_id', humanIds)
              .gte('created_at', start)
              .lt('created_at', end);
            byUser = new Map();
            (records || []).forEach((r) => {
              byUser.set(r.user_id, (byUser.get(r.user_id) || 0) + (r.points_earned || 0));
            });
          }

          const sumHumans = humans.reduce((s, h) => s + (byUser.get(h.user_id) || 0), 0);
          const avgHuman = humans.length ? Math.round(sumHumans / humans.length) : 0;

          participants.forEach((p) => {
            const total = p.is_bot ? avgHuman : byUser.get(p.user_id) || 0;
            map.set(keyDP({ league_id: league.id, match_date: d }, p), total);
          });
        }
      }
      if (!cancelled) setDayPoints(map);
    }
    if (leagues.length) compute();
  }, [leagues, tick]);

  // Invite management
  const addInvite = (u) => {
    if (!u || u.id === user?.id) return;
    if (invites.find((x) => x.id === u.id)) return;
    setInvites((prev) => [...prev, u]);
    setSearchEmail('');
    setEmailResults([]);
  };
  const removeInvite = (id) => setInvites((prev) => prev.filter((x) => x.id !== id));

  // 2–20 including creator; if odd, bot is added
  const totalChosen = 1 + invites.length;
  const totalIfOdd = totalChosen % 2 === 1 ? totalChosen + 1 : totalChosen;
  const withinLimits = totalIfOdd >= 2 && totalIfOdd <= 20;
  const canCreate = name.trim() && startDate && withinLimits;

  const onCreateLeague = async () => {
    if (!user?.id || !canCreate) return;

    let people = [
      {
        id: user.id,
        email: user.email,
        full_name:
          user.user_metadata?.full_name || user.full_name || 'You',
      },
      ...invites,
    ];

    if (people.length % 2 === 1) {
      people.push({ id: null, email: null, full_name: randomBotName(), is_bot: true });
    }

    const { data: leagueRow, error: e1 } = await supabase
      .from('leagues')
      .insert([{ name: name.trim(), description: desc || null, creator_id: user.id, start_date: startDate }])
      .select()
      .single();
    if (e1) {
      console.error(e1);
      return;
    }

    const partsPayload = people.map((p) => ({
      league_id: leagueRow.id,
      user_id: p.is_bot ? null : p.id,
      is_bot: !!p.is_bot,
      display_name: p.is_bot ? p.full_name : null,
    }));
    const { data: parts, error: e2 } = await supabase
      .from('league_participants')
      .insert(partsPayload)
      .select();
    if (e2) {
      console.error(e2);
      return;
    }

    // Round-robin double fixtures
    const partIds = parts.map((p) => p.id);
    const rounds = generateDoubleRoundRobin(partIds);
    const start = toUtcPlus2Midnight(startDate);
    const matchesPayload = [];
    rounds.forEach((round, idx) => {
      const date = new Date(start.getTime() + idx * 24 * 60 * 60 * 1000);
      round.pairs.forEach((pair) => {
        matchesPayload.push({
          league_id: leagueRow.id,
          match_day: round.match_day,
          match_date: date.toISOString().slice(0, 10),
          home_participant_id: pair.home,
          away_participant_id: pair.away,
        });
      });
    });
    const { error: e3 } = await supabase.from('league_matches').insert(matchesPayload);
    if (e3) {
      console.error(e3);
      return;
    }

    // Notifications
    const invitedHumans = invites.filter((i) => !!i.id && i.id !== user.id);
    if (invitedHumans.length) {
      const payloads = invitedHumans.map((uRow) => ({
        user_id: uRow.id,
        type: 'league_invite',
        payload: {
          league_id: leagueRow.id,
          league_name: leagueRow.name,
          start_date: leagueRow.start_date,
          creator_name:
            user.user_metadata?.full_name ||
            user.full_name ||
            user.email ||
            'A user',
          description: leagueRow.description || '',
        },
      }));
      await supabase.from('notifications').insert(payloads);
    }

    // reset modal state & quick refresh
    setOpenCreate(false);
    setName('');
    setDesc('');
    setInvites([]);
    setStartDate(tomorrowStr);

    const { data: myParts } = await supabase
      .from('league_participants')
      .select('league_id')
      .eq('user_id', user.id);
    const ids = [...new Set((myParts || []).map((p) => p.league_id))];
    if (!ids.length) return;

    const { data: leaguesData } = await supabase.from('leagues').select('*').in('id', ids);
    const { data: parts2 } = await supabase
      .from('league_participants')
      .select('id, league_id, user_id, is_bot, display_name')
      .in('league_id', ids);

    let userIds = parts2?.filter((p) => p.user_id).map((p) => p.user_id) || [];
    const creatorIds = leaguesData.map((l) => l.creator_id).filter(Boolean);
    userIds = [...new Set([...userIds, ...creatorIds])];

    const umap = new Map();
    if (userIds.length) {
      const { data: usersRows } = await supabase
        .from('users')
        .select('id, full_name, profile_photo_url, email, created_at')
        .in('id', userIds);
      (usersRows || []).forEach((u) => umap.set(u.id, u));
    }

    const partsHydrated =
      parts2?.map((p) => ({ ...p, user: p.user_id ? umap.get(p.user_id) : null })) || [];
    const { data: matches } = await supabase.from('league_matches').select('*').in('league_id', ids);

    const grouped = ids.map((id) => ({
      league: leaguesData.find((l) => l.id === id),
      creatorUser: umap.get(leaguesData.find((l) => l.id === id)?.creator_id),
      participants: partsHydrated.filter((p) => p.league_id === id),
      matches: (matches || []).filter((m) => m.league_id === id).sort(byDateAsc),
    }));
    setLeagues(grouped);
  };

  const currentList =
    tab === 'Active' ? classified.Active : tab === 'Scheduled' ? classified.Scheduled : classified.Ended;

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-green-50 to-transparent">
      <div className="fixed inset-0 -z-10 bg-gradient-to-b from-green-50 to-transparent" />
      <div className="container mx-auto py-8 px-4 max-w-6xl">
        <h1 className="text-4xl font-extrabold text-center text-green-800">My Leagues</h1>
        <p className="text-center text-gray-600 mt-2">
          Compete with friends and track your progress in exciting football leagues
        </p>

        {/* Notifications banner (only if there were new unread on first visit) */}
        {notifBanner.length > 0 && (
          <div className="mt-6 rounded-xl border bg-amber-50 px-4 py-3 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 h-8 w-8 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center">
                <Bell className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <div className="font-semibold text-amber-900 mb-1">Notifications</div>
                <ul className="space-y-1">
                  {notifBanner.map((n) => (
                    <li key={n.id} className="text-sm text-amber-900">
                      You were added to <span className="font-medium">{n.league_name}</span> by{' '}
                      <span className="font-medium">{n.creator_name}</span>
                      {n.start_date ? (
                        <>
                          {' '}— starts <span className="font-medium">
                            {new Date(n.start_date).toLocaleDateString()}
                          </span>
                        </>
                      ) : null}
                      {n.description ? <> — “{n.description}”</> : null}
                      {n.league_id ? (
                        <>
                          {' '}•{' '}
                          <a
                            href={`#league-${n.league_id}`}
                            className="text-amber-800 underline decoration-dotted hover:decoration-solid"
                          >
                            jump to league
                          </a>
                        </>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-center mt-6">
          <button
            onClick={() => setOpenCreate(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-green-700 text-white rounded-lg hover:bg-green-800"
          >
            <Plus className="h-5 w-5" />
            Create New League
          </button>
        </div>

        {/* Tabs with counts */}
        <div className="flex items-center justify-center gap-2 bg-white/70 rounded-full px-2 py-1 w-fit mx-auto my-5 shadow-sm">
          {['Active', 'Scheduled', 'Ended'].map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium ${
                tab === t ? 'bg-green-700 text-white' : 'bg-white text-gray-700 border'
              }`}
            >
              {t} <span className="ml-1 text-xs opacity-80">({counts[t] || 0})</span>
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center my-12">
            <div className="h-10 w-10 rounded-full border-b-2 border-green-700 animate-spin" />
          </div>
        ) : currentList.length === 0 ? (
          <div className="text-center mt-16">
            <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-green-100 flex items-center justify-center">
              <CalendarDays className="h-8 w-8 text-green-700" />
            </div>
            <div className="text-xl font-semibold">No leagues found</div>
            <p className="text-gray-600">Create your first league or wait to be invited!</p>
          </div>
        ) : (
          <div className="space-y-6 mt-6">
            {currentList.map((L) => (
              <LeagueCard
                key={L.league.id}
                anchorId={`league-${L.league.id}`}
                league={L.league}
                creatorUser={L.creatorUser}
                participants={L.participants}
                matches={L.matches}
                dayPoints={dayPoints}
                onOpenUser={(u) => setModalUser(u)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create League Modal */}
      {openCreate && (
        <CreateLeagueModal
          onClose={() => setOpenCreate(false)}
          name={name}
          setName={setName}
          desc={desc}
          setDesc={setDesc}
          startDate={startDate}
          setStartDate={setStartDate}
          searchEmail={searchEmail}
          setSearchEmail={setSearchEmail}
          emailResults={emailResults}
          invites={invites}
          addInvite={addInvite}
          removeInvite={removeInvite}
          withinLimits={withinLimits}
          totalChosen={totalChosen}
          totalIfOdd={totalIfOdd}
          canCreate={canCreate}
          onCreate={onCreateLeague}
        />
      )}

      {/* User modal styled like Leaderboard */}
      {modalUser && <UserStatsModal user={modalUser} onClose={() => setModalUser(null)} />}
    </div>
  );
}

/* =========================================================
   Subcomponents
   =======================================================*/
function StatTile({ icon: Icon, label, value }) {
  return (
    <div className="bg-white rounded-lg border shadow-sm px-4 py-3 flex items-center gap-3">
      <div className="h-8 w-8 rounded-full bg-green-50 text-green-700 flex items-center justify-center">
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <div className="text-xs text-gray-500">{label}</div>
        <div className="text-base font-semibold text-gray-800">{value}</div>
      </div>
    </div>
  );
}

function LeagueCard({ anchorId, league, creatorUser, participants, matches, dayPoints, onOpenUser }) {
  const [collapsed, setCollapsed] = useState(false);

  const participantsById = useMemo(() => {
    const map = new Map();
    participants.forEach((p) => map.set(p.id, p));
    return map;
  }, [participants]);

  const standings = useMemo(
    () => computeStandings(participants, matches, dayPoints),
    [participants, matches, dayPoints]
  );

  const creatorName =
    creatorUser?.full_name || creatorUser?.email || (league.creator_id?.slice(0, 8) + '…');

  return (
    <div id={anchorId} className="rounded-2xl border bg-white shadow-sm overflow-hidden">
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-green-50 hover:bg-green-100 transition"
      >
        <div className="text-left">
          <div className="text-xl font-bold text-gray-900">{league.name}</div>
          {league.description ? (
            <div className="text-sm text-gray-600 mt-0.5">{league.description}</div>
          ) : null}
        </div>
        {collapsed ? (
          <ChevronDown className="h-5 w-5 text-green-800" />
        ) : (
          <ChevronUp className="h-5 w-5 text-green-800" />
        )}
      </button>

      {!collapsed && (
        <div className="p-4 md:p-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatTile icon={Users} label="Players" value={participants.length} />
            <StatTile
              icon={CalendarDays} // changed from Trophy
              label="Match Days"
              value={new Set(matches.map((m) => m.match_day)).size}
            />
            <StatTile
              icon={CalendarDays}
              label="Start Date"
              value={fmtShort(league.start_date)}
            />
            <StatTile
              icon={Flag}
              label="End Date"
              value={
                matches.length
                  ? fmtShort(matches[matches.length - 1].match_date)
                  : fmtShort(league.start_date)
              }
            />
          </div>

          <div className="mt-3 text-sm text-blue-900 bg-blue-50 border border-blue-100 rounded px-3 py-2 flex items-center gap-2">
            <UserIcon className="h-4 w-4" />
            <span>
              <span className="opacity-70">Created by:</span>{' '}
              <span className="font-medium">{creatorName}</span>
            </span>
          </div>

          {/* Two-column layout: Table (left) and Fixtures (right) */}
          <div className="mt-5 grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="rounded-xl border bg-white shadow-sm">
              <div className="px-4 py-3 border-b font-semibold">League Table</div>
              <div className="p-4">
                <LeagueTable
                  standings={standings}
                  participants={participants}
                  onOpenUser={onOpenUser}
                />
              </div>
            </div>

            <div className="rounded-xl border bg-white shadow-sm">
              <div className="px-4 py-3 border-b font-semibold">Fixtures & Results</div>
              <div className="p-4">
                <FixturesList
                  league={league}
                  matches={matches}
                  participantsById={participantsById}
                  dayPoints={dayPoints}
                  onOpenUser={onOpenUser}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LeagueTable({ standings, participants, onOpenUser }) {
  const findUser = (pid) => {
    const p = participants.find((x) => x.id === pid);
    if (!p) return {};
    return {
      name: p.is_bot ? p.display_name : p.user?.full_name || 'Unknown',
      isBot: !!p.is_bot,
      userRow: p.user || null,
    };
  };
  return (
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
                <td className="px-3 py-2">{i + 1}</td>
                <td className="px-3 py-2">
                  {u.isBot ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-purple-100 text-purple-700 text-xs">
                        B
                      </span>
                      <span className="font-medium">{u.name}</span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => u.userRow && onOpenUser(u.userRow)}
                      className="font-medium text-green-700 hover:text-green-800"
                      style={{ textDecoration: 'none' }}
                    >
                      {u.name}
                    </button>
                  )}
                </td>
                <td className="px-3 py-2 text-center">{s.P}</td>
                <td className="px-3 py-2 text-center text-green-700 font-semibold">{s.W}</td>
                <td className="px-3 py-2 text-center">{s.D}</td>
                <td className="px-3 py-2 text-center text-red-700 font-semibold">{s.L}</td>
                <td className="px-3 py-2 text-right font-bold">{s.PTS}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* =========================================================
   Fixtures: grouped by day; each MATCH is collapsible
   =======================================================*/
function FixturesList({ league, matches, participantsById, dayPoints, onOpenUser }) {
  const grouped = useMemo(() => {
    const m = new Map();
    matches.forEach((mt) => {
      const key = `${mt.match_day}|${mt.match_date}`;
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(mt);
    });
    return Array.from(m.entries())
      .map(([key, arr]) => {
        const [md, dt] = key.split('|');
        return {
          match_day: Number(md),
          match_date: dt,
          items: arr.sort((a, b) => a.id.localeCompare(b.id)),
        };
      })
      .sort((a, b) => new Date(a.match_date) - new Date(b.match_date));
  }, [matches]);

  return (
    <div className="space-y-4">
      {grouped.map((group) => (
        <FixtureDay
          key={`${group.match_day}-${group.match_date}`}
          league={league}
          group={group}
          participantsById={participantsById}
          dayPoints={dayPoints}
          onOpenUser={onOpenUser}
        />
      ))}
    </div>
  );
}

function NameButton({ children, onClick, disabled, alignRight }) {
  const content = <span className="font-medium text-gray-900">{children}</span>;
  return disabled ? (
    <div className={`flex items-center ${alignRight ? 'justify-end' : ''}`}>{content}</div>
  ) : (
    <button
      type="button"
      className={`flex items-center ${alignRight ? 'justify-end' : ''} text-green-700 hover:text-green-800`}
      onClick={onClick}
      style={{ textDecoration: 'none' }}
    >
      {content}
    </button>
  );
}

function FixtureDay({ league, group, participantsById, dayPoints, onOpenUser }) {
  const today0 = todayUtcPlus2Midnight();
  const matchDate0 = toUtcPlus2Midnight(group.match_date);
  const isFuture = matchDate0 > today0;

  return (
    <div className="rounded-xl border overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b">
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
            Match Day {group.match_day}
          </span>
          <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
            {fmtShort(group.match_date)}
          </span>
        </div>
      </div>

      <div className="divide-y">
        {group.items.map((item) => {
          const H = participantsById.get(item.home_participant_id);
          const A = participantsById.get(item.away_participant_id);
          const hName = displayName(H);
          const aName = displayName(A);

          const homePts =
            dayPoints.get(keyDP({ league_id: league.id, match_date: group.match_date }, H)) ?? 0;
          const awayPts =
            dayPoints.get(keyDP({ league_id: league.id, match_date: group.match_date }, A)) ?? 0;

          let homeCls = 'text-gray-700',
            awayCls = 'text-gray-700';
          if (!isFuture) {
            if (homePts === awayPts) {
              homeCls = 'text-yellow-600 font-semibold';
              awayCls = 'text-yellow-600 font-semibold';
            } else if (homePts > awayPts) {
              homeCls = 'text-green-700 font-semibold';
              awayCls = 'text-red-700 font-semibold';
            } else {
              homeCls = 'text-red-700 font-semibold';
              awayCls = 'text-green-700 font-semibold';
            }
          }

          return (
            <MatchCollapsible
              key={item.id}
              titleRow={
                <div className="grid grid-cols-3 items-center gap-3">
                  {/* Home name */}
                  <NameButton
                    disabled={!!H.is_bot}
                    onClick={() => H.user && onOpenUser(H.user)}
                  >
                    {hName}
                  </NameButton>

                  {/* Center score/upcoming */}
                  <div className="flex items-center justify-center">
                    {isFuture ? (
                      <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-700 text-sm">
                        Upcoming
                      </span>
                    ) : (
                      <div className="flex items-center gap-3 text-sm text-gray-700">
                        <span className={`min-w-[60px] text-center ${homeCls}`}>
                          {homePts.toLocaleString()}
                        </span>
                        <span className="text-gray-400">-</span>
                        <span className={`min-w-[60px] text-center ${awayCls}`}>
                          {awayPts.toLocaleString()}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Away name */}
                  <NameButton
                    disabled={!!A.is_bot}
                    onClick={() => A.user && onOpenUser(A.user)}
                    alignRight
                  >
                    {aName}
                  </NameButton>
                </div>
              }
              body={
                !isFuture && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                    <PlayersBreakdown
                      label={hName}
                      participant={H}
                      date={group.match_date}
                      botTotal={H.is_bot ? homePts : null}
                    />
                    <PlayersBreakdown
                      label={aName}
                      participant={A}
                      date={group.match_date}
                      botTotal={A.is_bot ? awayPts : null}
                    />
                  </div>
                )
              }
            />
          );
        })}
      </div>
    </div>
  );
}

function MatchCollapsible({ titleRow, body }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="p-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full rounded-lg border hover:bg-gray-50 transition"
      >
        <div className="px-3 py-2">
          {titleRow}
          <div className="flex items-center justify-center">
            {open ? (
              <ChevronUp className="h-4 w-4 text-gray-500 mt-1" />
            ) : (
              <ChevronDown className="h-4 w-4 text-gray-500 mt-1" />
            )}
          </div>
        </div>
      </button>
      {open && body}
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
          const total = Math.max(0, Number(botTotal || 0));
          const names = ['Auto Striker', 'Mecha Playmaker', 'Cyber Winger', 'Robo Mid', 'Quantum Back'];
          const parts = [0.28, 0.22, 0.2, 0.18, 0.12];
          const list = parts.map((p, i) => ({
            player_name: names[i],
            points_earned: Math.round(total * p),
          }));
          if (!cancelled) setRows(list);
        } else {
          const { start, end } = dayRangeUtcPlus2(date);
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
    return () => {
      cancelled = true;
    };
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

/* =========================================================
   Create League Modal
   =======================================================*/
function CreateLeagueModal(props) {
  const {
    onClose,
    name,
    setName,
    desc,
    setDesc,
    startDate,
    setStartDate,
    searchEmail,
    setSearchEmail,
    emailResults,
    invites,
    addInvite,
    removeInvite,
    withinLimits,
    totalChosen,
    totalIfOdd,
    canCreate,
    onCreate,
  } = props;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-white rounded-xl shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="text-lg font-semibold">Create a New League</div>
          <button className="p-1 rounded-full hover:bg-gray-100" onClick={onClose}>
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
                placeholder="Search email…"
                value={searchEmail}
                onChange={(e) => setSearchEmail(e.target.value)}
              />
              <button className="px-3 py-2 rounded bg-gray-100 text-gray-700" type="button" disabled>
                Search
              </button>
            </div>
            {!!emailResults.length && (
              <ul className="border rounded mt-2 max-h-40 overflow-auto">
                {emailResults.map((u) => (
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
                {invites.map((i) => (
                  <span
                    key={i.id}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-green-100 text-green-800 text-sm"
                  >
                    {i.full_name || i.email}
                    <button onClick={() => removeInvite(i.id)} className="ml-1 text-green-900 hover:opacity-70">
                      ×
                    </button>
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

          <div className="text-sm text-gray-700">
            <strong>Selected (incl. you):</strong> {totalChosen} →{' '}
            {totalChosen % 2 === 1 ? `${totalIfOdd} with bot` : `${totalIfOdd}`}
            {withinLimits ? (
              <span className="ml-2 text-green-700 font-medium">OK</span>
            ) : (
              <span className="ml-2 text-red-700 font-medium">Must be between 2 and 20</span>
            )}
          </div>

          <div className="pt-2">
            <button
              onClick={onCreate}
              disabled={!canCreate}
              className={`w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded ${
                canCreate ? 'bg-green-700 text-white hover:bg-green-800' : 'bg-gray-300 text-gray-600'
              }`}
            >
              <Plus className="h-5 w-5" />
              Create League
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   User modal — match Leaderboard look & behavior
   =======================================================*/
function UserStatsModal({ user, onClose }) {
  const [recent, setRecent] = useState([]);
  const [stats, setStats] = useState({ totalPoints: 0, games: 0, avgTime: 0, successRate: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        // recent 20
        const { data: games } = await supabase
          .from('games_records')
          .select(
            'id, player_name, won, points_earned, time_taken_seconds, guesses_attempted, created_at, is_daily_challenge'
          )
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(20);
        if (!cancelled) setRecent(games || []);

        // all games for totals
        const { data: allGames } = await supabase
          .from('games_records')
          .select('won, points_earned, time_taken_seconds')
          .eq('user_id', user.id);

        const total = allGames?.length || 0;
        const pts = (allGames || []).reduce((s, g) => s + (g.points_earned || 0), 0);
        const wins = (allGames || []).filter((g) => g.won).length;
        const time = (allGames || []).reduce((s, g) => s + (g.time_taken_seconds || 0), 0);

        if (!cancelled)
          setStats({
            totalPoints: pts,
            games: total,
            avgTime: total ? Math.round(time / total) : 0,
            successRate: total ? Math.round((wins / total) * 100) : 0,
          });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [user.id]);

  const memberSince = user.created_at
    ? new Date(user.created_at).toLocaleDateString()
    : 'Unknown';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-3">
            {user.profile_photo_url ? (
              <img
                src={user.profile_photo_url}
                alt=""
                className="h-10 w-10 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100 text-green-800">
                {(user.full_name || user.email || '?')[0]}
              </div>
            )}
            <div>
              <div className="font-semibold">{user.full_name || user.email}</div>
              <div className="text-xs text-gray-500">Member since {memberSince}</div>
            </div>
          </div>
          <button className="rounded-full p-1 hover:bg-gray-100" onClick={onClose}>
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Stats tiles */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4">
          <div className="rounded border p-3 text-center">
            <div className="text-xs text-gray-500">Total Points</div>
            <div className="text-lg font-semibold text-green-700">
              {stats.totalPoints?.toLocaleString?.() || 0}
            </div>
          </div>
          <div className="rounded border p-3 text-center">
            <div className="text-xs text-gray-500">Games</div>
            <div className="text-lg font-semibold">{stats.games || 0}</div>
          </div>
          <div className="rounded border p-3 text-center">
            <div className="text-xs text-gray-500">Avg Time</div>
            <div className="text-lg font-semibold">{stats.avgTime || 0}s</div>
          </div>
          <div className="rounded border p-3 text-center">
            <div className="text-xs text-gray-500">Success</div>
            <div className="text-lg font-semibold">{stats.successRate || 0}%</div>
          </div>
        </div>

        {/* Recent 20 list (scroll) */}
        <div className="max-h-96 overflow-y-auto px-4 pb-4">
          {loading ? (
            <div className="flex h-32 items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-green-700" />
            </div>
          ) : recent.length === 0 ? (
            <div className="p-6 text-center text-gray-500">No recent games.</div>
          ) : (
            <div className="space-y-3">
              {recent.map((g) => (
                <div key={g.id} className="rounded border p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div
                        className={`font-medium ${
                          g.is_daily_challenge ? 'text-yellow-600 font-semibold' : ''
                        }`}
                      >
                        {g.player_name || 'Unknown Player'}
                        {g.is_daily_challenge && (
                          <span className="ml-2 text-xs text-yellow-700">(Daily)</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500">
                        {new Date(g.created_at).toLocaleString()}
                      </div>
                    </div>
                    <div className="text-right">
                      <div
                        className={`font-semibold ${
                          g.won ? 'text-green-600' : 'text-red-600'
                        }`}
                      >
                        {g.won ? `+${g.points_earned}` : '0'} pts
                      </div>
                      <div className="text-xs text-gray-500">
                        {g.guesses_attempted} {g.guesses_attempted === 1 ? 'guess' : 'guesses'}
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
  );
}

/* =========================================================
   Double round-robin pairings
   =======================================================*/
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
    pairs: r.pairs.map((p) => ({ home: p.away, away: p.home })),
  }));
  return [...rounds, ...secondLeg];
}
