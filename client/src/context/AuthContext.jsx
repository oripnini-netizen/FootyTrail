import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../supabase.js'; // Make sure we have the .js extension

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    const getSessionAndUser = async () => {
      setLoading(true);
      console.log('Getting session and user...');

      try {
        const { data: { session } } = await supabase.auth.getSession();
        console.log('Session:', session ? 'exists' : 'none');
        
        const supabaseUser = session?.user;
        console.log('Supabase user:', supabaseUser ? 'exists' : 'none');

        if (supabaseUser) {
          // ננסה להביא את המשתמש מהטבלה שלנו
          const { data: existingUser, error } = await supabase
            .from('users')
            .select('*')
            .eq('id', supabaseUser.id)
            .single();

          console.log('Database user:', existingUser ? 'exists' : 'none');
          console.log('Query error:', error ? error.message : 'none');

          if (!existingUser && !error) {
            // משתמש חדש - יוצרים שורה בטבלת users
            console.log('Creating new user record');
            
            try {
              const { data: insertedUser, error: insertError } = await supabase
                .from('users')
                .insert([{
                  id: supabaseUser.id,
                  email: supabaseUser.email,
                  role: 'user',
                  has_completed_onboarding: false,
                }])
                .select()
                .single();

              if (insertError) {
                console.error('Error inserting user:', insertError);
                // Still set basic user info
                setUser({
                  id: supabaseUser.id,
                  email: supabaseUser.email,
                  has_completed_onboarding: false
                });
              } else {
                setUser(insertedUser);
              }
            } catch (e) {
              console.error('Exception inserting user:', e);
              // Still set basic user info
              setUser({
                id: supabaseUser.id,
                email: supabaseUser.email,
                has_completed_onboarding: false
              });
            }
          } else if (error && error.code !== 'PGRST116') {
            // Handle error (but ignore "no rows returned" error)
            console.error('Error fetching user:', error);
            // Still set basic user info
            setUser({
              id: supabaseUser.id,
              email: supabaseUser.email,
              has_completed_onboarding: false
            });
          } else {
            // User exists
            setUser(existingUser);
          }
        } else {
          setUser(null);
        }
      } catch (e) {
        console.error('Exception in getSessionAndUser:', e);
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    getSessionAndUser();

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('Auth state changed:', event);
      getSessionAndUser();
    });

    return () => {
      listener?.subscription.unsubscribe();
    };
  }, []);

  const refresh = async () => {
    const { data: { user: freshUser } } = await supabase.auth.getUser();
    setUser(freshUser);
  };

  const signOut = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setUser(null);
    } catch (error) {
      console.error('Error signing out:', error);
      throw error;
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, signOut, refresh }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  return useContext(AuthContext);
};
