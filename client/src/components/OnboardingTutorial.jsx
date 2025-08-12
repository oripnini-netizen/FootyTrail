import React from 'react';

export default function OnboardingTutorial({ onComplete }) {
  return (
    <div className="p-8 text-center">
      <h1 className="text-2xl font-bold mb-4">Welcome to FootyTrail! ⚽</h1>
      <p className="mb-6">Let’s get started by finishing this quick tutorial.</p>
      <button
        onClick={onComplete}
        className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded"
      >
        Finish Tutorial
      </button>
    </div>
  );
}
