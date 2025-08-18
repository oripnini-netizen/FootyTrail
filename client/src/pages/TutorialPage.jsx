// client/src/pages/TutorialPage.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../supabase';
import { useNavigate } from 'react-router-dom';
import { getCompetitions, getSeasons } from '../api';
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  Filter,
  Star,
  Trash2,
  UsersRound,
  CheckSquare,
  CalendarClock,
  ImagePlus
} from 'lucide-react';

function classNames(...s) {
  return s.filter(Boolean).join(' ');
}

function Section({ title, icon, collapsed, onToggle, actions, children }) {
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

const fmtCurrency = (n) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(n || 0));

export default function TutorialPage() {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState(1);

  // Step 2 — profile basics
  const [fullName, setFullName] = useState(user?.full_name || user?.user_metadata?.full_name || '');
  const [avatarUrl, setAvatarUrl] = useState(user?.profile_photo_url || user?.user_metadata?.avatar_url || '');

  // Step 3 — filters
  const [filtersCollapsed, setFiltersCollapsed] = useState(false);
  const [compCollapsed, setCompCollapsed] = useState(false);
  const [seasonsCollapsed, setSeasonsCollapsed] = useState(false);
  const [mvCollapsed, setMvCollapsed] = useState(false);

  const [groupedCompetitions, setGroupedCompetitions] = useState({});
  const [expandedCountries, setExpandedCountries] = useState({});
  const [allSeasons, setAllSeasons] = useState([]);

  const [competitionIds, setCompetitionIds] = useState(() => user?.default_competitions || user?.default_leagues || []);
  const [seasons, setSeasons] = useState(() => user?.default_seasons || []);
  const [minMarketValue, setMinMarketValue] = useState(() =>
    (user?.default_min_market_value ?? user?.default_min_appearances ?? 0) || 0
  );

  useEffect(() => {
    async function load() {
      const comps = await getCompetitions();
      const grouped = comps.groupedByCountry || {};
      setGroupedCompetitions(grouped);
      const initialCollapse = {};
      Object.keys(grouped).forEach((c) => (initialCollapse[c] = false));
      setExpandedCountries(initialCollapse);

      const s = await getSeasons();
      setAllSeasons(s.seasons || []);
    }
    load();
  }, []);

  const flatCompetitions = useMemo(() => {
    const out = [];
    Object.values(groupedCompetitions).forEach((arr) => (arr || []).forEach((c) => out.push(c)));
    return out;
  }, [groupedCompetitions]);

  const top10CompetitionIds = useMemo(() => {
    const arr = [...flatCompetitions];
    arr.sort((a, b) => (Number(b.total_value_eur || 0) - Number(a.total_value_eur || 0)));
    return arr.slice(0, 10).map((c) => String(c.competition_id));
  }, [flatCompetitions]);

  const compIdToLabel = useMemo(() => {
    const map = {};
    Object.entries(groupedCompetitions).forEach(([country, comps]) => {
      (comps || []).forEach((c) => (map[String(c.competition_id)] = `${country} - ${c.competition_name}`));
    });
    return map;
  }, [groupedCompetitions]);

  const next = () => setStep((s) => Math.min(3, s + 1));
  const back = () => setStep((s) => Math.max(1, s - 1));

  // Save step 2 (name/avatar) then move to step 3
  const saveStep2 = async () => {
    try {
      // Update name/avatar in both auth metadata and public.users
      await supabase.auth.updateUser({
        data: {
          ...(user?.user_metadata || {}),
          full_name: fullName || '',
          avatar_url: avatarUrl || ''
        }
      });
      await supabase.from('users').update({
        full_name: fullName || '',
        profile_photo_url: avatarUrl || ''
      }).eq('id', user.id);
      await refresh();
      setTimeout(() => next(), 600); // small, visible “saving…” buffer
    } catch (e) {
      console.error('Step 2 save error:', e);
      next(); // even if failed, allow progress
    }
  };

  // Finish: store defaults + mark onboarding complete, then hard refresh (as you preferred)
  const finish = async () => {
    try {
      await supabase.from('users').update({
        default_competitions: competitionIds,
        default_seasons: seasons,
        default_min_market_value: Number(minMarketValue) || 0,
        has_completed_onboarding: true
      }).eq('id', user.id);
      await refresh();
    } catch (e) {
      console.error('Finish error:', e);
    } finally {
      window.location.reload();
    }
  };

  const toggleCountry = (country) => setExpandedCountries((p) => ({ ...p, [country]: !p[country] }));
  const toggleCompetition = (cid) =>
    setCompetitionIds((prev) => (prev.includes(cid) ? prev.filter((x) => x !== cid) : [...prev, cid]));
  const clearCompetitions = () => setCompetitionIds([]);
  const selectAllCompetitions = () => setCompetitionIds(flatCompetitions.map((c) => String(c.competition_id)));
  const selectTop10 = () => setCompetitionIds(top10CompetitionIds);

  const clearSeasons = () => setSeasons([]);
  const selectAllSeasons = () => setSeasons(allSeasons);
  const last5Seasons = () => setSeasons(allSeasons.slice(0, 5));

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="bg-white rounded-xl shadow-md p-6">
        <div className="flex items-center gap-3 mb-4">
          <BookOpen className="h-6 w-6 text-green-700" />
          <h1 className="text-xl font-semibold">Welcome to FootyTrail — Onboarding</h1>
        </div>
        <div className="text-sm text-gray-600 mb-6">Step {step} of 3</div>

        {step === 1 && (
          <div className="space-y-4">
            <p>
              FootyTrail is a quick, competitive guessing game. Use the filters to tailor difficulty, then try to guess the mystery player.
              Win points, climb the leaderboard, and challenge friends in custom leagues!
            </p>
            <div className="flex justify-end gap-2">
              <button className="px-4 py-2 rounded bg-gray-200" onClick={() => navigate('/game')}>Skip</button>
              <button className="px-4 py-2 rounded bg-green-600 text-white" onClick={next}>Continue</button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">Set your display name and avatar</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium mb-1">Display Name</label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Your name"
                  className="w-full border rounded px-3 py-2"
                />
              </div>
              <div className="sm:col-span-1">
                <label className="block text-sm font-medium mb-1">Avatar URL (optional)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="url"
                    value={avatarUrl}
                    onChange={(e) => setAvatarUrl(e.target.value)}
                    placeholder="https://…"
                    className="w-full border rounded px-3 py-2"
                  />
                  <ImagePlus className="h-5 w-5 text-gray-500" />
                </div>
              </div>
            </div>
            {!!avatarUrl && (
              <div className="mt-2">
                <img src={avatarUrl} alt="avatar preview" className="h-16 w-16 rounded-full object-cover border" />
              </div>
            )}
            <div className="flex justify-between">
              <button className="px-4 py-2 rounded bg-gray-200" onClick={back}>Back</button>
              <button className="px-4 py-2 rounded bg-green-600 text-white" onClick={saveStep2}>Save & Continue</button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6">
            <div className="rounded-xl border bg-green-50/60 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Filter className="h-5 w-5 text-green-700" />
                  <h3 className="text-lg font-semibold text-green-900">Default Filters</h3>
                </div>
                <button
                  className="text-gray-600 hover:text-gray-800"
                  onClick={() => setFiltersCollapsed((c) => !c)}
                  type="button"
                >
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
                    onToggle={() => setCompCollapsed((v) => !v)}
                    actions={
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); selectTop10(); }}
                          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
                        >
                          <Star className="h-3 w-3" /> Top 10
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); selectAllCompetitions(); }}
                          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
                        >
                          <CheckSquare className="h-3 w-3" /> Select All
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); clearCompetitions(); }}
                          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
                        >
                          <Trash2 className="h-3 w-3" /> Clear All
                        </button>
                      </div>
                    }
                  >
                    <div className="max-h-80 overflow-y-auto pr-2">
                      {Object.entries(groupedCompetitions)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([country, comps]) => (
                          <div key={country} className="mb-2">
                            <button
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleCountry(country); }}
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
                                {(comps || []).map((c) => {
                                  const cid = String(c.competition_id);
                                  const checked = competitionIds.includes(cid);
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
                                        <img src={c.logo_url} alt={c.competition_name} className="w-5 h-5 object-contain" />
                                      )}
                                      <span className="text-sm">{c.competition_name}</span>
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
                    icon={<UsersRound className="h-4 w-4 text-green-700" />}
                    collapsed={seasonsCollapsed}
                    onToggle={() => setSeasonsCollapsed((v) => !v)}
                    actions={
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); last5Seasons(); }}
                          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
                        >
                          <CalendarClock className="h-3 w-3" /> Last 5
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); selectAllSeasons(); }}
                          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
                        >
                          <CheckSquare className="h-3 w-3" /> Select All
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); clearSeasons(); }}
                          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50"
                        >
                          <Trash2 className="h-3 w-3" /> Clear All
                        </button>
                      </div>
                    }
                  >
                    <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mt-2">
                      {allSeasons.map((season) => (
                        <button
                          key={season}
                          type="button"
                          onClick={() =>
                            setSeasons((prev) => (prev.includes(season) ? prev.filter((s) => s !== season) : [...prev, season]))
                          }
                          className={classNames(
                            'px-2 py-1 text-sm rounded-md border',
                            seasons.includes(season)
                              ? 'bg-green-100 border-green-500 text-green-700'
                              : 'bg-white hover:bg-gray-50'
                          )}
                        >
                          {season}
                        </button>
                      ))}
                    </div>
                  </Section>

                  {/* Min Market Value — step 100k + presets */}
                  <Section
                    title="Minimum Market Value (€)"
                    icon={<UsersRound className="h-4 w-4 text-green-700" />}
                    collapsed={mvCollapsed}
                    onToggle={() => setMvCollapsed((v) => !v)}
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

            <div className="flex justify-between">
              <button className="px-4 py-2 rounded bg-gray-200" onClick={back}>Back</button>
              <button className="px-4 py-2 rounded bg-green-600 text-white" onClick={finish}>Finish</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
