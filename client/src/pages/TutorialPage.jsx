import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../supabase';

const TutorialPage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);

  const handleFinish = async () => {
    if (!user) return;

    setLoading(true);
    const { error } = await supabase
      .from('users')
      .update({ has_completed_onboarding: true })
      .eq('id', user.id);

    setLoading(false);

    if (error) {
      console.error('Error updating user:', error.message);
      return;
    }

    navigate('/game');
  };

  if (!user) return <div>Loading...</div>;

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
      <h1 className="text-3xl font-bold mb-4">Welcome to the Tutorial</h1>
      <p className="text-lg text-center mb-6">Let’s set you up before you start playing.</p>
      <button
        onClick={handleFinish}
        disabled={loading}
        className="px-6 py-3 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
      >
        {loading ? 'Saving...' : 'Start Playing'}
      </button>
    </div>
  );
};

export default TutorialPage;
