// client/src/pages/AdminPage.jsx
import React, { useEffect, useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { getCompetitions, getSeasons, generateDailyChallenge } from '../api';
import {
  Filter,
  ShieldCheck,
  Trash2,
  UsersRound,
  ChevronDown,
  ChevronUp,
  Star,
  CheckSquare,
  CalendarClock
} from 'lucide-react';

function classNames(...s) {
  return s.filter(Boolean).join(' ');
}

function Section({ title, icon, collapsed, onToggle, actions, children }) {
  // Header actions don't toggle collapse.
  return (
    <div className="rounded-lg border bg-white/60">
      <div className="flex items-center justify-between px-3 py-2">
        <button type="button" onClick={onToggle} className="inline-flex items-center gap-2">
          {icon}
          <span className="font-medium text-green-900">{title}</span>
          {collapsed ? <ChevronDown className="h-4 w-4 ml-1" /> : <ChevronUp className="h-4 w-4 ml-1" />}
        </button>
        <div className="flex items-center gap-2">{actions}</div>
      </div>
      {!collapsed && <div className="p-3 pt-0">{children}</div>}
    </div>
  );
}

const SelectedChips = ({ title, items, onClear, getLabel, onRemoveItem, hoverClose = false }) => {
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
                'group relative inline-flex items-center gap-2 px-2 py-1 rounded-full text-xs bg-green-100 text-green-800',
                hoverClose && 'pr-6'
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
        <button type="button" onClick={onClear} className="text-xs text-gray-600 underline hover:text-gray-800">
          Clear
        </button>
      </div>
    </div>
  );
};

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
        'inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border transition-colors',
        active
          ? 'bg-green-600 text-white border-green-700'
          : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
      )}
    >
      {children}
    </button>
  );
}

