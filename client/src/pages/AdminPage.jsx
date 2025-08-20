// client/src/pages/AdminPage.jsx
import React, { useEffect, useMemo, useState, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  ShieldCheck,
  Filter as FilterIcon,
  ChevronDown,
  ChevronUp,
  Trash2,
  Star,
  CheckSquare,
  CalendarClock,
  CalendarPlus,
  X,
  Globe2,
  Trophy,
  Layers,
  Search,
} from 'lucide-react';

import { useAuth } from '../context/AuthContext';
import { supabase } from '../supabase';
import {
  getCompetitions,
  getSeasons,
  generateDailyChallenge,
  getPlayersCoverage, // RPC
} from '../api';

function cx(...a) {
  return a.filter(Boolean).join(' ');
}

function Section({ title, icon, collapsed, onToggle, actions, children }) {
  return (
    <div className="rounded-lg border bg-white/70">
      {/* Header row */}
      <div className="flex items-center justify-between px-3 py-2">
        <button type="button" onClick={onToggle} className="inline-flex items-center gap-2">
          {icon}
          <span className="font-medium text-green-900">{title}</span>
          {collapsed ? <ChevronDown className="h-4 w-4 ml-1" /> : <ChevronUp className="h-4 w-4 ml-1" />}
        </button>
        {/* Show header actions only on >= sm to avoid overlap on mobile */}
        <div className="hidden sm:flex items-center gap-2">{actions}</div>
      </div>

      {/* On mobile, show actions in a row directly beneath the header */}
      {!collapsed && actions ? (
        <div className="sm:hidden px-3 pb-2">
          <div className="flex flex-wrap gap-2">{actions}</div>
        </div>
      ) : null}

      {!collapsed && <div className="p-3 pt-0">{children}</div>}
    </div>
  );
}

