import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function TutorialPage() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const handleStartPlaying = async () => {
    try {
      // If you need to update user's onboarding status
      if (user) {
        // Update user's onboarding status if needed
      }
      
      // Navigate to game page
      navigate('/game');
    } catch (error) {
      console.error('Error during tutorial completion:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50 flex flex-col items-center justify-center p-6">
      <h1 className="text-4xl font-bold mb-6">Welcome to the Tutorial</h1>
      <p className="text-xl mb-10 text-center max-w-2xl">
        Let's set you up before you start playing.
      </p>
      
      {/* Your tutorial content goes here */}
      
      <button 
        onClick={handleStartPlaying}
        className="px-8 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-lg font-medium"
      >
        Start Playing
      </button>
    </div>
  );
}