export default function AdminPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  // NEW model: competitions + seasons + minMarketValue
  const [groupedCompetitions, setGroupedCompetitions] = useState({});
  const [allSeasons, setAllSeasons] = useState([]);
  const [selectedCompetitionIds, setSelectedCompetitionIds] = useState([]);
  const [selectedSeasons, setSelectedSeasons] = useState([]);
  const [minMarketValue, setMinMarketValue] = useState(0);

  const [filtersCollapsed, setFiltersCollapsed] = useState(true);
  const [compCollapsed, setCompCollapsed] = useState(false);
  const [seasonsCollapsed, setSeasonsCollapsed] = useState(false);
  const [mvCollapsed, setMvCollapsed] = useState(false);

  const [expandedCountries, setExpandedCountries] = useState({});
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState('');
  const [defaultFilters, setDefaultFilters] = useState(null);
  const [filtersChanged, setFiltersChanged] = useState(false);
  const [dailyChallenges, setDailyChallenges] = useState([]);

  const competitionIdToLabel = useMemo(() => {
    const map = {};
    Object.entries(groupedCompetitions || {}).forEach(([country, comps]) => {
      (comps || []).forEach((c) => {
        map[String(c.competition_id)] = `${country} - ${c.competition_name}`;
      });
    });
    return map;
  }, [groupedCompetitions]);

  const flatCompetitions = useMemo(() => {
    const out = [];
    Object.values(groupedCompetitions).forEach(arr => (arr || []).forEach(c => out.push(c)));
    return out;
  }, [groupedCompetitions]);

  const top10CompetitionIds = useMemo(() => {
    const arr = [...flatCompetitions];
    arr.sort((a, b) => (Number(b.total_value_eur || 0) - Number(a.total_value_eur || 0)));
    return arr.slice(0, 10).map(c => String(c.competition_id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatCompetitions]);

  // Track changes to filters
  useEffect(() => {
    if (!defaultFilters) return;
    const changed =
      JSON.stringify([...selectedCompetitionIds].sort()) !== JSON.stringify([...(defaultFilters.competitions || [])].sort()) ||
      JSON.stringify([...selectedSeasons].sort()) !== JSON.stringify([...(defaultFilters.seasons || [])].sort()) ||
      Number(minMarketValue) !== Number(defaultFilters.min_market_value || 0);
    setFiltersChanged(changed);
  }, [selectedCompetitionIds, selectedSeasons, minMarketValue, defaultFilters]);

  const toggleCountry = (country) => setExpandedCountries(prev => ({ ...prev, [country]: !prev[country] }));
  const clearCompetitions = () => setSelectedCompetitionIds([]);
  const selectAllCompetitions = () => setSelectedCompetitionIds(flatCompetitions.map(c => String(c.competition_id)));
  const selectTop10Competitions = () => setSelectedCompetitionIds(top10CompetitionIds);

  const clearSeasons = () => setSelectedSeasons([]);
  const selectAllSeasons = () => setSelectedSeasons(allSeasons);
  const last5Seasons = () => setSelectedSeasons(allSeasons.slice(0, 5));

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
      const compsRes = await getCompetitions();
      const grouped = compsRes.groupedByCountry || {};
      setGroupedCompetitions(grouped);
      const initialCollapse = {};
      Object.keys(grouped).forEach((c) => (initialCollapse[c] = false));
      setExpandedCountries(initialCollapse);

      const seasonsRes = await getSeasons();
      setAllSeasons(seasonsRes.seasons || []);

      const { data: settings } = await supabase
        .from('daily_challenge_settings')
        .select('competitions, seasons, min_market_value, leagues, appearances')
        .eq('id', 1)
        .single();

      if (settings) {
        const effective = {
          competitions: settings.competitions || (settings.leagues || []).map(String),
          seasons: settings.seasons || [],
          min_market_value: settings.min_market_value ?? 0,
        };
        setDefaultFilters(effective);
        setSelectedCompetitionIds(effective.competitions || []);
        setSelectedSeasons(effective.seasons || []);
        setMinMarketValue(Number(effective.min_market_value || 0));
      }

      const { data: challenges } = await supabase
        .from('daily_challenges')
        .select('challenge_date, player_id, player_name, created_at')
        .order('challenge_date', { ascending: false });
      setDailyChallenges(challenges || []);
    }
    loadFilters();
  }, []);

  if (loading) return <div className="p-8 text-center">Loading...</div>;
  if (!isAdmin) return <div className="p-8 text-center text-red-600">Access denied. Admins only.</div>;

  const handleDateChange = (e) => setDate(e.target.value);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus('Saving...');
    const payload = {
      id: 1,
      competitions: selectedCompetitionIds,
      seasons: selectedSeasons,
      min_market_value: Number(minMarketValue) || 0,
      leagues: null,
      appearances: null,
    };
    const { error } = await supabase.from('daily_challenge_settings').upsert(payload);
    setStatus(error ? 'Error saving filters: ' + error.message : 'Filters saved!');
    if (!error) {
      setDefaultFilters({
        competitions: selectedCompetitionIds,
        seasons: selectedSeasons,
        min_market_value: Number(minMarketValue) || 0,
      });
      setFiltersChanged(false);
    }
  };

  const handleGenerate = async () => {
    setStatus('Generating daily challenge...');
    const filters = {
      competitions: selectedCompetitionIds,
      seasons: selectedSeasons,
      minMarketValue: Number(minMarketValue) || 0,
    };
    const result = await generateDailyChallenge({ date, filters });
    setStatus(result.success ? 'Daily challenge generated for ' + date : 'Error: ' + (result.error || 'Unknown error'));
    const { data: challenges } = await supabase
      .from('daily_challenges')
      .select('challenge_date, player_id, player_name, created_at')
      .order('challenge_date', { ascending: false });
    setDailyChallenges(challenges || []);
  };

  const fmtCurrency = (n) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(n || 0));

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}>
        <h1 className="text-2xl font-bold mb-6 flex items-center gap-2">
          <ShieldCheck className="h-7 w-7 text-blue-600" /> Daily Challenge Admin
        </h1>

        {/* Daily Challenge Card */}
        <div className="rounded-xl shadow-lg border bg-green-50/80 p-6 mb-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="rounded-xl shadow-md border bg-green-50/60 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Filter className="h-5 w-5 text-green-700" />
                  <h3 className="text-lg font-semibold text-green-900">Difficulty Filters</h3>
                </div>
                <button className="text-gray-600 hover:text-gray-800" type="button" onClick={() => setFiltersCollapsed(c => !c)}>
                  {filtersCollapsed ? <ChevronDown className="h-5 w-5" /> : <ChevronUp className="h-5 w-5" />}
                </button>
              </div>

              {!filtersCollapsed && (
                <div className="mt-4 space-y-6">
                  {/* Competitions */}
                  <Section
                    title="Competitions"
                    icon={<Star className="h-4 w-4 text-green-700" />}
                    collapsed={compCollapsed}
                    onToggle={() => setCompCollapsed(v => !v)}
                    actions={
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={selectTop10Competitions} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50">
                          <Star className="h-3 w-3" /> Top 10
                        </button>
                        <button type="button" onClick={selectAllCompetitions} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50">
                          <CheckSquare className="h-3 w-3" /> Select All
                        </button>
                        <button type="button" onClick={clearCompetitions} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50">
                          <Trash2 className="h-3 w-3" />Clear All
                        </button>
                      </div>
                    }
                  >
                    <SelectedChips
                      title="Chosen competitions"
                      items={selectedCompetitionIds}
                      onClear={clearCompetitions}
                      getLabel={id => competitionIdToLabel[id] || `Competition ${id}`}
                      onRemoveItem={id => setSelectedCompetitionIds(prev => prev.filter(x => x !== id))}
                      hoverClose
                    />
                    <div className="max-h-96 overflow-y-auto pr-2">
                      {Object.entries(groupedCompetitions)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([country, comps]) => (
                          <div key={country} className="mb-2">
                            <button
                              onClick={e => { e.preventDefault(); e.stopPropagation(); toggleCountry(country); }}
                              type="button"
                              className="w-full flex items-center justify-between p-2 hover:bg-green-50 rounded"
                            >
                              <div className="flex items-center gap-2">
                                {comps?.[0]?.flag_url && (
                                  <img src={comps[0].flag_url} alt={country} className="w-6 h-4 object-cover rounded" />
                                )}
                                <span>{country}</span>
                                <span className="text-xs text-gray-500">({(comps || []).length})</span>
                              </div>
                              {expandedCountries[country] ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </button>

                            {expandedCountries[country] && (
                              <div className="ml-8 space-y-2 mt-2">
                                {(comps || []).map(c => (
                                  <label key={c.competition_id} className="flex items-center gap-2 cursor-pointer" onClick={(e) => e.stopPropagation()}>
                                    <input
                                      type="checkbox"
                                      checked={selectedCompetitionIds.includes(String(c.competition_id))}
                                      onChange={() =>
                                        setSelectedCompetitionIds(prev =>
                                          prev.includes(String(c.competition_id))
                                            ? prev.filter(x => x !== String(c.competition_id))
                                            : [...prev, String(c.competition_id)]
                                        )
                                      }
                                      className="rounded"
                                    />
                                    {c.logo_url && <img src={c.logo_url} alt={c.competition_name} className="w-5 h-5 object-contain" />}
                                    <span className="text-sm">{c.competition_name}</span>
                                  </label>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                    </div>
                  </Section>

                  {/* Seasons */}
                  <Section
                    title="Seasons"
                    icon={<UsersRound className="h-4 w-4 text-green-700" />}
                    collapsed={seasonsCollapsed}
                    onToggle={() => setSeasonsCollapsed(v => !v)}
                    actions={
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={last5Seasons} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50">
                          <CalendarClock className="h-3 w-3" /> Last 5
                        </button>
                        <button type="button" onClick={selectAllSeasons} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50">
                          <CheckSquare className="h-3 w-3" /> Select All
                        </button>
                        <button type="button" onClick={clearSeasons} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50">
                          <Trash2 className="h-3 w-3" />Clear All
                        </button>
                      </div>
                    }
                  >
                    <SelectedChips
                      title="Chosen seasons"
                      items={selectedSeasons}
                      onClear={clearSeasons}
                      onRemoveItem={season => setSelectedSeasons(prev => prev.filter(x => x !== season))}
                      hoverClose
                    />
                    <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mt-2">
                      {allSeasons.map(season => (
                        <button
                          key={season}
                          type="button"
                          onClick={() =>
                            setSelectedSeasons(prev =>
                              prev.includes(season) ? prev.filter(s => s !== season) : [...prev, season]
                            )
                          }
                          className={classNames(
                            'px-2 py-1 text-sm rounded-md border',
                            selectedSeasons.includes(season)
                              ? 'bg-green-100 border-green-500 text-green-700'
                              : 'bg-white hover:bg-gray-50'
                          )}
                        >
                          {season}
                        </button>
                      ))}
                    </div>
                  </Section>

                  {/* Min Market Value (step = 100k + presets) */}
                  <Section
                    title="Minimum Market Value (€)"
                    icon={<UsersRound className="h-4 w-4 text-green-700" />}
                    collapsed={mvCollapsed}
                    onToggle={() => setMvCollapsed(v => !v)}
                  >
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center gap-3">
                        <input
                          type="number"
                          value={minMarketValue}
                          onChange={(e) => setMinMarketValue(parseInt(e.target.value) || 0)}
                          min="0"
                          step="100000"
                          className="w-40 border rounded-md px-2 py-1 text-center"
                        />
                        <div className="text-sm text-gray-600">Current: {fmtCurrency(minMarketValue)}</div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <PresetButton title="Clear" onClick={() => setMinMarketValue(0)} active={minMarketValue === 0}>
                          <Trash2 size={14} /> Clear
                        </PresetButton>
                        <PresetButton onClick={() => setMinMarketValue(100000)} active={minMarketValue === 100000}>
                          <Star size={14} /> 100K €
                        </PresetButton>
                        <PresetButton onClick={() => setMinMarketValue(500000)} active={minMarketValue === 500000}>
                          <Star size={14} /> 500K €
                        </PresetButton>
                        <PresetButton onClick={() => setMinMarketValue(1000000)} active={minMarketValue === 1000000}>
                          <Star size={14} /> 1M €
                        </PresetButton>
                        <PresetButton onClick={() => setMinMarketValue(5000000)} active={minMarketValue === 5000000}>
                          <Star size={14} /> 5M €
                        </PresetButton>
                        <PresetButton onClick={() => setMinMarketValue(10000000)} active={minMarketValue === 10000000}>
                          <Star size={14} /> 10M €
                        </PresetButton>
                        <PresetButton onClick={() => setMinMarketValue(25000000)} active={minMarketValue === 25000000}>
                          <Star size={14} /> 25M €
                        </PresetButton>
                        <PresetButton onClick={() => setMinMarketValue(50000000)} active={minMarketValue === 50000000}>
                          <Star size={14} /> 50M €
                        </PresetButton>
                      </div>
                    </div>
                  </Section>
                </div>
              )}
            </div>

            <button
              type="submit"
              className={classNames(
                'bg-blue-600 text-white px-4 py-2 rounded mt-4 transition',
                !filtersChanged && 'opacity-50 cursor-not-allowed'
              )}
              disabled={!filtersChanged}
            >
              Save Default Filters
            </button>
            {status && <div className="mt-2 text-center text-sm text-green-700">{status}</div>}
          </form>

          <hr className="my-6" />

          <div className="mb-4">
            <label className="block font-medium mb-1">Select Date</label>
            <input type="date" value={date} onChange={handleDateChange} className="border rounded px-3 py-2" />
          </div>
          <button onClick={handleGenerate} className="bg-green-600 text-white px-4 py-2 rounded">
            Generate Daily Challenge
          </button>

          {/* Daily Challenges Table */}
          <div className="mt-8">
            <h3 className="text-lg font-semibold mb-2">All Daily Challenges</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full border rounded">
                <thead>
                  <tr className="bg-green-100">
                    <th className="px-2 py-1 border">Date</th>
                    <th className="px-2 py-1 border">Player ID</th>
                    <th className="px-2 py-1 border">Player Name</th>
                    <th className="px-2 py-1 border">Created At</th>
                  </tr>
                </thead>
                <tbody>
                  {dailyChallenges.map(dc => (
                    <tr key={dc.challenge_date}>
                      <td className="px-2 py-1 border">{dc.challenge_date}</td>
                      <td className="px-2 py-1 border">{dc.player_id}</td>
                      <td className="px-2 py-1 border">{dc.player_name}</td>
                      <td className="px-2 py-1 border">{dc.created_at ? new Date(dc.created_at).toLocaleString() : ''}</td>
                    </tr>
                  ))}
                  {dailyChallenges.length === 0 && (
                    <tr>
                      <td colSpan={4} className="text-center py-4 text-gray-500">No daily challenges found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
