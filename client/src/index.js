import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';

import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';

import App from './App';
import EliminationTournamentsPage from './pages/EliminationTournamentsPage';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* New: Elimination Tournaments page */}
          <Route
            path="/elimination-tournaments"
            element={<EliminationTournamentsPage />}
          />
          {/* Everything else goes to your existing app */}
          <Route path="/*" element={<App />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
