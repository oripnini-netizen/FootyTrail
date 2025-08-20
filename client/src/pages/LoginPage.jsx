// client/src/pages/LoginPage.jsx
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../supabase';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading } = useAuth(); // <- rely on AuthContext only
  const [busy, setBusy] = useState(false);
  const navigatedRef = useRef(false);

  // Once auth/profile is ready, route exactly once
  useEffect(() => {
    if (loading) return;
    if (navigatedRef.current) return;
    // If already logged in (user from public.users or minimal fallback)
    if (user?.id) {
      navigatedRef.current = true;
      const toTutorial =
        user.has_completed_onboarding === false ||
        user.has_completed_onboarding == null;
      navigate(toTutorial ? '/tutorial' : '/game', { replace: true });
    }
  }, [loading, user, navigate]);

  const signInWithGoogle = async () => {
    try {
      setBusy(true);
      await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/login`,
          queryParams: { prompt: 'select_account' },
        },
      });
    } catch (e) {
      console.error('Google sign-in error:', e);
      setBusy(false);
    }
  };

  const handleEmailSignin = async (e) => {
    e.preventDefault();
    setBusy(true);
    const email = e.target.email.value.trim();
    const password = e.target.password.value.trim();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) alert(error.message);
  };

  const handleEmailSignup = async (e) => {
    e.preventDefault();
    setBusy(true);
    const email = e.target.email.value.trim();
    const password = e.target.password.value.trim();
    const full_name = e.target.full_name.value.trim();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name },
        emailRedirectTo: `${window.location.origin}/login`,
      },
    });
    setBusy(false);
    if (error) {
      alert(error.message);
    } else {
      alert('Check your email to confirm your account.');
    }
  };

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-green-50 to-transparent flex items-center justify-center">
      <div className="fixed inset-0 -z-10 bg-gradient-to-b from-green-50 to-transparent" />
      <div className="w-[360px] bg-white p-6 rounded-2xl shadow-xl">
        <div className="text-center mb-4">
          <img src="/footytrail_logo.png" alt="FootyTrail" className="w-20 mx-auto mb-3" />
        </div>

        <button
          onClick={signInWithGoogle}
          disabled={busy}
          className="w-full py-2.5 rounded-lg border border-gray-300 bg-white mb-2 flex items-center justify-center gap-2 font-medium disabled:opacity-60"
        >
          <svg width="18" height="18" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 488 512">
            <path fill="#4285F4" d="M488 261.8C488 403.3 391.1 504 248 504 110.8 504 0 393.2 0 256S110.8 8 248 8c66.8 0 123 24.5 166.3 64.9l-67.5 64.9C258.5 52.6 94.3 116.6 94.3 256c0 86.5 69.1 156.6 153.7 156.6 98.2 0 135-70.4 140.8-106.9H248v-85.3h236.1c2.3 12.7 3.9 24.9 3.9 41.4z"/>
          </svg>
          Continue with Google
        </button>

        <hr className="my-4" />

        <form onSubmit={handleEmailSignin} className="mb-3">
          <input name="email" type="email" placeholder="Email" required className="w-full p-2.5 border border-gray-300 rounded-lg mb-2" />
          <input name="password" type="password" placeholder="Password" required className="w-full p-2.5 border border-gray-300 rounded-lg mb-2" />
          <button type="submit" disabled={busy} className="w-full p-2.5 rounded-lg bg-green-600 text-white disabled:opacity-60">
            Sign in
          </button>
        </form>

        <form onSubmit={handleEmailSignup}>
          <input name="full_name" type="text" placeholder="Full name" required className="w-full p-2.5 border border-gray-300 rounded-lg mb-2" />
          <input name="email" type="email" placeholder="Email" required className="w-full p-2.5 border border-gray-300 rounded-lg mb-2" />
          <input name="password" type="password" placeholder="Password" required className="w-full p-2.5 border border-gray-300 rounded-lg mb-2" />
          <button type="submit" disabled={busy} className="w-full p-2.5 rounded-lg bg-blue-600 text-white disabled:opacity-60">
            Sign up
          </button>
        </form>
      </div>
    </div>
  );
}
