import React from 'react';
import Navbar from './Navbar';
import { useLocation } from 'react-router-dom';

export default function Layout({ children }) {
  const location = useLocation();
  
  // Hide navbar on login and signup pages
  const hideNavbarPaths = ['/login', '/signup', '/'];
  const shouldShowNavbar = !hideNavbarPaths.includes(location.pathname);

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50">
      {shouldShowNavbar && <Navbar />}
      {children}
    </div>
  );
}
