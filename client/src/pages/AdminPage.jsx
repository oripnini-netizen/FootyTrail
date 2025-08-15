// client/src/pages/AdminPage.jsx
import React, { useEffect, useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { getLeagues, getSeasons } from '../api';
import { Filter, ShieldCheck } from 'lucide-react';

export default function AdminPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [groupedLeagues, setGroupedLeagues] = useState({});
  const [allSeasons, setAllSeasons] = useState([]);
  const [selectedLeagueIds, setSelectedLeagueIds] = useState([]);
  const [selectedSeasons, setSelectedSeasons] = useState([]);
  const [minApps, setMinApps] = useState(0);
  const [collapsed, setCollapsed] = useState(true);
  const [expandedCountries, setExpandedCountries] = useState({});
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState('');

  const leagueIdToLabel = useMemo(() => {
    const map = {};
    Object.entries(groupedLeagues || {}).forEach(([country, leagues]) => {
      (leagues || []).forEach((l) => {
        map[String(l.league_id)] = `${country} - ${l.league_name}`;
      });
    });
    return map;
  }, [groupedLeagues]);

  const toggleCountry = (country) => {
    setExpandedCountries(prev => ({ ...prev, [country]: !prev[country] }));
  };

  const handleTop10Leagues = () => {
    const top10Ids = ['39', '140', '78', '135', '61', '88', '94', '71', '128', '253'];
    setSelectedLeagueIds(prev => Array.from(new Set([...prev, ...top10Ids])));
  };

  const handleLast5Seasons = () => {
    setSelectedSeasons(allSeasons.slice(0, 5));
  };

  const clearLeagues = () => setSelectedLeagueIds([]);
  const clearSeasons = () => setSelectedSeasons([]);

  useEffect(() => {
    async function checkAdmin() {
      if (!user?.id) {
        setIsAdmin(false);
        setLoading(false);
        return;
      }
      const { data, error } = await supabase
        .from('users')
        .select('role')
        .eq('id', user.id)
        .single();
      setIsAdmin(!error && data?.role === 'admin');
      setLoading(false);
    }
    checkAdmin();
  }, [user]);

  useEffect(() => {
    async function loadFilters() {
      const leaguesRes = await getLeagues();
      setGroupedLeagues(leaguesRes.groupedByCountry || {});
      const seasonsRes = await getSeasons();
      setAllSeasons(seasonsRes.seasons || []);
    }
    loadFilters();
  }, []);

  if (loading) return <div className="p-8 text-center">Loading...</div>;
  if (!isAdmin) return <div className="p-8 text-center text-red-600">Access denied. Admins only.</div>;

  const handleDateChange = (e) => setDate(e.target.value);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus('Saving...');
    const { error } = await supabase
      .from('daily_challenge_settings')
      .upsert({
        id: 1,
        leagues: selectedLeagueIds,
        seasons: selectedSeasons,
        appearances: minApps
      });
    setStatus(error ? 'Error saving filters: ' + error.message : 'Filters saved!');
  };

  const handleGenerate = async () => {
    setStatus('Generating daily challenge...');
    const filters = { leagues: selectedLeagueIds, seasons: selectedSeasons, appearances: minApps };
    const res = await fetch(`/api/admin/generate-daily-challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, filters })
    });
    const result = await res.json();
    setStatus(result.success
      ? 'Daily challenge generated for ' + date
      : 'Error: ' + (result.error || 'Unknown error')
    );
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
        <h1 className="text-2xl font-bold mb-6 flex items-center gap-2">
          <ShieldCheck className="h-7 w-7 text-blue-600" /> Daily Challenge Admin
        </h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-xl shadow-md border bg-green-50/60 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Filter className="h-5 w-5 text-green-700" />
                <h3 className="text-lg font-semibold text-green-900">Difficulty Filters</h3>
              </div>
              <button
                className="text-gray-600 hover:text-gray-800"
                type="button"
                onClick={() => setCollapsed(c => !c)}
              >
                {collapsed ? <span>▼</span> : <span>▲</span>}
              </button>
            </div>
            {!collapsed && (
              <div className="mt-4 space-y-6">
                {/* Leagues Filter */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-green-900">Leagues Filter</span>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={handleTop10Leagues} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50">Top 10</button>
                      <button type="button" onClick={clearLeagues} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50">Clear</button>
                    </div>
                  </div>
                  <div className="max-h-96 overflow-y-auto pr-2">
                    {Object.entries(groupedLeagues).sort(([a], [b]) => a.localeCompare(b)).map(([country, leagues]) => (
                      <div key={country} className="mb-2">
                        <button onClick={e => { e.preventDefault(); toggleCountry(country); }} type="button" className="w-full flex items-center justify-between p-2 hover:bg-green-50 rounded">
                          <div className="flex items-center gap-2">
                            {leagues[0].country_flag && <img src={leagues[0].country_flag} alt={country} className="w-6 h-4 object-cover rounded" />}
                            <span>{country}</span>
                            <span className="text-xs text-gray-500">({leagues.length})</span>
                          </div>
                          {expandedCountries[country] ? <span>▲</span> : <span>▼</span>}
                        </button>
                        {expandedCountries[country] && (
                          <div className="ml-8 space-y-2 mt-2">
                            {leagues.map(league => (
                              <label key={league.league_id} className="flex items-center gap-2 cursor-pointer" onClick={e => e.stopPropagation()}>
                                <input type="checkbox" checked={selectedLeagueIds.includes(league.league_id)} onChange={() => setSelectedLeagueIds(prev => prev.includes(league.league_id) ? prev.filter(x => x !== league.league_id) : [...prev, league.league_id])} className="rounded" />
                                {league.logo && <img src={league.logo} alt={league.league_name} className="w-5 h-5 object-contain" />}
                                <span className="text-sm">{league.league_name}</span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
                {/* Seasons Filter */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
                  <div className="md:col-span-2">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-green-900">Season Filter</span>
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={handleLast5Seasons} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50">Last 5</button>
                        <button type="button" onClick={clearSeasons} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50">Clear</button>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mt-2">
                      {allSeasons.map(season => (
                        <button key={season} type="button" onClick={() => setSelectedSeasons(prev => prev.includes(season) ? prev.filter(s => s !== season) : [...prev, season])} className={['px-2 py-1 text-sm rounded-md border', selectedSeasons.includes(season) ? 'bg-green-100 border-green-500 text-green-700' : 'bg-white hover:bg-gray-50'].join(' ')}>{season}</button>
                      ))}
                    </div>
                  </div>
                  {/* Minimum Appearances */}
                  <div className="flex flex-col items-center">
                    <span className="font-medium text-green-900 mb-2">Minimum Appearances</span>
                    <input type="number" value={minApps} onChange={e => setMinApps(parseInt(e.target.value) || 0)} min="0" max="100" className="w-full px-3 py-2 border rounded-md text-center" />
                    <div className="text-xs text-gray-500 text-center mt-1">Minimum appearances in a season</div>
                  </div>
                </div>
              </div>
            )}
          </div>
          <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded mt-4">Save Default Filters</button>
        </form>
        <hr className="my-6" />
        <div className="mb-4">
          <label className="block font-medium mb-1">Select Date</label>
          <input type="date" value={date} onChange={handleDateChange} className="border rounded px-3 py-2" />
        </div>
        <button onClick={handleGenerate} className="bg-green-600 text-white px-4 py-2 rounded">Generate Daily Challenge</button>
        {status && <div className="mt-4 text-center text-sm text-gray-700">{status}</div>}
      </motion.div>
    </div>
  );
}
