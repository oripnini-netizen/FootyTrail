import React from 'react';

export default function MyLeaguesPage() {
  return (
    <div className="container mx-auto py-8 px-4 max-w-4xl">
      <h1 className="text-3xl font-bold mb-6">My Leagues</h1>
      
      <div className="bg-white rounded-xl shadow-md p-6 mb-6">
        <p className="text-gray-600 mb-4">
          Track your performance across different competitions and see where you rank.
        </p>
        
        <div className="bg-yellow-50 rounded-lg p-4 mb-6 border border-yellow-200">
          <div className="flex items-center gap-2 text-yellow-700">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            <span className="font-medium">League functionality coming soon</span>
          </div>
          <p className="mt-2 text-yellow-600 text-sm">
            We're currently developing the leagues feature. Check back soon for updates!
          </p>
        </div>
        
        <h2 className="text-xl font-semibold mb-4">Featured Leagues</h2>
        
        {/* Example League Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {['Premier League', 'La Liga', 'Bundesliga', 'Serie A'].map(league => (
            <div key={league} className="border rounded-lg p-4 hover:bg-gray-50 transition-colors">
              <h3 className="font-medium">{league}</h3>
              <p className="text-sm text-gray-500">Coming soon</p>
            </div>
          ))}
        </div>
      </div>
      
      <div className="bg-white rounded-xl shadow-md p-6">
        <h2 className="text-xl font-semibold mb-4">Create Your Own League</h2>
        <p className="text-gray-600 mb-4">
          Compete with friends and build your own community.
        </p>
        
        <button 
          className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
          onClick={() => alert('This feature is coming soon!')}
        >
          Create League
        </button>
      </div>
    </div>
  );
}