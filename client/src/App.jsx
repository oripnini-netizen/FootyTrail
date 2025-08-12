// src/App.jsx
import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
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

const App = () => {
  const { user, loading } = useAuth();

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