function PresetBtn({ onClick, children, active, title }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      title={title}
      className={cx(
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

  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  // Filters state
  const [groupedCompetitions, setGroupedCompetitions] = useState({});
  const [allSeasons, setAllSeasons] = useState([]);
  const [selectedCompetitionIds, setSelectedCompetitionIds] = useState([]);
  const [selectedSeasons, setSelectedSeasons] = useState([]);
  const [minMarketValue, setMinMarketValue] = useState(0);

  // Collapses (cards collapsed by default)
  const [filtersCollapsed, setFiltersCollapsed] = useState(true);
  const [compCollapsed, setCompCollapsed] = useState(false);
  const [seasonsCollapsed, setSeasonsCollapsed] = useState(false);
  const [mvCollapsed, setMvCollapsed] = useState(false);

  const [expandedCountries, setExpandedCountries] = useState({});

  // Save-button enabling
  const [filtersChanged, setFiltersChanged] = useState(false);

  // Daily challenge: multi-date
  const [dateInput, setDateInput] = useState(new Date().toISOString().slice(0, 10));
  const [selectedDates, setSelectedDates] = useState([]); // array of YYYY-MM-DD
  const [status, setStatus] = useState('');
  const [dailyChallenges, setDailyChallenges] = useState([]);

  // Players coverage card
  const [coverageCollapsed, setCoverageCollapsed] = useState(true);
  const [coverage, setCoverage] = useState(null);
  const [coverageCountryOpen, setCoverageCountryOpen] = useState({});
  const [coverageCompOpen, setCoverageCompOpen] = useState({}); // key: `${country}|${compId}`

  // ---- NEW: competitions search / autocomplete ----
  const [compSearch, setCompSearch] = useState('');
  const [showSuggest, setShowSuggest] = useState(false);
  const searchBoxRef = useRef(null);

  // Close suggestions on outside click
  useEffect(() => {
    const onClick = (e) => {
      if (!searchBoxRef.current) return;
      if (!searchBoxRef.current.contains(e.target)) setShowSuggest(false);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  // ---- helpers ----
  const flatCompetitions = useMemo(() => {
    const arr = [];
    Object.entries(groupedCompetitions).forEach(([country, list]) =>
      (list || []).forEach((c) => arr.push({ ...c, _country: country }))
    );
    return arr;
  }, [groupedCompetitions]);

  const compIdToLabel = useMemo(() => {
    const m = {};
    Object.entries(groupedCompetitions).forEach(([country, comps]) => {
      (comps || []).forEach((c) => {
        m[String(c.competition_id)] = { label: `${country} - ${c.competition_name}`, country, comp: c };
      });
    });
    return m;
  }, [groupedCompetitions]);

  const top10CompetitionIds = useMemo(() => {
    const arr = [...flatCompetitions];
    arr.sort((a, b) => Number(b.total_value_eur || 0) - Number(a.total_value_eur || 0));
    return arr.slice(0, 10).map((c) => String(c.competition_id));
  }, [flatCompetitions]);

  // Map: country -> flag_url (from competitions list)
  const countryFlagMap = useMemo(() => {
    const map = {};
    Object.entries(groupedCompetitions).forEach(([country, comps]) => {
      const flag = comps?.[0]?.flag_url || null;
      map[country] = flag;
    });
    return map;
  }, [groupedCompetitions]);

  const toggleCountry = (country) =>
    setExpandedCountries((p) => ({ ...p, [country]: !p[country] }));

  const fmtCurrency = (n) =>
    new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(
      Number(n || 0)
    );

  // Filtered competitions by search text (keeps country grouping)
  const filteredGroupedCompetitions = useMemo(() => {
    const q = compSearch.trim().toLowerCase();
    if (!q) return groupedCompetitions;
    const out = {};
    Object.entries(groupedCompetitions).forEach(([country, comps]) => {
      const mCountry = country.toLowerCase().includes(q);
      const filtered = (comps || []).filter(
        (c) => mCountry || (c.competition_name || '').toLowerCase().includes(q)
      );
      if (filtered.length) out[country] = filtered;
    });
    return out;
  }, [compSearch, groupedCompetitions]);

  // Suggestions list (top 15)
  const compSuggestions = useMemo(() => {
    const q = compSearch.trim().toLowerCase();
    if (!q) return [];
    const list = flatCompetitions
      .filter(
        (c) =>
          c._country.toLowerCase().includes(q) ||
          (c.competition_name || '').toLowerCase().includes(q)
      )
      .slice(0, 15);
    // sort: startsWith first, then includes, then by value descending
    const starts = (txt) => (txt || '').toLowerCase().startsWith(q) ? 0 : 1;
    return list.sort(
      (a, b) =>
        starts(a.competition_name) - starts(b.competition_name) ||
        Number(b.total_value_eur || 0) - Number(a.total_value_eur || 0)
    );
  }, [compSearch, flatCompetitions]);

  // ---- access check ----
  useEffect(() => {
    (async () => {
      if (!user?.id) {
        setIsAdmin(false);
        setLoading(false);
        return;
      }
      const { data, error } = await supabase.from('users').select('role').eq('id', user.id).single();
      setIsAdmin(!error && data?.role === 'admin');
      setLoading(false);
    })();
  }, [user]);

  // ---- initial load ----
  useEffect(() => {
    (async () => {
      // competitions / seasons
      const compsRes = await getCompetitions();
      const grouped = compsRes.groupedByCountry || {};
      setGroupedCompetitions(grouped);

      const expandInit = {};
      Object.keys(grouped).forEach((c) => (expandInit[c] = false));
      setExpandedCountries(expandInit);

      const seasonsRes = await getSeasons();
      setAllSeasons(seasonsRes.seasons || []);

      // daily challenge settings (default filters)
      const { data: settings, error: settingsErr } = await supabase
        .from('daily_challenge_settings')
        .select('competitions, seasons, min_market_value')
        .eq('id', 1)
        .maybeSingle();

      if (settingsErr) {
        console.error('load settings error:', settingsErr.message);
      }

      setSelectedCompetitionIds(settings?.competitions || []);
      setSelectedSeasons(settings?.seasons || []);
      setMinMarketValue(Number(settings?.min_market_value || 0));
      setFiltersChanged(false);

      // daily challenges list
      const { data: challenges } = await supabase
        .from('daily_challenges')
        .select('challenge_date, player_id, player_name, created_at')
        .order('challenge_date', { ascending: false });
      setDailyChallenges(challenges || []);

      // Coverage via RPC
      try {
        const rows = await getPlayersCoverage(); // [{country, competition_id, competition_name, logo_url, season_id, players_count}]
        const countries = {};
        for (const r of rows) {
          const country = r.country || 'Unknown';
          const compId = String(r.competition_id);
          const season = String(r.season_id);

          countries[country] = countries[country] || { total: 0, competitions: {} };
          const cBucket = countries[country];

          cBucket.competitions[compId] = cBucket.competitions[compId] || {
            name: r.competition_name || compId,
            logo_url: r.logo_url || null,
            total: 0,
            seasons: {},
          };

          const compBucket = cBucket.competitions[compId];
          compBucket.seasons[season] = Number(r.players_count || 0);
          compBucket.total += Number(r.players_count || 0);
          cBucket.total += Number(r.players_count || 0);
        }
        setCoverage({ countries });
      } catch (err) {
        console.error('coverage rpc error:', err.message);
        setCoverage({ countries: {} });
      }
    })();
  }, []);

  // mark changed on any user interaction
  const markChanged = () => setFiltersChanged(true);

  // competitions actions
  const clearCompetitions = () => {
    setSelectedCompetitionIds([]);
    markChanged();
  };
  const selectAllCompetitions = () => {
    setSelectedCompetitionIds(flatCompetitions.map((c) => String(c.competition_id)));
    markChanged();
  };
  const selectTop10Competitions = () => {
    setSelectedCompetitionIds(top10CompetitionIds);
    markChanged();
  };

  // seasons actions
  const clearSeasons = () => {
    setSelectedSeasons([]);
    markChanged();
  };
  const selectAllSeasons = () => {
    setSelectedSeasons(allSeasons);
    markChanged();
  };
  const selectLast5Seasons = () => {
    setSelectedSeasons(allSeasons.slice(0, 5));
    markChanged();
  };

  // submit/save defaults
  const handleSaveDefaults = async (e) => {
    e.preventDefault();
    setStatus('Saving…');

    const payload = {
      id: 1,
      competitions: selectedCompetitionIds,
      seasons: selectedSeasons,
      min_market_value: Number(minMarketValue) || 0,
    };

    const { error } = await supabase.from('daily_challenge_settings').upsert(payload);
    if (error) {
      setStatus('Error saving filters: ' + error.message);
      return;
    }

    setStatus('Filters saved!');
    setFiltersChanged(false);
  };

  // ---- Multi-date Daily Challenge generation ----
  const addDate = () => {
    const d = (dateInput || '').trim();
    if (!d) return;
    setSelectedDates((prev) => (prev.includes(d) ? prev : [...prev, d].sort()));
  };
  const removeDate = (d) => setSelectedDates((prev) => prev.filter((x) => x !== d));

  const handleGenerateForSelected = async () => {
    if (!selectedDates.length) {
      setStatus('Pick at least one date.');
      return;
    }
    setStatus('Generating daily challenges…');
    const filters = {
      competitions: selectedCompetitionIds,
      seasons: selectedSeasons,
      minMarketValue: Number(minMarketValue) || 0,
    };

    const tasks = selectedDates.map((d) => generateDailyChallenge({ date: d, filters }));
    const results = await Promise.allSettled(tasks);

    const ok = results.filter((r) => r.status === 'fulfilled' && r.value?.success).length;
    const fail = results.length - ok;

    setStatus(`Generated: ${ok}, Failed: ${fail}`);

    // refresh list
    const { data: challenges } = await supabase
      .from('daily_challenges')
      .select('challenge_date, player_id, player_name, created_at')
      .order('challenge_date', { ascending: false });
    setDailyChallenges(challenges || []);
  };

  if (loading) return <div className="p-8 text-center">Loading…</div>;
  if (!isAdmin) return <div className="p-8 text-center text-red-600">Access denied. Admins only.</div>;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.35 }}>
        {/* Main Admin Card (title inside header) */}
        <div className="rounded-xl shadow-lg border bg-green-50/80">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-6 w-6 text-blue-600" />
              <h1 className="text-xl font-bold text-green-900">Daily Challenge Admin</h1>
            </div>

            <button
              type="button"
              onClick={() => setFiltersCollapsed((v) => !v)}
              className="text-gray-700 hover:text-gray-900 inline-flex items-center gap-1"
            >
              <FilterIcon className="h-5 w-5" />
              <span>Difficulty Filters</span>
              {filtersCollapsed ? <ChevronDown className="h-4 w-4 ml-1" /> : <ChevronUp className="h-4 w-4 ml-1" />}
            </button>
          </div>

          {!filtersCollapsed && (
            <div className="p-5 space-y-6">
              {/* Competitions */}
              <Section
                title="Competitions"
                icon={<Trophy className="h-4 w-4 text-green-700" />}
                collapsed={compCollapsed}
                onToggle={() => setCompCollapsed((v) => !v)}
                actions={
                  <>
                    <PresetBtn onClick={selectTop10Competitions} title="Top 10 competitions by market value">
                      <Star size={14} /> Top 10
                    </PresetBtn>
                    <PresetBtn onClick={selectAllCompetitions}>
                      <CheckSquare size={14} /> Select All
                    </PresetBtn>
                    <PresetBtn onClick={clearCompetitions}>
                      <Trash2 size={14} /> Clear All
                    </PresetBtn>
                  </>
                }
              >
                {/* NEW: search bar + suggestions */}
                <div ref={searchBoxRef} className="mb-3 relative">
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-2 top-2.5 h-4 w-4 text-gray-400" />
                      <input
                        value={compSearch}
                        onChange={(e) => {
                          setCompSearch(e.target.value);
                          setShowSuggest(true);
                        }}
                        onFocus={() => setShowSuggest(true)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && compSuggestions.length) {
                            const c = compSuggestions[0];
                            const id = String(c.competition_id);
                            if (!selectedCompetitionIds.includes(id)) {
                              setSelectedCompetitionIds((prev) => [...prev, id]);
                              setFiltersChanged(true);
                            }
                            setCompSearch('');
                            setShowSuggest(false);
                          }
                        }}
                        placeholder="Search country or league…"
                        className="w-full pl-8 pr-3 py-2 rounded-md border focus:outline-none focus:ring-2 focus:ring-emerald-300"
                      />
                    </div>
                  </div>

                  {showSuggest && compSearch.trim() && compSuggestions.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full rounded-md border bg-white shadow-lg max-h-64 overflow-auto">
                      {compSuggestions.map((c) => {
                        const id = String(c.competition_id);
                        const selected = selectedCompetitionIds.includes(id);
                        return (
                          <button
                            key={id}
                            type="button"
                            className={cx(
                              'w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-emerald-50',
                              selected && 'opacity-60'
                            )}
                            onClick={() => {
                              if (!selected) {
                                setSelectedCompetitionIds((prev) => [...prev, id]);
                                setFiltersChanged(true);
                              }
                              setCompSearch('');
                              setShowSuggest(false);
                            }}
                          >
                            {c.logo_url && (
                              <img src={c.logo_url} alt="" className="w-5 h-5 object-contain" />
                            )}
                            <span className="flex-1">
                              {c.competition_name}
                              <span className="ml-1 text-xs text-gray-500">({c._country})</span>
                            </span>
                            {selected && <span className="text-emerald-600 text-xs">Selected</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {!!selectedCompetitionIds.length && (
                  <div className="mb-2">
                    <div className="text-xs text-gray-600 mb-1">Chosen competitions</div>
                    <div className="flex flex-wrap gap-2">
                      {selectedCompetitionIds.map((id) => (
                        <span
                          key={id}
                          className="inline-flex items-center gap-2 px-2 py-1 rounded-full text-xs bg-green-100 text-green-800"
                        >
                          {compIdToLabel[id]?.label || `Competition ${id}`}
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedCompetitionIds((prev) => prev.filter((x) => x !== id));
                              setFiltersChanged(true);
                            }}
                            className="text-red-600 hover:text-red-700"
                            title="Remove"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="max-h-96 overflow-y-auto pr-2">
                  {Object.entries(filteredGroupedCompetitions)
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
                            {countryFlagMap[country] && (
                              <img src={countryFlagMap[country]} alt={country} className="w-6 h-4 object-cover rounded" />
                            )}
                            <span>{country}</span>
                            <span className="text-xs text-gray-500">({(comps || []).length})</span>
                          </div>
                          {expandedCountries[country] ? (
                            <ChevronUp className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )}
                        </button>

                        {expandedCountries[country] && (
                          <div className="ml-8 space-y-2 mt-2">
                            {(comps || []).map((c) => (
                              <label
                                key={c.competition_id}
                                className="flex items-center gap-2 cursor-pointer"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedCompetitionIds.includes(String(c.competition_id))}
                                  onChange={() => {
                                    setSelectedCompetitionIds((prev) =>
                                      prev.includes(String(c.competition_id))
                                        ? prev.filter((x) => x !== String(c.competition_id))
                                        : [...prev, String(c.competition_id)]
                                    );
                                    setFiltersChanged(true);
                                  }}
                                  className="rounded"
                                />
                                {c.logo_url && (
                                  <img src={c.logo_url} alt={c.competition_name} className="w-5 h-5 object-contain" />
                                )}
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
                icon={<CalendarClock className="h-4 w-4 text-green-700" />}
                collapsed={seasonsCollapsed}
                onToggle={() => setSeasonsCollapsed((v) => !v)}
                actions={
                  <>
                    <PresetBtn onClick={selectLast5Seasons}>
                      <CalendarClock size={14} /> Last 5
                    </PresetBtn>
                    <PresetBtn onClick={selectAllSeasons}>
                      <CheckSquare size={14} /> Select All
                    </PresetBtn>
                    <PresetBtn onClick={clearSeasons}>
                      <Trash2 size={14} /> Clear All
                    </PresetBtn>
                  </>
                }
              >
                {!!selectedSeasons.length && (
                  <div className="mb-2">
                    <div className="text-xs text-gray-600 mb-1">Chosen seasons</div>
                    <div className="flex flex-wrap gap-2">
                      {selectedSeasons.map((s) => (
                        <span
                          key={s}
                          className="inline-flex items-center gap-2 px-2 py-1 rounded-full text-xs bg-green-100 text-green-800"
                        >
                          {s}
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedSeasons((p) => p.filter((x) => x !== s));
                              setFiltersChanged(true);
                            }}
                            className="text-red-600 hover:text-red-700"
                            title="Remove"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {/* Exactly 3 columns (responsive still OK) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 mt-2">
                  {allSeasons.map((season) => (
                    <button
                      key={season}
                      type="button"
                      onClick={() => {
                        setSelectedSeasons((prev) =>
                          prev.includes(season) ? prev.filter((x) => x !== season) : [...prev, season]
                        );
                        setFiltersChanged(true);
                      }}
                      className={cx(
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

              {/* Minimum Market Value */}
              <Section
                title="Minimum Market Value (€)"
                icon={<Layers className="h-4 w-4 text-green-700" />}
                collapsed={mvCollapsed}
                onToggle={() => setMvCollapsed((v) => !v)}
              >
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <input
                      type="number"
                      value={minMarketValue}
                      onChange={(e) => {
                        setMinMarketValue(parseInt(e.target.value) || 0);
                        setFiltersChanged(true);
                      }}
                      min="0"
                      step="100000"
                      className="w-40 border rounded-md px-2 py-1 text-center"
                    />
                    <div className="text-sm text-gray-600">Current: {fmtCurrency(minMarketValue)}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <PresetBtn
                      onClick={() => {
                        setMinMarketValue(0);
                        setFiltersChanged(true);
                      }}
                      active={minMarketValue === 0}
                    >
                      <Trash2 size={14} /> Clear
                    </PresetBtn>
                    <PresetBtn
                      onClick={() => {
                        setMinMarketValue(100000);
                        setFiltersChanged(true);
                      }}
                      active={minMarketValue === 100000}
                    >
                      <Star size={14} /> 100K €
                    </PresetBtn>
                    <PresetBtn
                      onClick={() => {
                        setMinMarketValue(500000);
                        setFiltersChanged(true);
                      }}
                      active={minMarketValue === 500000}
                    >
                      <Star size={14} /> 500K €
                    </PresetBtn>
                    <PresetBtn
                      onClick={() => {
                        setMinMarketValue(1000000);
                        setFiltersChanged(true);
                      }}
                      active={minMarketValue === 1000000}
                    >
                      <Star size={14} /> 1M €
                    </PresetBtn>
                    <PresetBtn
                      onClick={() => {
                        setMinMarketValue(5000000);
                        setFiltersChanged(true);
                      }}
                      active={minMarketValue === 5000000}
                    >
                      <Star size={14} /> 5M €
                    </PresetBtn>
                    <PresetBtn
                      onClick={() => {
                        setMinMarketValue(10000000);
                        setFiltersChanged(true);
                      }}
                      active={minMarketValue === 10000000}
                    >
                      <Star size={14} /> 10M €
                    </PresetBtn>
                    <PresetBtn
                      onClick={() => {
                        setMinMarketValue(25000000);
                        setFiltersChanged(true);
                      }}
                      active={minMarketValue === 25000000}
                    >
                      <Star size={14} /> 25M €
                    </PresetBtn>
                    <PresetBtn
                      onClick={() => {
                        setMinMarketValue(50000000);
                        setFiltersChanged(true);
                      }}
                      active={minMarketValue === 50000000}
                    >
                      <Star size={14} /> 50M €
                    </PresetBtn>
                  </div>
                </div>
              </Section>
            </div>
          )}

          {/* Save & Generate Row */}
          <div className="px-5 pb-5 pt-3 border-t space-y-4">
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSaveDefaults}
                  className={cx(
                    'bg-blue-600 text-white px-4 py-2 rounded transition',
                    !filtersChanged && 'opacity-50 cursor-not-allowed'
                  )}
                  disabled={!filtersChanged}
                >
                  Save Default Filters
                </button>
                {status && <span className="text-sm text-green-700 ml-2">{status}</span>}
              </div>

              {/* Single date quick-generate (still kept) */}
              <div className="flex items-center gap-2">
                <label className="text-sm">Date</label>
                <input
                  type="date"
                  value={dateInput}
                  onChange={(e) => setDateInput(e.target.value)}
                  className="border rounded px-3 py-2"
                />
                <button
                  onClick={async () => {
                    setStatus('Generating daily challenge…');
                    const filters = {
                      competitions: selectedCompetitionIds,
                      seasons: selectedSeasons,
                      minMarketValue: Number(minMarketValue) || 0,
                    };
                    const res = await generateDailyChallenge({ date: dateInput, filters });
                    setStatus(
                      res.success ? `Daily challenge generated for ${dateInput}` : `Error: ${res.error || 'Unknown error'}`
                    );
                    const { data: challenges } = await supabase
                      .from('daily_challenges')
                      .select('challenge_date, player_id, player_name, created_at')
                      .order('challenge_date', { ascending: false });
                    setDailyChallenges(challenges || []);
                  }}
                  className="bg-green-600 text-white px-4 py-2 rounded inline-flex items-center gap-2"
                >
                  <CalendarPlus className="h-4 w-4" />
                  Generate (single)
                </button>
              </div>
            </div>

            {/* Multi-date selection */}
            <div className="rounded-lg border bg-white/70 p-3">
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={dateInput}
                  onChange={(e) => setDateInput(e.target.value)}
                  className="border rounded px-3 py-2"
                />
                <button
                  type="button"
                  onClick={addDate}
                  className="bg-emerald-600 text-white px-3 py-2 rounded inline-flex items-center gap-2"
                >
                  <CalendarPlus className="h-4 w-4" />
                  Add date
                </button>
                <button
                  type="button"
                  onClick={handleGenerateForSelected}
                  className="bg-indigo-600 text-white px-3 py-2 rounded"
                >
                  Generate for selected dates
                </button>
              </div>

              {selectedDates.length > 0 && (
                <div className="mt-3">
                  <div className="text-sm text-gray-600 mb-1">Selected dates</div>
                  <div className="flex flex-wrap gap-2">
                    {selectedDates.map((d) => (
                      <span
                        key={d}
                        className="inline-flex items-center gap-2 px-2 py-1 rounded-full text-xs bg-indigo-100 text-indigo-800"
                      >
                        {d}
                        <button
                          type="button"
                          title="Remove date"
                          onClick={() => removeDate(d)}
                          className="text-red-600 hover:text-red-700"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Daily Challenges Table */}
          <div className="px-5 pb-6">
            <h3 className="text-lg font-semibold mb-2">All Daily Challenges</h3>
            <div className="overflow-x-auto rounded border bg-white/60">
              <table className="min-w-full">
                <thead className="bg-green-100">
                  <tr>
                    <th className="px-2 py-1 border">Date</th>
                    <th className="px-2 py-1 border">Player ID</th>
                    <th className="px-2 py-1 border">Player Name</th>
                    <th className="px-2 py-1 border">Created At</th>
                  </tr>
                </thead>
                <tbody>
                  {(dailyChallenges || []).map((dc) => (
                    <tr key={`${dc.challenge_date}-${dc.player_id}`}>
                      <td className="px-2 py-1 border whitespace-nowrap">{dc.challenge_date}</td>
                      <td className="px-2 py-1 border whitespace-nowrap">{dc.player_id}</td>
                      <td className="px-2 py-1 border">{dc.player_name}</td>
                      <td className="px-2 py-1 border whitespace-nowrap">
                        {dc.created_at ? new Date(dc.created_at).toLocaleString() : ''}
                      </td>
                    </tr>
                  ))}
                  {!dailyChallenges?.length && (
                    <tr>
                      <td colSpan={4} className="text-center py-4 text-gray-500">
                        No daily challenges found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Players Coverage (Country → Competition → Season) */}
        <div className="rounded-xl shadow-lg border bg-white/70 mt-8">
          <div className="flex items-center justify-between px-4 py-3">
            <button
              type="button"
              onClick={() => setCoverageCollapsed((v) => !v)}
              className="inline-flex items-center gap-2"
            >
              <Globe2 className="h-5 w-5 text-green-700" />
              <span className="font-semibold text-green-900">Players Coverage (by Country → Competition → Season)</span>
              {coverageCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </button>
          </div>

          {!coverageCollapsed && (
            <div className="px-4 pb-4">
              {!coverage ? (
                <div className="text-sm text-gray-600">Loading coverage…</div>
              ) : (
                <div className="space-y-3">
                  {Object.entries(coverage.countries || {})
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([country, cData]) => {
                      const open = !!coverageCountryOpen[country];
                      const flagUrl = countryFlagMap[country] || null;
                      return (
                        <div key={country} className="border rounded-md bg-white/60">
                          <div
                            className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-green-50"
                            onClick={() => setCoverageCountryOpen((p) => ({ ...p, [country]: !p[country] }))}
                          >
                            <div className="flex items-center gap-2">
                              {flagUrl && (
                                <img src={flagUrl} alt={country} className="w-6 h-4 object-cover rounded" />
                              )}
                              <span className="font-medium">{country}</span>
                              <span className="text-xs text-gray-600">Players: {cData.total}</span>
                            </div>
                            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </div>

                          {open && (
                            <div className="px-3 pb-3 space-y-2">
                              {Object.entries(cData.competitions || {})
                                .sort(([a], [b]) => a.localeCompare(b))
                                .map(([compId, comp]) => {
                                  const key = `${country}|${compId}`;
                                  const compOpen = !!coverageCompOpen[key];
                                  return (
                                    <div key={key} className="border rounded bg-white/70">
                                      <div
                                        className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-green-50"
                                        onClick={() => setCoverageCompOpen((p) => ({ ...p, [key]: !p[key] }))}
                                      >
                                        <div className="flex items-center gap-2">
                                          {comp.logo_url && (
                                            <img src={comp.logo_url} alt={comp.name} className="w-5 h-5 object-contain" />
                                          )}
                                          <span>{comp.name}</span>
                                          <span className="text-xs text-gray-600">Players: {comp.total}</span>
                                        </div>
                                        {compOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                      </div>

                                      {compOpen && (
                                        <div className="px-3 pb-3">
                                          {/* EXACTLY 3 columns for seasons */}
                                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                                            {Object.entries(comp.seasons || {})
                                              .sort(([a], [b]) => String(b).localeCompare(String(a))) // desc
                                              .map(([season, count]) => (
                                                <div
                                                  key={season}
                                                  className="rounded border bg-white/90 px-2 py-1 text-sm flex items-center justify-between"
                                                >
                                                  <span>{season}</span>
                                                  <span className="text-gray-600">{count}</span>
                                                </div>
                                              ))}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
