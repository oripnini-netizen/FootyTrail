// src/App.jsx
import React, { useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from './supabase';
import { useAuth } from './context/AuthContext';

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

// Import your layout component
import Layout from './components/Layout';

// Create a wrapper component to use navigation hooks
const App = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  
  // Handle OAuth redirect
  useEffect(() => {
    if (window.location.hash && window.location.hash.includes('access_token')) {
      console.log('OAuth redirect detected, processing session');
      console.log('Hash:', window.location.hash.substring(0, 20) + '...');
      
      // Process the OAuth response
      supabase.auth.getSession().then(({ data, error }) => {
        if (error) {
          console.error('Error getting session:', error);
          return;
        }
        
        console.log('Session after redirect:', data.session ? 'Exists' : 'None');
        
        // Navigate to the appropriate page after authentication
        if (data.session) {
          console.log('User authenticated:', data.session.user.email);
          
          // Check if user has completed onboarding
          supabase
            .from('users')
            .select('has_completed_onboarding')
            .eq('id', data.session.user.id)
            .single()
            .then(({ data: userData, error: userError }) => {
              if (userError) {
                console.error('Error fetching user data:', userError);
                navigate('/game'); // Fallback to game page
                return;
              }
              
              console.log('User data:', userData);
              
              if (userData?.has_completed_onboarding) {
                console.log('Navigating to game page');
                navigate('/game');
              } else {
                console.log('Navigating to tutorial page');
                navigate('/tutorial');
              }
            });
        }
      });
    }
  }, [navigate]);
  
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
            <Route path="/leaderboard" element={<LeaderboardPage />} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/postgame" element={<PostGamePage />} />
            <Route path="*" element={<Navigate to="/game" replace />} />
          </>
        )}
      </Routes>
    </Layout>
  );
};

export default App;
