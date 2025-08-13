import React, { useEffect, useState } from 'react';
import { supabase } from '../supabase';

// Email/Password + שתי לחצנים ל-Google/Facebook (ללא GitHub)
// הלחצן של Google מכריח חלון בחירת חשבון (select_account)

export default function LoginPage() {
  const [session, setSession] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session || null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (s?.user) {
        // אם המשתמש כבר התחבר, ננווט בצד ה-App.jsx לפי has_completed_onboarding
        // כאן לא עושים navigate – תשאיר לאפליקציה להחליט.
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const signInWithGoogle = async () => {
    try {
      console.log("Starting Google sign in");
      
      // Use the deployed URL for production, localhost for development
      const redirectUrl = process.env.NODE_ENV === 'production' 
        ? 'https://footy-trail.vercel.app/game'
        : `${window.location.origin}/game`;
      
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

  const signInWithFacebook = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'facebook',
      options: {
        redirectTo: `${window.location.origin}/game`, // Change to redirect directly to game
      },
    });
  };

  const handleEmailSignup = async (e) => {
    e.preventDefault();
    const email = e.target.email.value.trim();
    const password = e.target.password.value.trim();
    const full_name = e.target.full_name.value.trim();

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name } },
    });
    if (error) alert(error.message);
    else alert('Check your email to confirm your account.');
  };

  const handleEmailSignin = async (e) => {
    e.preventDefault();
    const email = e.target.email.value.trim();
    const password = e.target.password.value.trim();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) alert(error.message);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <div style={{ minHeight: '100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#f5f5f5' }}>
      <div style={{ width: 360, background:'#fff', padding:24, borderRadius:12, boxShadow:'0 10px 30px rgba(0,0,0,0.08)' }}>
        <div style={{ textAlign:'center', marginBottom:16 }}>
          <img src="/footytrail_logo.png" alt="FootyTrail" style={{ width:80, marginBottom:12 }} />
          <h2 style={{ margin:0 }}>Sign in to FootyTrail</h2>
        </div>

        {/* OAuth buttons */}
        <button onClick={signInWithGoogle} style={{ width:'100%', padding:10, borderRadius:8, border:'1px solid #ddd', marginBottom:8 }}>
          Continue with Google
        </button>
        <button onClick={signInWithFacebook} style={{ width:'100%', padding:10, borderRadius:8, border:'1px solid #ddd', marginBottom:16 }}>
          Continue with Facebook
        </button>

        <hr style={{ margin:'16px 0' }} />

        {/* Email/Password – Sign In */}
        <form onSubmit={handleEmailSignin} style={{ marginBottom:12 }}>
          <input name="email" type="email" placeholder="Email" required style={{ width:'100%', padding:10, border:'1px solid #ddd', borderRadius:8, marginBottom:8 }} />
          <input name="password" type="password" placeholder="Password" required style={{ width:'100%', padding:10, border:'1px solid #ddd', borderRadius:8, marginBottom:8 }} />
          <button type="submit" style={{ width:'100%', padding:10, borderRadius:8, background:'#16a34a', color:'#fff', border:'none' }}>
            Sign in
          </button>
        </form>

        {/* Email/Password – Sign Up */}
        <form onSubmit={handleEmailSignup}>
          <input name="full_name" type="text" placeholder="Full name" required style={{ width:'100%', padding:10, border:'1px solid #ddd', borderRadius:8, marginBottom:8 }} />
          <input name="email" type="email" placeholder="Email" required style={{ width:'100%', padding:10, border:'1px solid #ddd', borderRadius:8, marginBottom:8 }} />
          <input name="password" type="password" placeholder="Password" required style={{ width:'100%', padding:10, border:'1px solid #ddd', borderRadius:8, marginBottom:8 }} />
          <button type="submit" style={{ width:'100%', padding:10, borderRadius:8, background:'#2563eb', color:'#fff', border:'none' }}>
            Sign up
          </button>
        </form>

        {session?.user && (
          <button onClick={signOut} style={{ width:'100%', marginTop:16, padding:10, borderRadius:8, border:'1px solid #ddd' }}>
            Sign out
          </button>
        )}
      </div>
    </div>
  );
}
