import React from 'react';
import Navbar from './Navbar';
import { useLocation } from 'react-router-dom';

export default function Layout({ children }) {
  const location = useLocation();
  
  // Hide navbar on login, signup, and tutorial pages
  const hideNavbarPaths = ['/login', '/signup', '/', '/tutorial'];
  const shouldShowNavbar = !hideNavbarPaths.includes(location.pathname);

  return (
    <div className="min-h-screen bg-green-50/30">
      <Navbar />
      {/* Add a small top margin to content */}
      <div className="mt-4">
        {children}
      </div>
    </div>
  );
}
