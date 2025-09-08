// client/src/pages/TutorialPage.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ChevronLeft,
  ChevronRight,
  Check,
  Upload,
  Trophy,
  CalendarClock,
  Layers,
  ChevronDown,
  ChevronUp,
  Trash2,
  Star,
  CheckSquare,
  Search,
  User } from 'lucide-react';

import { useAuth } from '../context/AuthContext';
import { supabase } from '../supabase';
import { getCompetitions, getSeasons } from '../api';

function cx(...a) {
  return a.filter(Boolean).join(' ');
}

function Section({ title, icon, collapsed, onToggle, actions, children }) {
  return (
    <div className="rounded-lg border bg-white/70">
      <div className="flex items-center justify-between px-3 py-2">
        <button type="button" onClick={onToggle} className="inline-flex items-center gap-2">
          {icon}
          <span className="font-medium text-green-900">{title}</span>
          {collapsed ? <ChevronDown className="h-4 w-4 ml-1" /> : <ChevronUp className="h-4 w-4 ml-1" />}
        </button>
        <div className="hidden sm:flex items-center gap-2">{actions}</div>
      </div>

      {/* Actions row under header on mobile to prevent overlap */}
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

export default function TutorialPage() {
  const { user } = useAuth();

  const [step, setStep] = useState(1);

  // Profile (step 2)
  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState('');

  // Filters (step 3)
  const [groupedCompetitions, setGroupedCompetitions] = useState({});
  const [allSeasons, setAllSeasons] = useState([]);
  const [expandedCountries, setExpandedCountries] = useState({});

  const [selectedCompetitionIds, setSelectedCompetitionIds] = useState([]);
  const [selectedSeasons, setSelectedSeasons] = useState([]);
  const [minMarketValue, setMinMarketValue] = useState(0);
  const [minAppearances, setMinAppearances] = useState(0);

  const [compCollapsed, setCompCollapsed] = useState(false);
  const [seasonsCollapsed, setSeasonsCollapsed] = useState(false);
  const [mvCollapsed, setMvCollapsed] = useState(false);
  const [appsCollapsed, setAppsCollapsed] = useState(false);

  // for tiny progress indicator during db updates
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  // ---- Competitions search state (autocomplete) ----
  const [compQuery, setCompQuery] = useState('');
  const [compSuggestions, setCompSuggestions] = useState([]);
  const [showCompSuggestions, setShowCompSuggestions] = useState(false);
  const [compActiveIndex, setCompActiveIndex] = useState(-1);
  const compListRef = useRef(null);
  const compItemRefs = useRef([]);

  // flatten list of competitions
  const flatCompetitions = useMemo(() => {
    const arr = [];
    Object.values(groupedCompetitions).forEach((list) => (list || []).forEach((c) => arr.push(c)));
    return arr;
  }, [groupedCompetitions]);

  // id -> { label, country, comp }
  const compIdToLabel = useMemo(() => {
    const m = {};
    Object.entries(groupedCompetitions).forEach(([country, comps]) => {
      (comps || []).forEach((c) => {
        m[String(c.competition_id)] = { label: `${country} - ${c.competition_name}`, country, comp: c };
      });
    });
    return m;
  }, [groupedCompetitions]);

  // top 10 by total_value_eur
  const top10CompetitionIds = useMemo(() => {
    const arr = [...flatCompetitions];
    arr.sort((a, b) => Number(b.total_value_eur || 0) - Number(a.total_value_eur || 0));
    return arr.slice(0, 10).map((c) => String(c.competition_id));
  }, [flatCompetitions]);

  const toggleCountry = (country) =>
    setExpandedCountries((p) => ({ ...p, [country]: !p[country] }));

  const fmtCurrency = (n) =>
    new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(
      Number(n || 0)
    );

  // Load initial user profile + filters data (and competitions/seasons)
  useEffect(() => {
    (async () => {
      // user profile
      if (user?.id) {
        const { data } = await supabase
          .from('users')
          .select(
            'full_name, profile_photo_url, default_leagues, default_seasons, default_min_market_value, default_min_appearances'
          )
          .eq('id', user.id)
          .maybeSingle();
        if (data) {
          setDisplayName(data.full_name || '');
          setAvatarUrl(data.profile_photo_url || '');
          setSelectedCompetitionIds(data.default_leagues || []); // using legacy column name if present
          setSelectedSeasons(data.default_seasons || []);
          setMinMarketValue(Number(data.default_min_market_value || 0));
          setMinAppearances(Number(data.default_min_appearances || 0));
        }
      }

      // competitions
      const compsRes = await getCompetitions();
      const grouped = compsRes.groupedByCountry || {};
      setGroupedCompetitions(grouped);
      const init = {};
      Object.keys(grouped).forEach((c) => (init[c] = false));
      setExpandedCountries(init);

      // seasons
      const seasonsRes = await getSeasons();
      setAllSeasons(seasonsRes.seasons || []);
    })();
  }, [user?.id]);

  // Step navigation
  const next = () => setStep((s) => Math.min(3, s + 1));
  const prev = () => setStep((s) => Math.max(1, s - 1));

  // ---- Avatar upload (Step 2) ----
  const onAvatarSelected = async (e) => {
    try {
      setAvatarError('');
      const file = e.target.files?.[0];
      if (!file) return;

      if (!file.type.startsWith('image/')) {
        setAvatarError('Please choose an image file.');
        return;
      }
      const maxBytes = 2 * 1024 * 1024; // ~2MB
      if (file.size > maxBytes) {
        setAvatarError('Image is too large (max 2 MB).');
        return;
      }

      if (!user?.id) {
        setAvatarError('Not signed in.');
        return;
      }

      setAvatarUploading(true);
      const path = `public/${user.id}/${Date.now()}_${file.name}`;
      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true, cacheControl: '3600' });
      if (upErr) throw upErr;

      const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
      const url = pub?.publicUrl || '';

      // Save immediately to the profile (keeps Step 2 self-contained)
      const { error: updErr } = await supabase
        .from('users')
        .update({ profile_photo_url: url })
        .eq('id', user.id);
      if (updErr) throw updErr;

      setAvatarUrl(url);
    } catch (err) {
      console.error('Avatar upload failed:', err);
      setAvatarError('Upload failed. Please try again.');
    } finally {
      setAvatarUploading(false);
    }
  };

  // Step 2 save (profile)
  const saveProfileAndContinue = async () => {
    if (!user?.id) return;
    try {
      setBusy(true);
      setStatus('Saving your profile…');
      const updates = {
        full_name: displayName || '',
        profile_photo_url: avatarUrl || null,
      };
      const { error } = await supabase.from('users').update(updates).eq('id', user.id);
      if (error) throw error;
      setStatus('Saved!');
      setTimeout(() => {
        setBusy(false);
        next();
      }, 1000);
    } catch (e) {
      setBusy(false);
      setStatus('Error saving profile, please try again.');
      console.error(e);
    }
  };

  // Step 3 save (filters) + finish onboarding
  const finishOnboarding = async () => {
    if (!user?.id) return;
    try {
      setBusy(true);
      setStatus('Setting up your FootyTrail experience…');

      const updates = {
        default_leagues: selectedCompetitionIds, // reuse column for competitions
        default_seasons: selectedSeasons,
        default_min_market_value: Number(minMarketValue) || 0,
        default_min_appearances: Number(minAppearances) || 0,
        has_completed_onboarding: true,
      };

      const { error } = await supabase.from('users').update(updates).eq('id', user.id);
      if (error) throw error;

      // small pause then hard refresh to route to GamePage
      setTimeout(() => {
        setBusy(false);
        window.location.href = '/game';
      }, 800);
    } catch (e) {
      setBusy(false);
      setStatus('Error finishing onboarding, please try again.');
      console.error(e);
    }
  };

  // Preset handlers (Step 3)
  const clearCompetitions = () => setSelectedCompetitionIds([]);
  const selectAllCompetitions = () =>
    setSelectedCompetitionIds(flatCompetitions.map((c) => String(c.competition_id)));
  const selectTop10Competitions = () => setSelectedCompetitionIds(top10CompetitionIds);

  const clearSeasons = () => setSelectedSeasons([]);
  const selectAllSeasons = () => setSelectedSeasons(allSeasons);
  const selectLast5Seasons = () => setSelectedSeasons(allSeasons.slice(0, 5));

  // ---- Competitions autocomplete logic ----
  useEffect(() => {
    const q = compQuery.trim().toLowerCase();
    if (!q) {
      setCompSuggestions([]);
      setCompActiveIndex(-1);
      return;
    }
    const pool = [];
    Object.entries(groupedCompetitions).forEach(([country, comps]) => {
      (comps || []).forEach((c) => {
        const id = String(c.competition_id);
        const name = c.competition_name || '';
        const label = `${country} - ${name}`;
        if (
          country.toLowerCase().includes(q) ||
          name.toLowerCase().includes(q) ||
          label.toLowerCase().includes(q)
        ) {
          pool.push({
            id,
            label,
            logo: c.logo_url,
            country,
            name,
          });
        }
      });
    });
    // de-dupe by id
    const seen = new Set();
    const out = [];
    for (const s of pool) {
      if (!seen.has(s.id)) {
        out.push(s);
        seen.add(s.id);
      }
      if (out.length >= 25) break;
    }
    setCompSuggestions(out);
    setCompActiveIndex(out.length ? 0 : -1);
  }, [compQuery, groupedCompetitions]);

  // ✅ NEW: auto-toggle suggestions open/closed based on query
  useEffect(() => {
    const q = compQuery.trim();
    setShowCompSuggestions(q.length > 0);
  }, [compQuery]);

  useEffect(() => {
    if (compActiveIndex < 0 || !compItemRefs.current[compActiveIndex]) return;
    compItemRefs.current[compActiveIndex].scrollIntoView({
      block: 'nearest',
    });
  }, [compActiveIndex]);

  const addCompetitionById = (id) => {
    setSelectedCompetitionIds((prev) =>
      prev.includes(id) ? prev : [...prev, id]
    );
  };

  const handleCompKeyDown = (e) => {
    if (!showCompSuggestions || compSuggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCompActiveIndex((i) => Math.min(i + 1, compSuggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCompActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const s = compSuggestions[compActiveIndex] || compSuggestions[0];
      if (s) {
        addCompetitionById(s.id);
        setCompQuery('');
        // keep focus and let the new effect reopen suggestions when user types again
      }
    } else if (e.key === 'Escape') {
      setShowCompSuggestions(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.35 }}>
        <div className="rounded-xl shadow-lg border bg-white/80">
          <div className="px-6 py-5 border-b bg-green-50/70">
            <h1 className="text-xl font-bold text-green-900">Welcome to FootyTrail</h1>
            <div className="text-sm text-gray-600 mt-1">Step {step} of 3</div>
          </div>

          <div className="p-6 space-y-6">
            {step === 1 && (
              <div>
                <h2 className="text-lg font-semibold mb-3">Quick Tour</h2>
                <p className="text-sm text-gray-700 leading-relaxed">
                  FootyTrail is a daily football guessing game. Each round you’ll get hints
                  about a player. Guess correctly to earn points! Your <b>Difficulty Filters</b> let you
                  tailor the pool by <b>competitions</b>, <b>seasons</b>, <b>minimum appearances</b> and <b>minimum market value (€)</b>.
                </p>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4">
                <h2 className="text-lg font-semibold">Your profile</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label className="block">
                    <span className="text-sm text-gray-700">Display name</span>
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="mt-1 w-full border rounded px-3 py-2"
                      placeholder="Your name"
                    />
                  </label>

                  {/* Direct file upload for avatar */}
                  <div className="block">
                    <span className="text-sm text-gray-700">Avatar (optional)</span>
                    <div className="mt-1 flex items-center gap-3">
                      <div className="w-12 h-12 rounded-full overflow-hidden bg-gray-100 border">
                        {avatarUrl ? (
                          <img
                            src={avatarUrl}
                            alt="avatar"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-400">
                            <Upload className="h-5 w-5" />
                          </div>
                        )}
                      </div>
                      <label className="inline-flex items-center gap-2 px-3 py-2 border rounded cursor-pointer bg-white hover:bg-gray-50">
                        <Upload className="h-4 w-4" />
                        <span className="text-sm">{avatarUploading ? 'Uploading…' : 'Upload Image'}</span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={onAvatarSelected}
                          className="hidden"
                          disabled={avatarUploading}
                        />
                      </label>
                    </div>
                    {avatarError && <div className="text-xs text-red-600 mt-1">{avatarError}</div>}
                  </div>
                </div>
                {busy && <div className="text-sm text-blue-700">{status}</div>}
              </div>
            )}

            {step === 3 && (
              <div className="space-y-6">
                <h2 className="text-lg font-semibold">Difficulty Filters</h2>

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
                  {/* Search bar */}
                  <div className="relative mb-3">
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <input
                        type="text"
                        value={compQuery}
                        onChange={(e) => setCompQuery(e.target.value)}
                        onFocus={() => setShowCompSuggestions(true)}
                        onKeyDown={handleCompKeyDown}
                        placeholder="Search country or competition…"
                        className="w-full pl-8 pr-3 py-2 border rounded-md"
                      />
                    </div>

                    {/* Suggestions dropdown */}
                    {showCompSuggestions && compSuggestions.length > 0 && (
                      <ul
                        ref={compListRef}
                        className="absolute z-10 mt-1 w-full max-h-56 overflow-auto rounded-md border bg-white shadow"
                        onMouseDown={(e) => e.preventDefault()} // keep input focus on click
                      >
                        {compSuggestions.map((s, idx) => (
                          <li
                            key={`${s.id}-${idx}`}
                            ref={(el) => (compItemRefs.current[idx] = el)}
                            className={cx(
                              'flex items-center gap-2 px-2 py-1 cursor-pointer',
                              idx === compActiveIndex ? 'bg-green-100' : 'hover:bg-gray-50'
                            )}
                            onClick={() => {
                              addCompetitionById(s.id);
                              setCompQuery('');
                              // dropdown auto re-opens when user types again (effect above)
                            }}
                          >
                            {s.logo ? (
                              <img src={s.logo} alt="" className="w-4 h-4 object-contain" />
                            ) : (
                              <span className="w-4 h-4" />
                            )}
                            <span className="text-sm">
                              <span className="font-medium">{s.country}</span> – {s.name}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {/* Chosen competitions chips */}
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
                              onClick={() =>
                                setSelectedCompetitionIds((prev) => prev.filter((x) => x !== id))
                              }
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
                                    onChange={() =>
                                      setSelectedCompetitionIds((prev) =>
                                        prev.includes(String(c.competition_id))
                                          ? prev.filter((x) => x !== String(c.competition_id))
                                          : [...prev, String(c.competition_id)]
                                      )
                                    }
                                    className="rounded"
                                  />
                                  {c.logo_url && (
                                    <img
                                      src={c.logo_url}
                                      alt={c.competition_name}
                                      className="w-5 h-5 object-contain"
                                    />
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
                              onClick={() => setSelectedSeasons((p) => p.filter((x) => x !== s))}
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 mt-2">
                    {allSeasons.map((season) => (
                      <button
                        key={season}
                        type="button"
                        onClick={() =>
                          setSelectedSeasons((prev) =>
                            prev.includes(season) ? prev.filter((x) => x !== season) : [...prev, season]
                          )
                        }
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
                        onChange={(e) => setMinMarketValue(parseInt(e.target.value) || 0)}
                        min="0"
                        step="100000"
                        className="w-40 border rounded-md px-2 py-1 text-center"
                      />
                      <div className="text-sm text-gray-600">Current: {fmtCurrency(minMarketValue)}</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <PresetBtn onClick={() => setMinMarketValue(0)} active={minMarketValue === 0}>
                        <Trash2 size={14} /> Clear
                      </PresetBtn>
                      <PresetBtn onClick={() => setMinMarketValue(100000)} active={minMarketValue === 100000}>
                        <Star size={14} /> 100K €
                      </PresetBtn>
                      <PresetBtn onClick={() => setMinMarketValue(500000)} active={minMarketValue === 500000}>
                        <Star size={14} /> 500K €
                      </PresetBtn>
                      <PresetBtn onClick={() => setMinMarketValue(1000000)} active={minMarketValue === 1000000}>
                        <Star size={14} /> 1M €
                      </PresetBtn>
                      <PresetBtn onClick={() => setMinMarketValue(5000000)} active={minMarketValue === 5000000}>
                        <Star size={14} /> 5M €
                      </PresetBtn>
                      <PresetBtn onClick={() => setMinMarketValue(10000000)} active={minMarketValue === 10000000}>
                        <Star size={14} /> 10M €
                      </PresetBtn>
                      <PresetBtn onClick={() => setMinMarketValue(25000000)} active={minMarketValue === 25000000}>
                        <Star size={14} /> 25M €
                      </PresetBtn>
                      <PresetBtn onClick={() => setMinMarketValue(50000000)} active={minMarketValue === 50000000}>
                        <Star size={14} /> 50M €
                      </PresetBtn>
                    </div>
                  </div>
                </Section>

                {/* Minimum Appearances */}
                <Section
                  title="Minimum Appearances"
                  icon={<User className="h-4 w-4 text-green-700" />}
                  collapsed={appsCollapsed}
                  onToggle={() => setAppsCollapsed((v) => !v)}
                  actions={
                    <>
                      {[0,5,10,15,20,25,30].map((v) => (
                        <PresetBtn key={v} onClick={() => setMinAppearances(v)} active={minAppearances === v}>
                          {v}
                        </PresetBtn>
                      ))}
                    </>
                  }
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="number"
                      value={minAppearances}
                      onChange={(e) => setMinAppearances(parseInt(e.target.value) || 0)}
                      min="0"
                      step="1"
                      className="w-40 border rounded-md px-2 py-1 text-center"
                    />
                    <div className="text-sm text-gray-600">Current: {Number(minAppearances) || 0}</div>
                  </div>
                </Section>

                {busy && <div className="text-sm text-blue-700">{status}</div>}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t bg-green-50/60 flex items-center justify-between">
            <button
              onClick={prev}
              disabled={step === 1 || busy}
              className={cx(
                'inline-flex items-center gap-2 px-4 py-2 rounded border',
                step === 1 || busy
                  ? 'opacity-50 cursor-not-allowed bg-white'
                  : 'bg-white hover:bg-gray-50'
              )}
            >
              <ChevronLeft className="h-4 w-4" /> Back
            </button>

            {step < 3 ? (
              step === 2 ? (
                <button
                  onClick={saveProfileAndContinue}
                  disabled={busy}
                  className={cx(
                    'inline-flex items-center gap-2 px-4 py-2 rounded text-white',
                    busy ? 'bg-green-400' : 'bg-green-600 hover:bg-green-700'
                  )}
                >
                  Save & Continue <ChevronRight className="h-4 w-4" />
                </button>
              ) : (
                <button
                  onClick={next}
                  disabled={busy}
                  className={cx(
                    'inline-flex items-center gap-2 px-4 py-2 rounded text-white',
                    busy ? 'bg-green-400' : 'bg-green-600 hover:bg-green-700'
                  )}
                >
                  Continue <ChevronRight className="h-4 w-4" />
                </button>
              )
            ) : (
              <button
                onClick={finishOnboarding}
                disabled={busy}
                className={cx(
                  'inline-flex items-center gap-2 px-4 py-2 rounded text-white',
                  busy ? 'bg-blue-400' : 'bg-blue-600 hover:bg-blue-700'
                )}
              >
                Finish <Check className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
