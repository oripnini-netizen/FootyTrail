// client/src/components/Navbar.jsx
import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { TableProperties, Aperture, Trophy, Info, ShieldCheck } from 'lucide-react';

export default function Navbar() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);

  // Redirect brand–new users into onboarding
  useEffect(() => {
    if (user && user.has_completed_onboarding === false && window.location.pathname !== '/tutorial') {
      navigate('/tutorial', { replace: true });
    }
  }, [user?.has_completed_onboarding, navigate]);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div className={`sticky top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? 'py-2 px-4 sm:px-6 lg:px-8' : ''}`}>
      <nav className={`bg-white rounded-xl transition-all duration-300 ${scrolled ? 'shadow-lg mx-auto max-w-7xl' : 'shadow-sm w-full'}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            {/* Left: Logo and name */}
            <div className="flex items-center">
              <Link to="/game" className="flex items-center">
                <img
                  src={`${process.env.PUBLIC_URL}/footytrail_logo.png`}
                  alt="FootyTrail"
                  className="h-8 w-8 mr-2"
                  style={{ objectFit: 'contain' }}
                />
                <span className="text-xl font-bold text-green-800">FootyTrail</span>
              </Link>

              {user?.role === 'admin' && (
                <button
                  onClick={() => navigate('/admin')}
                  className="ml-4 flex flex-col items-center text-blue-600 hover:text-blue-800"
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
                <div className="rounded-full shadow-md border bg-green-600 group-hover:bg-green-700 text-white p-3 sm:p-4 flex flex-col items-center transition-all duration-300 group-hover:scale-110">
                  <Aperture className="h-7 w-7 sm:h-8 sm:w-8 group-hover:rotate-45 transition-transform duration-300" />
                  <span className="text-[10px] sm:text-xs mt-1 font-semibold">Play</span>
                </div>
              </button>
            </div>

            {/* Right: Navigation icons and avatar */}
            <div className="flex items-center">
              {/* Navigation icons with text labels (icon + text are both clickable) */}
              <div className="flex items-center space-x-8 mr-8">
                <button
                  onClick={() => navigate('/my-leagues')}
                  className="flex flex-col items-center text-gray-500 hover:text-green-700"
                  title="My Leagues"
                >
                  <TableProperties className="h-6 w-6" />
                  <span className="text-xs mt-1">My Leagues</span>
                </button>

                <button
                  onClick={() => navigate('/leaderboard')}
                  className="flex flex-col items-center text-gray-500 hover:text-green-700"
                  title="Leaderboard"
                >
                  <Trophy className="h-6 w-6" />
                  <span className="text-xs mt-1">Leaderboard</span>
                </button>

                <button
                  onClick={() => navigate('/about')}
                  className="flex flex-col items-center text-gray-500 hover:text-green-700"
                  title="About"
                >
                  <Info className="h-6 w-6" />
                  <span className="text-xs mt-1">About</span>
                </button>
              </div>

              {/* Avatar at far right */}
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
                    onError={(e) => { e.currentTarget.src = 'https://via.placeholder.com/48?text=' + (user?.email?.[0]?.toUpperCase() || 'U'); }}
                  />
                ) : (
                  <div className="h-12 w-12 rounded-full bg-gray-200 hover:bg-green-100 transition-colors flex items-center justify-center text-sm text-gray-700 shadow-sm hover:shadow-md">
                    {(user?.email?.[0] || 'U').toUpperCase()}
                  </div>
                )}
              </button>
            </div>
          </div>
        </div>
      </nav>
    </div>
  );
}
