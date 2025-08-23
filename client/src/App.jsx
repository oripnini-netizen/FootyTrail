// src/App.jsx
import React, { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import AdminPage from './pages/AdminPage.jsx';
import { supabase } from './supabase.js';
import { useAuth } from './context/AuthContext';
import ScrollToTop from './components/ScrollToTop';

// Import your pages
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import TutorialPage from './pages/TutorialPage';
import GamePage from './pages/GamePage';
import LiveGamePage from './pages/LiveGamePage';
import MyLeaguesPage from './pages/MyLeaguesPage';
import LeaderboardPage from './pages/LeaderboardPage';
import AboutPage from './pages/AboutPage';
import ProfilePage from './pages/ProfilePage';
import PostGamePage from './pages/PostGamePage';
import EliminationTournamentsPage from './pages/EliminationTournamentsPage';
import EliminationTournamentPage from './pages/EliminationTournamentPage'; // NEW

// Import your layout component
import Layout from './components/Layout';

// Create a wrapper component to use navigation hooks
const App = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  
  // Add ScrollToTop effect directly in App component
  useEffect(() => {
    window.scrollTo({ 
      top: 0, 
      behavior: 'smooth' 
    });
  }, [location.pathname]);
  
  // Handle OAuth redirect
  useEffect(() => {
    if (window.location.hash && window.location.hash.includes('access_token')) {
      console.log('OAuth redirect detected, processing session');
      console.log('Current URL:', window.location.href);
      
      // Process the OAuth response
      supabase.auth.getSession().then(({ data }) => {
        if (data.session) {
          // Force the app to stay on localhost after login
          const gamePageUrl = window.location.origin + '/game';
          console.log('Navigating to:', gamePageUrl);
          window.location.href = gamePageUrl;
        }
      });
    }
  }, []);
  
  if (loading) {
    return <div className="text-center mt-20 text-xl">Loading...</div>;
  }
  
  return (
    <Layout>
      <Routes>
        {/* Not signed in */}
        {!user && (
          <>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </>
        )}

        {/* Signed in but still needs tutorial */}
        {user && !user.has_completed_onboarding && (
          <>
            <Route path="/tutorial" element={<TutorialPage />} />
            <Route path="*" element={<Navigate to="/tutorial" replace />} />
          </>
        )}

        {/* Signed in and completed tutorial */}
        {user && user.has_completed_onboarding && (
          <>
            <Route path="/game" element={<GamePage />} />
            <Route path="/live" element={<LiveGamePage />} />
            <Route path="/my-leagues" element={<MyLeaguesPage />} />
            <Route path="/elimination-tournaments" element={<EliminationTournamentsPage />} />
            <Route path="/elimination-tournaments/:id" element={<EliminationTournamentPage />} /> {/* NEW */}
            <Route path="/leaderboard" element={<LeaderboardPage />} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/postgame" element={<PostGamePage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="*" element={<Navigate to="/game" replace />} />
          </>
        )}
      </Routes>
    </Layout>
  );
};

export default App;
