// client/src/components/Navbar.jsx
import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../supabase';
import {
  TableProperties,
  Aperture,
  Trophy,
  Info,
  ShieldCheck,
  Menu,
  X,
  Axe,
} from 'lucide-react';

const SKIP_REDIRECT_KEY = 'skip_onboarding_redirect';
const SKIP_UNTIL_KEY = 'skip_onboarding_redirect_until';

export default function Navbar() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // ---- unread notifications for My Leagues ----
  const [unreadLeagues, setUnreadLeagues] = useState(0);

  async function refreshUnread() {
    try {
      if (!user?.id) {
        setUnreadLeagues(0);
        return;
      }
      const { count, error } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('type', 'league_invite')
        .is('read_at', null);

      if (!error) setUnreadLeagues(count || 0);
    } catch {
      /* noop */
    }
  }

  useEffect(() => {
    refreshUnread();
    if (!user?.id) return;

    const channel = supabase
      .channel(`notif-dot:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        () => refreshUnread()
      )
      .subscribe();

    const onMarkedRead = () => refreshUnread();
    window.addEventListener('leagues-notifications-read', onMarkedRead);

    const id = setInterval(refreshUnread, 30000);

    return () => {
      clearInterval(id);
      window.removeEventListener('leagues-notifications-read', onMarkedRead);
      try {
        supabase.removeChannel(channel);
      } catch {}
    };
  }, [user?.id]);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!user) return;
    if (location.pathname === '/tutorial') return;

    const skip = sessionStorage.getItem(SKIP_REDIRECT_KEY) === '1';
    const untilTs = parseInt(sessionStorage.getItem(SKIP_UNTIL_KEY) || '0', 10);
    const grace = Number.isFinite(untilTs) && Date.now() < untilTs;
    if (skip || grace) return;

    if (user.has_completed_onboarding === false) {
      navigate('/tutorial', { replace: true });
    }
  }, [user?.has_completed_onboarding, location.pathname, navigate]);

  useEffect(() => {
    if (user?.has_completed_onboarding) {
      try {
        sessionStorage.removeItem(SKIP_REDIRECT_KEY);
        sessionStorage.removeItem(SKIP_UNTIL_KEY);
      } catch {}
    }
  }, [user?.has_completed_onboarding]);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const NavItem = ({ title, icon: Icon, onClick, showDot = false }) => (
    <button
      onClick={onClick}
      className="relative flex flex-col items-center text-gray-500 hover:text-green-700"
      title={title}
    >
      <div className="relative">
        <Icon className="h-6 w-6" />
        {showDot ? (
          <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-white" />
        ) : null}
      </div>
      <span className="text-xs mt-1">{title}</span>
    </button>
  );

  return (
    <div
      className={`sticky top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled ? 'py-2 px-4 sm:px-6 lg:px-8' : ''
      }`}
    >
      <nav
        className={`bg-white rounded-xl transition-all duration-300 ${
          scrolled ? 'shadow-lg mx-auto max-w-7xl' : 'shadow-sm w-full'
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 relative">
            {/* Left: Logo */}
            <div className="flex items-center">
              <Link to="/game" className="flex items-center">
                <img
                  src={`${process.env.PUBLIC_URL}/footytrail_logo.png`}
                  alt="FootyTrail"
                  className="h-12 w-12"
                  style={{ objectFit: 'contain' }}
                />
              </Link>

              {user?.role === 'admin' && (
                <button
                  onClick={() => navigate('/admin')}
                  className="ml-4 hidden sm:flex flex-col items-center text-blue-600 hover:text-blue-800"
                  title="Admin"
                >
                  <ShieldCheck className="h-7 w-7" />
                  <span className="text-xs mt-1 font-semibold">Admin</span>
                </button>
              )}
            </div>

            {/* Center: Play button */}
            <div className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 mt-1">
              <button
                onClick={() => navigate('/game')}
                className="relative -mb-3 sm:-mb-4 pointer-events-auto group"
                title="Play"
              >
                <div className="rounded-full shadow-md border bg-green-900 group-hover:bg-green-800 text-white p-3 sm:p-4 flex flex-col items-center transition-all duration-300 group-hover:scale-110">
                  <Aperture className="h-7 w-7 sm:h-8 sm:w-8 group-hover:rotate-45 transition-transform duration-300" />
                  <span className="text-[10px] sm:text-xs mt-1 font-semibold">
                    Play
                  </span>
                </div>
              </button>
            </div>

            {/* Right: nav + avatar */}
            <div className="hidden md:flex items-center">
              <div className="flex items-center space-x-8 mr-8">
                <NavItem
                  title="My Leagues"
                  icon={TableProperties}
                  onClick={() => navigate('/my-leagues')}
                  showDot={unreadLeagues > 0}
                />
                <NavItem
                  title="Elimination"
                  icon={Axe}
                  onClick={() => navigate('/elimination-tournaments')}
                />
                <NavItem
                  title="Leaderboard"
                  icon={Trophy}
                  onClick={() => navigate('/leaderboard')}
                />
                <NavItem
                  title="About"
                  icon={Info}
                  onClick={() => navigate('/about')}
                />
              </div>

              <button
                onClick={() => navigate('/profile')}
                className="flex items-center justify-center transition-transform duration-200 hover:scale-110 ml-4"
                title="Profile"
              >
                {user?.profile_photo_url ? (
                  <img
                    src={user.profile_photo_url}
                    alt="avatar"
                    className="h-12 w-12 rounded-full object-cover shadow-sm hover:shadow-md"
                    onError={(e) => {
                      e.currentTarget.src =
                        'https://via.placeholder.com/48?text=' +
                        (user?.email?.[0]?.toUpperCase() || 'U');
                    }}
                  />
                ) : (
                  <div className="h-12 w-12 rounded-full bg-gray-200 hover:bg-green-100 transition-colors flex items-center justify-center text-sm text-gray-700 shadow-sm hover:shadow-md">
                    {(user?.email?.[0] || 'U').toUpperCase()}
                  </div>
                )}
              </button>
            </div>

            {/* Mobile menu */}
            <div className="flex items-center md:hidden">
              {user?.role === 'admin' && (
                <button
                  onClick={() => navigate('/admin')}
                  className="mr-2 flex flex-col items-center text-blue-600 hover:text-blue-800"
                  title="Admin"
                >
                  <ShieldCheck className="h-6 w-6" />
                  <span className="text-[10px] mt-0.5 font-semibold">Admin</span>
                </button>
              )}

              <button
                onClick={() => setMobileOpen((v) => !v)}
                className="p-2 rounded-md border hover:bg-gray-50"
                aria-label="Open menu"
              >
                {mobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
              </button>

              {mobileOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setMobileOpen(false)}
                    aria-hidden="true"
                  />
                  <div className="absolute right-2 top-16 z-50 w-56 bg-white rounded-xl shadow-lg border p-2">
                    <div className="flex flex-col divide-y">
                      <button
                        onClick={() => navigate('/my-leagues')}
                        className="relative flex items-center gap-3 p-3 hover:bg-gray-50 text-gray-700"
                      >
                        <TableProperties className="h-5 w-5" />
                        <span>My Leagues</span>
                        {unreadLeagues > 0 ? (
                          <span className="ml-auto h-2.5 w-2.5 rounded-full bg-red-500" />
                        ) : null}
                      </button>
                      <button
                        onClick={() => navigate('/elimination-tournaments')}
                        className="flex items-center gap-3 p-3 hover:bg-gray-50 text-gray-700"
                      >
                        <Axe className="h-5 w-5" />
                        <span>Elimination</span>
                      </button>
                      <button
                        onClick={() => navigate('/leaderboard')}
                        className="flex items-center gap-3 p-3 hover:bg-gray-50 text-gray-700"
                      >
                        <Trophy className="h-5 w-5" />
                        <span>Leaderboard</span>
                      </button>
                      <button
                        onClick={() => navigate('/about')}
                        className="flex items-center gap-3 p-3 hover:bg-gray-50 text-gray-700"
                      >
                        <Info className="h-5 w-5" />
                        <span>About</span>
                      </button>
                      <button
                        onClick={() => navigate('/profile')}
                        className="flex items-center gap-3 p-3 hover:bg-gray-50 text-gray-700"
                      >
                        {user?.profile_photo_url ? (
                          <img
                            src={user.profile_photo_url}
                            alt="avatar"
                            className="h-6 w-6 rounded-full object-cover"
                            onError={(e) => {
                              e.currentTarget.src =
                                'https://via.placeholder.com/24?text=' +
                                (user?.email?.[0]?.toUpperCase() || 'U');
                            }}
                          />
                        ) : (
                          <div className="h-6 w-6 rounded-full bg-gray-200 flex items-center justify-center text-[10px] text-gray-700">
                            {(user?.email?.[0] || 'U').toUpperCase()}
                          </div>
                        )}
                        <span>Profile</span>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </nav>
    </div>
  );
}
