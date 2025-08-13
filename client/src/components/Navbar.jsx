import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { TableProperties, Aperture, Trophy, Info } from 'lucide-react';

export default function Navbar() {
  const { user } = useAuth();
  const navigate = useNavigate();

  return (
    <nav className="w-full border-b bg-white/90 backdrop-blur sticky top-0 z-50">
      <div className="relative max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        {/* Left cluster: logo/title */}
        <div
          className="flex items-center gap-2 cursor-pointer"
          onClick={() => navigate('/game')}
        >
          <img src="/footytrail_logo.png" alt="FootyTrail" className="h-8 w-8 object-contain" />
          <span className="text-lg font-semibold text-black">FootyTrail</span>
        </div>

        {/* Center: Play button only */}
        <div className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2">
          <button
            onClick={() => navigate('/game')}
            className="relative -mb-3 sm:-mb-4 pointer-events-auto"
            title="Play"
          >
            <div className="rounded-full shadow-md border bg-green-600 hover:bg-green-700 text-white p-3 sm:p-4 flex flex-col items-center">
              <Aperture className="h-7 w-7 sm:h-8 sm:w-8" />
              <span className="text-[10px] sm:text-xs mt-1 font-semibold">Play</span>
            </div>
          </button>
        </div>

        {/* Right: Navigation items + Avatar */}
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-5">
            {/* All navigation items with consistent styling */}
            <button
              onClick={() => navigate('/my-leagues')}
              className="flex flex-col items-center text-xs text-gray-700 hover:text-black"
              title="My Leagues"
            >
              <TableProperties className="h-5 w-5" />
              <span className="mt-1 hidden sm:block">My Leagues</span>
            </button>

            <button
              onClick={() => navigate('/leaderboard')}
              className="flex flex-col items-center text-xs text-gray-700 hover:text-black"
              title="Leaderboard"
            >
              <Trophy className="h-5 w-5" />
              <span className="mt-1 hidden sm:block">Leaderboard</span>
            </button>

            <button
              onClick={() => navigate('/about')}
              className="flex flex-col items-center text-xs text-gray-700 hover:text-black"
              title="About"
            >
              <Info className="h-5 w-5" />
              <span className="mt-1 hidden sm:block">About</span>
            </button>

            <button
              onClick={() => navigate('/profile')}
              className="flex items-center justify-center"
              title="Profile"
            >
              {user?.profile_photo_url ? (
                <img
                  src={user.profile_photo_url}
                  alt="avatar"
                  className="h-10 w-10 rounded-full object-cover"
                />
              ) : (
                <div className="h-10 w-10 rounded-full bg-gray-200 flex items-center justify-center text-sm text-gray-700">
                  {(user?.email?.[0] || 'U').toUpperCase()}
                </div>
              )}
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
