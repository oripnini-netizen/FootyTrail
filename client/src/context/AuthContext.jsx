import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '../supabase.js';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  // This "user" is the row from public.users (not auth.users)
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // prevent duplicate inserts during rapid auth events
  const creatingRef = useRef(false);

  // Helper: fetch the profile row (0/1 row)
  const fetchProfile = async (uid) => {
    if (!uid) return null;
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', uid)
      .maybeSingle(); // avoids 406 on 0 rows
    if (error) return null;
    return data || null;
  };

  // Helper: insert a profile if missing (used ONLY on SIGNED_IN)
  const insertProfileIfMissing = async (authUser) => {
    const existing = await fetchProfile(authUser.id);
    if (existing) return existing;

    if (creatingRef.current) return null;
    creatingRef.current = true;
    const newRow = {
      id: authUser.id,
      email: authUser.email,
      full_name:
        authUser.user_metadata?.full_name ||
        authUser.user_metadata?.name ||
        '',
      profile_photo_url: authUser.user_metadata?.avatar_url || null,
      role: 'user',
      has_completed_onboarding: false,
      created_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('users')
      .insert([newRow])
      .select()
      .maybeSingle();
    creatingRef.current = false;

    if (error) return null;
    return data || null;
  };

  // Route all auth changes through a single handler so we can choose when to insert
  const handleAuth = async ({ event, session }) => {
    const authUser = session?.user || null;

    // Signed out => clear
    if (!authUser) {
      setUser(null);
      setLoading(false);
      return;
    }

    // For INITIAL_SESSION or TOKEN_REFRESHED: DO NOT INSERT. Just read.
    // For SIGNED_IN (fresh login): allow insert if missing.
    const allowInsert = event === 'SIGNED_IN';

    if (allowInsert) {
      const prof = (await insertProfileIfMissing(authUser)) ?? (await fetchProfile(authUser.id));
      setUser(prof);
      setLoading(false);
      return;
    } else {
      const prof = await fetchProfile(authUser.id);
      // If no row exists and we didn't just SIGN IN, do NOT create a row here.
      setUser(prof); // may be null; LoginPage will not redirect
      setLoading(false);
      return;
    }
  };

  useEffect(() => {
    let active = true;

    // Initial hydration: treat as INITIAL_SESSION (no insert)
    (async () => {
      setLoading(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!active) return;
      await handleAuth({ event: 'INITIAL_SESSION', session });
    })();

    // Listen to auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      handleAuth({ event, session });
    });

    return () => {
      active = false;
      subscription?.unsubscribe?.();
    };
  }, []);

  const refresh = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const authUser = session?.user || null;
    if (!authUser) {
      setUser(null);
      return;
    }
    const prof = await fetchProfile(authUser.id);
    setUser(prof);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, refresh, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
