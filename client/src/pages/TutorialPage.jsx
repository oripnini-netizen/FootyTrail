// client/src/pages/TutorialPage.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase, uploadAvatar } from '../supabase';
import { getLeagues, getSeasons } from '../api';
import { ChevronRight, ChevronLeft, ImagePlus, UsersRound, Filter, CheckCircle2 } from 'lucide-react';

function classNames(...s) { return s.filter(Boolean).join(' '); }

const STEP_STORAGE_KEY = 'onboarding_step';

// Persist filters so they don't clear if the component remounts mid-flow
const LEAGUES_KEY = 'onboarding_leagueIds';
const SEASONS_KEY = 'onboarding_seasons';
const MINAPPS_KEY = 'onboarding_minApps';

export default function TutorialPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  // If already onboarded, send to game
  const [step, setStep] = useState(() => {
    const saved = parseInt(sessionStorage.getItem(STEP_STORAGE_KEY) || '1', 10);
    return saved >= 1 && saved <= 3 ? saved : 1;
  });

  useEffect(() => {
    if (!user) return;
    if (user.has_completed_onboarding) {
      navigate('/game', { replace: true });
    }
  }, [user?.has_completed_onboarding, navigate]);

  useEffect(() => {
    try { sessionStorage.setItem(STEP_STORAGE_KEY, String(step)); } catch {}
  }, [step]);

  // profile state
  const [fullName, setFullName] = useState(user?.user_metadata?.full_name || user?.full_name || '');
  const [avatar, setAvatar] = useState(user?.user_metadata?.avatar_url || user?.profile_photo_url || '');
  const [savingProfile, setSavingProfile] = useState(false);

  // filters state (with session persistence)
  const [groupedLeagues, setGroupedLeagues] = useState({});
  const [allSeasons, setAllSeasons] = useState([]);
  const [expandedCountries, setExpandedCountries] = useState({});

  const [leagueIds, setLeagueIds] = useState(() => {
    const saved = sessionStorage.getItem(LEAGUES_KEY);
    return saved ? JSON.parse(saved) : (user?.default_leagues || []);
  });
  const [seasons, setSeasons] = useState(() => {
    const saved = sessionStorage.getItem(SEASONS_KEY);
    return saved ? JSON.parse(saved) : (user?.default_seasons || []);
  });
  const [minApps, setMinApps] = useState(() => {
    const saved = sessionStorage.getItem(MINAPPS_KEY);
    return saved ? parseInt(saved, 10) || 0 : (user?.default_min_appearances || 0);
  });

  useEffect(() => {
    try { sessionStorage.setItem(LEAGUES_KEY, JSON.stringify(leagueIds)); } catch {}
  }, [leagueIds]);
  useEffect(() => {
    try { sessionStorage.setItem(SEASONS_KEY, JSON.stringify(seasons)); } catch {}
  }, [seasons]);
  useEffect(() => {
    try { sessionStorage.setItem(MINAPPS_KEY, String(minApps)); } catch {}
  }, [minApps]);

  // Load selectable filters
  useEffect(() => {
    async function loadFilters() {
      try {
        const leaguesRes = await getLeagues();
        setGroupedLeagues(leaguesRes.groupedByCountry || {});
        const initialCollapse = {};
        Object.keys(leaguesRes.groupedByCountry || {}).forEach((c) => (initialCollapse[c] = false));
        setExpandedCountries(initialCollapse);

        const seasonsRes = await getSeasons();
        setAllSeasons(seasonsRes.seasons || []);
      } catch (e) {
        console.error('Error loading filters for tutorial:', e);
      }
    }
    loadFilters();
  }, []);

  const leagueIdToLabel = useMemo(() => {
    const map = {};
    Object.entries(groupedLeagues).forEach(([country, leagues]) => {
      (leagues || []).forEach(l => {
        map[String(l.league_id)] = `${country} - ${l.league_name}`;
      });
    });
    return map;
  }, [groupedLeagues]);

  const toggleLeague = (id) => {
    setLeagueIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const SelectedChips = ({ title, items, onClear, getLabel, onRemoveItem }) => {
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
                className="group relative inline-flex items-center gap-2 px-2 py-1 rounded-full text-xs bg-green-100 text-green-800 pr-6"
              >
                {label}
                {onRemoveItem && (
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
          <button onClick={onClear} className="text-xs text-gray-600 underline hover:text-gray-800">Clear</button>
        </div>
      </div>
    );
  };

  const handleUploadAvatar = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setSavingProfile(true);
      const publicUrl = await uploadAvatar(file);
      const { error: dbError } = await supabase
        .from('users')
        .update({ profile_photo_url: publicUrl })
        .eq('id', user.id);
      if (dbError) throw dbError;
      setAvatar(publicUrl);
    } catch (e) {
      console.error('Avatar upload failed:', e);
    } finally {
      setSavingProfile(false);
    }
  };

  // STEP 2 -> update DB and move to step 3 immediately (no auth refresh)
  const saveProfileStep = async () => {
    try {
      setSavingProfile(true);
      if (fullName?.trim()) {
        const { error } = await supabase
          .from('users')
          .update({ full_name: fullName.trim() })
          .eq('id', user.id);
        if (error) throw error;
      }
    } catch (e) {
      console.error('Failed updating name:', e);
      // allow proceeding anyway
    } finally {
      setSavingProfile(false);
      setStep(3);
      try { sessionStorage.setItem(STEP_STORAGE_KEY, '3'); } catch {}
    }
  };

  // STEP 3 -> Await DB write, then hard-navigate to /game (full reload) so fresh user is fetched
  const [finalizing, setFinalizing] = useState(false);
  const finishOnboarding = async () => {
    if (finalizing) return;
    setFinalizing(true);
    try {
      const { error } = await supabase.from('users')
        .update({
          default_leagues: leagueIds,
          default_seasons: seasons,
          default_min_appearances: minApps,
          has_completed_onboarding: true
        })
        .eq('id', user.id);
      if (error) throw error;
    } catch (e) {
      console.error('Error finalizing onboarding:', e);
      // continue to reload; user can adjust later in Profile
    } finally {
      // Clear persisted wizard state
      try {
        sessionStorage.removeItem(LEAGUES_KEY);
        sessionStorage.removeItem(SEASONS_KEY);
        sessionStorage.removeItem(MINAPPS_KEY);
        sessionStorage.removeItem(STEP_STORAGE_KEY);
      } catch {}
      // Full reload to ensure fresh user (and navbar redirect to /game is honored)
      window.location.replace('/game'); // hard navigation to the game page
    }
  };

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-green-50 to-transparent">
      {/* fixed bg so area under navbar is green too */}
      <div className="fixed inset-0 -z-10 bg-gradient-to-b from-green-50 to-transparent" />

      <div className="max-w-3xl mx-auto px-4 py-10">
        <div className="bg-white rounded-xl shadow-md p-6 relative">
          {/* Finalizing overlay */}
          {finalizing && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/80">
              <div className="flex items-center gap-3">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-green-600 border-t-transparent" />
                <div className="text-green-800 font-semibold">Saving your defaults…</div>
              </div>
            </div>
          )}

          {/* Step indicator */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              {[1,2,3].map(n => (
                <div key={n} className={classNames(
                  'h-8 w-8 rounded-full flex items-center justify-center text-sm font-semibold',
                  step >= n ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-600'
                )}>
                  {step > n ? <CheckCircle2 className="h-5 w-5" /> : n}
                </div>
              ))}
            </div>
            <div className="text-sm text-gray-500">Step {step} of 3</div>
          </div>

          {/* Step 1 */}
          {step === 1 && (
            <div>
              <h1 className="text-2xl font-bold text-green-900 mb-2">Welcome to FootyTrail</h1>
              <p className="text-gray-700 mb-4">
                In FootyTrail you’ll guess players from their transfer history.
                You have <strong>3 minutes</strong> and <strong>3 guesses</strong> per game.
                Use hints wisely—each hint reduces your points.
              </p>
              <ul className="list-disc ml-6 text-gray-700 space-y-2 mb-4">
                <li><strong>Daily Challenge:</strong> one shared player per day worth 10,000 pts. Win it to get an extra game.</li>
                <li><strong>Regular Games:</strong> up to 10 per day (11 if you won the daily).</li>
                <li><strong>Filters:</strong> choose leagues, seasons, and minimum appearances to set difficulty.</li>
                <li><strong>Leaderboards:</strong> your name & avatar appear across the app.</li>
              </ul>
              <div className="flex justify-end">
                <button
                  onClick={() => setStep(2)}
                  className="inline-flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white font-semibold px-4 py-2 rounded"
                >
                  Continue <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* Step 2 */}
          {step === 2 && (
            <div>
              <h2 className="text-xl font-semibold text-green-900 mb-2">Set your profile</h2>
              <p className="text-gray-600 mb-4">
                Choose how you appear on the leaderboard and around the app.
              </p>
              <div className="flex items-center gap-4 mb-4">
                <div className="relative">
                  {avatar ? (
                    <img src={avatar} alt="avatar" className="h-20 w-20 rounded-full object-cover border" onError={() => setAvatar('')} />
                  ) : (
                    <div className="h-20 w-20 rounded-full bg-gray-200 flex items-center justify-center border">
                      <span className="text-2xl font-bold text-gray-600">{(user?.email?.[0] || 'U').toUpperCase()}</span>
                    </div>
                  )}
                  <label className="absolute inset-0 flex items-center justify-center rounded-full cursor-pointer bg-black/0 hover:bg-black/40 transition-colors">
                    <input type="file" accept="image/*" className="hidden" onChange={handleUploadAvatar} disabled={savingProfile} />
                    <ImagePlus className="h-6 w-6 text-white opacity-0 hover:opacity-100 transition-opacity" />
                  </label>
                </div>
                <div className="flex-1">
                  <label className="block text-sm text-gray-600 mb-1">Display name</label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Enter your name"
                    className="w-full px-3 py-2 border rounded-md"
                  />
                  <div className="text-xs text-gray-500 mt-1">This name and avatar appear on leaderboards and game history.</div>
                </div>
              </div>

              <div className="flex justify-between">
                <button onClick={() => setStep(1)} className="inline-flex items-center gap-2 px-3 py-2 rounded border">
                  <ChevronLeft className="h-4 w-4" /> Back
                </button>
                <button onClick={saveProfileStep} disabled={savingProfile} className="inline-flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white font-semibold px-4 py-2 rounded">
                  {savingProfile ? 'Saving…' : <>Save & Continue <ChevronRight className="h-4 w-4" /></>}
                </button>
              </div>
            </div>
          )}

          {/* Step 3 */}
          {step === 3 && (
            <div>
              <h2 className="text-xl font-semibold text-green-900 mb-2">Default filters</h2>
              <p className="text-gray-600 mb-4">
                These filters preload when you play. You can change them later in your Profile.
              </p>

              {/* Leagues */}
              <div className="rounded-xl border bg-green-50/60 p-3 mb-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Filter className="h-5 w-5 text-green-700" />
                    <span className="font-medium text-green-900">Leagues</span>
                  </div>
                </div>

                <SelectedChips
                  items={leagueIds}
                  onClear={() => setLeagueIds([])}
                  getLabel={(id) => leagueIdToLabel[id] || `League ${id}`}
                  onRemoveItem={(id) => setLeagueIds(prev => prev.filter(x => x !== id))}
                />

                <div className="max-h-64 overflow-y-auto pr-1">
                  {Object.entries(groupedLeagues)
                    .sort(([a],[b]) => a.localeCompare(b))
                    .map(([country, leagues]) => (
                      <div key={country} className="mb-2">
                        <button
                          onClick={() => setExpandedCountries(prev => ({ ...prev, [country]: !prev[country] }))}
                          className="w-full flex items-center justify-between p-2 hover:bg-green-50 rounded"
                        >
                          <div className="flex items-center gap-2">
                            {leagues?.[0]?.country_flag && (
                              <img src={leagues[0].country_flag} alt={country} className="w-6 h-4 object-cover rounded" />
                            )}
                            <span>{country}</span>
                            <span className="text-xs text-gray-500">({leagues.length})</span>
                          </div>
                          <span className="text-sm text-gray-500">{expandedCountries[country] ? 'Hide' : 'Show'}</span>
                        </button>

                        {expandedCountries[country] && (
                          <div className="ml-8 space-y-2 mt-2">
                            {leagues.map((league) => (
                              <label key={league.league_id} className="flex items-center gap-2 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={leagueIds.includes(league.league_id)}
                                  onChange={() => toggleLeague(league.league_id)}
                                  className="rounded"
                                />
                                {league.logo && (
                                  <img src={league.logo} alt={league.league_name} className="w-5 h-5 object-contain" />
                                )}
                                <span className="text-sm">{league.league_name}</span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                </div>
              </div>

              {/* Seasons + min apps */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
                <div className="md:col-span-2">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <UsersRound className="h-4 w-4 text-green-700" />
                      <span className="font-medium text-green-900">Seasons</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setSeasons(allSeasons.slice(0,5))} className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50">Last 5</button>
                      <button onClick={() => setSeasons([])} className="text-xs px-2 py-1 rounded border bg-white hover:bg-gray-50">Clear</button>
                    </div>
                  </div>

                  <SelectedChips
                    items={seasons}
                    onClear={() => setSeasons([])}
                    onRemoveItem={(season) => setSeasons(prev => prev.filter(x => x !== season))}
                  />

                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mt-2">
                    {allSeasons.map((season) => (
                      <button
                        key={season}
                        onClick={() => setSeasons(prev => prev.includes(season) ? prev.filter(s => s !== season) : [...prev, season])}
                        className={classNames(
                          'px-2 py-1 text-sm rounded-md border',
                          seasons.includes(season) ? 'bg-green-100 border-green-500 text-green-700' : 'bg-white hover:bg-gray-50'
                        )}
                      >
                        {season}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col items-center">
                  <div className="flex items-center gap-2 mb-2">
                    <UsersRound className="h-4 w-4 text-green-700" />
                    <span className="font-medium text-green-900">Minimum Appearances</span>
                  </div>
                  <input
                    type="number"
                    value={minApps}
                    onChange={(e) => setMinApps(parseInt(e.target.value) || 0)}
                    min="0" max="100"
                    className="w-full px-3 py-2 border rounded-md text-center"
                  />
                  <div className="text-xs text-gray-500 text-center mt-1">Sum of appearances across chosen leagues & seasons</div>
                </div>
              </div>

              <div className="flex justify-between mt-6">
                <button onClick={() => setStep(2)} className="inline-flex items-center gap-2 px-3 py-2 rounded border">
                  <ChevronLeft className="h-4 w-4" /> Back
                </button>
                <button onClick={finishOnboarding} disabled={finalizing} className="inline-flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white font-semibold px-4 py-2 rounded">
                  {finalizing ? 'Finishing…' : <>Finish <ChevronRight className="h-4 w-4" /></>}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
