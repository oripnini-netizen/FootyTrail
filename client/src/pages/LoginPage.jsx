import React, { useEffect, useState } from 'react';
import { supabase } from '../supabase';

export default function LoginPage() {
  const [session, setSession] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session || null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  const signInWithGoogle = async () => {
    try {
      const redirectUrl = window.location.origin + '/game';
      await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
          queryParams: { prompt: 'select_account' }
        }
      });
    } catch (e) {
      console.error("Exception during Google sign in:", e);
    }
  };

  const handleEmailSignup = async (e) => {
    e.preventDefault();
    const email = e.target.email.value.trim();
    const password = e.target.password.value.trim();
    const full_name = e.target.full_name.value.trim();
    const { error } = await supabase.auth.signUp({ email, password, options: { data: { full_name } } });
    if (error) alert(error.message); else alert('Check your email to confirm your account.');
  };

  const handleEmailSignin = async (e) => {
    e.preventDefault();
    const email = e.target.email.value.trim();
    const password = e.target.password.value.trim();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) alert(error.message);
  };

  const signOut = async () => { await supabase.auth.signOut(); };

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-green-50 to-transparent flex items-center justify-center">
      <div className="fixed inset-0 -z-10 bg-gradient-to-b from-green-50 to-transparent" />
      <div className="w-[360px] bg-white p-6 rounded-2xl shadow-xl">
        <div className="text-center mb-4">
          <img src="/footytrail_logo.png" alt="FootyTrail" className="w-20 mx-auto mb-3" />
          <h2 className="m-0 text-xl font-semibold">Sign in to FootyTrail</h2>
        </div>

        <button
          onClick={signInWithGoogle}
          className="w-full py-2.5 rounded-lg border border-gray-300 bg-white mb-2 flex items-center justify-center gap-2 font-medium"
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
          <button type="submit" className="w-full p-2.5 rounded-lg bg-green-600 text-white">Sign in</button>
        </form>

        <form onSubmit={handleEmailSignup}>
          <input name="full_name" type="text" placeholder="Full name" required className="w-full p-2.5 border border-gray-300 rounded-lg mb-2" />
          <input name="email" type="email" placeholder="Email" required className="w-full p-2.5 border border-gray-300 rounded-lg mb-2" />
          <input name="password" type="password" placeholder="Password" required className="w-full p-2.5 border border-gray-300 rounded-lg mb-2" />
          <button type="submit" className="w-full p-2.5 rounded-lg bg-blue-600 text-white">Sign up</button>
        </form>

        {session?.user && (
          <button onClick={signOut} className="w-full mt-4 p-2.5 rounded-lg border border-gray-300">
            Sign out
          </button>
        )}
      </div>
    </div>
  );
}
